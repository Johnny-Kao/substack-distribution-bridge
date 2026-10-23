import test from "node:test";
import assert from "node:assert/strict";
import {stripArticleHTML} from "../worker/src/global_article.js";
test("article HTML produces real readable text",()=>{
 const html="<article><h1>AI Governance</h1><p>"+("Delegation needs evidence. ".repeat(25))+"</p><script>neverexecute()</script></article>";
 const text=stripArticleHTML(html);
 assert.ok(text.includes("AI Governance"));
 assert.ok(text.length>400);
 assert.ok(!text.includes("neverexecute"));
});
test("short body is rejected",()=>assert.equal(stripArticleHTML("short"),""));
