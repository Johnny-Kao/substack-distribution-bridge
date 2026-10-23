// Private pull-based execution queue. The runner receives only explicitly approved work.
const respond=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
export async function runnerHandler(req,env,url){
 if(!env.RUNNER_KEY||req.headers.get("Authorization")!=="Bearer "+env.RUNNER_KEY)return respond({error:"unauthorized"},403);
 const db=env.DB;
 if(url.pathname==="/v1/runner/health"&&req.method==="GET")return respond({ok:true,runner:true});
 if(url.pathname==="/v1/runner/next"&&req.method==="POST"){
  const policy=await db.prepare("SELECT halted FROM write_policy WHERE id=1").first();
  if(policy?.halted)return respond({halted:true,job:null});
  const row=await db.prepare("SELECT * FROM proposals WHERE state='approved' AND origin='manual' ORDER BY approved_at LIMIT 1").first();
  if(!row)return respond({job:null});
  const cap={like:10,comment:3,note:2}[row.kind];
  const usage=await db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind=? AND status IN ('executing','succeeded','unknown') AND DATE(created_at,'+9 hours')=DATE('now','+9 hours')").bind(row.kind).first();
  if(usage.n>=cap)return respond({job:null,quota_reached:true});
  const existing=await db.prepare("SELECT id FROM operations WHERE target=? AND kind=? AND status IN ('executing','succeeded','unknown')").bind(row.target,row.kind).first();
  if(existing)return respond({job:null,already_handled:true});
  // Conditional D1 batch: insert occurs only if conditional update succeeds.
  const claim=await db.batch([
   db.prepare("UPDATE proposals SET state='executing' WHERE id=? AND state='approved'").bind(row.id),
   db.prepare("INSERT OR IGNORE INTO operations(id,kind,target,approved_hash,status) SELECT id,kind,target,body_hash,'executing' FROM proposals WHERE id=? AND state='executing'").bind(row.id)
  ]);
  if(claim[0].meta?.changes!==1||claim[1].meta?.changes!==1)return respond({job:null});
  return respond({job:{id:row.id,kind:row.kind,target:row.target,body:row.body,hash:row.body_hash}});
 }
 if(url.pathname==="/v1/runner/complete"&&req.method==="POST"){
  const input=await req.json().catch(()=>null);
  if(!input||typeof input.id!=="string"||!["verified","unknown"].includes(input.outcome))return respond({error:"bad_request"},400);
  const operation=await db.prepare("SELECT * FROM operations WHERE id=?").bind(input.id).first();
  if(!operation||operation.status!=="executing")return respond({error:"not_claimed"},409);
  if(input.outcome==="verified"&&typeof input.public_id==="string"&&input.public_id.length<100){
   await db.batch([
    db.prepare("UPDATE operations SET status='succeeded',public_id=? WHERE id=? AND status='executing'").bind(input.public_id,input.id),
    db.prepare("UPDATE proposals SET state='sent' WHERE id=? AND state='executing'").bind(input.id)
   ]);
   return respond({ok:true,verified:true});
  }
  await db.batch([
   db.prepare("UPDATE operations SET status='unknown' WHERE id=? AND status='executing'").bind(input.id),
   db.prepare("UPDATE write_policy SET halted=1,reason='runner_unknown_result',updated_at=CURRENT_TIMESTAMP WHERE id=1")
  ]);
  return respond({ok:true,halted:true});
 }
 return respond({error:"not_found"},404);
}
