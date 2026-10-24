// Authenticated read-only thread sampling for comment proposals. No public write.
import puppeteer from "@cloudflare/puppeteer";
import {parsePostTarget} from "./cloud_substack_writes.js";
import {withBrowserBudget} from "./browser_budget.js";
const clean=s=>String(s||"").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi," ").replace(/<[^>]*>/g," ").replace(/&(?:amp|lt|gt|quot|nbsp);/g,v=>({"&amp;":"&","&lt;":"<","&gt;":">","&quot;":"\"","&nbsp;":" "}[v]||v)).replace(/\s+/g," ").trim();
export function normalizeCommentThread(payload,max=20){
 if(!payload||!Array.isArray(payload.comments))throw Error("invalid_comment_response");
 const result=[],seen=new Set();
 function walk(v,depth=0){
  if(result.length>=max||depth>8||!v||typeof v!=="object")return;
  if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}
  const id=Number(v.id);
  const body=clean(v.body||v.body_html||"").slice(0,540);
  if(Number.isSafeInteger(id)&&id>0&&body&&!seen.has(id)){
   seen.add(id);result.push({id,excerpt:body,reply_to:Number(v.parent_id)||null});
  }
  for(const key of ["children","replies","comments"])if(Array.isArray(v[key]))walk(v[key],depth+1);
 }
 walk(payload.comments);
 return {comments:result,visible_count:payload.comments.length,sampled:result.length,possibly_truncated:payload.comments.length>max||result.length>=max};
}
export async function fetchAuthenticatedThread(env,{target,postId}){
 const loc=parsePostTarget(target);
 if(!loc||!Number.isSafeInteger(postId)||postId<1)throw Error("invalid_thread_target");
 if(!env.BROWSER||typeof env.SUBSTACK_SESSION!=="string"||env.SUBSTACK_SESSION.length<20)throw Error("thread_session_unavailable");
 const browser=await puppeteer.launch(env.BROWSER);
 try{
  const page=await browser.newPage();
  await page.setCookie({name:"substack.sid",value:env.SUBSTACK_SESSION.trim(),domain:".substack.com",path:"/",httpOnly:true,secure:true});
  await page.goto("https://substack.com/",{waitUntil:"domcontentloaded",timeout:18000});
  const user=await page.evaluate(async()=>{
   const r=await fetch("/api/v1/user/profile/self",{credentials:"include"});
   const d=r.ok?await r.json().catch(()=>null):null;
   return Number.isSafeInteger(d?.id)?d.id:null;
  });
  if(!user)throw Error("thread_login_unverified");
  await page.goto("https://"+loc.host+"/",{waitUntil:"domcontentloaded",timeout:18000});
  const data=await page.evaluate(async args=>{
   const p=await fetch("/api/v1/posts/by-id/"+args.id,{credentials:"include",headers:{accept:"application/json"}});
   const obj=p.ok?await p.json().catch(()=>null):null,post=obj?.post||obj;
   if(post?.id!==args.id||post?.canonical_url!==args.canonical)return {ok:false,reason:"post_identity_mismatch"};
   const c=await fetch("/api/v1/post/"+args.id+"/comments?token=&all_comments=true&sort=most_recent_first",{credentials:"include"});
   if(!c.ok)return {ok:false,reason:"thread_unavailable"};
   return {ok:true,comments:await c.json().catch(()=>null)};
  },{id:postId,canonical:loc.url});
  if(!data?.ok)return {ok:false,reason:data?.reason||"thread_fetch_failed"};
  return {ok:true,...normalizeCommentThread(data.comments),publication_performed:false};
 }finally{await browser.close().catch(()=>{});}
}
export async function readOneCandidateThread(env,{fetcher=fetchAuthenticatedThread,budget=withBrowserBudget}={}){
 const row=await env.DB.prepare("SELECT t.id,c.url,g.id AS post_id FROM engagement_targets t JOIN candidates c ON c.id=t.id JOIN global_posts g ON c.url=g.url WHERE t.review_state='semantically_reviewed' AND json_extract(t.evidence_signals,'$.deep_review.decision')='comment_review' AND json_extract(t.evidence_signals,'$.discussion.status') IS NULL ORDER BY t.score DESC LIMIT 1").first();
 if(!row)return {ok:true,read:0,reason:"no_pending_comment_thread",publication_performed:false};
 let thread;
 try{thread=await budget(env.DB,"comment_thread_read",()=>fetcher(env,{target:row.url,postId:row.post_id}));}
 catch(err){
  const why=err?.message==="browser_free_budget_or_pacing"?"browser_quota":"thread_transport";
  return {ok:false,read:0,reason:why,publication_performed:false};
 }
 if(!thread?.ok)return {ok:false,read:0,reason:"thread_unavailable",publication_performed:false};
 const snapshot={status:"sampled",sampled:thread.sampled,visible_count:thread.visible_count,possibly_truncated:thread.possibly_truncated,comments:thread.comments};
 const updated=await env.DB.prepare("UPDATE engagement_targets SET evidence_signals=json_set(evidence_signals,'$.discussion',json(?)),updated_at=CURRENT_TIMESTAMP WHERE id=? AND json_extract(evidence_signals,'$.discussion.status') IS NULL").bind(JSON.stringify(snapshot),row.id).run();
 return {ok:true,read:updated.meta?.changes?1:0,reason:"thread_sampled",sampled:thread.sampled,publication_performed:false};
}
