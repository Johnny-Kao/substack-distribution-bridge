// Decision-to-execution bridge. Candidate decisions are not public-write approval.
// This module is read-only or creates pending proposals only.
const VALID_ORIGIN="decision_pipeline_v1";
const encode=new TextEncoder();
export async function sha256(value){
 const digest=await crypto.subtle.digest("SHA-256",encode.encode(value));
 return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
export function actionStage({deepDecision,alreadyHandled=false,proposalState=null,discussionReviewed=false}){
 if(alreadyHandled)return "already_executed_or_uncertain";
 if(proposalState==="executed")return "executed";
 if(proposalState==="unknown")return "execution_unknown";
 if(proposalState==="executing")return "executing";
 if(proposalState==="approved")return "approved_for_execution";
 if(proposalState==="proposed")return "awaiting_approval";
 if(deepDecision==="skip")return "rejected";
 if(deepDecision==="like_review")return "ready_to_propose_like";
 if(deepDecision==="comment_review")return discussionReviewed?"ready_for_exact_comment":"needs_discussion_and_exact_comment";
 return "awaiting_deep_review";
}
export async function stageApprovedDecisionCandidate(env,{id,kind,body="",discussionReviewed=false}){
 if(typeof id!=="string"||id.length>180||!["like","comment"].includes(kind))return {ok:false,error:"invalid_decision_request",status:400};
 if(typeof body!=="string"||body.length>750|| (kind==="like"&&body!=="")||(kind==="comment"&&(body.trim().length<20||!discussionReviewed)))return {ok:false,error:"exact_body_or_discussion_review_required",status:400};
 const paused=await env.DB.prepare("SELECT halted FROM write_policy WHERE id=1").first();
 if(paused?.halted)return {ok:false,error:"write_policy_halted",status:423};
 const target=await env.DB.prepare("SELECT c.id,c.url,g.id AS post_id,t.score,t.evidence_signals, (SELECT COUNT(*) FROM operations o WHERE o.target=c.url AND o.kind=? AND o.status IN ('unknown','succeeded','executing')) AS existing_actions FROM engagement_targets t JOIN candidates c ON c.id=t.id JOIN global_posts g ON g.url=c.url WHERE t.id=? AND t.review_state='semantically_reviewed' LIMIT 1").bind(kind,id).first();
 if(!target)return {ok:false,error:"reviewed_candidate_not_found",status:404};
 let signals;try{signals=JSON.parse(target.evidence_signals)}catch{return {ok:false,error:"invalid_private_evidence",status:409};}
 if(!signals?.deep_review||signals?.deep_review?.decision!==(kind==="like"?"like_review":"comment_review")||target.score<60)return {ok:false,error:"no_qualifying_deep_decision",status:409};
 if(kind==="comment"&&signals?.deep_review?.discussion_context!=="not_fetched")return {ok:false,error:"unexpected_discussion_state",status:409};
 if(target.existing_actions)return {ok:false,error:"previous_interaction_or_uncertain",status:409};
 if(!Number.isSafeInteger(target.post_id)||target.post_id<=0)return {ok:false,error:"invalid_post_id",status:409};
 const hash=await sha256(kind+"\u0000"+target.url+"\u0000"+body);
 const prior=await env.DB.prepare("SELECT id,state FROM proposals WHERE kind=? AND target=? AND body_hash=?").bind(kind,target.url,hash).first();
 if(prior)return {ok:true,proposal_id:prior.id,state:prior.state,already_staged:true,publication_performed:false};
 const outstanding=await env.DB.prepare("SELECT COUNT(*) AS n FROM proposals WHERE origin=? AND state IN ('proposed','approved','executing')").bind(VALID_ORIGIN).first();
 if(Number(outstanding?.n||0)>=20)return {ok:false,error:"approval_queue_full",status:429};
 const proposalId="decision_"+crypto.randomUUID().replace(/-/g,"");
 await env.DB.prepare("INSERT OR IGNORE INTO proposals(id,kind,target,body,body_hash,origin) VALUES(?,?,?,?,?,?)").bind(proposalId,kind,target.url,body,hash,VALID_ORIGIN).run();
 const staged=await env.DB.prepare("SELECT id,state FROM proposals WHERE kind=? AND target=? AND body_hash=?").bind(kind,target.url,hash).first();
 return {ok:true,proposal_id:staged.id,state:staged.state,already_staged:staged.id!==proposalId,post_id:target.post_id,content_hash:hash,requires_exact_approval:true,publication_performed:false};
}
export async function autoStageDeepLike(env,candidate,verdict){
 // Stage only reversible, private, non-publishing proposals.
 if(verdict.decision!=="like_review"||!candidate.url||candidate.score<60)return {state:verdict.decision==="skip"?"rejected":"needs_discussion_and_exact_comment"};
 const prev=await env.DB.prepare("SELECT id FROM operations WHERE kind='like' AND target=? AND status IN ('succeeded','unknown','executing') LIMIT 1").bind(candidate.url).first();
 if(prev)return {state:"already_executed_or_uncertain"};
 const hash=await sha256("like\u0000"+candidate.url+"\u0000");
 const prior=await env.DB.prepare("SELECT id FROM proposals WHERE kind='like' AND target=? AND body_hash=?").bind(candidate.url,hash).first();
 if(prior)return {state:"awaiting_approval"};
 const outstanding=await env.DB.prepare("SELECT COUNT(*) AS n FROM proposals WHERE origin=? AND state IN ('proposed','approved','executing')").bind(VALID_ORIGIN).first();
 if(Number(outstanding?.n||0)>=20)return {state:"queue_full"};
 const proposalId="decision_"+crypto.randomUUID().replace(/-/g,"");
 await env.DB.prepare("INSERT OR IGNORE INTO proposals(id,kind,target,body,body_hash,origin) VALUES(?,'like',?,'',?,?)").bind(proposalId,candidate.url,hash,VALID_ORIGIN).run();
 return {state:"awaiting_approval"};
}
export async function listDecisionOutbox(env){
 const rows=await env.DB.prepare("SELECT t.id,c.title,c.url,g.id AS post_id,t.score,t.evidence_signals,t.semantic_verdict,t.comment_angle, (SELECT p.state FROM proposals p WHERE p.target=c.url AND p.origin='decision_pipeline_v1' ORDER BY p.created_at DESC LIMIT 1) AS proposal_state, EXISTS(SELECT 1 FROM operations o WHERE o.target=c.url AND o.kind IN ('comment','like') AND o.status IN ('unknown','succeeded','executing')) AS already_handled FROM engagement_targets t JOIN candidates c ON c.id=t.id JOIN global_posts g ON g.url=c.url WHERE json_extract(t.evidence_signals,'$.deep_review.decision') IN ('like_review','comment_review','skip') ORDER BY t.score DESC LIMIT 30").all();
 const out=(rows.results||[]).map(row=>{
  let d={};try{d=JSON.parse(row.evidence_signals)?.deep_review||{}}catch{}
  const state=actionStage({deepDecision:d.decision,alreadyHandled:!!row.already_handled,proposalState:row.proposal_state});
  return {id:row.id,title:row.title,url:row.url,post_id:row.post_id,score:row.score,decision:d.decision||null,rationale:d.rationale||null,evidence_quote:d.evidence_quote||null,angle:d.angle||null,discussion_context:d.discussion_context||"unknown",state};
 });
 const counts=out.reduce((o,row)=>(o[row.state]=(o[row.state]||0)+1,o),{});
 return {ok:true,items:out,counts,publication_performed:false};
}
