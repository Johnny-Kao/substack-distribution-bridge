// Private state and authentication. Public workflow returns only generic acknowledgements.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
async function authorize(req,env){
  const v=req.headers.get("Authorization")||"";
  return !!env.BRIDGE_KEY && v.startsWith("Bearer ") && v.slice(7)===env.BRIDGE_KEY;
}
async function record(env, id, kind, status){
  await env.DB.prepare("INSERT INTO jobs(id,kind,status) VALUES(?,?,?)").bind(id,kind,status).run();
}
async function discover(env){
  // Only process an allowlisted source list stored PRIVATELY in Cloudflare.
  const raw=await env.DB.prepare("SELECT value FROM settings WHERE key='sources'").first();
  const sources=raw?.value?JSON.parse(raw.value):[];
  let inspected=0;
  for(const pub of sources.slice(0,12)){
    if(!/^[a-z0-9-]{2,60}$/.test(pub)) continue;
    const r=await fetch("https://"+pub+".substack.com/api/v1/posts?limit=12&offset=0",{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(12000)});
    if(!r.ok) continue;
    const posts=await r.json();
    if(!Array.isArray(posts))continue;
    for(const p of posts){
      if(!p.id || !p.title)continue;
      const id=pub+":"+p.id;
      await env.DB.prepare("INSERT OR IGNORE INTO candidates(id,pub,title,url,published) VALUES(?,?,?,?,?)")
       .bind(id,pub,String(p.title).slice(0,300),p.canonical_url||null,p.post_date||null).run();
      inspected++;
    }
  }
  return inspected;
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==="/health") return json({ok:true,mode:"read_only"});
    if(!(await authorize(request,env)))return json({error:"unauthorized"},401);
    if(url.pathname==="/v1/discover"&&request.method==="POST"){
      const body=await request.json().catch(()=>({}));
      if(body.read_only!==true)return json({error:"read_only_required"},403);
      const id=crypto.randomUUID();
      try {const count=await discover(env);await record(env,id,"discovery","ok");return json({ok:true,job_id:id,count});}
      catch(e){await record(env,id,"discovery","error");return json({error:"discovery_failed"},502);}
    }
    if(url.pathname==="/v1/status"&&request.method==="GET"){
      const jobs=await env.DB.prepare("SELECT id,kind,status,created_at FROM jobs ORDER BY created_at DESC LIMIT 10").all();
      const cnt=await env.DB.prepare("SELECT count(*) AS n FROM candidates").first();
      return json({jobs:jobs.results,candidate_count:cnt?.n||0});
    }
    return json({error:"not_found"},404);
  }
};
