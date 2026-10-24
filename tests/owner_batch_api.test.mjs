import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {validateOwnerSelection,enqueueOwnerChoices,MAX_SELECTED_LIKES} from "../worker/src/owner_batch_api.js";
import {importOwnerChoicesFromGithub} from "../worker/src/github_owner_import.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const items=(n=3)=>Array.from({length:n},(_,i)=>({choice:i%3===2?"skip":"like",url:"https://test-"+(i+1)+".substack.com/p/article-"+(i+1),post_id:100001+i,title:"Investing essay "+i}));
const request=()=>({headers:new Headers({"Content-Length":"200","X-GitHub-OIDC":"signed-token"}),async json(){return {v:1,key:"encrypted",iv:"encrypted",data:"encrypted"};}});
const make=(i=items())=>({batch_id:"owner-batch-20261025-01",confirmed_by_owner:true,items:i});
function fakeDB({existing=null,mapping=null,reverseMapping=null,priorWrite=null,halted=false,batch=null}={}){
 const queries=[],batches=[];
 return {queries,batches,prepare(sql){
  return {sql,bind(...args){this.args=args;return this;},
   async first(){
    queries.push({sql,args:this.args});
    if(sql.includes("FROM write_policy"))return {halted:halted?1:0};
    if(sql.includes("FROM owner_choice_batches"))return batch;
    if(sql.includes("FROM approved_external_posts"))return sql.includes("WHERE post_id=")?reverseMapping:mapping;
    if(sql.includes("FROM proposals"))return existing;
    if(sql.includes("FROM operations"))return priorWrite;
    return null;
   },async run(){queries.push({sql,args:this.args});return {meta:{changes:1}};}
  };
 },async batch(statements){batches.push(statements.map(s=>({sql:s.sql,args:s.args})));}};
}
test("explicit 1-20 owner choices require exact Substack article identifiers",()=>{
 assert.equal(MAX_SELECTED_LIKES,20);
 assert.ok(validateOwnerSelection(make()));
 assert.ok(validateOwnerSelection(make(items(20))));
 assert.equal(validateOwnerSelection(make(items(21))),null);
 assert.equal(validateOwnerSelection({...make(),confirmed_by_owner:false}),null);
 assert.equal(validateOwnerSelection(make([{...items(1)[0],url:"https://evil.com/p/article"}])),null);
 assert.equal(validateOwnerSelection(make([{...items(1)[0],post_id:"1001"}])),null);
 assert.equal(validateOwnerSelection(make([items(1)[0],items(1)[0]])),null);
});
test("D1 stores Like approval, Skip preference and registered post IDs atomically",async()=>{
 const DB=fakeDB();
 const r=await enqueueOwnerChoices({DB},make());
 assert.equal(r.ok,true);
 assert.equal(r.selected.like,2);assert.equal(r.selected.skip,1);
 assert.equal(r.newly_approved,2);assert.equal(r.skipped,1);
 assert.equal(r.publication_performed,false);
 assert.equal(DB.batches.length,1);
 const sql=DB.batches[0].map(s=>s.sql);
 assert.equal(sql.filter(x=>x.includes("INSERT OR IGNORE INTO proposals")).length,2);
 assert.equal(sql.filter(x=>x.includes("INTO owner_batch_items")).length,3);
 assert.equal(sql.filter(x=>x.includes("INTO interaction_feedback")).length,5);
 assert.ok(sql.every(x=>!x.includes("POST /api/")));
});
test("owner batch replay with identical hash is idempotent and never re-posts",async()=>{
 const data=make(),normalized=validateOwnerSelection(data);
 const digest=(await import("../worker/src/action_pipeline.js")).sha256;
 const DB=fakeDB({batch:{selection_hash:await digest(JSON.stringify(normalized.items)),item_count:3}});
 const r=await enqueueOwnerChoices({DB},data);
 assert.equal(r.ok,true);assert.equal(r.already_recorded,true);assert.equal(DB.batches.length,0);
});
test("batch id changed content, target mapping collision and unknown previous write fail closed",async()=>{
 const result1=await enqueueOwnerChoices({DB:fakeDB({batch:{selection_hash:"wrong"}})},make());
 assert.equal(result1.status,409);
 const result2=await enqueueOwnerChoices({DB:fakeDB({mapping:{post_id:9999}})},make());
 assert.equal(result2.status,409);
 const result3=await enqueueOwnerChoices({DB:fakeDB({priorWrite:{status:"unknown"}})},make());
 assert.equal(result3.status,409);
 const result4=await enqueueOwnerChoices({DB:fakeDB({halted:true})},make());
 assert.equal(result4.status,423);
});
test("invalid or missing GitHub identity cannot decrypt or write a batch",async()=>{
 let decryptCount=0,saveCount=0;
 const r=await importOwnerChoicesFromGithub({APPROVED_COMMENT_PRIVATE_PEM:"private"},request(),{
  verify:async()=>({ok:false,reason:"oidc_claims_rejected"}),
  decrypt:async()=>{decryptCount++;return new Uint8Array();},
  enqueue:async()=>{saveCount++;return {ok:true};}
 });
 assert.equal(r.ok,false);assert.equal(decryptCount,0);assert.equal(saveCount,0);
});
test("cryptographically verified identity can import arbitrary future approved batches, not just hardcoded first batch",async()=>{
 const batch=make([{choice:"like",url:"https://other.substack.com/p/new",post_id:199999999,title:"New owner choice"}]);
 let saved;
 const r=await importOwnerChoicesFromGithub({},request(),{
  verify:async()=>({ok:true}),
  decrypt:async()=>new TextEncoder().encode(JSON.stringify(batch)),
  enqueue:async(_env,b)=>{saved=b;return {ok:true,selected:{like:1,skip:0},publication_performed:false};}
 });
 assert.equal(r.ok,true);
 assert.equal(saved.batch_id,batch.batch_id);
 assert.equal(saved.items[0].post_id,199999999);
});

