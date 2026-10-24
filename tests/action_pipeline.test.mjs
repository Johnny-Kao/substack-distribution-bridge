import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {actionStage,autoStageDeepLike,sha256,stageApprovedDecisionCandidate} from "../worker/src/action_pipeline.js";
import {executeOneApprovedDecision} from "../worker/src/approved_dispatch.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
test("candidate lifecycle makes next action explicit",()=>{
 assert.equal(actionStage({deepDecision:"skip"}),"rejected");
 assert.equal(actionStage({deepDecision:"comment_review"}),"needs_discussion_and_exact_comment");
 assert.equal(actionStage({deepDecision:"like_review"}),"ready_to_propose_like");
 assert.equal(actionStage({deepDecision:"like_review",proposalState:"proposed"}),"awaiting_approval");
 assert.equal(actionStage({deepDecision:"like_review",proposalState:"approved"}),"approved_for_execution");
 assert.equal(actionStage({deepDecision:"like_review",proposalState:"executed"}),"executed");
 assert.equal(actionStage({deepDecision:"like_review",alreadyHandled:true}),"already_executed_or_uncertain");
});
function fixture({approved=true,halted=false,kind="like",body="",prior=null,quota=0,unresolved=0}={}){
 const target="https://sample.substack.com/p/test";
 const proposal={id:"decision_12345678",kind,target,body,body_hash:"",state:approved?"approved":"proposed",origin:"decision_pipeline_v1",post_id:123};
 const calls=[];
 const DB={calls,proposal,prepare(sql){
  const stmt={sql,params:[],bind(...args){this.params=args;return this;},
   async first(){
    if(sql.includes("FROM write_policy"))return {halted:halted?1:0};
    if(sql.includes("FROM proposals p LEFT JOIN global_posts"))return approved?proposal:null;
    if(sql.includes("FROM operations WHERE status IN ('executing','unknown')"))return {n:unresolved};
    if(sql.includes("FROM operations WHERE id="))return prior;
    if(sql.includes("COUNT(*) AS n"))return {n:quota};
    return null;
   },
   async run(){
    calls.push({sql,params:this.params});
    return {meta:{changes:1}};
   }};
  return stmt;
 },async batch(stmts){for(const x of stmts)calls.push({sql:x.sql,params:x.params});}};
 return DB;
}
test("cron does nothing without exact approved proposal",async()=>{
 const DB=fixture({approved:false});let writes=0;
 const r=await executeOneApprovedDecision({DB},{perform:async()=>{writes++},budget:async()=>{writes++}});
 assert.equal(r.status,"no_approved_work");assert.equal(writes,0);assert.equal(DB.calls.length,0);
});
test("orphaned executing or unknown write blocks every other approved post",async()=>{
 const DB=fixture({unresolved:1});
 let externalWrites=0;
 const result=await executeOneApprovedDecision({DB},{perform:async()=>{externalWrites++;},budget:async()=>{externalWrites++;}});
 assert.equal(result.ok,true);
 assert.equal(result.status,"needs_reconciliation");
 assert.equal(result.publication_performed,false);
 assert.equal(externalWrites,0);
 assert.equal(DB.calls.length,0);
});
test("cron respects owner stop policy",async()=>{
 const DB=fixture({halted:true});let writes=0;
 const r=await executeOneApprovedDecision({DB},{perform:async()=>{writes++}});
 assert.equal(r.status,"paused");assert.equal(writes,0);
});
test("unknown previous operation must never be repeated",async()=>{
 const DB=fixture({prior:{status:"unknown"}});DB.proposal.body_hash=await sha256("like\u0000"+DB.proposal.target+"\u0000");
 let writes=0;
 const r=await executeOneApprovedDecision({DB},{perform:async()=>{writes++}});
 assert.equal(r.status,"previous_execution_unresolved");assert.equal(writes,0);
});
test("approved exact Like is executed once, checked, and marked complete",async()=>{
 const DB=fixture();DB.proposal.body_hash=await sha256("like\u0000"+DB.proposal.target+"\u0000");
 const calls=[];
 const outcome=await executeOneApprovedDecision({DB},{perform:async(_env,arg)=>{calls.push(arg);return {ok:true,verified:true,public_id:"post-123",publication_performed:true};},budget:async(_db,_kind,fn)=>fn()});
 assert.equal(outcome.status,"verified_executed");assert.equal(outcome.publication_performed,true);
 assert.equal(calls.length,1);assert.equal(calls[0].postId,123);assert.equal(calls[0].approved,true);
 assert.ok(DB.calls.some(x=>x.sql.includes("UPDATE operations SET status='succeeded'")));
 assert.ok(DB.calls.some(x=>x.sql.includes("UPDATE proposals SET state='executed'")));
});
test("network ambiguity halts further interactions",async()=>{
 const DB=fixture();DB.proposal.body_hash=await sha256("like\u0000"+DB.proposal.target+"\u0000");
 const outcome=await executeOneApprovedDecision({DB},{perform:async()=>{throw Error("unknown network outcome");},budget:async(_db,_kind,fn)=>fn()});
 assert.equal(outcome.status,"ambiguous_write_halted");assert.equal(outcome.publication_performed,null);
 assert.ok(DB.calls.some(x=>x.sql.includes("SET halted=1")));
});
test("known Substack 403 rejection cannot halt unrelated owner-approved Likes",async()=>{
 const DB=fixture();DB.proposal.body_hash=await sha256("like\u0000"+DB.proposal.target+"\u0000");
 const result=await executeOneApprovedDecision({DB},{perform:async()=>{throw Error("substack_action_rejected_403_subscription_required");},budget:async(_db,_kind,fn)=>fn()});
 assert.equal(result.ok,true);assert.equal(result.status,"declined_permission");
 assert.equal(result.publication_performed,false);
 assert.ok(DB.calls.some(x=>x.sql.includes("UPDATE operations SET status='rejected'")));
 assert.ok(DB.calls.some(x=>x.sql.includes("UPDATE proposals SET state='rejected'")));
 assert.ok(!DB.calls.some(x=>x.sql.includes("SET halted=1")));
});
test("quota admission denial safely defers without making a write",async()=>{
 const DB=fixture();DB.proposal.body_hash=await sha256("like\u0000"+DB.proposal.target+"\u0000");let calls=0;
 const outcome=await executeOneApprovedDecision({DB},{perform:async()=>{calls++},budget:async()=>{throw Error("browser_free_budget_or_pacing");}});
 assert.equal(outcome.status,"deferred_browser_quota");assert.equal(calls,0);
 assert.ok(DB.calls.some(x=>x.sql.includes("SET state='approved'")));
});
test("malformed and forged AI proposal cannot bypass exact user-context requirement",async()=>{
 let reads=0;const env={DB:{prepare(){reads++;throw Error("unexpected DB read");}}};
 const r=await stageApprovedDecisionCandidate(env,{id:"sample:123",kind:"comment",body:"A good comment discussing the source",discussionReviewed:false});
 assert.equal(r.error,"exact_body_or_discussion_review_required");assert.equal(reads,0);
});
test("a valid deep Like can be privately staged but never posted",async()=>{
 const url="https://sample.substack.com/p/test",changes=[];
 const env={DB:{prepare(sql){return {bind(...args){this.args=args;return this;},async first(){if(sql.includes("COUNT(*)"))return {n:0};return null;},async run(){changes.push(sql);return {meta:{changes:1}};}};}}};
 const result=await autoStageDeepLike(env,{url,score:78},{decision:"like_review"});
 assert.equal(result.state,"awaiting_approval");
 assert.equal(changes.length,1);
 assert.ok(changes[0].includes("INSERT OR IGNORE INTO proposals"));
});
