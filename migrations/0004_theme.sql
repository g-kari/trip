-- Add theme column to trips (default: 'quiet' = しずか)
ALTER TABLE trips ADD COLUMN theme TEXT DEFAULT 'quiet';

-- Add cover_image_url for photo theme
ALTER TABLE trips ADD COLUMN cover_image_url TEXT;
