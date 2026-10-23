CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, pub TEXT NOT NULL, title TEXT NOT NULL, url TEXT, published TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, approved_hash TEXT NOT NULL, status TEXT NOT NULL, public_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('like','comment','note')), target TEXT NOT NULL, body TEXT NOT NULL, body_hash TEXT NOT NULL, origin TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'proposed', approved_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_identity ON proposals(kind,target,body_hash);
CREATE TABLE IF NOT EXISTS write_policy (id INTEGER PRIMARY KEY CHECK(id=1), halted INTEGER NOT NULL DEFAULT 0, reason TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO write_policy(id,halted) VALUES(1,0);
CREATE INDEX IF NOT EXISTS idx_operations_time ON operations(created_at,kind,status);
