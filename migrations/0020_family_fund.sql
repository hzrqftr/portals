-- Coinbox: the Family fund. docs/coinbox-spec.md §11.
--
-- A pooled sibling fund: each member pays in monthly, and the pot pays for
-- family meals, gifts and trips. It replaces "Family Fund.xlsx", which kept a
-- flat in/out log plus a hand-ticked "who has paid" grid that had already
-- drifted out of agreement with the log it was meant to summarise.
--
-- ===========================================================================
-- A SEPARATE BOOK. Nothing here may reach `transactions`.
-- ===========================================================================
--
-- The fund's money sits in its own bank account. The owner's own RM 200
-- already leaves the PERSONAL ledger once, as the "Family fund" recurring
-- entry. If the pot's dinners and homestays were also rows in `transactions`,
-- v_txn_monthly and the Home dashboard would count family money as personal
-- spending, on top of the contribution that paid for it. So these are new
-- tables, and no view in this repo reads them.
--
-- ===========================================================================
-- NOT A SECOND LEDGER
-- ===========================================================================
--
-- uq_ledger_owner (0010) makes "one ledger per person" an invariant, and
-- resolveLedgerScope() and every repository assume it. A fund is instead
-- OWNED BY a ledger: `funds.ledger_id` carries the tenant, and every child
-- table reaches it through fund_id -- the way recurring_postings reaches it
-- through rule_id. The repository resolves the fund under the ordinary ledger
-- predicate first, so nothing here needs a second scoping model.
--
-- Conventions as 0001: money INTEGER sen, dates TEXT 'YYYY-MM-DD', months
-- TEXT 'YYYY-MM', timestamps ISO 8601 UTC, enums TEXT + CHECK.
--
-- EVERY FOREIGN KEY CASCADES, SETS NULL, OR IS SATISFIED BY A CASCADE, because
-- deleting a user cascades users -> ledgers -> funds -> everything below, and
-- both portals' test suites reset by deleting `users`. A RESTRICT anywhere in
-- that chain would fail the other portal's tests with an error about a table
-- it has never heard of.

-- ===========================================================================
-- funds
-- ===========================================================================
CREATE TABLE funds (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Family fund',
  created_at TEXT NOT NULL
);

-- One fund per ledger, for now. UNIQUE rather than a plain index for the same
-- reason as uq_ledger_owner: first-use bootstrap is INSERT ... ON CONFLICT DO
-- NOTHING followed by a re-read, which is only race-safe if a second fund is
-- impossible. Dropping this index is all a second fund would need.
CREATE UNIQUE INDEX uq_fund_ledger ON funds(ledger_id);

-- ===========================================================================
-- fund_members -- names, NOT users
-- ===========================================================================
--
-- The siblings never sign in. The fund is owner-only, like the rest of
-- Coinbox (no ledger_members, and the Access policy admits the owner alone),
-- so a member is a label on a contribution rather than an identity.
CREATE TABLE fund_members (
  id                TEXT PRIMARY KEY,
  fund_id           TEXT NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,

  -- What the entry sheet PRE-FILLS, and nothing else. Contributions are not a
  -- fixed amount: a member may skip months (agreed) and the siblings may agree
  -- a different figure. Nothing is ever computed from this column -- no
  -- "expected", no "owed" -- so changing it cannot rewrite a single past cell.
  -- Every cell shows what was actually paid.
  default_sen       INTEGER NOT NULL DEFAULT 0 CHECK (default_sen >= 0),

  -- The recurring rule in the PERSONAL ledger that pays this member's share.
  -- When it posts, the same batch writes this member's contribution (see
  -- RecurringRepo.postOne), so the owner's share is typed once and cannot
  -- fall out of step. SET NULL: deleting the rule stops future links and
  -- leaves every contribution it already made.
  recurring_rule_id TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL,

  -- 0 = left the fund. Hidden from the grid; their history stays in the pot.
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX uq_fund_member_name ON fund_members(fund_id, name);

-- One rule feeds at most one member, or a single RM 200 would be credited
-- twice. PARTIAL, because UNIQUE does not constrain NULLs in SQLite and most
-- members have no rule.
CREATE UNIQUE INDEX uq_fund_member_rule ON fund_members(recurring_rule_id)
  WHERE recurring_rule_id IS NOT NULL;

