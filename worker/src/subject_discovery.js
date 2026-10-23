// Topic -> global publication discovery. Read-only Substack request, private D1.
// All search terms originate in existing private Worker settings, never URL inputs.
import {readBrowserJSON} from "./subject.js";
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const validSubject=s=>typeof s==="string"&&s.length>=2&&s.length<=60;
const validSubdomain=s=>typeof s==="string"&&/^[a-z0-9-]{2,60}$/.test(s);

export function cleanPublications(data){
 if(!data||!Array.isArray(data.results)||typeof data.more!=="boolean")throw Error("unexpected_subject_search_response");
 const seen=new Set();
 const publications=[];
 for(const item of data.results){
  if(!item||!Number.isSafeInteger(item.id)||!validSubdomain(item.subdomain)||seen.has(item.id))continue;
  seen.add(item.id);
  publications.push({id:item.id,subdomain:item.subdomain,name:String(item.name||"").slice(0,140)});
 }
 return {publications,hasMore:data.more,returned:data.results.length};
}
export function nextSearchCursor(cursor,numTerms,hasMore,maxPages=4){
 const start=Number.isInteger(cursor?.term_index)&&cursor.term_index>=0?cursor.term_index%numTerms:0;
 const page=Number.isInteger(cursor?.page)&&cursor.page>=0?cursor.page:0;
 return hasMore&&page+1<maxPages ? {term_index:start,page:page+1} : {term_index:(start+1)%numTerms,page:0};
}
export async function runSubjectDiscovery(req,env){
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 if(!env.BROWSER)return json({error:"browser_binding_missing"},503);
 const setting=await env.DB.prepare("SELECT value FROM settings WHERE key='subject_terms'").first();
 const fallback=await env.DB.prepare("SELECT value FROM settings WHERE key='keywords'").first();
 let terms;
 try{
  const raw=JSON.parse(setting?.value||fallback?.value||"[]");
  terms=Array.isArray(raw)?[...new Set(raw.filter(validSubject).map(x=>x.trim()))].slice(0,32):[];
 }catch{return json({error:"invalid_private_subject_configuration"},503);}
 if(!terms.length)return json({error:"no_subjects_configured"},503);
 const state=await env.DB.prepare("SELECT value FROM settings WHERE key='subject_cursor'").first();
 let cursor;
 try{cursor=JSON.parse(state?.value||"{}");}catch{cursor={};}
 const term_index=Number.isInteger(cursor?.term_index)&&cursor.term_index>=0?cursor.term_index%terms.length:0;
 const page=Number.isInteger(cursor?.page)&&cursor.page>=0&&cursor.page<4?cursor.page:0;
 const query=terms[term_index],id=crypto.randomUUID();
 try{
  const url="https://substack.com/api/v1/publication/search?"+new URLSearchParams({query,page:String(page),limit:"25",sort:"relevance"}).toString();
  const data=cleanPublications(await readBrowserJSON(env,url));
  const operations=[];
  for(const pub of data.publications){
   operations.push(
    env.DB.prepare("INSERT OR IGNORE INTO discovered_publications(id,subdomain,name,first_match,last_match) VALUES(?,?,?,?,?)")
     .bind(pub.id,pub.subdomain,pub.name,query,query),
    env.DB.prepare("UPDATE discovered_publications SET last_match=?,last_seen_at=CURRENT_TIMESTAMP,name=? WHERE id=?")
     .bind(query,pub.name,pub.id)
   );
  }
  const next=nextSearchCursor({term_index,page},terms.length,data.hasMore);
  operations.push(
   env.DB.prepare("INSERT INTO subject_search_events(id,term_index,page,returned,valid_count,status) VALUES(?,?,?,?,?,'ok')")
    .bind(id,term_index,page,data.returned,data.publications.length),
   env.DB.prepare("INSERT INTO settings(key,value) VALUES('subject_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(JSON.stringify(next))
  );
  await env.DB.batch(operations);
  const total=await env.DB.prepare("SELECT COUNT(*) AS n FROM discovered_publications").first();
  return json({ok:true,source:"authenticated_substack_publication_search",returned:data.returned,valid:data.publications.length,stored_total:total?.n||0,next_page:next.page,publication_performed:false});
 }catch(err){
  const code=String(err?.message||"unknown").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,70);
  await env.DB.prepare("INSERT INTO subject_search_events(id,term_index,page,returned,valid_count,status) VALUES(?,?,?,?,?,?)")
   .bind(id,term_index,page,0,0,code).run();
  return json({error:"subject_search_failed",code,publication_performed:false},code==="browser_free_budget_or_pacing"?429:502);
 }
}
