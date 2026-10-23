// Read-only Substack discovery against an existing authenticated owner session.
// Never return session data, bearer tokens or raw browser responses to clients.
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export function decodeBrowserJSON(text){
 if(typeof text!=="string"||text.length>4000000)throw Error("invalid_browser_content");
 const match=/<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(text);
 if(!match)throw Error("json_pre_missing");
 const content=match[1].replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,v)=>{
  const s=v.toLowerCase();const named={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};if(Object.hasOwn(named,s))return named[s];
  const n=s.startsWith("#x")?parseInt(s.slice(2),16):parseInt(s.slice(1),10);
  return Number.isInteger(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):m;
 });
 return JSON.parse(content);
}
async function readBrowserJSON(env,url){
 const baseHost="substack.com";
 if(new URL(url).hostname!==baseHost)throw Error("disallowed_host");
 const session=env.SUBSTACK_SESSION;
 if(typeof session!=="string"||session.length<20)throw Error("owner_session_missing");
 const cookies=[
  {name:"substack.sid",value:session.trim(),domain:".substack.com",path:"/",secure:true,httpOnly:true},
  {name:"substack.lli",value:"1",domain:".substack.com",path:"/",secure:true}
 ];
 const browserResponse=await env.BROWSER.quickAction("content",{
  url,cookies,cacheTTL:0,rejectResourceTypes:["image","font","media"],
  gotoOptions:{waitUntil:"domcontentloaded",timeout:16000}
 });
 if(!browserResponse.ok)throw Error("browser_transport_"+browserResponse.status);
 const wrapped=await browserResponse.json();
 if(wrapped?.success!==true||wrapped?.meta?.status!==200||wrapped?.meta?.finalUrl!==url||!String(wrapped?.meta?.headers?.["content-type"]||"").includes("json"))throw Error("browser_upstream_not_json200");
 return decodeBrowserJSON(wrapped.result);
}
export async function ownerSubjectProbe(req,env){
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 if(!env.BROWSER)return json({error:"browser_not_available"},503);
 const input=await req.json().catch(()=>null);
 const mode=input?.mode;
 if(mode!=="session"&&mode!=="search")return json({error:"invalid_mode"},400);
 let url="https://substack.com/api/v1/user/profile/self";
 if(mode==="search"){
  if(!Number.isInteger(input?.subject_index)||input.subject_index<0||input.subject_index>30)return json({error:"invalid_subject_index"},400);
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='keywords'").first();
  const terms=JSON.parse(row?.value||"[]");
  const term=terms[input.subject_index];
  if(typeof term!=="string"||term.length<2||term.length>60)return json({error:"unavailable_subject"},400);
  url="https://substack.com/api/v1/publication/search?"+new URLSearchParams({query:term,page:"0",limit:"12",sort:"relevance"}).toString();
 }
 try{
  const data=await readBrowserJSON(env,url);
  if(mode==="session")return json({ok:true,session_authenticated:Number.isInteger(data?.id),publication_performed:false});
  const results=Array.isArray(data?.results)?data.results:[];
  const pubs=results.filter(r=>r&&typeof r.subdomain==="string"&&/^[a-z0-9-]{2,60}$/.test(r.subdomain));
  return json({ok:true,search_status:"complete",result_count:results.length,usable_publications:pubs.length,publication_performed:false});
 }catch(e){
  const reason=String(e?.message||"unknown").replace(/[^a-zA-Z0-9_:-]/g,"_").slice(0,65);
  return json({error:"read_only_subject_probe_failed",code:reason,publication_performed:false},502);
 }
}