-- ===========================================================================
-- fund_entries -- every ringgit in or out of the pot
-- ===========================================================================
--
-- A row WITH a member is a contribution; a row without one is everything else
-- (spending, a refunded deposit, the 2024 opening balance). There is
-- deliberately NO `kind` column: it would restate what member_id already says
-- and be free to disagree with it -- the categories.direction mistake that
-- 0011 and schema.test.ts guard against. The CHECKs below derive the shape
-- from member_id instead.
CREATE TABLE fund_entries (
  id             TEXT PRIMARY KEY,
  fund_id        TEXT NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  occurred_on    TEXT NOT NULL,
  item           TEXT NOT NULL,
  description    TEXT,

  -- Magnitude plus direction, sign derived -- identical to transactions, and
  -- >= 0 rather than > 0 because RM 0.00 is real data here too: an AGREED SKIP
  -- is a RM 0.00 contribution, so the month reads "skipped" rather than
  -- "not yet paid".
  amount_sen     INTEGER NOT NULL CHECK (amount_sen >= 0),
  direction      TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  signed_sen     INTEGER GENERATED ALWAYS AS
                   (CASE direction WHEN 'out' THEN -amount_sen ELSE amount_sen END) VIRTUAL,

  -- No ON DELETE: members are never deleted by the app (is_active instead),
  -- and when a fund cascades away, NO ACTION is checked at the END of the
  -- statement, by which point the cascade has removed these rows too. A
  -- RESTRICT here would be checked immediately and break that cascade.
  member_id      TEXT REFERENCES fund_members(id),

  -- The month a contribution PAYS FOR, which is not always the month it was
  -- paid in. The workbook has each sibling paying twice in January 2025 and
  -- not at all in February, and the owner paying January and February 2024
  -- together on 18 February. The grid is keyed on this, never on occurred_on.
  for_month      TEXT CHECK (for_month IS NULL OR for_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),

  -- The personal-ledger entry that IS this contribution, when a recurring
  -- rule posted it. CASCADE: deleting the ledger entry removes the fund's copy
  -- of the same money -- one payment, deleted in one place. The repository
  -- refuses to edit or delete a linked row directly, for the same reason.
  transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE,

  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,

  -- A contribution has both a member and a month; anything else has neither.
  CHECK ((member_id IS NULL) = (for_month IS NULL)),
  -- A contribution is money INTO the pot.
  CHECK (member_id IS NULL OR direction = 'in'),
  -- Only a contribution can be linked to the personal ledger.
  CHECK (transaction_id IS NULL OR member_id IS NOT NULL)
);

-- NOT unique on (member_id, for_month): a month can legitimately hold two
-- payments (a top-up, or a skip later reversed). The grid sums them.
CREATE INDEX idx_fund_entries_fund_date ON fund_entries(fund_id, occurred_on DESC);
CREATE INDEX idx_fund_entries_member_month ON fund_entries(member_id, for_month)
  WHERE member_id IS NOT NULL;

-- One ledger entry is at most one contribution. Partial for the NULL reason.
CREATE UNIQUE INDEX uq_fund_entries_txn ON fund_entries(transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ===========================================================================
-- fund_balance_checks -- "does the bank agree?"
-- ===========================================================================
--
-- The pot records contributions and spending only. The real account also earns
-- a small monthly dividend at a rate the owner does not know, so the bank is
-- normally a little AHEAD of the record -- and that is fine. The case that
-- matters is the bank holding LESS than recorded: money recorded as paid in
-- that never arrived, or spending nobody wrote down.
--
-- The owner types the balance whenever he looks. It is compared, never
-- applied: nothing here adjusts the pot, so a mistyped check cannot corrupt a
-- total. History is kept so a gap can be traced to when it opened.
CREATE TABLE fund_balance_checks (
  id          TEXT PRIMARY KEY,
  fund_id     TEXT NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  checked_on  TEXT NOT NULL,
  balance_sen INTEGER NOT NULL CHECK (balance_sen >= 0),
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_fund_checks_fund_date ON fund_balance_checks(fund_id, checked_on DESC);

-- ===========================================================================
-- fund_import_rows -- idempotency for scripts/import-fund.mjs
-- ===========================================================================
--
-- Own table rather than import_rows, whose transaction_id references
-- `transactions` -- which these rows are, by design, not.
--
-- THE HASH INCLUDES THE SOURCE LINE NUMBER. The workbook has rows identical in
-- every field (18 Feb 2024, "From Ayiq", RM 200, twice). Hashing content alone
-- would collide them and silently import one: the RM 4.99 lesson from 0011.
CREATE TABLE fund_import_rows (
  row_hash    TEXT PRIMARY KEY,
  fund_id     TEXT NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  source_line INTEGER NOT NULL,
  entry_id    TEXT REFERENCES fund_entries(id) ON DELETE SET NULL
);
