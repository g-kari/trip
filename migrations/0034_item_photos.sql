-- Multiple photos per item
CREATE TABLE IF NOT EXISTS item_photos (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  uploaded_by TEXT,
  uploaded_by_name TEXT,
  uploaded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
