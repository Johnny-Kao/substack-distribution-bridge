// Returns only the RSA *public* encryption key, derived from the existing
// private Cloudflare secret in-process. Never exports private fields or secrets.
const encoder=new TextEncoder();
const arr=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function ownerBatchPublicKey(env){
 const pem=env.APPROVED_COMMENT_PRIVATE_PEM;
 if(typeof pem!=="string"||!pem.includes("BEGIN PRIVATE KEY"))
  return {ok:false,error:"key_unavailable"};
 try{
  const privateDer=arr(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));
  const key=await crypto.subtle.importKey("pkcs8",privateDer,{name:"RSA-OAEP",hash:"SHA-256"},true,["decrypt"]);
  const data=await crypto.subtle.exportKey("jwk",key);
  const pub=await crypto.subtle.importKey("jwk",{kty:"RSA",n:data.n,e:data.e,alg:"RSA-OAEP-256",ext:true},
   {name:"RSA-OAEP",hash:"SHA-256"},true,["encrypt"]);
  const spki=new Uint8Array(await crypto.subtle.exportKey("spki",pub));
  let out="";for(let start=0;start<spki.length;start+=8192)out+=String.fromCharCode(...spki.slice(start,start+8192));
  const b64=btoa(out).match(/.{1,64}/g).join("\n");
  return {ok:true,algorithm:"RSA-OAEP-256+AES-256-GCM",pem:"-----BEGIN PUBLIC KEY-----\n"+b64+"\n-----END PUBLIC KEY-----\n"};
 }catch{return {ok:false,error:"public_key_derivation_failed"};}
}
