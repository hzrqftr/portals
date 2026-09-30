#!/usr/bin/env node
/**
 * Import "Family Fund.xlsx" into Coinbox's Family fund. docs/coinbox-spec.md §11.
 *
 *   py -3.12 scripts/fund-xlsx-to-csv.py "Family Fund.xlsx" fund.csv
 *   node scripts/import-fund.mjs fund.csv --dry-run          # parse + report only
 *   node scripts/import-fund.mjs fund.csv                    # local
 *   node scripts/import-fund.mjs fund.csv --bank-check=2026-09-30:3192.06
 *   node scripts/import-fund.mjs fund.csv --remote --i-mean-it
 *
 * LOCAL FIRST. Restore a production backup into the local D1
 * (`node scripts/restore.mjs <backup.json>`), run this against it, look at the
 * page, and only then run it with --remote. The link step below needs the
 * owner's real recurring postings, which only a backup brings to local.
 *
 * WHAT IT DOES, IN ORDER -- and it ABORTS rather than reporting success if any
 * figure disagrees:
 *
 *   1. Parses the CSV and checks it against RECONCILIATION below, figures
 *      written down from the workbook BEFORE this script existed.
 *   2. Creates the fund and its three members if missing, and links the
 *      owner's member to the ledger's "Family fund" recurring entry, so every
 *      FUTURE posting lands in the pot by itself.
 *   3. Inserts every row not yet imported (idempotent: fund_import_rows, hash
 *      including the line number), then re-reads the database and checks the
 *      same figures again.
 *   4. LINK STEP: pairs each posting that rule has ALREADY made with the pot.
 *      A posting pays for its own month (owner, 2026-09-30). If the workbook
 *      already has that month -- August 2026, dated 1 Aug in the workbook and
 *      posted 31 Aug in the ledger -- the imported row is linked to it. If not
 *      -- September, posted 30 Sep after the workbook was last updated -- a
 *      linked contribution is created.
 *   5. Optionally records one bank check (--bank-check=YYYY-MM-DD:RM).
 *
 * NOTHING IS SILENTLY FIXED. Rows that look like slips ("2/3" twice, a typo)
 * are imported as written and listed for the owner. Editing them afterwards is
 * a normal edit in the app.
 */

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const remote = args.includes("--remote");
const confirmed = args.includes("--i-mean-it");
const dryRun = args.includes("--dry-run");
const bankArg = args.find((a) => a.startsWith("--bank-check="))?.slice("--bank-check=".length);

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!file) die("Usage: node scripts/import-fund.mjs <fund.csv> [--dry-run] [--bank-check=YYYY-MM-DD:RM] [--remote --i-mean-it]");
if (remote && !confirmed) {
  die("Refusing to import to REMOTE without --i-mean-it.\n  Run it against a restored local copy first and look at the page.");
}

// ===========================================================================
// The workbook's figures, written down from "Family Fund.xlsx" on 2026-09-30
// before this script existed. An import that does not reproduce them exactly
// has mapped something wrong, and says so rather than writing.
// ===========================================================================
const RECONCILIATION = {
  rows: 149,
  inSen: 2_048_000, // RM 20,480.00
  outSen: 1_731_459, // RM 17,314.59
  balanceSen: 316_541, // RM 3,165.41 -- the workbook's F6, without its float drift
  members: { Ayiq: 640_000, Kdik: 660_000, Kyon: 660_000 },
};

/** Whose share the ledger's "Family fund" recurring entry pays. The owner. */
const OWNER_MEMBER = "Ayiq";
const RULE_ITEM = "Family fund";
const DEFAULT_SEN = 20_000;

// See scripts/restore.mjs for why this is not `npx wrangler`.
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

