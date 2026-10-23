CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, pub TEXT NOT NULL, title TEXT NOT NULL, url TEXT, published TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, approved_hash TEXT NOT NULL, status TEXT NOT NULL, public_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('like','comment','note')), target TEXT NOT NULL, body TEXT NOT NULL, body_hash TEXT NOT NULL, origin TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'proposed', approved_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_identity ON proposals(kind,target,body_hash);
CREATE TABLE IF NOT EXISTS write_policy (id INTEGER PRIMARY KEY CHECK(id=1), halted INTEGER NOT NULL DEFAULT 0, reason TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO write_policy(id,halted) VALUES(1,0);
CREATE INDEX IF NOT EXISTS idx_operations_time ON operations(created_at,kind,status);
CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS feed_fetches (id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_feed_fetches_created ON feed_fetches(created_at);
CREATE TABLE IF NOT EXISTS engagement_targets (
 id TEXT PRIMARY KEY REFERENCES candidates(id),
 score INTEGER NOT NULL,
 suggested_action TEXT NOT NULL,
 evidence_excerpt TEXT NOT NULL,
 evidence_signals TEXT NOT NULL,
 word_count INTEGER NOT NULL,
 review_state TEXT NOT NULL DEFAULT 'pending_semantic_review',
 semantic_verdict TEXT,
 semantic_rationale TEXT,
 comment_angle TEXT,
 reviewed_at TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_engagement_target_queue ON engagement_targets(review_state,score DESC,created_at DESC);
CREATE TABLE IF NOT EXISTS browser_requests (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 status TEXT NOT NULL,
 browser_ms INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_browser_requests_time ON browser_requests(created_at);
CREATE TABLE IF NOT EXISTS discovered_publications (
 id INTEGER PRIMARY KEY,
 subdomain TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 first_match TEXT NOT NULL,
 last_match TEXT NOT NULL,
 discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_publications_scan_priority ON discovered_publications(last_fetched_at,discovered_at);
CREATE TABLE IF NOT EXISTS subject_search_events (
 id TEXT PRIMARY KEY,
 term_index INTEGER NOT NULL,
 page INTEGER NOT NULL,
 returned INTEGER NOT NULL,
 valid_count INTEGER NOT NULL,
 status TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subject_search_events_time ON subject_search_events(created_at);
CREATE TABLE IF NOT EXISTS global_posts (id INTEGER PRIMARY KEY, publication_id INTEGER NOT NULL, subdomain TEXT NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL, url TEXT NOT NULL, published TEXT NOT NULL, first_subject_index INTEGER NOT NULL, last_subject_index INTEGER NOT NULL, excerpt TEXT NOT NULL DEFAULT '', wordcount INTEGER NOT NULL DEFAULT 0, comment_count INTEGER NOT NULL DEFAULT 0, reaction_count INTEGER NOT NULL DEFAULT 0, can_comment INTEGER NOT NULL DEFAULT 0, already_liked INTEGER NOT NULL DEFAULT 0, first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_global_posts_date ON global_posts(published DESC);
CREATE TABLE IF NOT EXISTS global_search_events (id TEXT PRIMARY KEY, term_index INTEGER NOT NULL, page INTEGER NOT NULL, returned INTEGER NOT NULL, valid_count INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
