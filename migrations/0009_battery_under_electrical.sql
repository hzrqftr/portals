-- Migration number: 0009 	 2026-08-21T11:12:23.940Z

-- Battery was the only part type ever seeded with category 'battery' --
-- spark plugs and ignition coils already live under 'electrical' -- so it
-- was a category with exactly one member. Folding it into 'electrical'
-- gives it the same grouping and icon as the rest of the vehicle's
-- electrical parts instead of a section of its own.
--
-- 'electrical' is already a valid value in the category CHECK constraint, so
-- this is a plain data UPDATE, not a rebuild.
UPDATE part_types SET category = 'electrical' WHERE id = 'pt_battery';