/** Same helper as scripts/import-sheet.mjs. */
function d1(sqlOrFile, { isFile = false } = {}) {
  const base = [WRANGLER, "d1", "execute", "fleet", "-c", "wrangler.jsonc", remote ? "--remote" : "--local"];
  if (!remote) base.push("--persist-to", ".wrangler/state");
  base.push(isFile ? "--file" : "--command", sqlOrFile, "--json");
  const out = execFileSync(process.execPath, base, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = out.indexOf("[");
  return JSON.parse(start === -1 ? out : out.slice(start));
}

const rowsOf = (res, i = 0) => res[i]?.results ?? [];
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const rm = (sen) =>
  `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function runSql(statements) {
  if (!statements.length) return;
  const path = join(tmpdir(), `import-fund-${process.pid}.sql`);
  writeFileSync(path, statements.join(";\n") + ";\n");
  try {
    d1(path, { isFile: true });
  } finally {
    unlinkSync(path);
  }
}

// ===========================================================================
// Parse
// ===========================================================================

/** Minimal RFC 4180 reader -- descriptions may carry commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "-543.30" -> { sen: 54330, negative: true }. Integer halves, never a float. */
function parseAmount(s) {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  return { sen: Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0")), negative: m[1] === "-" };
}

/** "2024-01" + n months. */
function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

const table = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
const header = table[0].map((h) => h.trim());
if (header.join(",") !== "line,date,description,amount") {
  die(`Unexpected CSV header "${header.join(",")}". Produce it with scripts/fund-xlsx-to-csv.py.`);
}

const parsed = [];
for (const r of table.slice(1)) {
  const [line, date, description, amount] = r.map((c) => c.trim());
  const a = parseAmount(amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description || !a) {
    die(`line ${line}: cannot read ${JSON.stringify(r)}`);
  }
  const member = /^From (\S+)$/.exec(description)?.[1] ?? null;
  if (member && a.negative) die(`line ${line}: "${description}" is a contribution going OUT`);
  parsed.push({
    line: Number(line),
    occurredOn: date,
    item: description,
    amountSen: a.sen,
    direction: a.negative ? "out" : "in",
    member,
    forMonth: null,
  });
}

// --- The month each contribution pays FOR -----------------------------------
//
// SEQUENTIAL, per member, from the fund's first month. The workbook dates
// contributions to month buckets and holds catch-ups as extra rows: Ayiq paid
// January and February 2024 together on 18 February, and everyone paid twice in
// January 2025 and not in February. Allocating each member's payments in order
// to their next unpaid month reproduces exactly those readings.
//
// It is only right because nobody skipped a month in this file, so it is
// FENCED: every allocation must land within one month of the payment's own
// month, and the script stops if one does not. It is a rule for this file, not
// a general theory of contributions -- future skips are RM 0.00 rows in the app.
const firstMonth = parsed.map((p) => p.occurredOn.slice(0, 7)).sort()[0];
const nextMonth = new Map();
for (const p of [...parsed].filter((p) => p.member).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.line - b.line)) {
  const month = nextMonth.get(p.member) ?? firstMonth;
  const paidIn = p.occurredOn.slice(0, 7);
  if (month < addMonths(paidIn, -1) || month > addMonths(paidIn, 1)) {
    die(`line ${p.line}: ${p.item} paid in ${paidIn} would be allocated to ${month} -- more than a month away. Stopping rather than guessing.`);
  }
  p.forMonth = month;
  nextMonth.set(p.member, addMonths(month, 1));
}

for (const p of parsed) {
  p.hash = createHash("sha256")
    // THE LINE NUMBER IS PART OF THE HASH. Rows 6 and 7 are identical in every
    // other field (18 Feb 2024, From Ayiq, RM 200); without it one would be
    // skipped as "already imported" and Ayiq would be RM 200 short.
    .update(`${p.line}|${p.occurredOn}|${p.item}|${p.amountSen}|${p.direction}`)
    .digest("hex")
    .slice(0, 32);
}

// --- Reconcile the parse ---------------------------------------------------

const sum = (xs) => xs.reduce((a, p) => a + p.amountSen, 0);
const inSen = sum(parsed.filter((p) => p.direction === "in"));
const outSen = sum(parsed.filter((p) => p.direction === "out"));
const byMember = {};
for (const p of parsed.filter((p) => p.member)) byMember[p.member] = (byMember[p.member] ?? 0) + p.amountSen;

function reconcile(label, got) {
  const want = {
    rows: RECONCILIATION.rows,
    inSen: RECONCILIATION.inSen,
    outSen: RECONCILIATION.outSen,
    balanceSen: RECONCILIATION.balanceSen,
    members: RECONCILIATION.members,
  };
  console.log(`\n  ${label}`);
  const lines = [
    ["rows", got.rows, want.rows, String],
    ["money in", got.inSen, want.inSen, rm],
    ["money out", got.outSen, want.outSen, rm],
    ["balance", got.balanceSen, want.balanceSen, rm],
    ...Object.keys(want.members).map((m) => [`  ${m}`, got.members[m] ?? 0, want.members[m], rm]),
  ];
  let ok = true;
  for (const [name, g, w, fmt] of lines) {
    const match = g === w;
    ok &&= match;
    console.log(`    ${name.padEnd(12)} ${fmt(g).padStart(14)}   ${match ? "ok" : `EXPECTED ${fmt(w)}`}`);
  }
  if (!ok) die(`${label}: does not reconcile. Nothing further written.`);
}

console.log(`\n  Source:   ${file}`);
console.log(`  Target:   ${remote ? "REMOTE (production)" : "local"}`);
reconcile("Parsed from the CSV", {
  rows: parsed.length,
  inSen,
  outSen,
  balanceSen: inSen - outSen,
  members: byMember,
});

// --- Slips, reported and imported as written --------------------------------
const slips = [];
const seenInstalment = new Map();
for (const p of parsed) {
  const m = /^(.*?)\s*-\s*SPayLater\s+(\d+)\/(\d+)$/.exec(p.item);
  if (!m) continue;
  const key = `${m[1]} ${m[2]}/${m[3]}`;
  if (seenInstalment.has(key)) slips.push(`line ${p.line}: "${p.item}" repeats line ${seenInstalment.get(key)} -- was it ${Number(m[2]) + 1}/${m[3]}?`);
  else seenInstalment.set(key, p.line);
}
for (const p of parsed) if (/'s's|s's\b/.test(p.item)) slips.push(`line ${p.line}: "${p.item}" -- typo?`);
const months = new Set(parsed.filter((p) => p.forMonth).map((p) => p.forMonth));
for (const member of Object.keys(RECONCILIATION.members)) {
  const last = [...parsed].filter((p) => p.member === member).map((p) => p.forMonth).sort().at(-1);
  const latest = [...months].sort().at(-1);
  if (last < latest) slips.push(`${member}: paid through ${last}, others through ${latest}`);
}
if (slips.length) {
  console.log("\n  For the owner to review (imported as written):");
  for (const s of slips) console.log(`    ${s}`);
}

if (dryRun) {
  console.log("\n  --dry-run: nothing written.\n");
  process.exit(0);
}

// ===========================================================================
// Fund and members
// ===========================================================================

const ledgers = rowsOf(d1("SELECT id FROM ledgers ORDER BY created_at LIMIT 2"));
if (ledgers.length !== 1) die(`Expected exactly one ledger, found ${ledgers.length}.`);
const ledgerId = ledgers[0].id;

const rules = rowsOf(
  d1(`SELECT id, day_of_month FROM recurring_rules WHERE ledger_id = ${lit(ledgerId)} AND item = ${lit(RULE_ITEM)}`),
);
if (rules.length !== 1) die(`Expected exactly one "${RULE_ITEM}" recurring entry, found ${rules.length}.`);
const ruleId = rules[0].id;

const now = new Date().toISOString();
const newId = () => crypto.randomUUID();

runSql([
  `INSERT INTO funds (id, ledger_id, name, created_at) VALUES (${lit(newId())}, ${lit(ledgerId)}, 'Family fund', ${lit(now)})
     ON CONFLICT(ledger_id) DO NOTHING`,
  ...Object.keys(RECONCILIATION.members).map(
    (name) =>
      `INSERT INTO fund_members (id, fund_id, name, default_sen, recurring_rule_id, is_active, created_at)
       SELECT ${lit(newId())}, f.id, ${lit(name)}, ${DEFAULT_SEN}, ${name === OWNER_MEMBER ? lit(ruleId) : "NULL"}, 1, ${lit(now)}
         FROM funds f WHERE f.ledger_id = ${lit(ledgerId)}
       ON CONFLICT(fund_id, name) DO NOTHING`,
  ),
]);

const fundId = rowsOf(d1(`SELECT id FROM funds WHERE ledger_id = ${lit(ledgerId)}`))[0].id;
const memberIds = Object.fromEntries(
  rowsOf(d1(`SELECT id, name, recurring_rule_id FROM fund_members WHERE fund_id = ${lit(fundId)}`)).map((m) => [m.name, m]),
);
if (memberIds[OWNER_MEMBER].recurring_rule_id !== ruleId) {
  die(`${OWNER_MEMBER} exists but is not linked to the "${RULE_ITEM}" rule. Link it in the app, then re-run.`);
}

// ===========================================================================
// Rows
// ===========================================================================

const already = new Set(
  rowsOf(d1(`SELECT row_hash FROM fund_import_rows WHERE fund_id = ${lit(fundId)}`)).map((r) => r.row_hash),
);
const todo = parsed.filter((p) => !already.has(p.hash));
console.log(`\n  Fund ${fundId}`);
console.log(`    already imported    ${already.size}`);
console.log(`    to insert now       ${todo.length}`);

const statements = [];
for (const p of todo) {
  const id = newId();
  statements.push(
    `INSERT INTO fund_entries (id, fund_id, occurred_on, item, description, amount_sen, direction,
                               member_id, for_month, transaction_id, created_at, updated_at)
     VALUES (${lit(id)}, ${lit(fundId)}, ${lit(p.occurredOn)}, ${lit(p.item)}, NULL, ${p.amountSen}, ${lit(p.direction)},
             ${p.member ? lit(memberIds[p.member].id) : "NULL"}, ${lit(p.forMonth)}, NULL, ${lit(now)}, ${lit(now)})`,
    `INSERT INTO fund_import_rows (row_hash, fund_id, source_line, entry_id)
     VALUES (${lit(p.hash)}, ${lit(fundId)}, ${p.line}, ${lit(id)})`,
  );
}
// Unknown member names would have failed above on memberIds[...].id; the set is
// exactly RECONCILIATION.members, which the parse already matched.
runSql(statements);

// Re-read what the DATABASE holds for the imported rows, not what we sent.
const imported = rowsOf(
  d1(
    `SELECT COUNT(*) AS rows,
            COALESCE(SUM(CASE WHEN e.direction = 'in' THEN e.amount_sen END), 0) AS in_sen,
            COALESCE(SUM(CASE WHEN e.direction = 'out' THEN e.amount_sen END), 0) AS out_sen,
            COALESCE(SUM(e.signed_sen), 0) AS balance_sen
       FROM fund_import_rows r JOIN fund_entries e ON e.id = r.entry_id
      WHERE r.fund_id = ${lit(fundId)}`,
  ),
)[0];
const importedMembers = Object.fromEntries(
  rowsOf(
    d1(
      `SELECT m.name, SUM(e.amount_sen) AS sen
         FROM fund_import_rows r JOIN fund_entries e ON e.id = r.entry_id
         JOIN fund_members m ON m.id = e.member_id
        WHERE r.fund_id = ${lit(fundId)}
        GROUP BY m.name`,
    ),
  ).map((r) => [r.name, r.sen]),
);
reconcile("In the database, imported rows only", {
  rows: imported.rows,
  inSen: imported.in_sen,
  outSen: imported.out_sen,
  balanceSen: imported.balance_sen,
  members: importedMembers,
});

// ===========================================================================
// LINK STEP -- pair the rule's existing postings with the pot
// ===========================================================================

const postings = rowsOf(
  d1(
    `SELECT p.occurred_on, p.transaction_id, t.amount_sen
       FROM recurring_postings p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.rule_id = ${lit(ruleId)}
      ORDER BY p.occurred_on`,
  ),
);

// A typed "Family fund" row in the same month as a posting is a DOUBLE
// payment in the ledger -- exactly what 28 Aug 2026 was until the owner
// deleted it. Linking over it would hide the duplicate, so stop instead.
const typed = rowsOf(
  d1(
    `SELECT occurred_on FROM transactions
      WHERE ledger_id = ${lit(ledgerId)} AND item = ${lit(RULE_ITEM)} AND is_recurring = 0
        AND substr(occurred_on, 1, 7) IN (${postings.map((p) => lit(p.occurred_on.slice(0, 7))).join(",") || "''"})`,
  ),
);
if (typed.length) {
  die(`Typed "${RULE_ITEM}" entries share a month with the rule's postings: ${typed.map((t) => t.occurred_on).join(", ")}. Resolve the duplicate in the ledger first.`);
}

