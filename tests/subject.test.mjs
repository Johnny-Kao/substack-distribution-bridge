import test from "node:test";
import assert from "node:assert/strict";
import {decodeBrowserJSON} from "../worker/src/subject.js";
test("decode safely rendered Chrome JSON envelope",()=>{
 const data={results:[{subdomain:"example-news",name:"Research &amp; Practice"}]};
 const encoded=JSON.stringify(data).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
 assert.deepEqual(decodeBrowserJSON("<html><body><pre>"+encoded+"</pre></body></html>"),data);
});
test("reject HTML challenge without structured JSON",()=>{
 assert.throws(()=>decodeBrowserJSON("<html><body>Just a moment</body></html>"),/json_pre_missing/);
});
