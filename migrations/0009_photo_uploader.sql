-- Add uploader info to item photos
ALTER TABLE items ADD COLUMN photo_uploaded_by TEXT;
ALTER TABLE items ADD COLUMN photo_uploaded_at TEXT;

-- For day photos, we need a separate table since it's an array
CREATE TABLE day_photos (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  uploaded_by TEXT,
  uploaded_by_name TEXT,
  uploaded_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_day_photos_day_id ON day_photos(day_id);
CREATE INDEX idx_day_photos_trip_id ON day_photos(trip_id);
