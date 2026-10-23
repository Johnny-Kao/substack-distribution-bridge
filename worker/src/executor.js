// Verified Substack client. No logging of private content/cookies.
// Calls use the same HTTP headers verified on the M5.
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const validID=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;

function checkedURL(url){
 const result=new URL(url);
 if(result.protocol!=="https:"||(!result.hostname.endsWith(".substack.com")&&result.hostname!=="substack.com"))throw Error("invalid_upstream_host");
 return result;
}
function headers(env,origin,json=false){
 if(!env.SUBSTACK_SESSION || env.SUBSTACK_SESSION.length<20)throw Error("session_missing");
 const h={"User-Agent":UA,"Accept":"application/json","Cookie":"substack.sid="+env.SUBSTACK_SESSION.trim()+"; substack.lli=1","Origin":origin,"Referer":origin+"/"};
 if(json)h["Content-Type"]="application/json";
 return h;
}
async function request(env,url,origin,body){
 checkedURL(url);
 const r=await fetch(url,{method:body===undefined?"GET":"POST",headers:headers(env,origin,body!==undefined),body:body===undefined?undefined:JSON.stringify(body),redirect:"manual",signal:AbortSignal.timeout(15000)});
 if(!r.ok){
  const label=new URL(url).pathname.startsWith("/api/v1/user/")?"profile":new URL(url).pathname.startsWith("/api/v1/reader/feed/")?"likes_feed":"post_metadata";
  throw Error("upstream_"+label+"_http_"+r.status);
 }
 return r.json();
}
async function ownUser(env){
 const data=await request(env,"https://substack.com/api/v1/user/profile/self","https://johnnykao.substack.com");
 const id=data?.id||data?.user_id;
 if(!validID(id))throw Error("profile_id_missing");
 return Number(id);
}
async function likedFeedContains(env,postID,userID){
 const page=await request(env,"https://substack.com/api/v1/reader/feed/profile/"+userID+"?types%5B%5D=like&limit=50","https://johnnykao.substack.com");
 if(!Array.isArray(page?.items))throw Error("invalid_likes_feed");
 return page.items.some(x=>Number(x?.post?.id)===Number(postID));
}
function parsedPostTarget(target){
 const url=checkedURL(target);
 if(url.hostname==="substack.com"||url.search||url.hash)throw Error("invalid_post_target");
 const parts=url.pathname.split("/").filter(Boolean);
 if(parts.length!==2||parts[0]!=="p"||!/^[a-z0-9-]+$/i.test(parts[1]))throw Error("invalid_post_target");
 return {url,slug:parts[1],origin:url.origin};
}
async function postInfo(env,target){
 const info=parsedPostTarget(target);
 const post=await request(env,info.origin+"/api/v1/posts/"+encodeURIComponent(info.slug),info.origin);
 const value=post?.post||post;
 if(!validID(value?.id)||value?.is_published===false)throw Error("post_not_found");
 return {...info,postID:Number(value.id)};
}
function noteDocument(text){
 return {type:"doc",attrs:{schemaVersion:"v1",title:null},content:text.split(/\n+/).filter(x=>x.trim()).map(x=>({type:"paragraph",content:[{type:"text",text:x}]}))};
}
async function verifyComment(env,postID,origin,commentId,body){
 const data=await request(env,origin+"/api/v1/post/"+postID+"/comments?all_comments=true",origin);
 const seen=new Set();
 function seek(obj){
  if(!obj||typeof obj!=="object"||seen.has(obj))return false;
  seen.add(obj);
  if(Number(obj.id)===Number(commentId)&&obj.body===body)return true;
  if(Array.isArray(obj))return obj.some(seek);
  return Object.values(obj).some(v=>v&&typeof v==="object"&&seek(v));
 }
 return seek(data);
}
async function verifyNote(env,id){
 const data=await request(env,"https://substack.com/api/v1/reader/comment/"+id,"https://johnnykao.substack.com");
 return Number(data?.id||data?.comment?.id)===Number(id);
}
export async function performVerifiedWrite(env,proposal){
 if(!["like","comment","note"].includes(proposal.kind))throw Error("unsupported_kind");
 if(proposal.kind==="note"&&proposal.target!=="https://johnnykao.substack.com/")throw Error("wrong_note_publication");
 const self=await ownUser(env);
 let post=null;
 if(proposal.kind!=="note")post=await postInfo(env,proposal.target);
 if(proposal.kind==="like"){
  if(await likedFeedContains(env,post.postID,self))return {verified:true,already_existed:true,public_id:String(post.postID)};
  await request(env,post.origin+"/api/v1/post/"+post.postID+"/reaction",post.origin,{reaction:"❤",surface:"reader"});
  for(let n=0;n<3;n++){
   if(await likedFeedContains(env,post.postID,self))return {verified:true,already_existed:false,public_id:String(post.postID)};
   if(n<2)await sleep(1200);
  }
  throw Error("like_unverified");
 }
 if(proposal.kind==="comment"){
  const created=await request(env,post.origin+"/api/v1/post/"+post.postID+"/comment",post.origin,{body:proposal.body});
  const cid=created?.id||created?.comment?.id;
  if(!validID(cid))throw Error("comment_response_no_id");
  for(let n=0;n<3;n++){
   if(await verifyComment(env,post.postID,post.origin,cid,proposal.body))return {verified:true,public_id:String(cid)};
   if(n<2)await sleep(1200);
  }
  throw Error("comment_unverified");
 }
 const created=await request(env,"https://substack.com/api/v1/comment/feed","https://johnnykao.substack.com",{bodyJson:noteDocument(proposal.body)});
 const nid=created?.id||created?.comment?.id;
 if(!validID(nid))throw Error("note_response_no_id");
 for(let n=0;n<3;n++){
  if(await verifyNote(env,nid))return {verified:true,public_id:String(nid)};
  if(n<2)await sleep(1200);
 }
 throw Error("note_unverified");
}
export async function existingLikeStatus(env,target){
 const post=await postInfo(env,target);
 const self=await ownUser(env);
 return {post_id:post.postID,already_liked:await likedFeedContains(env,post.postID,self)};
}
