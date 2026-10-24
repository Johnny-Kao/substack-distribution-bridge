// Recovery of exactly one ambiguous Like from the explicitly approved,
// digest-pinned batch. This function never sends a public reaction.
// Two separate authenticated negative observations must precede the one
// permitted re-attempt. The original interruption remains journaled.
import {verifyPinnedLikeBatch} from "./sealed_like_batch.js";
import {verifyCloudPostLike} from "./cloud_substack_writes.js";
import {withBrowserBudget} from "./browser_budget.js";
import {sha256} from "./action_pipeline.js";

export async function recoverOnePinnedUnknownLike(env,envelope,{
 verifyBatch=verifyPinnedLikeBatch,
 verify=verifyCloudPostLike,
 budget=withBrowserBudget
}={}){
 const receipt=await verifyBatch(envelope,env.APPROVED_COMMENT_PRIVATE_PEM);
 if(!receipt?.ok)return {ok:false,status:"owner_approval_unverified",publication_performed:false};
 const db=env.DB;
 const policy=await db.prepare("SELECT halted,reason FROM write_policy WHERE id=1").first();
 if(policy?.halted!==1||policy?.reason!=="orphan_like_not_confirmed")
  return {ok:false,status:"recovery_policy_not_eligible",publication_performed:false};
 const unresolved=await db.prepare(
  "SELECT o.id,o.status,o.target,o.approved_hash,p.state,p.body_hash,p.origin,"+
  "COALESCE(g.id,a.post_id) AS post_id FROM operations o JOIN proposals p ON p.id=o.id "+
  "LEFT JOIN global_posts g ON g.url=o.target LEFT JOIN approved_external_posts a ON a.url=o.target "+
  "WHERE o.status IN ('executing','unknown') LIMIT 2"
 ).all();
 const rows=unresolved?.results||[];
 if(rows.length!==1||rows[0].status!=="unknown"||rows[0].state!=="unknown"||rows[0].origin!=="decision_pipeline_v1")
  return {ok:false,status:"recovery_target_not_unique",publication_performed:false};
 const row=rows[0];
 const pinned=receipt.batch.posts.find(p=>p.url===row.target&&p.post_id===row.post_id);
 if(!pinned||row.body_hash!==row.approved_hash||row.body_hash!==await sha256("like\u0000"+row.target+"\u0000"))
  return {ok:false,status:"owner_approval_target_mismatch",publication_performed:false};
 // This table is a permanent once-per-proposal recovery audit and retry guard.
 await db.prepare("CREATE TABLE IF NOT EXISTS approved_like_recovery (proposal_id TEXT PRIMARY KEY,observed_liked INTEGER NOT NULL DEFAULT 0,reopened_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
 const prior=await db.prepare("SELECT proposal_id FROM approved_like_recovery WHERE proposal_id=?").bind(row.id).first();
 if(prior)return {ok:false,status:"one_recovery_already_used",publication_performed:false};
 let state;
 try{state=await budget(db,"unknown_like_recheck",()=>verify(env,{target:row.target,postId:row.post_id}));}
 catch(e){
  return {ok:true,status:e?.message==="browser_free_budget_or_pacing"?"browser_quota_deferred":"readback_deferred",publication_performed:false};
 }
 if(state?.ok!==true||state.verified!==true||state.authenticated!==true||typeof state.liked!=="boolean")
  return {ok:false,status:"reaction_state_unverified",publication_performed:false};
 if(state.liked){
  await db.batch([
   db.prepare("UPDATE operations SET status='succeeded' WHERE id=? AND status='unknown'").bind(row.id),
   db.prepare("UPDATE proposals SET state='executed' WHERE id=? AND state='unknown'").bind(row.id),
   db.prepare("INSERT OR IGNORE INTO interaction_feedback(id,candidate_id,choice,source,reason,suggested_action,actual_body,outcome) SELECT ?,c.id,'like','verified_execution','',COALESCE(t.suggested_action,''),'','reconciled_positive_readback' FROM candidates c LEFT JOIN engagement_targets t ON t.id=c.id WHERE c.url=?").bind("verified_execution:"+row.id,row.target),
   db.prepare("UPDATE write_policy SET halted=0,reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND halted=1 AND reason='orphan_like_not_confirmed'")
  ]);
  return {ok:true,status:"confirmed_existing_like_and_resumed",publication_performed:false};
 }
 // Prior independent reconciliation observed liked=false and set the exact
 // policy reason. This fresh second negative read justifies ONE re-attempt of
 // the same previously owner-approved absolute-state Like, not an unapproved post.
 await db.batch([
  db.prepare("INSERT INTO approved_like_recovery(proposal_id,observed_liked) VALUES(?,0)").bind(row.id),
  db.prepare("UPDATE operations SET status='reconciled_unliked' WHERE id=? AND status='unknown'").bind(row.id),
  db.prepare("UPDATE proposals SET state='approved' WHERE id=? AND state='unknown' AND body_hash=?").bind(row.id,row.body_hash),
  db.prepare("UPDATE write_policy SET halted=0,reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND halted=1 AND reason='orphan_like_not_confirmed'")
 ]);
 return {ok:true,status:"reconfirmed_unliked_requeued_once",publication_performed:false,requires_approved_dispatch:true};
}
