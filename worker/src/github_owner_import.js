// GitHub-OIDC-authenticated encrypted owner choices -> private D1.
// Never accepts plaintext article targets over public GitHub or BRIDGE_KEY alone.
import {verifyOwnerWorkflowJwt} from "./github_owner_oidc.js";
import {decryptApprovedEnvelope} from "./sealed_like_batch.js";
import {enqueueOwnerChoices,validateOwnerSelection} from "./owner_batch_api.js";
import {sha256} from "./action_pipeline.js";
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
 if(choices?.ingress_test_only===true){
  // Production-safe encrypted ingress smoke: persists only a digest, never a
  // candidate, preference, proposal, operation, or executable Like.
  const parsed=validateOwnerSelection(choices);
  if(!parsed)return {ok:false,status:400,error:"invalid_encrypted_owner_choices",publication_performed:false};
  const digest=await sha256(JSON.stringify(parsed.items));
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS owner_ingress_smoke (batch_id TEXT PRIMARY KEY,selection_hash TEXT NOT NULL,item_count INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
  const prior=await env.DB.prepare("SELECT selection_hash FROM owner_ingress_smoke WHERE batch_id=?").bind(parsed.batch_id).first();
  if(prior&&prior.selection_hash!==digest)
   return {ok:false,status:409,error:"test_batch_id_reused_with_different_choices",publication_performed:false};
  if(!prior)await env.DB.prepare("INSERT INTO owner_ingress_smoke(batch_id,selection_hash,item_count) VALUES(?,?,?)").bind(parsed.batch_id,digest,parsed.items.length).run();
  const verified=await env.DB.prepare("SELECT selection_hash,item_count FROM owner_ingress_smoke WHERE batch_id=?").bind(parsed.batch_id).first();
  if(verified?.selection_hash!==digest||verified?.item_count!==parsed.items.length)
   return {ok:false,status:503,error:"test_ingress_readback_failed",publication_performed:false};
  return {ok:true,ingress_test_only:true,batch_id:parsed.batch_id,count:parsed.items.length,
   persisted:true,readback_verified:true,publication_performed:false,dispatch:"disabled_for_test"};
 }
 return enqueue(env,choices);
}