test("existing Post ID bound to another canonical URL rejects the entire batch",async()=>{
 const DB=fakeDB({reverseMapping:{url:"https://another.substack.com/p/other"}});
 const result=await enqueueOwnerChoices({DB},make());
 assert.equal(result.status,409);
 assert.equal(result.error,"post_id_url_identity_conflict");
 assert.equal(DB.batches.length,0);
});
test("unknown or executing like remains fail-closed, skip creates no proposals",async()=>{
 for(const state of ["unknown","executing"]){
  const DB=fakeDB({priorWrite:{status:state}});
  const result=await enqueueOwnerChoices({DB},make());
  assert.equal(result.status,409);
  assert.equal(DB.batches.length,0);
 }
 const DB=fakeDB();
 const result=await enqueueOwnerChoices({DB},make([{...items(1)[0],choice:"skip"}]));
 assert.equal(result.ok,true);
 assert.equal(DB.batches[0].filter(s=>s.sql.includes("INTO proposals")).length,0);
});

test("encrypted ingress test persists digest only and never queues Like or feedback",async()=>{
 const selection={...make(),ingress_test_only:true};
 const audit={};
 let queueCalls=0;
 const DB={prepare(sql){return {
  bind(...args){this.args=args;return this;},
  async first(){if(sql.includes("FROM owner_ingress_smoke"))return audit[this.args[0]]||null;return null;},
  async run(){if(sql.includes("INSERT INTO owner_ingress_smoke"))audit[this.args[0]]={selection_hash:this.args[1],item_count:this.args[2]};return {meta:{changes:1}};}
 };}};
 const importOnce=()=>importOwnerChoicesFromGithub({DB},request(),{
  verify:async()=>({ok:true}),
  decrypt:async()=>new TextEncoder().encode(JSON.stringify(selection)),
  enqueue:async()=>{queueCalls++;throw Error("must not execute");}
 });
 const first=await importOnce();
 assert.equal(first.ok,true);
 assert.equal(first.persisted,true);
 assert.equal(first.readback_verified,true);
 assert.equal(first.dispatch,"disabled_for_test");
 assert.equal(first.publication_performed,false);
 assert.equal(Object.keys(audit).length,1);
 const again=await importOnce();
 assert.equal(again.ok,true);
 assert.equal(Object.keys(audit).length,1);
 assert.equal(queueCalls,0);
});
