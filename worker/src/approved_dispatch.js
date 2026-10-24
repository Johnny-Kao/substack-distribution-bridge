// Cloudflare-only worker for owner-approved decisions. Never discover or approve here.
// Only proposals with decision_pipeline_v1 origin and explicit approved state qualify.
import {runAuthorizedPostAction} from "./cloud_substack_writes.js";
import {withBrowserBudget} from "./browser_budget.js";
import {sha256} from "./action_pipeline.js";
export const AUTO_ORIGIN="decision_pipeline_v1";
export const MAX_APPROVED_LIKES_24H=20;
export async function executeOneApprovedDecision(env,{perform=runAuthorizedPostAction,budget=withBrowserBudget,likeOnly=false}={}){
 const db=env.DB;
 const policy=await db.prepare("SELECT halted FROM write_policy WHERE id=1").first();
 if(policy?.halted)return {ok:true,status:"paused",publication_performed:false};
 // A Worker process can terminate after the upstream POST but before saving
 // success/failure. No other approved item may run while such a claim exists.
 const unresolved=await db.prepare("SELECT COUNT(*) AS n FROM operations WHERE status IN ('executing','unknown')").first();
 if(Number(unresolved?.n||0)>0)return {ok:true,status:"needs_reconciliation",publication_performed:false};
 const row=await db.prepare("SELECT p.id,p.kind,p.target,p.body,p.body_hash,COALESCE(g.id,a.post_id) AS post_id FROM proposals p LEFT JOIN global_posts g ON g.url=p.target LEFT JOIN approved_external_posts a ON a.url=p.target WHERE COALESCE(g.id,a.post_id) IS NOT NULL AND p.state='approved' AND p.origin=? AND p.kind IN ('like','comment') AND (?=0 OR p.kind='like') ORDER BY p.approved_at,p.created_at LIMIT 1").bind(AUTO_ORIGIN,likeOnly?1:0).first();
 if(!row)return {ok:true,status:"no_approved_work",publication_performed:false};
 if(!Number.isSafeInteger(row.post_id)||row.post_id<1)return {ok:false,status:"invalid_post",publication_performed:false};
 const check=await sha256(row.kind+"\u0000"+row.target+"\u0000"+row.body);
 if(check!==row.body_hash)return {ok:false,status:"tampered_approval_hash",publication_performed:false};
 const previous=await db.prepare("SELECT status FROM operations WHERE id=? OR (target=? AND kind=? AND status IN ('unknown','succeeded','executing')) LIMIT 1").bind(row.id,row.target,row.kind).first();
 let verifiedRecovery=false;
 if(previous){
  if(previous.status==="succeeded"){
   await db.prepare("UPDATE proposals SET state='executed' WHERE id=? AND state='approved'").bind(row.id).run();
   return {ok:true,status:"already_executed",publication_performed:false};
  }
  if(previous.status==="reconciled_unliked"&&row.kind==="like"){
   const journal=await db.prepare("SELECT proposal_id FROM approved_like_recovery WHERE proposal_id=?").bind(row.id).first();
   if(!journal)return {ok:false,status:"recovery_journal_missing",publication_performed:false};
   verifiedRecovery=true;
  }else return {ok:false,status:"previous_execution_unresolved",publication_performed:false};
 }
 const recent=await db.prepare("SELECT COUNT(*) AS n FROM operations WHERE kind=? AND status IN ('executing','succeeded','unknown') AND created_at>=datetime('now','-1 day')").bind(row.kind).first();
 if(Number(recent?.n||0)>=(row.kind==="like"?MAX_APPROVED_LIKES_24H:3))return {ok:true,status:"daily_interaction_cap",publication_performed:false};
 const claim=await db.prepare("UPDATE proposals SET state='executing' WHERE id=? AND state='approved' AND origin=? AND body_hash=?").bind(row.id,AUTO_ORIGIN,row.body_hash).run();
 if(!claim.meta?.changes)return {ok:true,status:"claimed_elsewhere",publication_performed:false};
 try{
  if(verifiedRecovery){
   const reused=await db.prepare("UPDATE operations SET status='executing',created_at=CURRENT_TIMESTAMP WHERE id=? AND status='reconciled_unliked'").bind(row.id).run();
   if(!reused.meta?.changes)throw Error("recovery_claim_collision");
  }else{
   await db.prepare("INSERT INTO operations(id,kind,target,approved_hash,status) VALUES(?,?,?,?,'executing')").bind(row.id,row.kind,row.target,row.body_hash).run();
  }
  const outcome=await budget(db,"approved_"+row.kind,()=>perform(env,{target:row.target,kind:row.kind,body:row.body,postId:row.post_id,approved:true}));
  if(!outcome?.ok||outcome.verified!==true)throw Error("cloud_write_unverified");
  await db.batch([
   db.prepare("UPDATE operations SET status='succeeded',public_id=? WHERE id=? AND status='executing'").bind(outcome.public_id||null,row.id),
   db.prepare("UPDATE proposals SET state='executed' WHERE id=? AND state='executing'").bind(row.id),
   db.prepare("INSERT OR IGNORE INTO interaction_feedback(id,candidate_id,choice,source,reason,suggested_action,actual_body,outcome) SELECT ?,c.id,?,'verified_execution','',COALESCE(t.suggested_action,''),?,? FROM candidates c LEFT JOIN engagement_targets t ON t.id=c.id WHERE c.url=?").bind("verified_execution:"+row.id,row.kind,row.body,String(outcome.status||"verified"),row.target)
  ]);
  return {ok:true,status:"verified_executed",kind:row.kind,publication_performed:outcome.publication_performed===true};
 }catch(err){
  const errorCode=String(err?.message||"");
  if(/^substack_action_rejected_403_/.test(errorCode)){
   // Explicit upstream HTTP 403 is a deterministic rejected POST, not an
   // ambiguous network timeout. Mark this one operation terminal while
   // allowing other individually approved posts to proceed in this batch.
   await db.batch([
    db.prepare("UPDATE operations SET status='rejected' WHERE id=? AND status='executing'").bind(row.id),
    db.prepare("UPDATE proposals SET state='rejected' WHERE id=? AND state='executing'").bind(row.id)
   ]);
   return {ok:true,status:"declined_permission",publication_performed:false};
  }
  if(errorCode==="browser_free_budget_or_pacing"){
   // The admission gate denied entry before any browser write was attempted.
   await db.batch([
    (verifiedRecovery
      ?db.prepare("UPDATE operations SET status='reconciled_unliked' WHERE id=? AND status='executing'").bind(row.id)
      :db.prepare("DELETE FROM operations WHERE id=? AND status='executing'").bind(row.id)),
    db.prepare("UPDATE proposals SET state='approved' WHERE id=? AND state='executing'").bind(row.id)
   ]);
   return {ok:true,status:"deferred_browser_quota",publication_performed:false};
  }
  await db.batch([
   db.prepare("UPDATE operations SET status='unknown' WHERE id=? AND status='executing'").bind(row.id),
   db.prepare("UPDATE proposals SET state='unknown' WHERE id=? AND state='executing'").bind(row.id),
   db.prepare("UPDATE write_policy SET halted=1,reason='approved_decision_ambiguous',updated_at=CURRENT_TIMESTAMP WHERE id=1")
  ]);
  return {ok:false,status:"ambiguous_write_halted",publication_performed:null};
 }
}
