// Public code, private data. No public workflow writes private candidate details to GitHub.
import { writeHandler } from './writes.js';
import { feedHandler } from './feed.js';
import { runSubjectDiscovery } from './subject_discovery.js';
import {globalContentStep} from './global_content.js';
import {screenGlobalCandidates} from './global_screening.js';
import {deepReviewCandidates} from './deep_screening.js';
import {executeOneApprovedDecision} from './approved_dispatch.js';
import {pruneTerminalArticleText} from './retention.js';
import {readOneGlobalArticle} from './global_article.js';
import {verifyCloudPostLike,verifyCloudCommentReadback,runAuthorizedPostAction,verifyExactCloudComment} from './cloud_substack_writes.js';
import {withBrowserBudget} from './browser_budget.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const allow=(req,env)=>!!env.BRIDGE_KEY&&(req.headers.get("Authorization")||"")==="Bearer "+env.BRIDGE_KEY;
async function setting(env,key,fallback){const r=await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();return r?.value?JSON.parse(r.value):fallback;}
async function record(env,id,kind,status){await env.DB.prepare("INSERT OR IGNORE INTO jobs(id,kind,status) VALUES(?,?,?)").bind(id,kind,status).run();}
const valid=(s,max)=>typeof s==="string"&&s.length>0&&s.length<=max;
export default {
 async fetch(req,env){
  const url=new URL(req.url);
  if(url.pathname==="/health")return json({ok:true,mode:"github_cloudflare_only",public_write_enabled:false});
  if(url.pathname.startsWith("/v1/write/"))return writeHandler(req,env,url);
  if(!allow(req,env))return json({error:"unauthorized"},401);
  // One strictly bounded recovery following independently verified absence.
  if(url.pathname==="/v1/global/reconcile-approved-once"&&req.method==="POST"){
    const expected="9b368097d3afd581ca4be17e3a0d3323e205ff9c168278d2eee864384117f608";
    const raw=await req.json().catch(()=>null);
    if(!raw||raw.v!==1||typeof raw.key!=="string"||typeof raw.iv!=="string"||typeof raw.data!=="string")return json({error:"invalid_reconcile_envelope"},400);
    const fromB64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
    try{
      const pem=env.APPROVED_COMMENT_PRIVATE_PEM;
      const der=fromB64(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));
      const privateKey=await crypto.subtle.importKey("pkcs8",der,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
      const rawKey=await crypto.subtle.decrypt({name:"RSA-OAEP"},privateKey,fromB64(raw.key));
      const aes=await crypto.subtle.importKey("raw",rawKey,{name:"AES-GCM"},false,["decrypt"]);
      const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(raw.iv)},aes,fromB64(raw.data));
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",plaintext))).map(x=>x.toString(16).padStart(2,"0")).join("");
      if(digest!==expected)return json({error:"approval_mismatch"},403);
      const item=JSON.parse(new TextDecoder().decode(plaintext));
      const id="sealed_"+expected.slice(0,40);
      const row=await env.DB.prepare("SELECT status,public_id FROM operations WHERE id=?").bind(id).first();
      if(row?.status!=="unknown"||(row.public_id&&!["retry_used","diagnostic_retry_allowed"].includes(row.public_id)))return json({error:"not_eligible_for_single_recovery",publication_performed:false},409);
      try{
        const checked=await withBrowserBudget(env.DB,"sealed_comment_reconcile",()=>verifyExactCloudComment(env,{target:item.target,postId:item.post_id,body:item.body}));
        if(!checked.ok||!checked.verified)return json({error:"independent_readback_unverified",publication_performed:false},503);
        if(checked.found){
          await env.DB.prepare("UPDATE operations SET status='succeeded',public_id=? WHERE id=? AND status='unknown' AND public_id IS NULL").bind(checked.public_id,id).run();
          return json({ok:true,verified:true,status:"already_commented",publication_performed:false});
        }
        const marker=row.public_id==="diagnostic_retry_allowed"?"minimal_body_retry_allowed":row.public_id==="retry_used"?"diagnostic_retry_allowed":"retry_used";
        const result=await env.DB.prepare("UPDATE operations SET status='reconciled_absent',public_id=? WHERE id=? AND status='unknown' AND COALESCE(public_id,'')=?").bind(marker,id,row.public_id||"").run();
        if(!result.meta?.changes)return json({error:"reconcile_race"},409);
        await env.DB.prepare("UPDATE write_policy SET halted=0,reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND reason='sealed_comment_ambiguous'").run();
        return json({ok:true,verified:true,status:"reconciled_absent_once",publication_performed:false});
      }catch(e){
        const code=String(e?.message||"unknown").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,65);
        return json({error:"reconciliation_unverified",code,publication_performed:false},503);
      }
    }catch(_){return json({error:"invalid_reconciliation_proof",publication_performed:false},400);}
  }
  if(url.pathname==="/v1/global/preflight-approved-comment"&&req.method==="POST"){
    try{
      const expected="9b368097d3afd581ca4be17e3a0d3323e205ff9c168278d2eee864384117f608";
      const raw=await req.json();
      if(raw?.v!==1||typeof raw.key!=="string"||typeof raw.iv!=="string"||typeof raw.data!=="string")return json({error:"invalid_envelope"},400);
      const fromB64=v=>Uint8Array.from(atob(v),x=>x.charCodeAt(0));
      const pem=env.APPROVED_COMMENT_PRIVATE_PEM;
      if(typeof pem!=="string")return json({error:"sealed_secret_missing"},503);
      const der=fromB64(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\s/g,""));
      const priv=await crypto.subtle.importKey("pkcs8",der,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
      const key=await crypto.subtle.decrypt({name:"RSA-OAEP"},priv,fromB64(raw.key));
      const aes=await crypto.subtle.importKey("raw",key,{name:"AES-GCM"},false,["decrypt"]);
      const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(raw.iv)},aes,fromB64(raw.data));
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",plain))).map(v=>v.toString(16).padStart(2,"0")).join("");
      if(hash!==expected)return json({error:"approval_hash_mismatch"},403);
      const item=JSON.parse(new TextDecoder().decode(plain));
      if(item?.action!=="comment"||item?.version!==1||typeof item.body!=="string")return json({error:"invalid_approved_action"},400);
      const result=await withBrowserBudget(env.DB,"comment_preflight",()=>runAuthorizedPostAction(env,{target:item.target,postId:item.post_id,body:item.body,kind:"comment",approved:true,preflightOnly:true}));
      return json({ok:result.ok,verified:result.verified,status:result.status,publication_performed:false});
    }catch(e){
      const code=String(e?.message||"unknown").replace(/[^a-z0-9_:]/gi,"_").slice(0,65);
      return json({error:"comment_preflight_failed",code,publication_performed:false},code==="browser_free_budget_or_pacing"?429:503);
    }
  }
  if(url.pathname==="/v1/global/verify-approved-once"&&req.method==="POST"){
    try{
      const expected="9b368097d3afd581ca4be17e3a0d3323e205ff9c168278d2eee864384117f608";
      const raw=await req.json();
      if(raw?.v!==1||typeof raw.key!=="string"||typeof raw.iv!=="string"||typeof raw.data!=="string")return json({error:"invalid_envelope"},400);
      const fromB64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
      const pem=env.APPROVED_COMMENT_PRIVATE_PEM;
      if(typeof pem!=="string")return json({error:"sealed_secret_missing"},503);
      const der=fromB64(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));
      const privateKey=await crypto.subtle.importKey("pkcs8",der,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
      const rawKey=await crypto.subtle.decrypt({name:"RSA-OAEP"},privateKey,fromB64(raw.key));
      const aes=await crypto.subtle.importKey("raw",rawKey,{name:"AES-GCM"},false,["decrypt"]);
      const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(raw.iv)},aes,fromB64(raw.data));
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",plaintext))).map(x=>x.toString(16).padStart(2,"0")).join("");
      if(digest!==expected)return json({error:"approval_hash_mismatch"},403);
      const item=JSON.parse(new TextDecoder().decode(plaintext));
      try{
        const result=await withBrowserBudget(env.DB,"sealed_comment_readback",()=>verifyExactCloudComment(env,{target:item.target,postId:item.post_id,body:item.body}));
        return json(result);
      }catch(e){
        const code=String(e?.message||"unknown").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,65);
        return json({error:"cloud_exact_comment_readback_failed",code,publication_performed:false},code==="browser_free_budget_or_pacing"?429:503);
      }
    }catch(_){return json({error:"approval_envelope_invalid",publication_performed:false},400);}
  }
  // Narrow one-shot allowance: only the user's explicitly approved, pinned
  // SHA-256 payload. BRIDGE_KEY cannot make arbitrary Like/Comment requests.
  if(url.pathname==="/v1/global/approved-once"&&req.method==="POST"){
    const expected="9b368097d3afd581ca4be17e3a0d3323e205ff9c168278d2eee864384117f608";
    const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
    const hex=b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
    if(typeof env.APPROVED_COMMENT_PRIVATE_PEM!=="string")return json({error:"sealed_decryption_unconfigured",publication_performed:false},503);
    try{
      const envelope=await req.json();
      if(!envelope||envelope.v!==1||typeof envelope.key!=="string"||typeof envelope.iv!=="string"||typeof envelope.data!=="string"||envelope.key.length>1024||envelope.iv.length>64||envelope.data.length>4096)return json({error:"invalid_envelope"},400);
      const keyPem=env.APPROVED_COMMENT_PRIVATE_PEM;
      const der=b64(keyPem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));
      const privateKey=await crypto.subtle.importKey("pkcs8",der,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
      const rawKey=await crypto.subtle.decrypt({name:"RSA-OAEP"},privateKey,b64(envelope.key));
      const aes=await crypto.subtle.importKey("raw",rawKey,{name:"AES-GCM"},false,["decrypt"]);
      const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(envelope.iv)},aes,b64(envelope.data));
      if(hex(await crypto.subtle.digest("SHA-256",plaintext))!==expected)return json({error:"approval_hash_mismatch",publication_performed:false},403);
      const item=JSON.parse(new TextDecoder().decode(plaintext));
      if(item?.version!==1||item.action!=="comment"||typeof item.body!=="string"||item.body.length<20||item.body.length>750||!Number.isSafeInteger(item.post_id)||!item.target)return json({error:"invalid_approved_payload"},400);
      const id="sealed_"+expected.slice(0,40);
      const existing=await env.DB.prepare("SELECT status,public_id FROM operations WHERE id=?").bind(id).first();
      if(existing&&existing.status!=="reconciled_absent")return json({ok:existing.status==="succeeded",status:existing.status,public_id:existing.public_id||null,publication_performed:false,duplicate:true},existing.status==="succeeded"?200:409);
      const policy=await env.DB.prepare("SELECT halted FROM write_policy WHERE id=1").first();
      if(policy?.halted)return json({error:"write_policy_halted",publication_performed:false},423);
      if(existing){
        if(!["retry_used","diagnostic_retry_allowed","minimal_body_retry_allowed"].includes(existing.public_id))return json({error:"retry_proof_mismatch"},409);
        const claimed=await env.DB.prepare("UPDATE operations SET status='executing' WHERE id=? AND status='reconciled_absent' AND public_id=?").bind(id,existing.public_id).run();
        if(!claimed.meta?.changes)return json({error:"concurrent_or_invalid_retry"},409);
      }else{
        await env.DB.prepare("INSERT INTO operations(id,kind,target,approved_hash,status) VALUES(?,'comment',?,?,'executing')").bind(id,item.target,expected).run();
      }
      try{
        const outcome=await withBrowserBudget(env.DB,"sealed_approved_comment",()=>runAuthorizedPostAction(env,{target:item.target,postId:item.post_id,body:item.body,kind:"comment",approved:true}));
        if(!outcome?.ok||outcome.verified!==true)throw Error("unverified_cloud_comment");
        await env.DB.prepare("UPDATE operations SET status='succeeded',public_id=? WHERE id=? AND status='executing'").bind(outcome.public_id||null,id).run();
        return json({ok:true,status:outcome.status,verified:true,public_id:outcome.public_id||null,publication_performed:outcome.publication_performed===true});
      }catch(e){
        const code=String(e?.message||"unknown").replace(/[^a-z0-9_:-]/gi,"_").slice(0,65);
        await env.DB.batch([
          env.DB.prepare("UPDATE operations SET status='unknown' WHERE id=?").bind(id),
          env.DB.prepare("UPDATE write_policy SET halted=1,reason='sealed_comment_ambiguous',updated_at=CURRENT_TIMESTAMP WHERE id=1")
        ]);
        return json({error:"comment_execution_ambiguous_halted",code,publication_performed:null},503);
      }
    }catch(_){
      return json({error:"sealed_approval_invalid",publication_performed:false},400);
    }
  }
  if(url.pathname==="/v1/source-feed")return feedHandler(req,env);
  if(url.pathname==="/v1/subject/step")return runSubjectDiscovery(req,env);
   if(url.pathname==="/v1/global/step")return globalContentStep(req,env);
   if(url.pathname==="/v1/global/read")return readOneGlobalArticle(req,env);
   if(url.pathname==="/v1/global/screen"&&req.method==="POST")return json(await screenGlobalCandidates(env));
   if(url.pathname==="/v1/global/deep-review"&&req.method==="POST")return json(await deepReviewCandidates(env));
   if(url.pathname==="/v1/global/dispatch-approved"&&req.method==="POST"){
    // BRIDGE_KEY is only a timer signal. Request cannot choose or approve an action.
    // Owner-approved proposal hash, origin, write policy, and DB execution lock
    // remain mandatory inside executeOneApprovedDecision.
    const slot=Math.floor(Date.now()/10800000); // one attempt per 3h UTC slot
    const jobId="approved_dispatch_"+slot;
    const acquired=await env.DB.prepare("INSERT OR IGNORE INTO jobs(id,kind,status) VALUES(?,'approved_dispatch','running')").bind(jobId).run();
    if(!acquired.meta?.changes)return json({ok:true,status:"already_triggered_this_slot",publication_performed:false});
    try{
     const outcome=await executeOneApprovedDecision(env);
     // Old terminal article bodies are compacted; IDs and execution audits remain.
     try{await pruneTerminalArticleText(env);}catch{}
     await env.DB.prepare("UPDATE jobs SET status=? WHERE id=?").bind(String(outcome.status).slice(0,80),jobId).run();
     return json({ok:outcome.ok,status:outcome.status,publication_performed:outcome.publication_performed},outcome.ok?200:503);
    }catch{
     await env.DB.prepare("UPDATE jobs SET status='dispatch_error' WHERE id=?").bind(jobId).run();
     return json({ok:false,status:"dispatch_error",publication_performed:null},503);
    }
   }

   if(url.pathname==="/v1/global/verify-comment-readback"&&req.method==="POST"){
    const row=await env.DB.prepare("SELECT url,id FROM global_posts WHERE full_read_at IS NOT NULL ORDER BY full_read_at DESC LIMIT 1").first();
    if(!row)return json({error:"no_private_article_for_comment_probe",publication_performed:false},503);
    try{
      const result=await withBrowserBudget(env.DB,"cloud_comment_probe",()=>verifyCloudCommentReadback(env,{target:row.url,postId:row.id}));
      return json(result);
    }catch(err){
      const code=String(err?.message||"unknown").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,65);
      return json({error:"cloud_comment_probe_failed",code,publication_performed:false},code==="browser_free_budget_or_pacing"?429:503);
    }
   }
   if(url.pathname==="/v1/global/verify-cloud-session"&&req.method==="POST"){
    // Read-only integration probe. Article identity remains private in D1.
    const row=await env.DB.prepare("SELECT url,id FROM global_posts WHERE full_read_at IS NOT NULL ORDER BY full_read_at DESC LIMIT 1").first();
    if(!row)return json({error:"no_private_article_for_probe",publication_performed:false},503);
    try{
     const state=await withBrowserBudget(env.DB,"cloud_like_probe",()=>verifyCloudPostLike(env,{target:row.url,postId:row.id}));
     return json({ok:state.ok,authenticated:state.authenticated,post_identified:state.verified,like_state_readable:typeof state.liked==="boolean",publication_performed:false});
    }catch(e){
     const code=String(e?.message||"unknown").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,65);
     return json({error:"cloud_browser_probe_failed",code,publication_performed:false},code==="browser_free_budget_or_pacing"?429:503);
    }
   }
  if(url.pathname==="/v1/plan"&&req.method==="GET"){
   const configured=await setting(env,"sources",[]);
   const fixedSources=Array.isArray(configured)?configured:[];
   const dynamic=await env.DB.prepare("SELECT subdomain FROM discovered_publications ORDER BY COALESCE(last_fetched_at,'') ASC,discovered_at ASC LIMIT 36").all();
   const sources=[...new Set([...fixedSources,...dynamic.results.map(x=>x.subdomain)])];
   const keywords=await setting(env,"keywords",[]);
    return json({sources,keywords,max_posts_per_source:10});
  }
  if(url.pathname==="/v1/ingest"&&req.method==="POST"){
   const input=await req.json().catch(()=>null);
   if(!input||input.read_only!==true||!Array.isArray(input.candidates)||input.candidates.length>150)return json({error:"bad_request"},400);
   const id=crypto.randomUUID();
   let accepted=0;
   try{
    for(const p of input.candidates){
     if(!p||!valid(p.id,180)||!valid(p.pub,80)||!valid(p.title,300)||!valid(p.url,1000))continue;
     if(!/^[a-z0-9-]{2,60}$/.test(p.pub)||!p.id.startsWith(p.pub+":"))continue;
     let uri;
     try{uri=new URL(p.url);}catch{continue;}
     if(uri.protocol!=="https:"||uri.hostname!==p.pub+".substack.com"||!uri.pathname.startsWith("/p/")||uri.username||uri.password)continue;
     if(!Number.isInteger(p.score)||p.score<0||p.score>100||!["comment_review","like_review"].includes(p.suggested_action))continue;
     if(typeof p.excerpt!=="string"||p.excerpt.length>3500||!Number.isInteger(p.word_count)||p.word_count<100||p.word_count>200000)continue;
     if(!p.signals||typeof p.signals!=="object"||Array.isArray(p.signals))continue;
     const results=await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO candidates(id,pub,title,url,published) VALUES(?,?,?,?,?)")
       .bind(p.id,p.pub,p.title,p.url,valid(p.published,80)?p.published:null),
      env.DB.prepare("INSERT INTO engagement_targets(id,score,suggested_action,evidence_excerpt,evidence_signals,word_count) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET score=excluded.score,suggested_action=excluded.suggested_action,evidence_excerpt=excluded.evidence_excerpt,evidence_signals=excluded.evidence_signals,word_count=excluded.word_count,updated_at=CURRENT_TIMESTAMP WHERE review_state='pending_semantic_review'")
       .bind(p.id,p.score,p.suggested_action,p.excerpt,JSON.stringify(p.signals),p.word_count),
     ]);
     accepted+=results[0]?.meta?.changes?1:0;
    }
    const blocked=input.upstream_blocked===true||input.rate_limited===true;
    await record(env,id,"ingest",input.browser_deferred===true?"deferred_browser_capacity":blocked?"blocked_upstream":"ok");
    return json({ok:true,job_id:id,accepted,upstream_blocked:blocked});
   }catch(e){await record(env,id,"ingest","error");return json({error:"ingest_failed"},502);}
  }
  if(url.pathname==="/v1/session-check"&&req.method==="GET"){
    if(!env.SUBSTACK_SESSION || env.SUBSTACK_SESSION.length<20)return json({configured:false,valid:false});
    try{
      const headers=new Headers({Accept:"application/json"});
      const session=env.SUBSTACK_SESSION.trim();
      headers.set("Cookie", "substack.sid="+session+"; substack.lli=1");
      headers.set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36");
      headers.set("Origin", "https://johnnykao.substack.com");
      headers.set("Referer", "https://johnnykao.substack.com/");
      const upstream=await fetch("https://substack.com/api/v1/user/profile/self",{headers,signal:AbortSignal.timeout(10000)});
      const retry=upstream.headers.get("Retry-After");
      return json({configured:true,valid:upstream.status===429?null:upstream.ok,rate_limited:upstream.status===429,upstream_status:upstream.status,retry_after:retry||null});
    }catch{return json({configured:true,valid:false,upstream_status:null});}
  }
  if(url.pathname==="/v1/status"&&req.method==="GET"){
   const jobs=await env.DB.prepare("SELECT id,kind,status,created_at FROM jobs ORDER BY created_at DESC LIMIT 10").all();
   const cnt=await env.DB.prepare("SELECT count(*) AS n FROM candidates").first();
   const pubs=await env.DB.prepare("SELECT COUNT(*) AS n FROM discovered_publications").first();
   const targets=await env.DB.prepare("SELECT COUNT(*) AS n FROM engagement_targets").first();
    const global=await env.DB.prepare("SELECT COUNT(*) AS posts,COUNT(DISTINCT publication_id) AS publications,SUM(CASE WHEN full_read_at IS NOT NULL THEN 1 ELSE 0 END) AS full_reads FROM global_posts").first();
    const screening=await env.DB.prepare("SELECT COUNT(*) AS reviewed,SUM(CASE WHEN semantic_verdict='skip' THEN 1 ELSE 0 END) AS skipped,SUM(CASE WHEN semantic_verdict IN ('like_review','comment_review') THEN 1 ELSE 0 END) AS potentially_relevant FROM engagement_targets WHERE json_extract(evidence_signals,'$.origin')='global_post_search' AND review_state='semantically_reviewed'").first();
    const outbox=await env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN state='proposed' THEN 1 ELSE 0 END) AS awaiting_approval,SUM(CASE WHEN state='approved' THEN 1 ELSE 0 END) AS ready_to_execute,SUM(CASE WHEN state='executed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN state='unknown' THEN 1 ELSE 0 END) AS needs_reconciliation FROM proposals WHERE origin='decision_pipeline_v1'").first();
   const topic=await env.DB.prepare("SELECT status,created_at,returned,valid_count FROM subject_search_events ORDER BY created_at DESC LIMIT 1").first();
   const budget=await env.DB.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(browser_ms),0) AS ms FROM browser_requests WHERE created_at>=datetime('now','-1 day')").first();
   return json({
    jobs:jobs.results,
    candidate_count:cnt?.n||0,
    engagement_target_count:targets?.n||0,
     global_posts:global?.posts||0,global_publications:global?.publications||0,global_full_reads:global?.full_reads||0,
     global_semantic_reviewed:screening?.reviewed||0,global_semantic_skipped:screening?.skipped||0,global_semantic_potentially_relevant:screening?.potentially_relevant||0,
     decision_pipeline:"scan_to_deep_review_to_owner_approval_to_verified_execution",
     action_outbox:{total:outbox?.total||0,awaiting_approval:outbox?.awaiting_approval||0,ready_to_execute:outbox?.ready_to_execute||0,completed:outbox?.completed||0,needs_reconciliation:outbox?.needs_reconciliation||0},
    discovered_publication_count:pubs?.n||0,
    subject_latest:topic?{status:topic.status,created_at:topic.created_at,returned:topic.returned,valid:topic.valid_count}:null,
    browser_requests_24h:budget?.n||0,browser_ms_24h:budget?.ms||0,
    public_write_enabled:false,transport:"github_cloudflare_only"
   });
  }
  // Write endpoints are deliberately absent until explicit authorization and
  // idempotent readback verification have been validated independently.
  return json({error:"not_found"},404);
 }
};
