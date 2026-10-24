// Read one real article per scheduled run using existing free-tier Browser Run.
// Results stay private in D1. Nothing is published to Substack.
import {withBrowserBudget} from "./browser_budget.js";
import {decodeBrowserJSON} from "./subject.js";
const reply=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export function stripArticleHTML(html){
 if(typeof html!=="string"||html.length<150)return "";
 return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi," ")
  .replace(/<[^>]+>/g," ")
  .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,x=>({ "&nbsp;":" ","&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"}[x]||x))
  .replace(/\s+/g," ").trim().slice(0,42000);
}
export async function readOneGlobalArticle(req,env){
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const candidate=await env.DB.prepare("SELECT g.id,g.subdomain,g.wordcount FROM global_posts g JOIN candidates c ON c.pub=g.subdomain AND c.id=(g.subdomain||':'||g.id) JOIN engagement_targets t ON t.id=c.id WHERE g.full_read_at IS NULL AND t.review_state IN ('pending_semantic_review','semantically_reviewed') ORDER BY t.score DESC,g.published DESC LIMIT 1").first();
 if(!candidate)return reply({ok:true,full_read:0,publication_performed:false});
 if(!Number.isSafeInteger(candidate.id)||!/^[a-z0-9-]{2,60}$/.test(candidate.subdomain))return reply({error:"invalid_article_record"},502);
 const url="https://"+candidate.subdomain+".substack.com/api/v1/posts/by-id/"+candidate.id;
 try{
  const response=await withBrowserBudget(env.DB,"global_article",()=>env.BROWSER.quickAction("content",{
   url,cacheTTL:0,rejectResourceTypes:["image","font","media"],gotoOptions:{waitUntil:"domcontentloaded",timeout:16000}
  }));
  if(!response.ok)return reply({error:"article_browser_error"},502);
  const wrapped=await response.json();
  if(wrapped?.success!==true||wrapped?.meta?.status!==200||wrapped?.meta?.finalUrl!==url)return reply({error:"article_upstream_invalid"},502);
  const data=decodeBrowserJSON(wrapped.result);
  if(data?.post?.id!==candidate.id)return reply({error:"article_identity_mismatch"},502);
  const text=stripArticleHTML(data.post.body_html);
  if(text.length<400)return reply({error:"insufficient_full_article"},422);
  const key=candidate.subdomain+":"+candidate.id;
  await env.DB.batch([
   env.DB.prepare("UPDATE global_posts SET full_text=?,full_read_at=CURRENT_TIMESTAMP WHERE id=?").bind(text,candidate.id),
   env.DB.prepare("UPDATE engagement_targets SET evidence_excerpt=?,word_count=?,review_state='pending_semantic_review',semantic_verdict=NULL,semantic_rationale=NULL,comment_angle=NULL,evidence_signals=json_set(evidence_signals,'$.excerpt_only',json('false'),'$.full_read',json('true')) WHERE id=?").bind(text.slice(0,3500),candidate.wordcount,key)
  ]);
  return reply({ok:true,full_read:1,content_chars:text.length,publication_performed:false});
 }catch(err){
  const code=String(err?.message||"unknown").replace(/[^a-z0-9_:]/gi,"_").slice(0,65);
  return reply({error:"article_read_failed",code,publication_performed:false},code==="browser_free_budget_or_pacing"?429:502);
 }
}
