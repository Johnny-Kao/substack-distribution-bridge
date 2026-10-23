// Public Substack RSS through Cloudflare Browser Run, never an authenticated proxy.
// Reject non-XML responses; do not publish private source names or article text to logs.
import {withBrowserBudget} from "./browser_budget.js";
const textResponse=(s,status=200,type="application/json")=>new Response(type==="application/json"?JSON.stringify(s):s,{status,headers:{"content-type":type,"cache-control":"no-store"}});
const id=s=>typeof s==="string"&&/^[a-z0-9-]{2,60}$/.test(s);
const namedEntities={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};
export function decodeBrowserXML(html){
 if(typeof html!=="string"||html.length>4_000_000)throw Error("invalid_rendered_html");
 const pre=/<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(html)?.[1];
 if(!pre)throw Error("xml_pre_missing");
 const xml=pre.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(full,part)=>{
  const key=part.toLowerCase();
  if(Object.hasOwn(namedEntities,key))return namedEntities[key];
  const code=key.startsWith("#x")?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
  return Number.isInteger(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):full;
 }).trim();
 if(xml.length<100||xml.length>2_000_000||!xml.startsWith("<?xml")||!/<rss\b/.test(xml)||!/<item\b/.test(xml))throw Error("invalid_rss_payload");
 if(/<!DOCTYPE/i.test(xml))throw Error("xml_doctype_not_allowed");
 return xml;
}
export async function feedHandler(req,env){
 if(req.method!=="POST")return textResponse({error:"method_not_allowed"},405);
 const input=await req.json().catch(()=>null);
 if(!id(input?.source))return textResponse({error:"invalid_source"},400);
 const plan=await env.DB.prepare("SELECT value FROM settings WHERE key='sources'").first();
 const sources=JSON.parse(plan?.value||"[]");
 const dynamic=await env.DB.prepare("SELECT subdomain FROM discovered_publications WHERE subdomain=?").bind(input.source).first();
 if((!Array.isArray(sources)||!sources.includes(input.source))&&!dynamic)return textResponse({error:"source_not_allowed"},403);
 if(!env.BROWSER)return textResponse({error:"browser_binding_missing"},503);
 const quota=await env.DB.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(duration_ms),0) AS used_ms FROM feed_fetches WHERE created_at>=datetime('now','start of day')").first();
 // Browser Run Free has a time allowance. Reserve ample room for other account activity.
 if(Number(quota?.n||0)>=36||Number(quota?.used_ms||0)>=300000)return textResponse({error:"browser_budget_exhausted"},429);
 const taskId=crypto.randomUUID(),started=Date.now();
 await env.DB.prepare("INSERT INTO feed_fetches(id,source,status) VALUES(?,?,'started')").bind(taskId,input.source).run();
 try{
  const url="https://"+input.source+".substack.com/feed";
  const result=await withBrowserBudget(env.DB,"public_feed",()=>env.BROWSER.quickAction("content",{url,gotoOptions:{waitUntil:"domcontentloaded",timeout:12000},rejectResourceTypes:["image","media","font"]}));
  if(!result.ok)throw Error("browser_http_"+result.status);
  const payload=await result.json();
  if(payload?.success!==true||payload.meta?.status!==200||!String(payload.meta?.headers?.["content-type"]||"").includes("xml")||payload.meta?.finalUrl!==url)throw Error("source_not_xml_200");
  const xml=decodeBrowserXML(payload.result);
  await env.DB.prepare("UPDATE feed_fetches SET status='ok',duration_ms=? WHERE id=?").bind(Date.now()-started,taskId).run();
  if(dynamic)await env.DB.prepare("UPDATE discovered_publications SET last_fetched_at=CURRENT_TIMESTAMP WHERE subdomain=?").bind(input.source).run();
  return textResponse(xml,200,"application/rss+xml; charset=utf-8");
 }catch(err){
  const code=String(err?.message||"unknown").replace(/[^a-zA-Z0-9_:]/g,"_").slice(0,65);
  await env.DB.prepare("UPDATE feed_fetches SET status='failed',duration_ms=? WHERE id=?").bind(Date.now()-started,taskId).run();
  if(dynamic)await env.DB.prepare("UPDATE discovered_publications SET last_fetched_at=CURRENT_TIMESTAMP WHERE subdomain=?").bind(input.source).run();
  return textResponse({error:"feed_fetch_failed",code},code==="browser_free_budget_or_pacing"?429:502);
 }
}
