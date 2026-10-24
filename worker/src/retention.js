// Keep stable post IDs and action audit records, not unbounded old article bodies.
// Only terminal decisions are eligible for compaction; pending approvals stay intact.
export async function expireStaleCandidates(env){
 // Do not keep evaluating abandoned historical candidates indefinitely.
 // Recent, approved, uncertain and actively executing items are protected.
 const result=await env.DB.prepare(`
  UPDATE engagement_targets SET review_state='expired',updated_at=CURRENT_TIMESTAMP
  WHERE review_state IN ('pending_semantic_review','semantically_reviewed')
  AND created_at < datetime('now','-45 days')
  AND NOT EXISTS (
   SELECT 1 FROM candidates c JOIN proposals p ON p.target=c.url
   WHERE c.id=engagement_targets.id AND p.state IN ('proposed','approved','executing','unknown')
  )
  AND NOT EXISTS (
   SELECT 1 FROM candidates c JOIN operations o ON o.target=c.url
   WHERE c.id=engagement_targets.id AND o.status IN ('executing','unknown')
  )
 `).run();
 return {ok:true,expired:result.meta?.changes||0};
}
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
      AND (json_extract(t.evidence_signals,'$.deep_review.decision')='skip' OR t.review_state='expired')
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
