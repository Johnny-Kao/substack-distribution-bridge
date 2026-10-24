import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {validateApprovedLikeBatch,importApprovedLikeBatch,ALLOWED_BATCH_HASH} from "../worker/src/sealed_like_batch.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const fixture=()=>({version:1,batch_id:"fo-wm-pb-likes-2026-10-25-01",action:"approved_likes",user_approved:true,
 posts:Array.from({length:10},(_,i)=>({post_id:100000001+i,url:"https://demo"+i+".substack.com/p/test-"+i,title:"Demo article "+i}))});
test("sealed Like batch accepts only ten unique, exact canonical post targets",()=>{
 const x=fixture();
 assert.equal(validateApprovedLikeBatch(x),true);
 assert.equal(validateApprovedLikeBatch({...x,posts:x.posts.slice(0,9)}),false);
 assert.equal(validateApprovedLikeBatch({...x,user_approved:false}),false);
 assert.equal(validateApprovedLikeBatch({...x,posts:[...x.posts.slice(0,9),x.posts[0]]}),false);
 assert.equal(validateApprovedLikeBatch({...x,posts:[...x.posts.slice(0,9),{post_id:999,url:"https://evil.example/p/post",title:"A"}]}),false);
 assert.match(ALLOWED_BATCH_HASH,/^[a-f0-9]{64}$/);
});
test("unauthorized or malformed encrypted envelope never accesses approval database",async()=>{
 const db={prepare(){throw Error("Must not query DB before valid sealed batch signature")}};
 const res=await importApprovedLikeBatch({DB:db,APPROVED_COMMENT_PRIVATE_PEM:"garbage"},{v:1,key:"invalid",iv:"invalid",data:"invalid"});
 assert.equal(res.ok,false);
 assert.equal(res.error,"sealed_batch_decryption_failed");
 assert.equal(res.publication_performed,false);
});
