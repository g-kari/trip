-- Trip comments table for discussion feature
CREATE TABLE IF NOT EXISTS trip_comments (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  item_id TEXT,  -- NULL = 旅程全体へのコメント
  user_id TEXT NOT NULL,
  parent_id TEXT,  -- 返信先コメントID (ネスト1段階まで)
  content TEXT NOT NULL,
  is_pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES trip_comments(id) ON DELETE CASCADE
);

-- Indexes for fast comment lookup
CREATE INDEX IF NOT EXISTS idx_trip_comments_trip_id ON trip_comments(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_comments_item_id ON trip_comments(item_id);
CREATE INDEX IF NOT EXISTS idx_trip_comments_user_id ON trip_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_trip_comments_parent_id ON trip_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_trip_comments_is_pinned ON trip_comments(trip_id, is_pinned);
