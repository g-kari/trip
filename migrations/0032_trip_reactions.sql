-- ========================================
-- Trip Reactions (Emoji Stamps) for Shared Pages
-- ========================================

CREATE TABLE IF NOT EXISTS trip_reactions (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  reaction_type TEXT NOT NULL CHECK(reaction_type IN ('want_to_go', 'like', 'amazing', 'helpful')),
  visitor_id TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(trip_id, reaction_type, visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_reactions_trip_id ON trip_reactions(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_reactions_visitor ON trip_reactions(visitor_id);
