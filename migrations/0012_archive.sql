-- Add archive functionality to trips
-- Allow users to archive past trips to hide them from the default view
ALTER TABLE trips ADD COLUMN is_archived INTEGER DEFAULT 0;
