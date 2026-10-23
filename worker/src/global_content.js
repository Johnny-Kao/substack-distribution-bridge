// Private, read-only global Substack POST discovery. One platform-wide page per invocation.
// No query, author identity, content or URL is returned to GitHub Actions logs.
import {readBrowserJSON} from "./subject.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export function normalizeGlobalPosts(data){
 if(!data||!Array.isArray(data.results)||typeof data.more!=="boolean"||!data.publications||typeof data.publications!=="object")throw Error("unexpected_global_post_search_response");
 const posts=[],seen=new Set();
 const pubs=new Map((Array.isArray(data.publications)?data.publications:Object.values(data.publications)).filter(p=>p&&Number.isSafeInteger(p.id)).map(p=>[p.id,p]));
 for(const p of data.results){
  if(!p||!Number.isSafeInteger(p.id)||!Number.isSafeInteger(p.publication_id)||typeof p.slug!=="string"||!/^[a-z0-9-]{1,200}$/.test(p.slug)||seen.has(p.id))continue;
  const publication=pubs.get(p.publication_id);
  const subdomain=publication?.subdomain;
  if(typeof subdomain!=="string"||!/^[a-z0-9-]{2,60}$/.test(subdomain))continue;
  const published=typeof p.post_date==="string"&&!Number.isNaN(Date.parse(p.post_date))?p.post_date:null;
  if(!published)continue;
  seen.add(p.id);
  const rawText=String(p.truncated_body_text||p.description||p.subtitle||"").slice(0,12000);
  const bodyText=rawText.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  const words=Number.isSafeInteger(p.wordcount)?p.wordcount:bodyText.split(/\s+/).length;
  posts.push({id:p.id,publication_id:p.publication_id,subdomain,title:String(p.title||"").slice(0,300),slug:p.slug,published,url:"https://"+subdomain+".substack.com/p/"+p.slug,
   excerpt:bodyText,wordcount:words,comment_count:Number(p.comment_count)||0,reaction_count:Number(p.reaction_count)||0,can_comment:p.write_comment_permissions==="everyone"||p.write_comment_permissions==="subscribers",already_liked:!!p.reaction});
 }
 return {posts,returned:data.results.length,hasMore:data.more};
}
export const MAX_POSTS_PER_SUBJECT=100;
export const POSTS_PER_PAGE=20;
export function nextGlobalCursor(cursor,numTerms,hasMore,lowYieldStreak=0){
 const page=cursor.page;
 const maxPages=Math.ceil(MAX_POSTS_PER_SUBJECT/POSTS_PER_PAGE);
 return hasMore&&page+1<maxPages&&lowYieldStreak<2
  ? {term_index:cursor.term_index,page:page+1,low_yield_streak:lowYieldStreak}
  : {term_index:(cursor.term_index+1)%numTerms,page:0,low_yield_streak:0};
}
export async function globalContentStep(req,env){
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 if(!env.BROWSER)return json({error:"browser_binding_missing"},503);
 const row=await env.DB.prepare("SELECT value FROM settings WHERE key='subject_terms'").first();
 const backup=await env.DB.prepare("SELECT value FROM settings WHERE key='keywords'").first();
 let terms;
 try{terms=[...new Set(JSON.parse(row?.value||backup?.value||"[]").filter(s=>typeof s==="string"&&s.trim().length>=2&&s.trim().length<=60).map(s=>s.trim()))].slice(0,32);}catch{return json({error:"invalid_private_subject_configuration"},503);}
 if(!terms.length)return json({error:"no_subjects_configured"},503);
 const state=await env.DB.prepare("SELECT value FROM settings WHERE key='global_post_cursor'").first();
 let cursor={};try{cursor=JSON.parse(state?.value||"{}");}catch{}
 const term_index=Number.isInteger(cursor?.term_index)&&cursor.term_index>=0?cursor.term_index%terms.length:0;
 const page=Number.isInteger(cursor?.page)&&cursor.page>=0&&cursor.page<Math.ceil(MAX_POSTS_PER_SUBJECT/POSTS_PER_PAGE)?cursor.page:0;
 const priorLowYield=Number.isInteger(cursor?.low_yield_streak)&&cursor.low_yield_streak>=0?cursor.low_yield_streak:0;
 const term=terms[term_index],id=crypto.randomUUID();
 try{
  const url="https://substack.com/api/v1/post/search?"+new URLSearchParams({query:term,page:String(page),includePlatformResults:"true",filter:"all",dateRange:"all"}).toString();
  const {posts,returned,hasMore}=normalizeGlobalPosts(await readBrowserJSON(env,url));
  // Compare with saved IDs before upsert. A page with <20% new posts counts as low-yield.
  const oldIds=posts.length?await env.DB.prepare(`SELECT id FROM global_posts WHERE id IN (${posts.map(()=>"?").join(",")})`).bind(...posts.map(p=>p.id)).all():{results:[]};
  const newlyFound=posts.length-(oldIds.results?.length||0);
  const lowYield=posts.length>0&&newlyFound/posts.length<0.2;
  const streak=lowYield?priorLowYield+1:0;
  const next=nextGlobalCursor({term_index,page},terms.length,hasMore,streak);
  const operations=posts.map(p=>env.DB.prepare("INSERT INTO global_posts(id,publication_id,subdomain,title,slug,url,published,first_subject_index,last_subject_index,excerpt,wordcount,comment_count,reaction_count,can_comment,already_liked) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_subject_index=excluded.last_subject_index,excerpt=excluded.excerpt,wordcount=excluded.wordcount,comment_count=excluded.comment_count,reaction_count=excluded.reaction_count,can_comment=excluded.can_comment,already_liked=excluded.already_liked,last_seen_at=CURRENT_TIMESTAMP").bind(p.id,p.publication_id,p.subdomain,p.title,p.slug,p.url,p.published,term_index,term_index,p.excerpt,p.wordcount,p.comment_count,p.reaction_count,p.can_comment?1:0,p.already_liked?1:0));
  // These are review candidates, NOT validated interactions. They still require
  // full article/context reading, semantic judgement and prior-state checks.
  let prequalified=0;
  for(const p of posts){
   if(prequalified>=5)break;
   const searchable=(p.title+" "+p.excerpt).toLowerCase();
   const hits=term.toLowerCase().split(/\s+/).filter(w=>w.length>2&&searchable.includes(w)).length;
   if(!hits||p.wordcount<150||p.excerpt.length<250||p.already_liked)continue;
   const ageDays=(Date.now()-Date.parse(p.published))/86400000;
   if(ageDays>45||ageDays<0)continue;
   const score=Math.min(85,30+10*hits+(ageDays<7?15:5)+(p.can_comment?10:0));
   const key=p.subdomain+":"+p.id;
   operations.push(env.DB.prepare("INSERT OR IGNORE INTO candidates(id,pub,title,url,published) VALUES(?,?,?,?,?)").bind(key,p.subdomain,p.title,p.url,p.published));
   operations.push(env.DB.prepare("INSERT OR IGNORE INTO engagement_targets(id,score,suggested_action,evidence_excerpt,evidence_signals,word_count) VALUES(?,?,?,?,?,?)").bind(key,score,p.can_comment?"comment_review":"like_review",p.excerpt.slice(0,3500),JSON.stringify({origin:"global_post_search",subject_index:term_index,comment_count:p.comment_count,reaction_count:p.reaction_count,excerpt_only:true,already_liked:p.already_liked}),p.wordcount));
   prequalified++;
  }
  operations.push(env.DB.prepare("INSERT INTO global_search_events(id,term_index,page,returned,valid_count,status) VALUES(?,?,?,?,?,'ok')").bind(id,term_index,page,returned,posts.length));
  operations.push(env.DB.prepare("INSERT INTO settings(key,value) VALUES('global_post_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(next)));
  await env.DB.batch(operations);
  const total=await env.DB.prepare("SELECT COUNT(*) AS n,COUNT(DISTINCT publication_id) AS authorship_sources FROM global_posts").first();
  return json({ok:true,entity_type:"post",returned,valid:posts.length,new_posts:newlyFound,prequalified,stored_total:total?.n||0,distinct_publications:total?.authorship_sources||0,has_more:hasMore,publication_performed:false});
 }catch(err){
  const code=String(err?.message||"unknown").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,70);
  await env.DB.prepare("INSERT INTO global_search_events(id,term_index,page,returned,valid_count,status) VALUES(?,?,?,?,?,?)").bind(id,term_index,page,0,0,code).run();
  return json({error:"global_search_failed",code,publication_performed:false},code==="browser_free_budget_or_pacing"?429:502);
 }
}
