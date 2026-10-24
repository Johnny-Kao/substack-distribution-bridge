// One-time encrypted batch ingress. The transport token NEVER becomes a
// general approval capability: only the pinned SHA-256 of the exact owner's
// ten approved Like choices can be imported. No plaintext enters GitHub.
import {sha256} from "./action_pipeline.js";
import {parsePostTarget} from "./cloud_substack_writes.js";
export const ALLOWED_BATCH_HASH="e39c531cd39ae23ac5d6865366b16835b55044ef9358a5170659ab8ba3a46b4f";
const BATCH_ID="fo-wm-pb-likes-2026-10-25-01";
const asBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function decryptApprovedEnvelope(envelope,privatePem){
 if(!envelope||envelope.v!==1||typeof envelope.key!=="string"||typeof envelope.iv!=="string"||typeof envelope.data!=="string"||envelope.key.length>1600||envelope.data.length>16000)throw Error("invalid_envelope");
 const der=asBytes(String(privatePem||"").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));
 const privateKey=await crypto.subtle.importKey("pkcs8",der,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
 const raw=await crypto.subtle.decrypt({name:"RSA-OAEP"},privateKey,asBytes(envelope.key));
 const aes=await crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["decrypt"]);
 return await crypto.subtle.decrypt({name:"AES-GCM",iv:asBytes(envelope.iv)},aes,asBytes(envelope.data));
}
export function validateApprovedLikeBatch(batch){
 if(!batch||batch.version!==1||batch.batch_id!==BATCH_ID||batch.action!=="approved_likes"||batch.user_approved!==true||!Array.isArray(batch.posts)||batch.posts.length!==10)return false;
 const ids=new Set(),urls=new Set();
 for(const post of batch.posts){
  if(!Number.isSafeInteger(post.post_id)||post.post_id<1||typeof post.title!=="string"||!post.title.trim()||post.title.length>240)return false;
  const canonical=parsePostTarget(post.url);
  if(!canonical||canonical.url!==post.url||urls.has(post.url)||ids.has(post.post_id))return false;
  urls.add(post.url);ids.add(post.post_id);
 }
 return true;
}
export async function verifyPinnedLikeBatch(envelope,privatePem){
 let plaintext;
 try{plaintext=await decryptApprovedEnvelope(envelope,privatePem);}
 catch{return {ok:false,error:"sealed_batch_decryption_failed"};}
 const bytes=new Uint8Array(plaintext);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(v=>v.toString(16).padStart(2,"0")).join("");
 if(digest!==ALLOWED_BATCH_HASH)return {ok:false,error:"owner_approval_digest_mismatch"};
 let batch;
 try{batch=JSON.parse(new TextDecoder().decode(bytes));}
 catch{return {ok:false,error:"invalid_approved_json"};}
 if(!validateApprovedLikeBatch(batch))return {ok:false,error:"invalid_exact_approval"};
 return {ok:true,batch};
}
export async function importApprovedLikeBatch(env,envelope){
 const receipt=await verifyPinnedLikeBatch(envelope,env.APPROVED_COMMENT_PRIVATE_PEM);
 if(!receipt.ok)return {ok:false,error:receipt.error,publication_performed:false};
 const batch=receipt.batch;
 const db=env.DB;
 const state=await db.prepare("SELECT halted FROM write_policy WHERE id=1").first();
 if(state?.halted)return {ok:false,error:"write_policy_halted",publication_performed:false};
 // Fixed, idempotent table bootstrap. No arbitrary SQL accepted from caller.
 await db.prepare("CREATE TABLE IF NOT EXISTS approved_external_posts (url TEXT PRIMARY KEY,post_id INTEGER NOT NULL,imported_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
 const ops=[],pending=[];
 for(const post of batch.posts){
  const url=post.url,loc=parsePostTarget(url),candidateId=loc.subdomain+":"+post.post_id;
  const hash=await sha256("like\u0000"+url+"\u0000");
  const proposalId="decision_"+(await sha256(batch.batch_id+"|"+url)).slice(0,40);
  const previous=await db.prepare("SELECT status FROM operations WHERE kind='like' AND target=? AND status IN ('succeeded','executing','unknown') LIMIT 1").bind(url).first();
  // Durable editorial preference is independent from whether a Like is
  // already present or becomes eligible for future execution.
  ops.push(db.prepare("INSERT OR IGNORE INTO candidates(id,pub,title,url) VALUES(?,?,?,?)").bind(candidateId,loc.subdomain,post.title,url));
  ops.push(db.prepare("INSERT OR IGNORE INTO approved_external_posts(url,post_id) VALUES(?,?)").bind(url,post.post_id));
  ops.push(db.prepare("INSERT OR IGNORE INTO interaction_feedback(id,candidate_id,choice,source,reason,suggested_action,actual_body,outcome) VALUES(?,?,'like','owner_choice','','like','','approved')").bind("owner_choice:"+batch.batch_id+":"+post.post_id,candidateId));
  if(!previous){
   pending.push(url);
   ops.push(db.prepare("INSERT OR IGNORE INTO proposals(id,kind,target,body,body_hash,origin,state,approved_at) VALUES(?,'like',?,'',?,'decision_pipeline_v1','approved',CURRENT_TIMESTAMP)").bind(proposalId,url,hash));
   ops.push(db.prepare("UPDATE proposals SET state='approved',approved_at=COALESCE(approved_at,CURRENT_TIMESTAMP),origin='decision_pipeline_v1' WHERE kind='like' AND target=? AND body_hash=? AND state='proposed'").bind(url,hash));
   ops.push(db.prepare("INSERT OR IGNORE INTO interaction_feedback(id,candidate_id,choice,source,reason,suggested_action,actual_body,outcome) VALUES(?,?,'like','owner_approval','','like','','approved')").bind("owner_approval:"+batch.batch_id+":"+post.post_id,candidateId));
  }
 }
 // Atomic D1 batch: rerunning the encrypted artifact cannot duplicate Likes.
 await db.batch(ops);
 const queued=await db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind='like' AND origin='decision_pipeline_v1' AND state='approved' AND target IN (SELECT url FROM approved_external_posts)").first();
 return {ok:true,accepted:batch.posts.length,eligible_without_prior_write:pending.length,pending_approved_total:Number(queued?.n||0),duplicate_safe:true,publication_performed:false};
}
