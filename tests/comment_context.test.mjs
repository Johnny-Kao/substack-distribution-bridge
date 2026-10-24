import test from "node:test";
import assert from "node:assert/strict";
import {normalizeCommentThread,readOneCandidateThread} from "../worker/src/comment_context.js";
test("comment sample strips untrusted HTML, deduplicates IDs, preserves replies",()=>{
 const data={comments:[{id:100,body:"<p>Mandates need <b>logs</b> not just policy.</p>",children:[{id:101,parent_id:100,body:"An audit trail helps."}]},{id:100,body:"Duplicate"}]};
 const d=normalizeCommentThread(data);
 assert.equal(d.sampled,2);
 assert.equal(d.visible_count,2);
 assert.equal(d.comments[0].excerpt,"Mandates need logs not just policy.");
 assert.equal(d.comments[1].reply_to,100);
 assert.equal(d.possibly_truncated,false);
 assert.throws(()=>normalizeCommentThread({results:[]}),/invalid_comment_response/);
});
test("thread selection stores only bounded private excerpts and never posts",async()=>{
 const queries=[];
 const DB={prepare(sql){return {bind(...args){this.args=args;return this;},async first(){return {id:"demo:101",url:"https://demo.substack.com/p/topic",post_id:101};},async run(){queries.push({sql,args:this.args});return {meta:{changes:1}};}};}};
 let calls=0;
 const result=await readOneCandidateThread({DB},{fetcher:async(_env,args)=>{calls++;assert.equal(args.postId,101);return {ok:true,...normalizeCommentThread({comments:[{id:11,body:"Specific critique"}]}),publication_performed:false};},budget:async(db,kind,fn)=>{assert.equal(kind,"comment_thread_read");return fn();}});
 assert.equal(result.ok,true);assert.equal(result.read,1);assert.equal(calls,1);
 assert.equal(JSON.parse(queries[0].args[0]).status,"sampled");
 assert.equal(queries.some(x=>x.sql.includes("INSERT INTO proposals")),false);
});
test("thread quota returns deferral and writes nothing",async()=>{
 const DB={prepare(sql){return {async first(){return {id:"demo:101",url:"https://demo.substack.com/p/topic",post_id:101};}};}};
 const result=await readOneCandidateThread({DB},{budget:async()=>{throw Error("browser_free_budget_or_pacing");}});
 assert.equal(result.reason,"browser_quota");assert.equal(result.read,0);
});
