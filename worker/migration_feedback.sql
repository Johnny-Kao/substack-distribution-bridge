-- Private owner feedback and outcome ledger, not exported to GitHub logs.
CREATE TABLE IF NOT EXISTS interaction_feedback (
 id TEXT PRIMARY KEY,
 candidate_id TEXT NOT NULL,
 choice TEXT NOT NULL CHECK(choice IN ('like','comment','skip')),
 source TEXT NOT NULL CHECK(source IN ('owner_choice','owner_approval','owner_rejection','verified_execution')),
 reason TEXT NOT NULL DEFAULT '',
 suggested_action TEXT NOT NULL DEFAULT '',
 actual_body TEXT NOT NULL DEFAULT '',
 outcome TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedback_candidate_time ON interaction_feedback(candidate_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_recent ON interaction_feedback(created_at DESC,choice);
