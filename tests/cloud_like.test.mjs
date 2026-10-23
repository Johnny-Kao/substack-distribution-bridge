import test from "node:test";
import assert from "node:assert/strict";
import {parsePostTarget} from "../worker/src/cloud_substack_writes.js";

test("Substack post targets accept only canonical HTTPS publication URLs",()=>{
  const parsed=parsePostTarget("https://example-publication.substack.com/p/a-valid-article");
  assert.deepEqual(parsed,{host:"example-publication.substack.com",subdomain:"example-publication",url:"https://example-publication.substack.com/p/a-valid-article"});
  for(const unsafe of [
    "http://example-publication.substack.com/p/a-valid-article",
    "https://example-publication.substack.com.evil.test/p/a-valid-article",
    "https://example-publication.substack.com/p/a-valid-article?token=hello",
    "https://user:pass@example-publication.substack.com/p/a-valid-article",
    "https://example-publication.substack.com/admin",
    "https://substack.com/p/a-valid-article",
    "https://example-publication.substack.com:8443/p/a-valid-article"
  ])assert.equal(parsePostTarget(unsafe),null,unsafe);
});
