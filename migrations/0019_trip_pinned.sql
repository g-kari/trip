-- Add pinned/favorite functionality to trips
-- Pinned trips appear at the top of the trip list
ALTER TABLE trips ADD COLUMN pinned INTEGER DEFAULT 0;
