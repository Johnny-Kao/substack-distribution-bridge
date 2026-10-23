import test from "node:test";
import assert from "node:assert/strict";
import {cleanPublications,nextSearchCursor} from "../worker/src/subject_discovery.js";
test("global publication search validates and deduplicates",()=>{
 const d=cleanPublications({more:true,results:[
  {id:1,subdomain:"alpha-fo",name:"Example"},
  {id:1,subdomain:"alpha-fo",name:"Duplicate"},
  {id:2,subdomain:"bad/.com",name:"Reject"},
  {id:3,subdomain:"another-one",name:"Good"},
 ]});
 assert.equal(d.returned,4);
 assert.equal(d.publications.length,2);
 assert.equal(d.hasMore,true);
});
test("search cursor respects pages, term rotation and max pages",()=>{
 assert.deepEqual(nextSearchCursor({term_index:1,page:0},3,true),{term_index:1,page:1});
 assert.deepEqual(nextSearchCursor({term_index:1,page:3},3,true),{term_index:2,page:0});
 assert.deepEqual(nextSearchCursor({term_index:2,page:1},3,false),{term_index:0,page:0});
});
test("malformed response is never counted as a successful search",()=>{
 assert.throws(()=>cleanPublications({results:[],more:"true"}),/unexpected_subject/);
});
