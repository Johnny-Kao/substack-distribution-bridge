// GitHub-OIDC-authenticated encrypted owner choices -> private D1.
// Never accepts plaintext article targets over public GitHub or BRIDGE_KEY alone.
import {verifyOwnerWorkflowJwt} from "./github_owner_oidc.js";
import {decryptApprovedEnvelope} from "./sealed_like_batch.js";
import {enqueueOwnerChoices,validateOwnerSelection} from "./owner_batch_api.js";
export async function importOwnerChoicesFromGithub(env,request,{
 verify=verifyOwnerWorkflowJwt,
 decrypt=decryptApprovedEnvelope,
 enqueue=enqueueOwnerChoices
}={}){
 const jwt=request.headers.get("X-GitHub-OIDC");
 const result=await verify(jwt);
 if(!result?.ok)return {ok:false,status:403,error:result?.reason||"github_owner_proof_required",publication_performed:false};
 let envelope;
 try{
  if(Number(request.headers.get("Content-Length")||0)>25000)return {ok:false,status:413,error:"envelope_too_large",publication_performed:false};
  envelope=await request.json();
 }catch{return {ok:false,status:400,error:"invalid_encrypted_envelope",publication_performed:false};}
 let decoded,choices;
 try{
  decoded=await decrypt(envelope,env.APPROVED_COMMENT_PRIVATE_PEM);
  if(decoded.byteLength>22000)throw Error("too_large");
  choices=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(decoded));
 }catch{return {ok:false,status:400,error:"invalid_encrypted_owner_choices",publication_performed:false};}
 if(choices?.validation_only===true){
  const parsed=validateOwnerSelection(choices);
  return parsed?{ok:true,validation_only:true,count:parsed.items.length,publication_performed:false,persisted:false}:
   {ok:false,status:400,error:"invalid_encrypted_owner_choices",publication_performed:false};
 }
 return enqueue(env,choices);
}
