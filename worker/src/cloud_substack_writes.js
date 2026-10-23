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
  // Comment POST may proceed only after the owner write-control plane verifies exact approval.
  if(typeof env.SUBSTACK_SESSION!=="string"||env.SUBSTACK_SESSION.length<20)throw Error("substack_session_missing");
  if(!env.BROWSER)throw Error("cloud_browser_unavailable");
  let browser;
  try{
    browser=await puppeteer.launch(env.BROWSER);
    const page=await browser.newPage();
    await page.setCookie({name:"substack.sid",value:env.SUBSTACK_SESSION.trim(),domain:".substack.com",path:"/",httpOnly:true,secure:true});
    await page.goto("https://substack.com/",{waitUntil:"domcontentloaded",timeout:18000});
    const owner=await page.evaluate(async()=>{
      const r=await fetch("/api/v1/user/profile/self",{credentials:"include"});
      const d=r.ok?await r.json().catch(()=>null):null;
      return Number.isSafeInteger(d?.id)?d.id:null;
    });
    if(!owner)throw Error("cloud_comment_account_unverified");
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
    const comments=()=>page.evaluate(async id=>{
      const r=await fetch("/api/v1/post/"+id+"/comments?token=&all_comments=true&sort=most_recent_first",{credentials:"include"});
      return r.ok?{ok:true,data:await r.json().catch(()=>null)}:{ok:false};
    },postId);
    const exact=(data,wantId=null)=>{
      const seen=new Set();
      function search(v,depth=0){
        if(!v||typeof v!=="object"||depth>12||seen.has(v))return null;
        seen.add(v);
        if(!Array.isArray(v)&&Number(v.id)>0&&Number(v.user_id)===owner&&typeof v.body==="string"&&v.body.trim()===body.trim()&&(!wantId||Number(v.id)===wantId))return Number(v.id);
        for(const x of Object.values(v)){
          if(Array.isArray(x)){for(const item of x){const id=search(item,depth+1);if(id)return id;}}
          else if(typeof x==="object"){const id=search(x,depth+1);if(id)return id;}
        }
        return null;
      }
      return search(data);
    };
    if(kind==="comment"){
      const pre=await comments();
      if(!pre.ok||!pre.data)throw Error("pre_comment_readback_failed");
      const found=exact(pre.data);
      if(found)return {ok:true,status:"already_commented",verified:true,public_id:String(found),publication_performed:false};
    }
    if(kind==="like"&&before.reaction)return {ok:true,status:"already_liked",verified:true,publication_performed:false};
    if(kind==="comment"&&(!body.trim()||body.length>750))throw Error("invalid_comment");
    const write=await page.evaluate(async args=>{
      const endpoint="/api/v1/post/"+args.id+(args.kind==="like"?"/reaction":"/comment");
      const payload=args.kind==="like"?{reaction:args.emoji}:{body:args.body,parent_id:null};
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
    // Verify exact body and authenticated user identity, not just a count.
    const after=await comments();
    if(!after.ok||!after.data)throw Error("ambiguous_comment_readback");
    const commentId=exact(after.data,write.id);
    if(!commentId)throw Error("ambiguous_comment_readback");
    return {ok:true,status:"commented",verified:true,public_id:String(commentId),publication_performed:true};
  }finally{
    if(browser)await browser.close().catch(()=>{});
  }
}

/**
 * Read-only, owner-authenticated Like verification. Fails closed on login
 * uncertainty, missing post identity, redirects, or malformed responses.
 * No public action is performed and no personal profile information leaves
 * the Worker.
 */
export async function verifyCloudPostLike(env,{target,postId}){
  const loc=parsePostTarget(target);
  if(!loc||!Number.isSafeInteger(postId)||postId<1)throw Error("invalid_like_check_target");
  if(typeof env.SUBSTACK_SESSION!=="string"||env.SUBSTACK_SESSION.length<20)throw Error("substack_session_missing");
  if(!env.BROWSER)throw Error("cloud_browser_unavailable");
  const browser=await puppeteer.launch(env.BROWSER);
  try{
    const page=await browser.newPage();
    await page.setCookie({name:"substack.sid",value:env.SUBSTACK_SESSION.trim(),domain:".substack.com",path:"/",httpOnly:true,secure:true});
    await page.goto("https://substack.com/",{waitUntil:"domcontentloaded",timeout:18000});
    const authenticated=await page.evaluate(async()=>{
      const r=await fetch("/api/v1/user/profile/self",{credentials:"include",headers:{accept:"application/json"}});
      if(!r.ok)return false;
      const d=await r.json().catch(()=>null);
      return Number.isSafeInteger(d?.id);
    });
    if(!authenticated)throw Error("cloud_substack_session_unverified");
    await page.goto("https://"+loc.host+"/",{waitUntil:"domcontentloaded",timeout:18000});
    const state=await page.evaluate(async(id)=>{
      const r=await fetch("/api/v1/posts/by-id/"+id,{credentials:"include",headers:{accept:"application/json"}});
      if(!r.ok)return {ok:false};
      const d=await r.json().catch(()=>null),p=d?.post||d;
      return {ok:p?.id===id&&typeof p?.reaction==="boolean",canonical:p?.canonical_url||"",liked:p?.reaction===true};
    },postId);
    if(!state.ok||state.canonical!==loc.url)throw Error("cloud_like_readback_unverified");
    return {ok:true,authenticated:true,liked:state.liked,verified:true,publication_performed:false};
  }finally{
    await browser.close().catch(()=>{});
  }
}

/** Read-only proof that Cloudflare can inspect this post's comment thread. */
export async function verifyCloudCommentReadback(env,{target,postId}){
  const loc=parsePostTarget(target);
  if(!loc||!Number.isSafeInteger(postId)||postId<1)throw Error("invalid_comment_probe_target");
  if(typeof env.SUBSTACK_SESSION!=="string"||env.SUBSTACK_SESSION.length<20||!env.BROWSER)throw Error("cloud_comment_session_unavailable");
  const browser=await puppeteer.launch(env.BROWSER);
  try{
    const page=await browser.newPage();
    await page.setCookie({name:"substack.sid",value:env.SUBSTACK_SESSION.trim(),domain:".substack.com",path:"/",httpOnly:true,secure:true});
    await page.goto("https://substack.com/",{waitUntil:"domcontentloaded",timeout:18000});
    const userId=await page.evaluate(async()=>{
      const r=await fetch("/api/v1/user/profile/self",{credentials:"include"});
      const d=r.ok?await r.json().catch(()=>null):null;
      return Number.isSafeInteger(d?.id)?d.id:null;
    });
    if(!userId)throw Error("cloud_comment_session_unverified");
    await page.goto("https://"+loc.host+"/",{waitUntil:"domcontentloaded",timeout:18000});
    const detail=await page.evaluate(async id=>{
      const r=await fetch("/api/v1/posts/by-id/"+id,{credentials:"include"});
      const d=r.ok?await r.json().catch(()=>null):null,p=d?.post||d;
      return {id:p?.id,canonical:p?.canonical_url};
    },postId);
    if(detail.id!==postId||detail.canonical!==loc.url)throw Error("cloud_comment_target_mismatch");
    const list=await page.evaluate(async id=>{
      const r=await fetch("/api/v1/post/"+id+"/comments?token=&all_comments=true&sort=most_recent_first",{credentials:"include"});
      if(!r.ok)return {ok:false};
      const d=await r.json().catch(()=>null);
      return {ok:Array.isArray(d?.comments)};
    },postId);
    if(!list.ok)throw Error("cloud_comment_listing_unavailable");
    return {ok:true,authenticated:true,post_identified:true,comments_readable:true,publication_performed:false};
  }finally{await browser.close().catch(()=>{});}
}
