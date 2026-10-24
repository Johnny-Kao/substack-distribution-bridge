// Shared Cloudflare Browser Run Free budget and pacing across RSS and subject search.
// Reserve atomically in D1 before every Quick Action. No paid overflow paths.
export const MAX_ACTIONS_DAY = 38;
// Reserve two additional actions ONLY for an exact, already owner-approved
// comment: prior-state reconciliation and one attempt with its own readback.
// Cloudflare Free bills browser minutes (10 min/day), not 38 actions/day.
// The stricter existing 390s rolling-minute guard remains unchanged.
export const MAX_APPROVED_ACTIONS_DAY = 40;
export const MAX_BROWSER_MS_DAY = 390000;
export const MIN_SECONDS_BETWEEN_ACTIONS = 15;

export async function reserveBrowserAction(db,kind){
 const id=crypto.randomUUID();
 const limit=["sealed_comment_reconcile","sealed_approved_comment"].includes(kind)?MAX_APPROVED_ACTIONS_DAY:MAX_ACTIONS_DAY;
 const result=await db.prepare(`
  INSERT INTO browser_requests(id,kind,status)
  SELECT ?,?,'reserved'
  WHERE (SELECT COUNT(*) FROM browser_requests WHERE created_at >= datetime('now','-1 day')) < ?
   AND (SELECT COALESCE(SUM(browser_ms),0) FROM browser_requests WHERE created_at >= datetime('now','-1 day')) < ?
   AND NOT EXISTS(SELECT 1 FROM browser_requests WHERE created_at > datetime('now','-15 seconds'))
 `).bind(id,kind,limit,MAX_BROWSER_MS_DAY).run();
 if(!result.meta?.changes)return null;
 return id;
}
export async function finalizeBrowserAction(db,id,status,ms){
 await db.prepare("UPDATE browser_requests SET status=?,browser_ms=? WHERE id=?")
  .bind(status,Math.max(0,Math.ceil(Number(ms)||0)),id).run();
}
export async function withBrowserBudget(db,kind,operation){
 const id=await reserveBrowserAction(db,kind);
 if(!id){
  const error=new Error("browser_free_budget_or_pacing");
  error.httpStatus=429;
  throw error;
 }
 const start=Date.now();
 try{
  const result=await operation();
  const reported=Number(result?.headers?.get?.("X-Browser-Ms-Used")||0);
  await finalizeBrowserAction(db,id,result?.ok?"ok":"upstream_error",reported||Date.now()-start);
  return result;
 }catch(err){
  await finalizeBrowserAction(db,id,"exception",Date.now()-start);
  throw err;
 }
}
