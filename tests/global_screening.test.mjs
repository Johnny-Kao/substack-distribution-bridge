import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {parseSemanticVerdict,screenGlobalCandidates} from "../worker/src/global_screening.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const valid={decision:"comment_review",rationale:"Evidence of accountable delegation",angle:"How is the evidence verified?"};
test("accepts valid JSON objects and Cloudflare response envelopes",()=>{
  assert.deepEqual(parseSemanticVerdict({response:JSON.stringify(valid)}),valid);
  assert.deepEqual(parseSemanticVerdict({response:valid}),valid);
  assert.deepEqual(parseSemanticVerdict({response:{response:JSON.stringify(valid)}}),valid);
});
test("accepts a fenced JSON block but rejects malformed or ungrounded decisions",()=>{
  assert.deepEqual(parseSemanticVerdict({response:"```json\n"+JSON.stringify(valid)+"\n```"}),valid);
  assert.equal(parseSemanticVerdict({response:"not JSON"}),null);
  assert.equal(parseSemanticVerdict({response:JSON.stringify({...valid,decision:"publish"})}),null);
  assert.equal(parseSemanticVerdict({response:JSON.stringify({...valid,angle:"x".repeat(241)})}),null);
  assert.equal(parseSemanticVerdict({response:JSON.stringify({...valid,rationale:""})}),null);
});
function dbFixture(){
  const updated=[];
  return {updated,prepare(sql){return {bind(...args){this.args=args;return this;},async first(){return {n:0};},async all(){return {results:[{id:"pub:123",title:"AI governance",evidence_excerpt:"A substantive piece on allocation of accountability."}]};}};},async batch(stmts){updated.push(stmts);}};
}
test("AI screening uses JSON-mode supported model and writes only accepted verdicts",async()=>{
  const db=dbFixture();let selected,payload;
  const ai={async run(model,input){selected=model;payload=input;return {response:JSON.stringify(valid)};}};
  const result=await screenGlobalCandidates({DB:db,AI:ai});
  assert.equal(result.ok,true);assert.equal(result.reviewed,1);assert.equal(result.publication_performed,false);
  assert.equal(selected,"@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(payload.response_format.type,"json_schema");
  assert.equal(db.updated.length,1);
});
test("bad AI JSON leaves the private candidate pending and fails visibly",async()=>{
  const db=dbFixture();
  const result=await screenGlobalCandidates({DB:db,AI:{run:async()=>({response:"I cannot decide"})}});
  assert.deepEqual({ok:result.ok,reason:result.reason,reviewed:result.reviewed},{ok:false,reason:"invalid_ai_verdict",reviewed:0});
  assert.equal(db.updated.length,0);
});
test("AI exception is a safe failure, not success or publication",async()=>{
  const db=dbFixture();
  const result=await screenGlobalCandidates({DB:db,AI:{run:async()=>{throw Error("private details");}}});
  assert.equal(result.reason,"ai_inference_failed");
  assert.equal(result.publication_performed,false);
  assert.equal(db.updated.length,0);
});

test("stage-one cap preserves two deep slots and one draft slot within eight calls",async()=>{
 let aiCalled=false;
 const DB={prepare(sql){return {async first(){return {n:sql.includes("kind='global_screening'")?5:5};},async all(){return {results:[]};}};}};
 const AI={run:async()=>{aiCalled=true;return {}; }};
 const result=await screenGlobalCandidates({DB,AI});
 assert.equal(result.ok,true);
 assert.equal(result.reason,"unavailable_or_daily_cap");
 assert.equal(result.reviewed,0);
 assert.equal(aiCalled,false);
});
