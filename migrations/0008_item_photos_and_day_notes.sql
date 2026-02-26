-- Add photo_url column to items for memory photos
ALTER TABLE items ADD COLUMN photo_url TEXT;

-- Add notes column to days for "その他" section
ALTER TABLE days ADD COLUMN notes TEXT;

-- Add photos column to days for "その他" section photos (JSON array of URLs)
ALTER TABLE days ADD COLUMN photos TEXT;
