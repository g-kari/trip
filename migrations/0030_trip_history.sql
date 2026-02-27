-- Trip change history for version tracking and restoration
CREATE TABLE IF NOT EXISTS trip_history (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  changes TEXT,
  snapshot TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trip_history_trip ON trip_history(trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_history_coalesce ON trip_history(trip_id, user_id, action, created_at DESC);
