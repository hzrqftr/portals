-- Coinbox: the ownership axis, and deliberately nothing else yet.
--
-- Conventions are the same as 0001 (CLAUDE.md invariant 1):
--   money      -> INTEGER, minor units (sen). Never REAL.
--   dates      -> TEXT 'YYYY-MM-DD', no time component.
--   timestamps -> TEXT ISO 8601 UTC.
--   enums      -> TEXT + CHECK.
--
-- WHY A LEDGER TABLE RATHER THAN owner_user_id ON transactions:
--
-- Coinbox is single-user by design. There is no ledger_members table, so
-- there is no mechanism by which one person could be granted access to
-- another's rows -- sharing is not merely absent, it is unrepresentable.
-- That is the property required of it: adding someone to your GARAGE so they
-- can see service schedules must never expose your salary.
--
-- The indirection is still worth its one table, because the costs are
-- asymmetric. Changing the ownership column on `transactions` later means the
-- SQLite 12-step table rebuild (see 0007, 0008) against real financial
-- history, plus every repository predicate and the scope resolution. Adding
-- ledger_members later is by contrast purely additive: a new table, no
-- rebuild, nothing else touched. One small table now buys that option.
--
-- This is the same lesson Odometry already learned with `garages`, minus the
-- membership surface that would give the isolation suite a new leak path.

CREATE TABLE ledgers (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'My Ledger',
  created_at    TEXT NOT NULL
);

-- UNIQUE, not a plain index: exactly one ledger per person is the invariant,
-- not merely the current situation. It also makes first-login bootstrap safe
-- to race -- a second concurrent request loses the insert instead of quietly
-- creating a second ledger that half the queries would never see.
CREATE UNIQUE INDEX uq_ledger_owner ON ledgers(owner_user_id);
