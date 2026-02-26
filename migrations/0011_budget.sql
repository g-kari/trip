-- Add budget management columns
-- Add budget column to trips table (total trip budget)
ALTER TABLE trips ADD COLUMN budget INTEGER;

-- Add cost_category column to items table
-- Categories: 交通費, 宿泊費, 食費, 観光・アクティビティ, お土産, その他
ALTER TABLE items ADD COLUMN cost_category TEXT;
