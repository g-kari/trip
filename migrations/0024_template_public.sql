-- Add is_public column to trip_templates
ALTER TABLE trip_templates ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

-- Index for public templates
CREATE INDEX IF NOT EXISTS idx_trip_templates_is_public ON trip_templates(is_public);
