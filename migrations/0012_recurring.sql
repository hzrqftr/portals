-- Coinbox: recurring ENTRY.
--
-- Not recurring DETECTION. docs/coinbox-spec.md §1.2 and apps/coinbox/CLAUDE.md
-- both put "recurring-transaction detection" out of scope, and it stays out:
-- nothing here inspects history to infer a pattern. The owner DECLARES a rule
-- ("Insurance, RM 230, the 15th of every month") and a nightly job posts it.
-- Stated, not discovered.
--
-- ===========================================================================
-- THE CLAMPING RULE CANNOT BE WRITTEN IN SQL. Do not try.
-- ===========================================================================
--
-- SQLite's date() NORMALISES an impossible date forward. It does not clamp.
-- Measured against this database on 2026-08-29, not assumed:
--
--     date('2026-01-31','+1 month')  ->  2026-03-03    (not 2026-02-28)
--     date('2026-03-31','+1 month')  ->  2026-05-01    (not 2026-04-30)
--     date('2028-01-31','+1 month')  ->  2028-03-02    (not 2028-02-29)
--
-- The owner asked for 31 -> 28/29 Feb -> back to 31 in March. That is
-- unexpressible in SQLite date arithmetic, so the schedule maths lives in JS
-- (apps/coinbox/src/shared/recurrence.ts) and NOTHING here computes a due date.
--
-- This matters because "aggregate in SQL, never in JavaScript" is a standing
-- invariant in this repo (root CLAUDE.md, invariant 4) and someone will
-- eventually try to honour it here. The failure mode is a payment three days
-- late, once a year, with no error anywhere.
--
-- There is deliberately NO "what is due" view, for the same reason and for a
-- second one: a view would need date('now'), which invariant 5 forbids. Today
-- is computed per ledger from users.timezone and passed as a bound parameter.

-- ===========================================================================
-- recurring_rules
-- ===========================================================================
CREATE TABLE recurring_rules (
  id              TEXT PRIMARY KEY,
  ledger_id       TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,

  -- The transaction template. Same shape and the same constraints as
  -- transactions, because what this produces IS a transaction: magnitude plus
  -- direction with the sign derived, and >= 0 rather than > 0 because a billed
  -- -nothing month is real data (eight RM 0.00 water bills are in the ledger).
  item            TEXT NOT NULL,
  description     TEXT,
  category_id     TEXT NOT NULL REFERENCES categories(id),

  -- NO FOREIGN KEY, for exactly the reason transactions.vehicle_id has none:
  -- vehicles are garage-scoped, this table is ledger-scoped, and a garage
  -- deletion must never cascade into financial history or into its schedule.
  -- Validated on write by assertUsableVehicle(), and RE-VALIDATED at post time
  -- months later -- see data/recurring-runner.ts. That second check is the
  -- whole reason this needs a comment: the cron writes long after the rule was
  -- authorised, when garage membership may have lapsed.
  vehicle_id      TEXT,

  amount_sen      INTEGER NOT NULL CHECK (amount_sen >= 0),
  direction       TEXT NOT NULL CHECK (direction IN ('in', 'out')),

  -- THE SCHEDULE, IN TWO COLUMNS AND NO ENUM.
  --
  -- 1 = monthly, 3 = quarterly, 12 = yearly, N = every N months. DO NOT add a
  -- `frequency TEXT CHECK (frequency IN ('monthly','yearly',...))` beside this.
  -- That is the categories.direction mistake in new clothes: a second column
  -- encoding a fact the first one already carries, free to disagree with it
  -- (frequency='monthly' with interval_months=3), and an invitation to write
  -- WHERE frequency = 'monthly' in a query that should have been arithmetic.
  -- schema.test.ts asserts the column's absence, as it does for categories.
  --
  -- The range is generous on purpose: widening a CHECK in SQLite is a full
  -- table rebuild, and a rebuild here means dropping and recreating dependent
  -- views (migrations 0004/0005/0007/0008 are all that shape).
  interval_months INTEGER NOT NULL CHECK (interval_months BETWEEN 1 AND 60),

  -- The user's INTENT, which is not always a day that exists. 31 means "the
  -- last day" in February. Kept separate from starts_on, which is a real date.
  day_of_month    INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),

  -- Carries BOTH the earliest permitted date and the PHASE of the series: a
  -- rule repeats in months where (month - month(starts_on)) % interval_months
  -- is 0. That is why there is no separate anchor_month column -- a second
  -- column could drift out of agreement with this one.
  --
  -- FORWARD ONLY. The Zod schema rejects a starts_on before today in the
  -- owner's timezone, so backfilling history is not a behaviour that was
  -- suppressed; it is unrepresentable. The 4,421 imported rows already cover
  -- the past, and a rule that regenerated them would duplicate them silently.
  starts_on       TEXT NOT NULL,
  ends_on         TEXT,

  -- Separate from ends_on on purpose: pausing is "not right now", ending is
  -- "never again". Astro runs indefinitely and is occasionally suspended.
  -- 1 = active, matching categories.is_active rather than inventing a
  -- differently-polarised flag two tables apart.
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),

  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,

  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX idx_recurring_ledger ON recurring_rules(ledger_id, is_active);

