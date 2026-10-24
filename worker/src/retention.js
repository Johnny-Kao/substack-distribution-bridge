// Keep stable post IDs and action audit records, not unbounded old article bodies.
// Only terminal decisions are eligible for compaction; pending approvals stay intact.
export async function pruneTerminalArticleText(env){
 const result=await env.DB.prepare(`
  UPDATE global_posts SET full_text=''
  WHERE length(full_text)>0
  AND full_read_at < datetime('now','-30 days')
  AND (
    EXISTS (
      SELECT 1 FROM candidates c
      JOIN engagement_targets t ON t.id=c.id
      WHERE c.url=global_posts.url
      AND json_extract(t.evidence_signals,'$.deep_review.decision')='skip'
    )
    OR EXISTS (
      SELECT 1 FROM operations o WHERE o.target=global_posts.url AND o.status='succeeded'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM proposals p WHERE p.target=global_posts.url
    AND p.state IN ('proposed','approved','executing','unknown')
  )
 `).run();
 return {ok:true,pruned:result.meta?.changes||0,post_identity_kept:true};
}
