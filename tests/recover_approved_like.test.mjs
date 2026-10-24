import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {sha256} from "../worker/src/action_pipeline.js";
import {recoverOnePinnedUnknownLike} from "../worker/src/recover_approved_like.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const target="https://sample.substack.com/p/approved-article",postId=211000111;
async function fixture({liked=false,halted=1,reason="orphan_like_not_confirmed",unknown=true,journal=false,batchValid=true,quota=false}={}){
 const hash=await sha256("like\u0000"+target+"\u0000");
 const row={id:"decision_existing_unknown",kind:"like",status:"unknown",state:"unknown",target,approved_hash:hash,body_hash:hash,origin:"decision_pipeline_v1",post_id:postId};
 const commands=[];let readCalls=0,verifierCalls=0;
 const DB={
   prepare(sql){return {sql,bind(...args){this.args=args;return this;},
     async first(){
      if(sql.includes("FROM write_policy"))return {halted,reason};
      if(sql.includes("FROM approved_like_recovery"))return journal?{proposal_id:row.id}:null;
      return null;
     },
     async all(){return {results:unknown?[row]:[]};},
     async run(){commands.push(this);return {meta:{changes:1}};}
   };},
   async batch(stmts){commands.push(...stmts);}
 };
 const env={DB,APPROVED_COMMENT_PRIVATE_PEM:"private"};
 const result=await recoverOnePinnedUnknownLike(env,{v:1},{
  verifyBatch:async()=>{verifierCalls++;return batchValid?{ok:true,batch:{posts:[{url:target,post_id:postId}]}}:{ok:false};},
  verify:async(_env,x)=>{readCalls++;assert.equal(x.postId,postId);return {ok:true,authenticated:true,verified:true,liked};},
  budget:async(_db,_kind,fn)=>{if(quota)throw Error("browser_free_budget_or_pacing");return fn();}
 });
 return {result,commands,readCalls,verifierCalls};
}
test("negative second authenticated readback opens one exact approved retry, preserving earlier attempt in journal",async()=>{
 const {result,commands,readCalls}=await fixture();
 assert.equal(result.ok,true);assert.equal(result.status,"reconfirmed_unliked_requeued_once");assert.equal(result.publication_performed,false);
 assert.equal(readCalls,1);
 assert.ok(commands.some(x=>x.sql.includes("INSERT INTO approved_like_recovery")));
 assert.ok(commands.some(x=>x.sql.includes("UPDATE operations SET status='reconciled_unliked'")));
 assert.ok(commands.some(x=>x.sql.includes("UPDATE proposals SET state='approved'")));
 assert.ok(commands.some(x=>x.sql.includes("UPDATE write_policy SET halted=0")));
 assert.ok(!commands.some(x=>/INSERT INTO operations|runAuthorizedPostAction/.test(x.sql)));
});
test("positive readback marks an existing Like successful without retrying",async()=>{
 const {result,commands}=await fixture({liked:true});
 assert.equal(result.status,"confirmed_existing_like_and_resumed");
 assert.ok(commands.some(x=>x.sql.includes("SET status='succeeded'")));
 assert.ok(!commands.some(x=>x.sql.includes("INSERT INTO approved_like_recovery")));
});
test("owner halt and unrelated policy reasons cannot be bypassed",async()=>{
 for(const config of [{halted:0},{reason:"owner_stop"}]){
  const {result,readCalls}=await fixture(config);
  assert.equal(result.status,"recovery_policy_not_eligible");assert.equal(readCalls,0);
 }
});
test("a second recovery from same original proposal is forbidden",async()=>{
 const {result,readCalls}=await fixture({journal:true});
 assert.equal(result.status,"one_recovery_already_used");assert.equal(readCalls,0);
});
test("lack of exactly one unknown write blocks recovery",async()=>{
 const {result,readCalls}=await fixture({unknown:false});
 assert.equal(result.status,"recovery_target_not_unique");assert.equal(readCalls,0);
});
test("invalid sealed approval cannot read D1 or send a reaction",async()=>{
 const {result,readCalls,commands}=await fixture({batchValid:false});
 assert.equal(result.status,"owner_approval_unverified");assert.equal(readCalls,0);assert.equal(commands.length,0);
});
test("quota deferral preserves original unknown and owner halt",async()=>{
 const {result,commands,readCalls}=await fixture({quota:true});
 assert.equal(result.status,"browser_quota_deferred");assert.equal(result.ok,true);
 assert.equal(readCalls,0);assert.ok(!commands.some(x=>x.sql.includes("UPDATE write_policy")));
});
