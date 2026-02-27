-- Add check-in fields to items table
ALTER TABLE items ADD COLUMN checked_in_at TEXT;
ALTER TABLE items ADD COLUMN checked_in_location TEXT;
