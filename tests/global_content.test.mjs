import test from "node:test";
import assert from "node:assert/strict";
import {normalizeGlobalPosts,nextGlobalCursor,MAX_POSTS_PER_SUBJECT} from "../worker/src/global_content.js";

test("100 posts / 5 pages per subject, rotate and stop low-yield",()=>{
 assert.equal(MAX_POSTS_PER_SUBJECT,100);
 assert.deepEqual(nextGlobalCursor({term_index:0,page:3},2,true,0),{term_index:0,page:4,low_yield_streak:0});
 assert.deepEqual(nextGlobalCursor({term_index:0,page:4},2,true,0),{term_index:1,page:0,low_yield_streak:0});
 assert.deepEqual(nextGlobalCursor({term_index:0,page:1},2,true,2),{term_index:1,page:0,low_yield_streak:0});
 assert.deepEqual(nextGlobalCursor({term_index:1,page:2},2,false,0),{term_index:0,page:0,low_yield_streak:0});
});
test("platform-wide posts resolve publication arrays and deduplicate",()=>{
 const data={more:true,publications:[{id:10,subdomain:"alpha"},{id:20,subdomain:"beta"}],results:[
 {id:101,publication_id:10,slug:"first-post",title:"First",post_date:"2026-10-23T00:00:00Z"},
 {id:102,publication_id:20,slug:"other-post",title:"Second",post_date:"2026-10-23T01:00:00Z"},
 {id:102,publication_id:20,slug:"other-post",title:"Repeat",post_date:"2026-10-23T01:00:00Z"},
 {id:103,publication_id:30,slug:"unknown",title:"Unknown",post_date:"2026-10-23T01:00:00Z"}]};
 const d=normalizeGlobalPosts(data);
 assert.equal(d.returned,4);assert.equal(d.posts.length,2);
 assert.equal(new Set(d.posts.map(p=>p.publication_id)).size,2);
 assert.equal(d.posts[0].url,"https://alpha.substack.com/p/first-post");
 assert.equal(d.hasMore,true);
});
test("malformed global response rejected",()=>{
 assert.throws(()=>normalizeGlobalPosts({results:[],more:true}),/unexpected_global/);
});