-- ===========================================================================
-- recurring_postings -- THE IDEMPOTENCY INTERLOCK
-- ===========================================================================
--
-- One row per occurrence that has been CLAIMED. The primary key is the whole
-- mechanism: a second cron run, a retry, or two overlapping invocations cannot
-- post the same occurrence twice, because the second INSERT fails at the
-- database rather than at a code path someone can later reorder.
--
-- (rule_id, occurred_on) IS A GENUINE NATURAL KEY, and unlike import_rows it
-- needs nothing extra. import_rows hashes the source LINE NUMBER as well as the
-- content, because the owner's export contains two rows identical in every
-- field (19-May-2026, 'Motorcycle fuel', RM4.99, 'Setel', lines 375 and 377)
-- and a content hash collided them into one, leaving the ledger RM 4.99 light
-- with no error. That cannot happen here: two occurrences of one rule are at
-- least a month apart by construction, so no two can share a date. The
-- schedule makes the collision arithmetically impossible rather than unlikely.
--
-- WHY A LINK TABLE AND NOT A NULLABLE transactions.recurring_rule_id:
--
--   1. Deleting a rule must NEVER cascade into financial history -- the same
--      reasoning that leaves vehicle_id unconstrained. Here the cascade lands
--      on the LINK rows and stops. Structural, not a convention to remember.
--   2. Deleting a TRANSACTION nulls transaction_id but LEAVES the
--      (rule_id, occurred_on) row, so the occurrence stays claimed and the
--      next run does not helpfully re-post the thing the owner just deleted.
--      With a column on transactions, deleting the row would delete the
--      evidence and the entry would come back.
--
-- No ledger_id column: it is reachable through rule_id, exactly as import_rows
-- reaches the ledger through import_batches. Every read joins recurring_rules
-- and goes through this.where(recurringRules, ...).
CREATE TABLE recurring_postings (
  rule_id        TEXT NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  occurred_on    TEXT NOT NULL,

  -- SET NULL, not CASCADE. See point 2 above -- this is what stops a deleted
  -- entry from being resurrected on the next run.
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,

  posted_at      TEXT NOT NULL,
  PRIMARY KEY (rule_id, occurred_on)
);

-- One transaction belongs to at most one occurrence. PARTIAL, because UNIQUE
-- does not constrain NULLs in SQLite: transaction_id is NULL for every
-- occurrence whose transaction has been deleted, and those must stay
-- unlimited. A plain UNIQUE would look correct and enforce nothing.
CREATE UNIQUE INDEX uq_recurring_postings_txn
  ON recurring_postings(transaction_id) WHERE transaction_id IS NOT NULL;

-- ===========================================================================
-- transactions.is_recurring -- how the row got here
-- ===========================================================================
--
-- Set once at insert by the materialiser and never recomputed. It is NOT the
-- idempotency mechanism -- recurring_postings' primary key is -- and it is not
-- derived from that table either. It answers a different question:
--
--   recurring_postings   "which occurrence was this, and has it been claimed?"
--   is_recurring         "did I type this, or did the system?"
--
-- It earns its own column because it SURVIVES. Deleting a rule cascades its
-- postings away, and without this the ledger could no longer answer "was this
-- auto-posted?" for entries already in it. It also makes the ledger filterable
-- without joining a second table on every read.
--
-- The redundancy is one-directional and therefore safe: written once at
-- insert, never re-derived, so the two cannot drift into disagreeing. Migration
-- 0005 is the cautionary tale -- one part with two schedules made an edit look
-- as though it had silently failed.
--
-- IMMUTABLE, like the import provenance columns. It is absent from
-- transactionPatch, which is .strict(), so an edit cannot rewrite how a row
-- entered the ledger. Editing an auto-posted entry's amount leaves it flagged,
-- because it WAS auto-posted: that is a fact about its origin, not its values.
--
-- The default backfills all 4,421 existing rows to 0, which is correct -- every
-- one of them was typed or imported, none was posted by a rule.
ALTER TABLE transactions
  ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0
  CHECK (is_recurring IN (0, 1));

CREATE INDEX idx_txn_ledger_recurring
  ON transactions(ledger_id, is_recurring, occurred_on DESC);
