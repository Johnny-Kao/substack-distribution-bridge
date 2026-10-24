import test from "node:test";
import assert from "node:assert/strict";
import {writeHandler} from "../worker/src/writes.js";
const ownerKey="test_owner_write_key_".padEnd(48,"z");
function request(path,body=null,key=ownerKey){
 return new Request("https://bridge.example"+path,{method:body?"POST":"GET",headers:{"Authorization":"Bearer "+key,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
test("non-owner cannot submit preference feedback",async()=>{
 const env={OWNER_WRITE_KEY:ownerKey,DB:{prepare(){throw Error("DB must not be called");}}};
 const q=request("/v1/write/feedback",{id:"demo:123",choice:"like"},"other-key");
 const res=await writeHandler(q,env,new URL(q.url));
 assert.equal(res.status,403);
});
test("owner Like selection is durably recorded but never posts",async()=>{
 const calls=[];const DB={prepare(sql){return {sql,bind(...a){this.args=a;return this;},async first(){return {suggested_action:"comment_review"};},async run(){calls.push(this);return {meta:{changes:1}};}};}};
 const env={OWNER_WRITE_KEY:ownerKey,DB};
 const q=request("/v1/write/feedback",{id:"demo:123",choice:"like",reason:"Unusual evidence point",event_id:"one-click-12345"});
 const res=await writeHandler(q,env,new URL(q.url)),body=await res.json();
 assert.equal(res.status,200);assert.equal(body.recorded,true);assert.equal(body.publication_performed,false);
 assert.equal(calls.length,1);
 assert.equal(calls[0].args[2],"like");
 assert.equal(calls[0].args[4],"Unusual evidence point");
});
test("exact proposal approval transaction includes feedback ledger insertion",async()=>{
 const hash="a".repeat(64);const transactions=[];
 const DB={
  prepare(sql){return {sql,bind(...args){this.args=args;return this;},async first(){
   if(sql.includes("write_policy"))return {halted:0};
   if(sql.includes("FROM proposals"))return {state:"proposed",body_hash:hash};
   return null;
  }};},
  async batch(items){transactions.push(items);return items.map(()=>({meta:{changes:1}}));}
 };
 const env={OWNER_WRITE_KEY:ownerKey,DB};
 const q=request("/v1/write/approve-batch",{items:[{id:"decision_12345678",hash}]});
 const res=await writeHandler(q,env,new URL(q.url)),body=await res.json();
 assert.equal(res.status,200);assert.equal(body.approved,1);
 assert.ok(transactions[0].some(s=>s.sql.includes("INSERT OR IGNORE INTO interaction_feedback")));
 assert.ok(transactions[0].some(s=>s.sql.includes("UPDATE proposals SET state='approved'")));
});
