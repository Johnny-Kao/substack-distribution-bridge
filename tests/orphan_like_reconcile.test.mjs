import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {sha256} from "../worker/src/action_pipeline.js";
import {reconcileOneOrphanLike} from "../worker/src/orphan_like_reconcile.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
async function setup({liked=true,minutesAgo=10,quota=false}={}){
 const target="https://sample.substack.com/p/approved-example",id="decision_12345678";
 const hash=await sha256("like\u0000"+target+"\u0000");
 const row={id,kind:"like",status:"executing",state:"executing",target,approved_hash:hash,body_hash:hash,origin:"decision_pipeline_v1",post_id:20261025,created_at:new Date(Date.now()-minutesAgo*60000).toISOString().slice(0,19).replace("T"," ")};
 const commands=[];
 const DB={prepare(sql){return {sql,bind(...args){this.args=args;return this;},async all(){return {results:[row]};}};},async batch(batch){commands.push(...batch.map(b=>({sql:b.sql,args:b.args})));}};
 let reads=0;
 const outcome=await reconcileOneOrphanLike({DB},{verify:async(_env,args)=>{
  reads++;assert.equal(args.postId,row.post_id);
  return {ok:true,verified:true,authenticated:true,liked,publication_performed:false};
 },budget:async(_db,_kind,fn)=>{if(quota)throw Error("browser_free_budget_or_pacing");return fn();}});
 return {outcome,commands,reads};
}
test("readback after worker crash marks previously liked post complete WITHOUT public write",async()=>{
 const {outcome,commands,reads}=await setup({liked:true});
 assert.equal(outcome.status,"liked_confirmed_after_crash");
 assert.equal(outcome.publication_performed,false);
 assert.equal(reads,1);
 assert.ok(commands.some(x=>x.sql.includes("SET status='succeeded'")));
 assert.ok(commands.some(x=>x.sql.includes("SET state='executed'")));
 assert.ok(commands.some(x=>x.sql.includes("verified_execution")));
 assert.ok(!commands.some(x=>x.sql.includes("INSERT INTO operations")));
});
test("a verified unliked result must become unknown and halt further writes",async()=>{
 const {outcome,commands}=await setup({liked:false});
 assert.equal(outcome.ok,false);
 assert.equal(outcome.status,"needs_manual_reconciliation");
 assert.ok(commands.some(x=>x.sql.includes("SET status='unknown'")));
 assert.ok(commands.some(x=>x.sql.includes("SET halted=1")));
});
test("browser quota cannot resume or change orphaned operation",async()=>{
 const {outcome,commands,reads}=await setup({quota:true});
 assert.equal(outcome.ok,true);
 assert.equal(outcome.status,"browser_quota_deferred");
 assert.equal(reads,0);assert.equal(commands.length,0);
});
test("too-recent executing claim is left undisturbed",async()=>{
 const {outcome,commands,reads}=await setup({minutesAgo:0});
 assert.equal(outcome.status,"still_in_flight");
 assert.equal(reads,0);assert.equal(commands.length,0);
});
