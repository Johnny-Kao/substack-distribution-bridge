// Private write control plane. No GitHub Actions credential can invoke these routes.
import {performVerifiedWrite,existingLikeStatus} from "./executor.js";
// Fail closed: unknown errors halt all execution until owner explicitly resumes.
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const kinds=new Set(["like","comment","note"]);
const limits={like:10,comment:3,note:2};
const encoder=new TextEncoder();
const isoDay=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Tokyo"});
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(text)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const goodId=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{8,100}$/.test(s);
const goodTarget=s=>typeof s==="string"&&s.length>=4&&s.length<=500&&/^https:\/\/([a-z0-9-]+\.)*substack\.com\//.test(s);
async function halted(db){return await db.prepare("SELECT halted,reason FROM write_policy WHERE id=1").first();}
async function stop(db,reason){await db.prepare("UPDATE write_policy SET halted=1,reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(reason).run();}
async function count(db,kind){
 const day=isoDay();
 const rows=await db.prepare("SELECT created_at,status FROM operations WHERE kind=? AND status IN ('executing','succeeded','unknown')").bind(kind).all();
 return rows.results.filter(r=>new Date(r.created_at.replace(" ","T")+"Z").toLocaleDateString("en-CA",{timeZone:"Asia/Tokyo"})===day).length;
}
async function auth(request,env){
 // Distinct capability. A scheduled-discovery token MUST NOT have write permissions.
 return typeof env.OWNER_WRITE_KEY==="string"&&env.OWNER_WRITE_KEY.length>=40&&request.headers.get("Authorization")==="Bearer "+env.OWNER_WRITE_KEY;
}
function validate(p){
 if(!p||!goodId(p.id)||!kinds.has(p.kind)||!goodTarget(p.target)||typeof p.body!=="string"||p.body.length>1200)return false;
 if(p.kind==="like"&&p.body!=="")return false;
 if(p.origin==="qc_auto"&&p.kind!=="like")return false;
 if(p.kind==="comment"&&(p.body.trim().length<20||p.body.length>750))return false;
 if(p.kind==="note"&&(p.body.trim().length<20||p.body.length>1200))return false;
 if(typeof p.origin!=="string"||!["manual","qc_auto"].includes(p.origin))return false;
 return true;
}
async function innerWriteHandler(request,env,url){
 if(!await auth(request,env))return reply({error:"owner_write_permission_required"},403);
 const db=env.DB;
 if(url.pathname==="/v1/write/policy"&&request.method==="GET"){
  const p=await halted(db);
  return reply({halted:!!p.halted,reason:p.reason,limits,auto_like_max:5,approval_for:["comment","note"],write_enabled:env.ENABLE_LIVE_WRITES==="true"});
 }
 if(url.pathname==="/v1/write/check-existing-like"&&request.method==="POST"){
  const cooling=await db.prepare("SELECT value FROM settings WHERE key='like_probe_cooldown_until'").first();
  if(cooling?.value&&Date.now()<Number(cooling.value))return reply({error:"upstream_cooldown_active"},429);
  const input=await request.json().catch(()=>null);
  if(!goodTarget(input?.target))return reply({error:"invalid_target"},400);
  try {
   const value=await existingLikeStatus(env,input.target);
   return reply({ok:true,...value,publication_performed:false});
  } catch(e) {
   const reason=String(e.message||"unknown").replace(/[^a-zA-Z0-9_:]/g,"_").slice(0,65);
   if(reason.endsWith("_http_429")){
    await db.prepare("INSERT INTO settings(key,value) VALUES('like_probe_cooldown_until',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(Date.now()+21600000)).run();
   }
   return reply({error:"read_probe_failed",reason},502);
  }
 }
 if(url.pathname==="/v1/write/dry-run"&&request.method==="POST"){
  const input=await request.json().catch(()=>null);
  if(!validate(input))return reply({error:"invalid_proposal"},400);
  const bodyHash=await digest(input.kind+"\u0000"+input.target+"\u0000"+input.body);
  const same=await db.prepare("SELECT id,state FROM proposals WHERE kind=? AND target=? AND body_hash=?").bind(input.kind,input.target,bodyHash).first();
  return reply({dry_run:true,accepted:!same,duplicate:same||null,proposal_id:input.id,content_hash:bodyHash,requires_approval:input.kind!=="like"||input.origin!=="qc_auto",live_writes_disabled:env.ENABLE_LIVE_WRITES!=="true"});
 }
 if(url.pathname==="/v1/write/ai-draft"&&request.method==="POST"){
  if((await halted(db))?.halted)return reply({error:"write_operations_halted"},423);
  const input=await request.json().catch(()=>null);
  if(!input||!["comment","note"].includes(input.kind)||typeof input.article!=="string"||input.article.trim().length<150||input.article.length>9000)return reply({error:"invalid_draft_context"},400);
  if(!env.AI)return reply({error:"ai_not_configured"},503);
  const usage=await db.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE created_at>=datetime('now','-1 day')").first();
  if((usage?.n||0)>=8)return reply({error:"private_ai_daily_cap_reached"},429);
  const isComment=input.kind==="comment";
  const instructions=isComment
    ?"Propose ONE thoughtful English Substack comment, 40-100 words. Reference an actual argument in the source, add a non-obvious observation or question. Never flatter generically, invent evidence, advertise, or add URLs."
    :"Draft ONE concise original English Substack Note, 40-90 words, with a concrete thought-provoking hook. No generic praise, invented claims, URLs, or promotional copy.";
  const output=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8",{
   messages:[{role:"system",content:"You are a careful editorial assistant. Use only the supplied text. Return only the proposed draft, without a preface."},{role:"user",content:instructions+"\n\nSOURCE ARTICLE:\n"+input.article}],
   max_tokens:260
  });
  const draft=typeof output?.response==="string"?output.response.trim():"";
  if(!draft||draft.length>1800)throw Error("unusable_private_ai_output");
  await db.prepare("INSERT INTO ai_usage(id,kind) VALUES(?,?)").bind(crypto.randomUUID(),input.kind).run();
  return reply({ok:true,kind:input.kind,draft,requires_user_approval:true,publication_performed:false});
 }
 if(url.pathname==="/v1/write/propose"&&request.method==="POST"){
  const p=await halted(db);if(p.halted)return reply({error:"write_operations_halted"},423);
  const input=await request.json().catch(()=>null);if(!validate(input))return reply({error:"invalid_proposal"},400);
  if(await count(db,input.kind)>=limits[input.kind])return reply({error:"daily_quota_reached"},429);
  if(input.kind==="like"&&input.origin==="qc_auto"){
   const autoUsed=await db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind='like' AND origin='qc_auto' AND DATE(created_at)>=DATE('now','-1 day')").first();
   if((autoUsed?.n||0)>=5)return reply({error:"automatic_like_quota_reached"},429);
  }
  const hash=await digest(input.kind+"\u0000"+input.target+"\u0000"+input.body);
  const exists=await db.prepare("SELECT id,state FROM proposals WHERE id=? OR (kind=? AND target=? AND body_hash=?)").bind(input.id,input.kind,input.target,hash).first();
  if(exists)return reply({error:"duplicate_proposal",proposal_id:exists.id},409);
  await db.prepare("INSERT INTO proposals(id,kind,target,body,body_hash,origin) VALUES(?,?,?,?,?,?)").bind(input.id,input.kind,input.target,input.body,hash,input.origin).run();
  return reply({ok:true,proposal_id:input.id,state:"proposed",content_hash:hash});
 }
 if(url.pathname==="/v1/write/approve-batch"&&request.method==="POST"){
  const p=await halted(db);if(p.halted)return reply({error:"write_operations_halted"},423);
  const input=await request.json().catch(()=>null);
  if(!input||!Array.isArray(input.items)||input.items.length<1||input.items.length>10)return reply({error:"invalid_batch"},400);
  if(new Set(input.items.map(x=>x?.id)).size!==input.items.length)return reply({error:"duplicate_approval_ids"},400);
  // All approval items pin id AND exact hash. No target or content substitution.
  for(const item of input.items){
    if(!goodId(item?.id)||typeof item.hash!=="string"||!/^[a-f0-9]{64}$/.test(item.hash))return reply({error:"invalid_approval"},400);
    const row=await db.prepare("SELECT state,body_hash FROM proposals WHERE id=?").bind(item.id).first();
    if(!row||row.state!=="proposed"||row.body_hash!==item.hash)return reply({error:"approval_mismatch"},409);
  }
  // Transactional batch; D1 batch executes atomically and prevents partial approval.
  await db.batch(input.items.map(item=>db.prepare("UPDATE proposals SET state='approved',approved_at=CURRENT_TIMESTAMP WHERE id=? AND state='proposed' AND body_hash=?").bind(item.id,item.hash)));
  return reply({ok:true,approved:input.items.length,publication_performed:false});
 }
 if(url.pathname==="/v1/write/status"&&request.method==="GET"){
  const state=await halted(db);const rows=await db.prepare("SELECT id,kind,origin,state,created_at FROM proposals ORDER BY created_at DESC LIMIT 20").all();
  return reply({halted:!!state.halted,proposals:rows.results});
 }
 if(url.pathname==="/v1/write/execute"&&request.method==="POST"){
  if(env.ENABLE_LIVE_WRITES!=="true")return reply({error:"live_writes_disabled"},423);
   if((await halted(db))?.halted)return reply({error:"write_operations_halted"},423);
   const input=await request.json().catch(()=>null);
   if(!goodId(input?.id))return reply({error:"invalid_operation_id"},400);
   const row=await db.prepare("SELECT * FROM proposals WHERE id=?").bind(input.id).first();
   if(!row||row.state!=="approved")return reply({error:"not_approved"},403);
   if(row.kind==="like"&&row.origin==="qc_auto")return reply({error:"automatic_qc_not_yet_proven"},423);
   const existing=await db.prepare("SELECT id FROM operations WHERE kind=? AND target=? AND status IN ('executing','succeeded','unknown')").bind(row.kind,row.target).first();
   if(existing)return reply({error:"target_already_handled"},409);
   const max=limits[row.kind];
   // Quota and unique operation claim happen in one serialized D1 statement.
   const claim=await db.prepare("INSERT OR IGNORE INTO operations(id,kind,target,approved_hash,status) SELECT ?,?,?,?,'executing' WHERE (SELECT COUNT(*) FROM operations WHERE kind=? AND status IN ('executing','succeeded','unknown') AND DATE(created_at,'+9 hours')=DATE('now','+9 hours'))<?")
    .bind(row.id,row.kind,row.target,row.body_hash,row.kind,max).run();
   if(!claim.meta?.changes)return reply({error:"already_claimed_or_daily_cap"},409);
   try{
    const result=await performVerifiedWrite(env,row);
    if(!result.verified)throw Error("upstream_result_unverified");
    await db.prepare("UPDATE operations SET status='succeeded',public_id=? WHERE id=? AND status='executing'").bind(result.public_id,row.id).run();
    await db.prepare("UPDATE proposals SET state='sent' WHERE id=? AND state='approved'").bind(row.id).run();
    return reply({ok:true,verified:true,operation_id:row.id,public_id:result.public_id,already_existed:!!result.already_existed});
   }catch(_error){
    await db.prepare("UPDATE operations SET status='unknown' WHERE id=? AND status='executing'").bind(row.id).run();
    await stop(db,"upstream_write_error_or_unverified");
    return reply({error:"operation_unknown_and_halted",operation_id:row.id},503);
   }
 }
 if(url.pathname==="/v1/write/halt"&&request.method==="POST"){
  await stop(db,"owner_stop");return reply({ok:true,halted:true});
 }
 if(url.pathname==="/v1/write/resume"&&request.method==="POST"){
  await db.prepare("UPDATE write_policy SET halted=0,reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
  return reply({ok:true,halted:false});
 }
 return reply({error:"not_found"},404);
}

export async function writeHandler(request,env,url){
 try{return await innerWriteHandler(request,env,url);}
 catch(_error){
  const code=String(_error?.message||"unknown").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,75);
  try{await stop(env.DB,"write_control_error:"+code);}catch{}
  return reply({error:"write_control_halted"},503);
 }
}
