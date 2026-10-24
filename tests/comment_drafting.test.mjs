import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {validateDraft,draftOneComment} from "../worker/src/comment_drafting.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const body="Your argument treats mandate issuance as the decisive control. Would independent verification of the execution trail reveal overlapping delegated authority before settlement, especially when two intermediaries act on different copies of the same instruction? This matters especially when audit responsibilities cross organizational boundaries and no single actor observes the complete chain.";
test("draft schema rejects generic, promotional or overlong comments",()=>{
 assert.ok(validateDraft({response:{body,rationale:"Specific challenge."}}));
 assert.equal(validateDraft({response:{body:"Looks good",rationale:"Why"}}),null);
 assert.equal(validateDraft({response:{body:body+" https://example.org",rationale:"Why"}}),null);
});
test("actual sampled discussion guides a private draft but never creates proposal",async()=>{
 const log=[],article="Mandate issuance creates a responsibility boundary. ".repeat(20);
 const details={id:"demo:101",title:"Delegated authority",full_text:article,comment_angle:"Who verifies?",evidence_signals:JSON.stringify({discussion:{status:"sampled",comments:[{id:3,excerpt:"What is the audit boundary?"}]}})};
 const DB={prepare(sql){const q={args:[],bind(...a){this.args=a;return this;},async first(){return sql.includes("COUNT(*) AS n")?{n:0}:details;},async all(){return {results:[]};},async run(){log.push({sql,args:this.args});return {meta:{changes:1}};}};return q;},async batch(items){log.push(...items.map(x=>({sql:x.sql,args:x.args})));}};
 let seen;const AI={async run(_model,input){seen=input;return {response:{body,rationale:"Grounded in the article and sampled discussion."}};}};
 const outcome=await draftOneComment({DB,AI});
 assert.equal(outcome.ok,true);assert.equal(outcome.drafted,1);
 assert.ok(seen.messages[1].content.includes("What is the audit boundary?"));
 assert.equal(JSON.parse(log.find(x=>x.sql.includes("json_set")).args[0]).status,"ready_for_owner_approval");
 assert.equal(log.some(x=>x.sql.includes("INSERT INTO proposals")),false);
});
