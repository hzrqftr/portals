-- Labour as a cost in its own right, and a total that is always the sum.
--
-- WHY
--
-- The owner often buys the oil and filter themselves and takes them to a
-- workshop that charges for the fitting only. Under the old shape that visit
-- had nowhere to put the labour except a lump "total paid" that silently
-- disagreed with the line items -- spec 8.4 said as much ("total_cost may
-- exceed sum of items") and left the difference unexplained. You could see
-- what you paid, never what you paid it for.
--
-- THE SHAPE
--
-- labour_cost sits beside the line items. The grand total is no longer a
-- stored, typed number: it is computed as SUM(line_total_cost) + labour_cost
-- wherever it is shown. One number cannot drift from another when there is
-- only one number.
--
-- This is the same correction migration 0005 made to intervals. A typed total
-- alongside a typed parts cost and a typed labour cost is three facts about
-- one bill, and nothing in the schema can say which is right when they
-- disagree.
--
-- Money stays INTEGER sen throughout (invariant 1).

ALTER TABLE service_records ADD COLUMN labour_cost INTEGER;

-- Backfill: whatever the old total did not account for in parts WAS the
-- labour. That is precisely the reading the old spec put on the remainder,
-- so this preserves every existing grand total exactly rather than
-- reinterpreting it.
--
-- MAX(0, ...) guards the case where the items already sum past the recorded
-- total (a mistyped unit cost, say). Negative labour is not a thing, and a
-- CHECK constraint cannot be added to an existing table without rebuilding
-- it, so the floor goes here.
UPDATE service_records
   SET labour_cost = MAX(
         0,
         total_cost - COALESCE(
           (SELECT SUM(si.line_total_cost)
              FROM service_items si
             WHERE si.service_record_id = service_records.id),
           0)
       )
 WHERE total_cost IS NOT NULL;

-- total_cost is dropped, not left in place.
--
-- Leaving it would leave a column that still holds a plausible number, is no
-- longer written, and no longer matches what the app shows -- the exact trap
-- this project keeps having to dig out of. Nothing is lost: the total is
-- parts + labour, and both survive above.
ALTER TABLE service_records DROP COLUMN total_cost;
