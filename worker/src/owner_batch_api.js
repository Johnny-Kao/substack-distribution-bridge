// Reusable owner-authorized engagement handoff. Unlike the one-time sealed
// envelope, this route accepts future explicit owner decisions without adding
// approvals, article titles or keys to a public GitHub repository.
//
// Call only behind /v1/write owner authentication. Never under BRIDGE_KEY.
import {parsePostTarget} from "./cloud_substack_writes.js";
import {sha256} from "./action_pipeline.js";

const BATCH_ID=/^[a-zA-Z0-9_-]{8,100}$/;
export const MAX_SELECTED_LIKES=20;
const MAX_REASON=300;
const bad=s=>typeof s!=="string"||/[\x00-\x1f\x7f]/.test(s);
export function validateOwnerSelection(input){
 if(!input||input.confirmed_by_owner!==true||!BATCH_ID.test(input.batch_id||"")||
    !Array.isArray(input.items)||input.items.length<1||input.items.length>MAX_SELECTED_LIKES)return null;
 const urls=new Set(),keys=new Set(),items=[];
 for(const item of input.items){
  if(!item||!["like","skip"].includes(item.choice)||
     !Number.isSafeInteger(item.post_id)||item.post_id<1||
     bad(item.url)||bad(item.title)||!item.title.trim()||item.title.length>200||
     (item.reason!==undefined&&(bad(item.reason)||item.reason.length>MAX_REASON)))return null;
  const normalized=parsePostTarget(item.url);
  if(!normalized||normalized.url!==item.url||
     urls.has(item.url)||keys.has(item.post_id))return null;
  urls.add(item.url);keys.add(item.post_id);
  items.push({
   choice:item.choice,
   url:item.url,
   post_id:item.post_id,
   title:item.title.trim(),
   reason:item.reason||"",
   subdomain:normalized.subdomain
  });
 }
 return {batch_id:input.batch_id,items};
}
const counts=items=>items.reduce((v,i)=>(v[i.choice]++,v),{like:0,skip:0});
export async function enqueueOwnerChoices(env,input){
 const chosen=validateOwnerSelection(input);
 if(!chosen)return {ok:false,error:"invalid_exact_owner_selection",status:400,publication_performed:false};
 const db=env.DB;
 const halt=await db.prepare("SELECT halted FROM write_policy WHERE id=1").first();
 if(halt?.halted)return {ok:false,error:"write_operations_halted",status:423,publication_performed:false};
 const {batch_id,items}=chosen;
 const digest=await sha256(JSON.stringify(items));
 await db.prepare("CREATE TABLE IF NOT EXISTS owner_choice_batches (batch_id TEXT PRIMARY KEY,selection_hash TEXT NOT NULL,item_count INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
 await db.prepare("CREATE TABLE IF NOT EXISTS approved_external_posts (url TEXT PRIMARY KEY,post_id INTEGER NOT NULL,imported_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
 await db.prepare("CREATE TABLE IF NOT EXISTS owner_batch_items (batch_id TEXT NOT NULL,post_id INTEGER NOT NULL,url TEXT NOT NULL,choice TEXT NOT NULL,PRIMARY KEY(batch_id,post_id))").run();
 const prior=await db.prepare("SELECT selection_hash,item_count FROM owner_choice_batches WHERE batch_id=?").bind(batch_id).first();
 if(prior&&prior.selection_hash!==digest)return {ok:false,error:"batch_id_reused_with_different_choices",status:409,publication_performed:false};
 if(prior)return {ok:true,batch_id,already_recorded:true,selected:counts(items),publication_performed:false};
 const prepared=[],statuses=[];
 // Preflight every item BEFORE committing any D1 rows; no partial approval.
 for(const entry of items){
  const mapping=await db.prepare("SELECT post_id FROM approved_external_posts WHERE url=?").bind(entry.url).first();
  if(mapping&&mapping.post_id!==entry.post_id)
   return {ok:false,error:"post_id_url_identity_conflict",status:409,publication_performed:false};
  const existing=await db.prepare("SELECT id,state,origin,body_hash FROM proposals WHERE kind='like' AND target=? LIMIT 1").bind(entry.url).first();
  const priorWrite=await db.prepare("SELECT status FROM operations WHERE kind='like' AND target=? ORDER BY created_at DESC LIMIT 1").bind(entry.url).first();
  if(entry.choice==="like"&&
     (existing?.state==="unknown"||existing?.state==="executing"||priorWrite?.status==="unknown"||priorWrite?.status==="executing"))
   return {ok:false,error:"unresolved_target_requires_readback",status:409,publication_performed:false};
  if(entry.choice==="like"&&existing&&
     (existing.body_hash!==await sha256("like\u0000"+entry.url+"\u0000")||
      !["proposed","approved","executed"].includes(existing.state)))
   return {ok:false,error:"existing_proposal_not_compatible",status:409,publication_performed:false};
  if(entry.choice==="like"&&existing?.state==="rejected")
   return {ok:false,error:"previous_rejection_requires_owner_resolution",status:409,publication_performed:false};
  const id="decision_"+(await sha256("owner-batch:"+batch_id+":"+entry.url)).slice(0,40);
  const hash=await sha256("like\u0000"+entry.url+"\u0000");
  prepared.push({...entry,id,hash,existing,priorWrite});
  statuses.push(entry.choice==="skip"?"skipped":
    (existing?.state==="executed"||priorWrite?.status==="succeeded")?"already_completed":
    existing?.state==="approved"?"already_approved":"newly_approved");
 }
 const actions=[
  db.prepare("INSERT INTO owner_choice_batches(batch_id,selection_hash,item_count) VALUES(?,?,?)").bind(batch_id,digest,items.length)
 ];
 for(const p of prepared){
  const candidateId=p.subdomain+":"+p.post_id;
  actions.push(db.prepare("INSERT INTO owner_batch_items(batch_id,post_id,url,choice) VALUES(?,?,?,?)").bind(batch_id,p.post_id,p.url,p.choice));
  actions.push(db.prepare("INSERT OR IGNORE INTO candidates(id,pub,title,url) VALUES(?,?,?,?)")
    .bind(candidateId,p.subdomain,p.title,p.url));
  actions.push(db.prepare("INSERT OR IGNORE INTO approved_external_posts(url,post_id) VALUES(?,?)")
    .bind(p.url,p.post_id));
  actions.push(db.prepare("INSERT OR IGNORE INTO interaction_feedback(id,candidate_id,choice,source,reason,suggested_action,actual_body,outcome) VALUES(?,?,?,'owner_choice',?,?,'','selected')")
    .bind("owner_choice:"+batch_id+":"+p.post_id,candidateId,p.choice,p.reason,p.choice));
  if(p.choice==="like"){
   if(!p.existing&&!p.priorWrite){
    actions.push(db.prepare("INSERT OR IGNORE INTO proposals(id,kind,target,body,body_hash,origin,state,approved_at) VALUES(?,'like',?,'',?,'decision_pipeline_v1','approved',CURRENT_TIMESTAMP)")
      .bind(p.id,p.url,p.hash));
   }else if(p.existing?.state==="proposed"||p.existing?.state==="approved"){
    actions.push(db.prepare("UPDATE proposals SET state='approved',origin='decision_pipeline_v1',approved_at=COALESCE(approved_at,CURRENT_TIMESTAMP) WHERE id=? AND state IN ('proposed','approved') AND body_hash=?")
      .bind(p.existing.id,p.hash));
   }
   actions.push(db.prepare("INSERT OR IGNORE INTO interaction_feedback(id,candidate_id,choice,source,reason,suggested_action,actual_body,outcome) VALUES(?,?,'like','owner_approval',?,'like','','approved')")
     .bind("owner_approval:"+batch_id+":"+p.post_id,candidateId,p.reason));
  }
 }
 // D1.batch is a transaction. On error no partial approvals/feedback survive.
 await db.batch(actions);
 const statusCounts={skipped:0,already_completed:0,already_approved:0,newly_approved:0};
 for(const v of statuses)statusCounts[v]++;
 return {ok:true,batch_id,selected:counts(items),...statusCounts,already_recorded:false,publication_performed:false,dispatch:"hourly_cloud_approved_outbox"};
}