const owner = memberIds[OWNER_MEMBER].id;
const linkStatements = [];
const linkReport = [];
let linkedNewSen = 0;
for (const post of postings) {
  const month = post.occurred_on.slice(0, 7);
  const existing = rowsOf(
    d1(
      `SELECT id, transaction_id FROM fund_entries
        WHERE fund_id = ${lit(fundId)} AND member_id = ${lit(owner)} AND for_month = ${lit(month)}`,
    ),
  );
  if (existing.some((e) => e.transaction_id === post.transaction_id)) {
    linkReport.push(`${post.occurred_on}  already linked`);
    continue;
  }
  const unlinked = existing.filter((e) => e.transaction_id === null);
  if (unlinked.length === 1) {
    linkStatements.push(
      `UPDATE fund_entries SET transaction_id = ${lit(post.transaction_id)}, updated_at = ${lit(now)}
        WHERE id = ${lit(unlinked[0].id)}`,
    );
    linkReport.push(`${post.occurred_on}  linked to the workbook's ${month} row (same payment)`);
  } else if (existing.length === 0) {
    linkStatements.push(
      `INSERT INTO fund_entries (id, fund_id, occurred_on, item, description, amount_sen, direction,
                                 member_id, for_month, transaction_id, created_at, updated_at)
       VALUES (${lit(newId())}, ${lit(fundId)}, ${lit(post.occurred_on)}, ${lit(`From ${OWNER_MEMBER}`)}, NULL,
               ${post.amount_sen}, 'in', ${lit(owner)}, ${lit(month)}, ${lit(post.transaction_id)}, ${lit(now)}, ${lit(now)})`,
    );
    linkedNewSen += post.amount_sen;
    linkReport.push(`${post.occurred_on}  new contribution for ${month} (${rm(post.amount_sen)})`);
  } else {
    die(`${OWNER_MEMBER} has ${existing.length} rows for ${month} and none is this posting's. Resolve by hand.`);
  }
}
runSql(linkStatements);

