import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {DEEP_MODEL,parseDeepVerdict,deepReviewCandidates,evidenceAnchors} from "../worker/src/deep_screening.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const article="A family office delegation policy should define a mandate, record evidence, and preserve authority boundaries. ".repeat(15);
const response={decision:"comment_review",rationale:"Proof must cover the whole decision chain.",angle:"Ask how the authorization trail is reviewed by the investment committee.",evidence_anchor:1,risk:"No evidence about technical enforcement in the excerpt."};
test("second stage rejects fabricated evidence quotes and unauthorized classifications",()=>{
 assert.equal(parseDeepVerdict({response:JSON.stringify(response)},article).evidence_quote,evidenceAnchors(article)[0]);
 assert.equal(parseDeepVerdict({response:JSON.stringify({...response,evidence_anchor:999})},article),null);
 assert.equal(parseDeepVerdict({response:JSON.stringify({...response,decision:"post_now"})},article),null);
});
function db(candidate={id:"alpha:123",title:"Delegation evidence",full_text:article,score:75,semantic_verdict:"comment_review",semantic_rationale:"Relevant"}){
 const calls=[],attempts=[];return {calls,attempts,prepare(sql){const stmt={bind(...a){this.args=a;return this;},async first(){if(sql.includes("COUNT(*) AS n"))return {n:0};return candidate;},async run(){attempts.push({sql,args:this.args});return {meta:{changes:1}};}};return stmt;},async batch(stmts){calls.push(stmts);}};
}
test("deep review reads stored full article, uses distinct reasoning model, and never posts",async()=>{
 const DB=db();let selected,request;
 const AI={async run(model,args){selected=model;request=args;return {response:JSON.stringify(response)};}};
 const outcome=await deepReviewCandidates({AI,DB});
 assert.deepEqual(outcome,{ok:true,reviewed:1,stage:"deep_review",publication_performed:false});
 assert.equal(selected,DEEP_MODEL);
 assert.ok(request.messages[1].content.includes(article));
 assert.ok(request.messages[1].content.includes("COMMENT THREAD: not fetched"));
 assert.equal(DB.calls.length,1);
 assert.equal(DB.attempts.length,1);
 const save=DB.calls[0][0];
 assert.equal(JSON.parse(save.args[0]).discussion_context,"not_fetched");
 assert.equal(JSON.parse(save.args[0]).evidence_quote,evidenceAnchors(article)[0]);
});
test("invalid model evidence leaves D1 untouched",async()=>{
 const DB=db(),AI={run:async()=>({response:JSON.stringify({...response,evidence_anchor:999})})};
 const result=await deepReviewCandidates({AI,DB});
 assert.equal(result.ok,false);assert.equal(result.reason,"invalid_deep_verdict");assert.equal(DB.calls.length,0);
});
test("deep inference exceptions fail closed without posting",async()=>{
 const DB=db(),AI={run:async()=>{throw Error("private trace");}};
 const result=await deepReviewCandidates({AI,DB});
 assert.equal(result.ok,false);assert.equal(result.reason,"deep_ai_inference_failed");assert.equal(DB.calls.length,0);
});
test("no relevant candidate does not spend AI",async()=>{
 const DB=db(null),AI={run:async()=>{throw Error("should not call");}};
 const result=await deepReviewCandidates({AI,DB});
 assert.equal(result.reason,"no_qualified_candidate");assert.equal(result.reviewed,0);
});
