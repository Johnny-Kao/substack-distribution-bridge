// Recover an orphaned approved Like after a Worker crash or upstream timeout.
// READ ONLY on Substack: never POST a reaction from this function.
import {verifyCloudPostLike} from "./cloud_substack_writes.js";
import {withBrowserBudget} from "./browser_budget.js";
import {sha256} from "./action_pipeline.js";

export async function reconcileOneOrphanLike(env,{verify=verifyCloudPostLike,budget=withBrowserBudget}={}){
 const db=env.DB;
 const rows=await db.prepare(
  "SELECT o.id,o.kind,o.status,o.target,o.approved_hash,o.created_at,p.state,p.body_hash,p.origin,COALESCE(g.id,a.post_id) AS post_id "+
  "FROM operations o JOIN proposals p ON p.id=o.id "+
  "LEFT JOIN global_posts g ON g.url=o.target "+
  "LEFT JOIN approved_external_posts a ON a.url=o.target "+
  "WHERE o.status='executing' ORDER BY o.created_at LIMIT 2"
 ).all();
 const pending=rows.results||[];
 if(pending.length===0)return {ok:true,status:"nothing_to_reconcile",publication_performed:false};
 if(pending.length!==1)return {ok:false,status:"multiple_orphans_manual_review",publication_performed:false};
 const row=pending[0];
 const age=Date.now()-Date.parse(String(row.created_at).replace(" ","T")+"Z");
 if(!Number.isFinite(age)||age<120000)return {ok:true,status:"still_in_flight",publication_performed:false};
 const digest=await sha256("like\u0000"+row.target+"\u0000");
 if(row.kind!=="like"||row.state!=="executing"||row.origin!=="decision_pipeline_v1"||
    row.approved_hash!==row.body_hash||digest!==row.body_hash||
    !Number.isSafeInteger(row.post_id)||row.post_id<1){
  return {ok:false,status:"orphan_identity_invalid",publication_performed:false};
 }
 let readback;
 try{readback=await budget(db,"orphan_like_readback",()=>verify(env,{target:row.target,postId:row.post_id}));}
 catch(error){
  if(error?.message==="browser_free_budget_or_pacing")
   return {ok:true,status:"browser_quota_deferred",publication_performed:false};
  return {ok:false,status:"readback_unverified",publication_performed:false};
 }
 if(!readback?.ok||readback.verified!==true||readback.authenticated!==true||typeof readback.liked!=="boolean")
  return {ok:false,status:"readback_unverified",publication_performed:false};
 if(!readback.liked){
  await db.batch([
   db.prepare("UPDATE operations SET status='unknown' WHERE id=? AND status='executing'").bind(row.id),
   db.prepare("UPDATE proposals SET state='unknown' WHERE id=? AND state='executing'").bind(row.id),
   db.prepare("UPDATE write_policy SET halted=1,reason='orphan_like_not_confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=1")
  ]);
  return {ok:false,status:"needs_manual_reconciliation",publication_performed:false};
 }
 await db.batch([
  db.prepare("UPDATE operations SET status='succeeded' WHERE id=? AND status='executing'").bind(row.id),
  db.prepare("UPDATE proposals SET state='executed' WHERE id=? AND state='executing'").bind(row.id),
  db.prepare("INSERT OR IGNORE INTO interaction_feedback(id,candidate_id,choice,source,reason,suggested_action,actual_body,outcome) SELECT ?,c.id,'like','verified_execution','',COALESCE(t.suggested_action,''),'','readback_after_interrupted_worker' FROM candidates c LEFT JOIN engagement_targets t ON t.id=c.id WHERE c.url=?")
    .bind("verified_execution:"+row.id,row.target)
 ]);
 return {ok:true,status:"liked_confirmed_after_crash",publication_performed:false};
}
