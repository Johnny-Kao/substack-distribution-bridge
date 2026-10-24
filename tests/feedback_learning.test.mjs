import test from "node:test";
import assert from "node:assert/strict";
import {makePreferenceContext,recordFeedback,feedbackEventId} from "../worker/src/feedback_learning.js";
test("likes, comments, skips give different private calibration evidence",()=>{
 const s=makePreferenceContext([
  {choice:"comment",source:"owner_approval",title:"Accountability after agent delegation",reason:"Unclear mandate enforcement",actual_body:"What independent control verifies the delegation boundary?"},
  {choice:"like",source:"owner_choice",title:"Family office mandate audit"},
  {choice:"skip",source:"owner_rejection",title:"A generic AI hype article"},
  {choice:"like",source:"verified_execution",title:"execution outcome is not an explicit choice"}
 ]);
 assert.ok(s.includes("Liked: Family office mandate audit"));
 assert.ok(s.includes("Commented on: Accountability after agent delegation"));
 assert.ok(s.includes("Unclear mandate enforcement"));
 assert.ok(s.includes("What independent control verifies"));
 assert.ok(s.includes("Rejected/skipped: A generic AI hype article"));
 assert.ok(!s.includes("execution outcome is not"));
 assert.ok(s.includes("Do not assume any future action is authorized"));
});
test("explicit preference records a private durable event once",async()=>{
 const calls=[];
 const DB={prepare(sql){return {bind(...args){this.args=args;return this;},async first(){return {suggested_action:"comment_review"};},async run(){calls.push({sql,args:this.args});return {meta:{changes:1}};}};}};
 const event=feedbackEventId("owner_choice","owner-click-123");
 const answer=await recordFeedback({DB},{id:event,candidateId:"demo:123",choice:"like",source:"owner_choice",reason:"Useful insight"});
 assert.equal(answer.ok,true);assert.equal(answer.recorded,true);
 assert.equal(calls[0].args[2],"like");
 assert.equal(calls[0].args[4],"Useful insight");
});
