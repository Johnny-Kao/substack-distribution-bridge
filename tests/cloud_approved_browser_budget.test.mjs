import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {reserveBrowserAction,MAX_ACTIONS_DAY,MAX_APPROVED_ACTIONS_DAY,MAX_BROWSER_MS_DAY} from "../worker/src/browser_budget.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
function mockDB(){
  const calls=[];
  return {calls,prepare(query){return {bind(...args){calls.push({query,args});return this;},async run(){return {meta:{changes:1}};}};}};
}
test("normal discovery stays at conservative 38 browser actions",async()=>{
  const db=mockDB();
  assert.ok(await reserveBrowserAction(db,"global_article"));
  assert.equal(db.calls[0].args[2],MAX_ACTIONS_DAY);
  assert.equal(db.calls[0].args[3],MAX_BROWSER_MS_DAY);
});
test("only explicitly approved reconciliation and comment may use two reserved actions",async()=>{
  for(const kind of ["sealed_comment_reconcile","sealed_approved_comment"]){
    const db=mockDB();
    assert.ok(await reserveBrowserAction(db,kind));
    assert.equal(db.calls[0].args[2],MAX_APPROVED_ACTIONS_DAY);
  }
  for(const kind of ["cloud_comment_probe","comment_preflight","cloud_like_probe","global_screening","approved_like","sealed_comment_readback"]){
    const db=mockDB();
    assert.ok(await reserveBrowserAction(db,kind));
    assert.equal(db.calls[0].args[2],MAX_ACTIONS_DAY);
  }
});
