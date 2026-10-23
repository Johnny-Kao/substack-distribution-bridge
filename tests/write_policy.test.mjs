import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {writeHandler} from "../worker/src/writes.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const base="https://worker.example/v1/write/";
const env={OWNER_WRITE_KEY:"o".repeat(48),DB:{prepare(){return{bind(){return this},async first(){return null}}}}};
const req=(route,key,body)=>new Request(base+route,{method:body?"POST":"GET",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
test("scan credential cannot open writing endpoints",async()=>{
 const r=await writeHandler(req("policy","d".repeat(48)),env,new URL(base+"policy"));
 assert.equal(r.status,403);
});
test("approved live writes remain disabled",async()=>{
 const r=await writeHandler(req("execute",env.OWNER_WRITE_KEY,{}),env,new URL(base+"execute"));
 assert.equal(r.status,423);
 assert.equal((await r.json()).error,"no_verified_cloud_only_substack_write_path");
});
test("config flag cannot silently reactivate cloud writes",async()=>{
 const exposed={...env,ENABLE_LIVE_WRITES:"true"};
 const r=await writeHandler(req("execute",env.OWNER_WRITE_KEY,{}),exposed,new URL(base+"execute"));
 assert.equal(r.status,423);
 assert.equal((await r.json()).error,"no_verified_cloud_only_substack_write_path");
});
test("private readback cannot be misrepresented as available",async()=>{
 const r=await writeHandler(req("check-existing-like",env.OWNER_WRITE_KEY,{}),env,new URL(base+"check-existing-like"));
 assert.equal(r.status,503);
});
test("invalid proposal is rejected without publishing",async()=>{
 const r=await writeHandler(req("dry-run",env.OWNER_WRITE_KEY,{id:"proposal_123456",kind:"note",target:"https://not-substack.example/test",body:"Test content",origin:"manual"}),env,new URL(base+"dry-run"));
 assert.equal(r.status,400);
});
