import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {OWNER_OIDC,verifyOwnerWorkflowJwt} from "../worker/src/github_owner_oidc.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString("base64url");
async function fixture(overrides={},doNotResign=false){
 const keys=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
 const pub=await crypto.subtle.exportKey("jwk",keys.publicKey);
 const now=Math.floor(Date.now()/1000);
 const claims={iss:OWNER_OIDC.issuer,aud:OWNER_OIDC.audience,sub:"repo:"+OWNER_OIDC.repository+":custom:trusted",
  repository_id:OWNER_OIDC.repository_id,actor_id:OWNER_OIDC.actor_id,repository:OWNER_OIDC.repository,
  workflow_ref:OWNER_OIDC.workflow_ref,event_name:"push",ref:OWNER_OIDC.ref,
  iat:now-10,nbf:now-10,exp:now+180,...overrides};
 const header=b64({alg:"RS256",kid:"test1"});
 const payload=b64(claims);
 const bytes=new TextEncoder().encode(header+"."+payload);
 const sig=await crypto.subtle.sign({name:"RSASSA-PKCS1-v1_5"},keys.privateKey,bytes);
 let jwt=header+"."+payload+"."+Buffer.from(sig).toString("base64url");
 if(doNotResign){let altered={...claims,actor_id:"intruder"};jwt=header+"."+b64(altered)+"."+Buffer.from(sig).toString("base64url");}
 return {jwt,now,fetchJwks:async()=>({ok:true,json:async()=>({keys:[{kty:"RSA",kid:"test1",n:pub.n,e:pub.e}]})})};
}
test("valid signed exact owner repo workflow and ref is accepted",async()=>{
 const f=await fixture();const v=await verifyOwnerWorkflowJwt(f.jwt,{fetchJwks:f.fetchJwks,now:f.now});
 assert.equal(v.ok,true);
});
test("different actor, branch, workflow, audience, expired token fail closed",async()=>{
 const changes=[{actor_id:"1"},{ref:"refs/heads/evil"},{workflow_ref:"wrong"},
 {aud:"https://evil.example/approval"},{exp:1},{repository_id:"999"},{event_name:"pull_request"}];
 for(const c of changes){
  const f=await fixture(c);const v=await verifyOwnerWorkflowJwt(f.jwt,{fetchJwks:f.fetchJwks,now:f.now});
  assert.equal(v.ok,false,JSON.stringify(c));
 }
});
test("payload tampering without resigning fails cryptographic signature verification",async()=>{
 const f=await fixture({},true);
 const v=await verifyOwnerWorkflowJwt(f.jwt,{fetchJwks:f.fetchJwks,now:f.now});
 assert.equal(v.ok,false);
});
test("missing JWT or unavailable JWKS fails without trust",async()=>{
 const f=await fixture();
 assert.equal((await verifyOwnerWorkflowJwt(null)).ok,false);
 assert.equal((await verifyOwnerWorkflowJwt(f.jwt,{fetchJwks:async()=>{throw Error("offline")},now:f.now})).ok,false);
});
