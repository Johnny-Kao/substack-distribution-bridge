import test from "node:test";
import assert from "node:assert/strict";
import {decodeBrowserXML} from "../worker/src/feed.js";

test("Chrome pre-rendered RSS is decoded exactly once",()=>{
 const xml="<?xml version='1.0'?><rss><channel><item><title>A &amp; B</title><description>This is a valid long public article summary for testing RSS conversion.</description></item></channel></rss>";
 const encoded=xml.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
 const rendered='<html><body><pre style="word-wrap: break-word">'+encoded+'</pre></body></html>';
 assert.equal(decodeBrowserXML(rendered),xml);
});
test("rejects non-RSS browser pages",()=>{
 assert.throws(()=>decodeBrowserXML("<html><body>Too Many Requests</body></html>"));
});
