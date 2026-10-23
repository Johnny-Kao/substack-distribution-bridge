// Private write control plane. No GitHub Actions credential can invoke these routes.
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
export async function writeHandler(request,env,url){
 if(!await auth(request,env))return reply({error:"owner_write_permission_required"},403);
 const db=env.DB;
 if(url.pathname==="/v1/write/policy"&&request.method==="GET"){
  const p=await halted(db);
  return reply({halted:!!p.halted,reason:p.reason,limits,auto_like_max:5,approval_for:["comment","note"],write_enabled:env.ENABLE_LIVE_WRITES==="true"});
 }
 if(url.pathname==="/v1/write/dry-run"&&request.method==="POST"){
  const input=await request.json().catch(()=>null);
  if(!validate(input))return reply({error:"invalid_proposal"},400);
  const bodyHash=await digest(input.kind+"\u0000"+input.target+"\u0000"+input.body);
  const same=await db.prepare("SELECT id,state FROM proposals WHERE kind=? AND target=? AND body_hash=?").bind(input.kind,input.target,bodyHash).first();
  return reply({dry_run:true,accepted:!same,duplicate:same||null,proposal_id:input.id,content_hash:bodyHash,requires_approval:input.kind!=="like"||input.origin!=="qc_auto",live_writes_disabled:env.ENABLE_LIVE_WRITES!=="true"});
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
  // No live execution until separately verified with real authenticated readback.
  // This is intentionally NOT bypassed by having a valid write credential.
  if(env.ENABLE_LIVE_WRITES!=="true")return reply({error:"live_writes_disabled"},423);
  return reply({error:"executor_not_yet_validated"},501);
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
