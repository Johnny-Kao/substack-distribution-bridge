import test from "node:test";
import assert from "node:assert/strict";
import {parseApprovedBatchStep,approvedBatchJobId,MAX_HOURLY_APPROVED_ACTIONS} from "../worker/src/dispatch_window.js";
test("twenty separate hourly dispatch locks are available, never more",()=>{
 assert.equal(MAX_HOURLY_APPROVED_ACTIONS,20);
 for(let i=0;i<20;i++){
  assert.equal(parseApprovedBatchStep({step:i}),i);
  assert.equal(approvedBatchJobId(3600000*8,i),"approved_dispatch_8_"+i);
 }
 assert.equal(parseApprovedBatchStep({}),0);
 for(const step of [-1,20,21,1.5,"5",null,NaN,Infinity]){
  assert.equal(parseApprovedBatchStep({step}),null);
 }
 assert.equal(approvedBatchJobId(100,20),null);
});
