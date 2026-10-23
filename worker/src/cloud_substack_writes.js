// Owner-authorized Substack writes using Cloudflare Browser Sessions.
// No local computer or GitHub Actions secret can issue a public interaction.
import puppeteer from "@cloudflare/puppeteer";
const likeEmoji="❤";
export function parsePostTarget(raw){
  let url;
  try{url=new URL(raw);}catch{return null;}
  if(url.protocol!=="https:"||url.username||url.password||url.port||url.search||url.hash)return null;
  const m=/^([a-z0-9-]{2,60})\.substack\.com$/.exec(url.hostname);
  if(!m||!/^\/p\/[a-z0-9-]{1,200}\/?$/.test(url.pathname))return null;
  return {host:url.hostname,subdomain:m[1],url:url.origin+url.pathname.replace(/\/$/,"")};
}
export async function runAuthorizedPostAction(env,{target,kind,body="",postId,approved=false}){
  const loc=parsePostTarget(target);
  if(!approved||!loc||!["like","comment"].includes(kind)||!Number.isSafeInteger(postId)||postId<1)throw Error("invalid_or_unapproved_action");
  // Match the verified local Substack reaction contract; reject unvalidated Comment transport.
  if(kind==="comment")throw Error("comment_cloud_transport_not_yet_verified");
  if(typeof env.SUBSTACK_SESSION!=="string"||env.SUBSTACK_SESSION.length<20)throw Error("substack_session_missing");
  if(!env.BROWSER)throw Error("cloud_browser_unavailable");
  let browser;
  try{
    browser=await puppeteer.launch(env.BROWSER);
    const page=await browser.newPage();
    await page.setCookie({name:"substack.sid",value:env.SUBSTACK_SESSION.trim(),domain:".substack.com",path:"/",httpOnly:true,secure:true});
    await page.goto("https://"+loc.host+"/",{waitUntil:"domcontentloaded",timeout:18000});
    const verify=()=>page.evaluate(async args=>{
      const response=await fetch("/api/v1/posts/by-id/"+args.id,{credentials:"include",headers:{"accept":"application/json"}});
      if(!response.ok)return {ok:false,status:response.status};
      const data=await response.json();
      const post=data?.post||data;
      return {ok:post?.id===args.id,id:post?.id,reaction:post?.reaction===true,commentCount:Number(post?.comment_count)||0};
    },{id:postId});
    const before=await verify();
    if(!before.ok)throw Error("unverified_account_or_post");
    if(kind==="like"&&before.reaction)return {ok:true,status:"already_liked",verified:true,publication_performed:false};
    if(kind==="comment"&&(!body.trim()||body.length>750))throw Error("invalid_comment");
    const write=await page.evaluate(async args=>{
      const endpoint="/api/v1/post/"+args.id+(args.kind==="like"?"/reaction":"/comment");
      const payload=args.kind==="like"?{reaction:args.emoji}:{body:args.body};
      const result=await fetch(endpoint,{method:"POST",credentials:"include",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify(payload)});
      const data=await result.json().catch(()=>null);
      return {ok:result.ok,status:result.status,id:args.kind==="comment"?Number(data?.id)||null:null};
    },{id:postId,kind,body,emoji:likeEmoji});
    if(!write.ok)throw Error("substack_action_rejected_"+write.status);
    const after=await verify();
    if(kind==="like"){
      if(after.ok&&after.reaction)return {ok:true,status:"liked",verified:true,publication_performed:true};
      throw Error("ambiguous_like_readback");
    }
    // Prefer an independently returned comment ID; count alone can race.
    if(!write.id)throw Error("ambiguous_comment_response");
    const comment=await page.evaluate(async args=>{
      const r=await fetch("/api/v1/post/"+args.id+"/comments?all_comments=true",{credentials:"include"});
      if(!r.ok)return false;
      const d=await r.json();
      const walk=(v,depth=0)=>{
        if(depth>6||!v||typeof v!=="object")return false;
        if(Number(v.id)===args.commentId&&typeof v.body==="string"&&v.body.trim()===args.body.trim())return true;
        return Object.values(v).some(x=>Array.isArray(x)?x.some(y=>walk(y,depth+1)):typeof x==="object"&&walk(x,depth+1));
      };
      return walk(d);
    },{id:postId,commentId:write.id,body});
    if(!comment)throw Error("ambiguous_comment_readback");
    return {ok:true,status:"commented",verified:true,public_id:String(write.id),publication_performed:true};
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
}
