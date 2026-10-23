// Public code, private data. No public workflow writes private candidate details to GitHub.
import { writeHandler } from './writes.js';
import { feedHandler } from './feed.js';
import { runSubjectDiscovery } from './subject_discovery.js';
import {globalContentStep} from './global_content.js';
import {screenGlobalCandidates} from './global_screening.js';
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
  if(url.pathname==="/v1/source-feed")return feedHandler(req,env);
  if(url.pathname==="/v1/subject/step")return runSubjectDiscovery(req,env);
   if(url.pathname==="/v1/global/step")return globalContentStep(req,env);
   if(url.pathname==="/v1/global/screen"&&req.method==="POST")return json(await screenGlobalCandidates(env));
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
   const topic=await env.DB.prepare("SELECT status,created_at,returned,valid_count FROM subject_search_events ORDER BY created_at DESC LIMIT 1").first();
   const budget=await env.DB.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(browser_ms),0) AS ms FROM browser_requests WHERE created_at>=datetime('now','-1 day')").first();
   return json({
    jobs:jobs.results,
    candidate_count:cnt?.n||0,
    engagement_target_count:targets?.n||0,
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
