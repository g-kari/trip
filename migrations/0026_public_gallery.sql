-- ========================================
-- Public Gallery Feature
-- ========================================

-- Add public gallery columns to trips table
ALTER TABLE trips ADD COLUMN is_public INTEGER DEFAULT 0;
ALTER TABLE trips ADD COLUMN public_title TEXT;
ALTER TABLE trips ADD COLUMN like_count INTEGER DEFAULT 0;

-- Create likes table
CREATE TABLE IF NOT EXISTS trip_likes (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(trip_id, user_id)
);

-- Create saves table
CREATE TABLE IF NOT EXISTS trip_saves (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(trip_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_trip_likes_trip_id ON trip_likes(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_likes_user_id ON trip_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_trip_saves_trip_id ON trip_saves(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_saves_user_id ON trip_saves(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_public ON trips(is_public) WHERE is_public = 1;
