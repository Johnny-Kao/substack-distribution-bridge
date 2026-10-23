// Public code, private data. No public workflow writes private candidate details to GitHub.
import { handleGateway } from "./gateway.js";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const allow=(req,env)=>!!env.BRIDGE_KEY&&(req.headers.get("Authorization")||"")==="Bearer "+env.BRIDGE_KEY;
async function setting(env,key,fallback){const r=await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();return r?.value?JSON.parse(r.value):fallback;}
async function record(env,id,kind,status){await env.DB.prepare("INSERT OR IGNORE INTO jobs(id,kind,status) VALUES(?,?,?)").bind(id,kind,status).run();}
const valid=(s,max)=>typeof s==="string"&&s.length>0&&s.length<=max;
export default {
 async fetch(req,env){
  const url=new URL(req.url);
  if(url.pathname==="/health")return json({ok:true,mode:"read_only"});
  if(!allow(req,env))return json({error:"unauthorized"},401);
  if(url.pathname==="/v1/plan"&&req.method==="GET"){
   const sources=await setting(env,"sources",[]);
   const keywords=await setting(env,"keywords",[]);
   const cooling=await env.DB.prepare("SELECT value FROM settings WHERE key='cooldown_until'").first();
   return json({sources,keywords,cooldown_until:Number(cooling?.value||0),max_posts_per_source:10});
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
     await env.DB.prepare("INSERT OR IGNORE INTO candidates(id,pub,title,url,published) VALUES(?,?,?,?,?)")
      .bind(p.id,p.pub,p.title,p.url,valid(p.published,80)?p.published:null).run();
     accepted++;
    }
    await record(env,id,"ingest","ok");
    if(input.rate_limited===true){
      await env.DB.prepare("INSERT INTO settings(key,value) VALUES('cooldown_until',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
       .bind(String(Date.now()+21600000)).run();
    }
    return json({ok:true,job_id:id,accepted});
   }catch(e){await record(env,id,"ingest","error");return json({error:"ingest_failed"},502);}
  }
  if(url.pathname==="/v1/gateway"&&req.method==="POST"){
    const input=await req.json().catch(()=>null);
    if(!input || typeof input.envelope!=="string" || input.envelope.length>22000)return json({error:"invalid_request"},400);
    const result=await handleGateway(env,input);
    return json(result.body,result.status);
  }
  if(url.pathname==="/v1/status"&&req.method==="GET"){
   const jobs=await env.DB.prepare("SELECT id,kind,status,created_at FROM jobs ORDER BY created_at DESC LIMIT 10").all();
   const cnt=await env.DB.prepare("SELECT count(*) AS n FROM candidates").first();
   return json({jobs:jobs.results,candidate_count:cnt?.n||0});
  }
  // Write endpoints are deliberately absent until explicit authorization and
  // idempotent readback verification have been validated independently.
  return json({error:"not_found"},404);
 }
};