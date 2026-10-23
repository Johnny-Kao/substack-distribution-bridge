import test from 'node:test';
import assert from 'node:assert/strict';
import {performVerifiedWrite} from '../worker/src/executor.js';
const env={SUBSTACK_SESSION:'test_session_cookie_value_0123456789'};
const target='https://examplepub.substack.com/p/sample-article';
function fixture(resolver){
 const original=globalThis.fetch;
 const events=[];
 globalThis.fetch=async(url,opt={})=>{
  const u=String(url);
  events.push({u,method:opt.method||'GET'});
  const response=resolver(u,opt);
  if(!response)throw Error('Unexpected mock endpoint: '+u);
  return new Response(JSON.stringify(response.body),{status:response.status||200,headers:{'content-type':'application/json'}});
 };
 return {events,reset(){globalThis.fetch=original}};
}
test('already-liked post is verified without a second write',async()=>{
 const stub=fixture((url,opt)=>{
  if(url.includes('/user/profile/self'))return {body:{id:123}};
  if(url.includes('/api/v1/posts/sample-article'))return {body:{id:321,is_published:true}};
  if(url.includes('/reader/feed/profile/123'))return {body:{items:[{post:{id:321}}]}};
 });
 try{
  const r=await performVerifiedWrite(env,{kind:'like',target,body:''});
  assert.deepEqual(r,{verified:true,already_existed:true,public_id:'321'});
  assert.equal(stub.events.filter(x=>x.method==='POST').length,0);
 }finally{stub.reset();}
});
test('a published comment is read back by exact id and body',async()=>{
 const body='This is a meaningful observation about the argument and a test.';
 const stub=fixture((url,opt)=>{
  if(url.includes('/user/profile/self'))return {body:{id:123}};
  if(url.includes('/api/v1/posts/sample-article'))return {body:{id:321,is_published:true}};
  if(url.endsWith('/api/v1/post/321/comment'))return {body:{id:555}};
  if(url.includes('/api/v1/post/321/comments?'))return {body:{comments:[{id:555,body}]}};
 });
 try{
  const r=await performVerifiedWrite(env,{kind:'comment',target,body});
  assert.equal(r.verified,true);
  assert.equal(r.public_id,'555');
  assert.equal(stub.events.filter(x=>x.method==='POST').length,1);
 }finally{stub.reset();}
});
test('a published Note is read back by its id',async()=>{
 const stub=fixture((url,opt)=>{
  if(url.includes('/user/profile/self'))return {body:{id:123}};
  if(url.endsWith('/api/v1/comment/feed'))return {body:{id:888}};
  if(url.endsWith('/api/v1/reader/comment/888'))return {body:{id:888}};
 });
 try{
  const r=await performVerifiedWrite(env,{kind:'note',target:'https://johnnykao.substack.com/',body:'An original thought about preserving choice in the face of change.'});
  assert.equal(r.verified,true);assert.equal(r.public_id,'888');
 }finally{stub.reset();}
});
