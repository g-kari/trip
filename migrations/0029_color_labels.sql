-- Add color_label column to trips table
-- Valid values: red, orange, yellow, green, blue, purple, pink, gray (or null)
ALTER TABLE trips ADD COLUMN color_label TEXT DEFAULT NULL;

-- Create index for filtering by color
CREATE INDEX idx_trips_color_label ON trips(color_label);
