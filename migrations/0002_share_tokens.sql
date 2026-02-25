-- Share tokens for trip sharing
CREATE TABLE IF NOT EXISTS share_tokens (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON share_tokens(token);
