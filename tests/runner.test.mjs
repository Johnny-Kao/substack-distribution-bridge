import test from "node:test";
import assert from "node:assert/strict";
import {runnerHandler} from "../worker/src/runner.js";

const base="https://worker.example/v1/runner/";
const key="r".repeat(64);
const db={prepare(sql){return {async first(){return sql.includes("write_policy")?{halted:1}:null;}}}};
const env={RUNNER_KEY:key,DB:db};
const req=(path,token)=>new Request(base+path,{method:path==="next"?"POST":"GET",headers:{Authorization:"Bearer "+token}});
test("runner rejects discovery capability",async()=>{
 const result=await runnerHandler(req("health","wrong"),env,new URL(base+"health"));
 assert.equal(result.status,403);
});
test("owner runner can inspect health without secrets",async()=>{
 const result=await runnerHandler(req("health",key),env,new URL(base+"health"));
 assert.deepEqual(await result.json(),{ok:true,runner:true});
});
test("halted queue never supplies an operation",async()=>{
 const result=await runnerHandler(req("next",key),env,new URL(base+"next"));
 assert.deepEqual(await result.json(),{halted:true,job:null});
});
