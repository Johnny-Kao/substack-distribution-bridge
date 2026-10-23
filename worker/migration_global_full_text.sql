ALTER TABLE global_posts ADD COLUMN full_text TEXT NOT NULL DEFAULT '';
ALTER TABLE global_posts ADD COLUMN full_read_at TEXT;
