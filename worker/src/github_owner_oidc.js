// Stateless GitHub Actions OIDC attestation for a reusable, private owner
// approval bridge. The BRIDGE_KEY only transports requests; without a valid
// GitHub-issued owner/workflow-bound JWT it cannot authorize any new Likes.
// Never accept GitHub commit author text as proof of identity.
export const OWNER_OIDC={
 issuer:"https://token.actions.githubusercontent.com",
 jwks:"https://token.actions.githubusercontent.com/.well-known/jwks",
 audience:"https://substack-distribution-bridge.at12885.workers.dev/v1/global/import-owner-choices",
 repository_id:"1430511205",
 actor_id:"19386515",
 repository:"Johnny-Kao/substack-distribution-bridge",
 workflow_ref:"Johnny-Kao/substack-distribution-bridge/.github/workflows/import-owner-choices.yml@refs/heads/master",
 ref:"refs/heads/master"
};
const utf8=new TextDecoder();
function fromB64Url(part){
 if(typeof part!=="string"||part.length>16000||!/^[A-Za-z0-9_-]+$/.test(part))throw Error("oidc_malformed_base64");
 const padded=part.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(part.length/4)*4,"=");
 return Uint8Array.from(atob(padded),s=>s.charCodeAt(0));
}
const str=s=>typeof s==="string"?s:"";
export async function verifyOwnerWorkflowJwt(jwt,{
 fetchJwks=fetch,
 now=Math.floor(Date.now()/1000),
 audience=OWNER_OIDC.audience
}={}){
 if(typeof jwt!=="string"||jwt.length>16000||jwt.length<200)return {ok:false,reason:"oidc_missing_or_invalid"};
 const parts=jwt.split(".");
 if(parts.length!==3)return {ok:false,reason:"oidc_malformed"};
 let header,claims,signature;
 try{
  header=JSON.parse(utf8.decode(fromB64Url(parts[0])));
  claims=JSON.parse(utf8.decode(fromB64Url(parts[1])));
  signature=fromB64Url(parts[2]);
 }catch{return {ok:false,reason:"oidc_malformed"};}
 if(header?.alg!=="RS256"||typeof header.kid!=="string"||header.kid.length>256||
    !claims||claims.iss!==OWNER_OIDC.issuer||claims.aud!==audience||
    str(claims.repository_id)!==OWNER_OIDC.repository_id||
    str(claims.actor_id)!==OWNER_OIDC.actor_id||
    claims.repository!==OWNER_OIDC.repository||
    claims.workflow_ref!==OWNER_OIDC.workflow_ref||
    claims.event_name!=="push"||claims.ref!==OWNER_OIDC.ref||
    !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.nbf)||
    !Number.isSafeInteger(claims.exp)||claims.nbf>now+30||claims.iat>now+30||
    claims.exp<=now||claims.exp>now+600||now-claims.iat>300)
   return {ok:false,reason:"oidc_claims_rejected"};
 let keys;
 try{
  const response=await fetchJwks(OWNER_OIDC.jwks,{signal:AbortSignal.timeout(7000)});
  if(!response.ok)return {ok:false,reason:"oidc_jwks_unavailable"};
  const data=await response.json();
  keys=data?.keys;
 }catch{return {ok:false,reason:"oidc_jwks_unavailable"};}
 const jwk=Array.isArray(keys)&&keys.find(k=>k.kid===header.kid&&k.kty==="RSA"&&k.n&&k.e);
 if(!jwk)return {ok:false,reason:"oidc_unknown_key"};
 try{
  const key=await crypto.subtle.importKey("jwk",{kty:"RSA",n:jwk.n,e:jwk.e,alg:"RS256",ext:true},
   {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const signed=new TextEncoder().encode(parts[0]+"."+parts[1]);
  if(!await crypto.subtle.verify({name:"RSASSA-PKCS1-v1_5"},key,signature,signed))
   return {ok:false,reason:"oidc_signature_invalid"};
 }catch{return {ok:false,reason:"oidc_signature_invalid"};}
 return {ok:true,owner_actor_id:OWNER_OIDC.actor_id,publication_performed:false};
}
