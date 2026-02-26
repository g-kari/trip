-- Trip tags table for categorizing trips
CREATE TABLE trip_tags (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Index for faster queries
CREATE INDEX idx_trip_tags_trip ON trip_tags(trip_id);
CREATE INDEX idx_trip_tags_tag ON trip_tags(tag);

-- Unique constraint to prevent duplicate tags per trip
CREATE UNIQUE INDEX idx_trip_tags_unique ON trip_tags(trip_id, tag);