console.log(`\n  Link step: ${postings.length} posting(s) of "${RULE_ITEM}"`);
for (const l of linkReport) console.log(`    ${l}`);

// After linking, the whole pot must equal the workbook plus exactly the new
// linked contributions -- nothing else may have moved.
const pot = rowsOf(d1(`SELECT COALESCE(SUM(signed_sen), 0) AS sen FROM fund_entries WHERE fund_id = ${lit(fundId)}`))[0].sen;
const expectedPot = RECONCILIATION.balanceSen + linkedNewSen;
const ownerTotal = rowsOf(d1(`SELECT COALESCE(SUM(amount_sen), 0) AS sen FROM fund_entries WHERE member_id = ${lit(owner)}`))[0].sen;
console.log(`\n  Recorded pot now       ${rm(pot).padStart(14)}   ${pot === expectedPot || linkStatements.length === 0 ? "ok" : `EXPECTED ${rm(expectedPot)}`}`);
console.log(`  ${OWNER_MEMBER} all-time          ${rm(ownerTotal).padStart(14)}`);
if (linkStatements.length && pot !== expectedPot) die("The pot moved by something other than the linked postings.");

// ===========================================================================
// Bank check
// ===========================================================================

if (bankArg) {
  const m = /^(\d{4}-\d{2}-\d{2}):(\d+(?:\.\d{1,2})?)$/.exec(bankArg);
  if (!m) die(`--bank-check must look like 2026-09-30:3192.06, got "${bankArg}"`);
  const a = parseAmount(m[2]);
  const exists = rowsOf(
    d1(`SELECT 1 FROM fund_balance_checks WHERE fund_id = ${lit(fundId)} AND checked_on = ${lit(m[1])} AND balance_sen = ${a.sen}`),
  ).length;
  if (!exists) {
    runSql([
      `INSERT INTO fund_balance_checks (id, fund_id, checked_on, balance_sen, created_at)
       VALUES (${lit(newId())}, ${lit(fundId)}, ${lit(m[1])}, ${a.sen}, ${lit(now)})`,
    ]);
  }
  const asAt = rowsOf(
    d1(`SELECT COALESCE(SUM(signed_sen), 0) AS sen FROM fund_entries WHERE fund_id = ${lit(fundId)} AND occurred_on <= ${lit(m[1])}`),
  )[0].sen;
  const gap = a.sen - asAt;
  console.log(`\n  Bank check ${m[1]}: bank ${rm(a.sen)}, recorded ${rm(asAt)} -> ${gap < 0 ? `SHORT by ${rm(-gap)}` : `bank ahead by ${rm(gap)}`}${exists ? " (already recorded)" : ""}`);
}

console.log("\n  Done.\n");
