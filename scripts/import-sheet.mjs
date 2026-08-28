#!/usr/bin/env node
/**
 * Import the Google Sheet export into Coinbox. Spec 6.
 *
 *   node scripts/import-sheet.mjs ledger.csv                 # local
 *   node scripts/import-sheet.mjs ledger.csv --dry-run       # parse + report only
 *   node scripts/import-sheet.mjs ledger.csv --remote --i-mean-it
 *   node scripts/import-sheet.mjs ledger.csv --reset         # clear and re-import
 *
 * IDEMPOTENT BY CONSTRUCTION. A batch is identified by (ledger, source name),
 * and every source line is recorded in import_rows keyed by a hash. Re-running
 * imports only lines that are not already there, so the expected "run it,
 * check the totals, fix a mapping, run it again" loop is safe.
 *
 * THE HASH INCLUDES THE SOURCE LINE NUMBER, and that is load-bearing rather
 * than incidental. The owner's export contains two rows identical in every
 * field -- 19-May-2026, 'Motorcycle fuel', RM4.99, 'Setel'. Hashing content
 * alone collides them, so the second is skipped as "already imported", the
 * ledger ends up RM 4.99 light, and nothing anywhere raises an error.
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
const reset = args.includes("--reset");
const SOURCE = "ledger.csv";

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!file) die("Usage: node scripts/import-sheet.mjs <ledger.csv> [--remote --i-mean-it] [--dry-run] [--reset]");
if (remote && !confirmed) {
  die(
    "Refusing to import to REMOTE without --i-mean-it.\n" +
      "  Run it against local first and check the reconciliation table.",
  );
}

// See scripts/restore.mjs for why this is not `npx wrangler`.
const WRANGLER = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

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
const lit = (v) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

// ===========================================================================
// Parsing
// ===========================================================================

/** Minimal RFC 4180 reader. The export has quoted fields containing commas. */
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

const MONTHS = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12" };

/** `01-Jan-2026` -> `2026-01-01`. Calendar date, no time. Invariant 5. */
function parseDate(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

/** `RM197.90` -> 19790 sen. Integer minor units, never a float. Invariant 1. */
function parseSen(s) {
  const m = /^RM\s*([\d,]+(?:\.\d{1,2})?)$/.exec(s.trim());
  if (!m) return null;
  // Parse the two halves as integers rather than multiplying a float by 100:
  // 0.29 * 100 is 28.999999999999996, and Math.round hides that until it does
  // not. Money never touches a float here.
  const [whole, frac = ""] = m[1].replace(/,/g, "").split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

// ===========================================================================
// The four import rules settled with the owner, 2026-08-28.
// docs/coinbox-spec.md 6. Each is data, not scattered conditionals, so the
// decisions stay visible and auditable rather than buried in a transform.
// ===========================================================================

/**
 * RULE 3. Three rows were filed under Transportation in the Sheet and are
 * corrected on the way in. The original is preserved in source_category_raw,
 * so the correction is auditable and reversible -- the import deliberately no
 * longer reproduces the source exactly, and that has to be recoverable.
 */
const CATEGORY_FIXES = [
  { on: "2026-04-11", item: "Ceiling light & screwdriver", to: "household" },
  { on: "2026-08-07", item: "Dinner", to: "food_drinks" },
  { on: "2026-08-17", item: "Lunch", to: "food_drinks" },
];

/**
 * RULE 4. A double Form submission. Identified by content so it does not
 * depend on line numbers staying put. Any OTHER content-duplicate is kept and
 * warned about rather than silently dropped -- two genuine RM4.99 top-ups on
 * one day are entirely possible, and this rule is about one known mistake.
 */
const DROP_DUPLICATE = {
  on: "2026-05-19",
  item: "Motorcycle fuel",
  amountSen: 499,
};

const BIKE = /motorcycle|rs150|\bbike\b/i;

/**
 * RULES 1 and 2. Vehicle attribution.
 *
 * Order matters: an explicit name in Item or Description always wins, so the
 * one row reading "Setel - Waja" goes to the Waja rather than being swept into
 * rule 1 with the rest.
 */
function attributeVehicle(item, description) {
  const blob = `${item} ${description}`;
  if (BIKE.test(blob)) return { nickname: "RS150R", why: "named" };
  if (/\bcity\b/i.test(blob)) return { nickname: "City", why: "named" };
  if (/\bwaja\b/i.test(blob)) return { nickname: "Waja", why: "named" };

  // RULE 1. The 14 'Car fuel' rows that say only "Setel" go to the City. This
  // is an OWNER DECISION, not evidence from the file -- the single row that
  // does name a car says Waja. Kept narrow to exactly 'Car fuel': 'Car
  // service' and 'Car wash' were not part of the decision and stay
  // unattributed rather than being quietly included.
  if (item.trim().toLowerCase() === "car fuel") return { nickname: "City", why: "rule-1" };

  // RULE 2. Tolls, parking and everything else carry no vehicle. A toll is a
  // trip cost, not a vehicle cost, and attributing it would dilute cost-per-km.
  return { nickname: null, why: "none" };
}

// ===========================================================================
// Read the target
// ===========================================================================

const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
const table = parseCsv(raw);
const header = table[0].map((h) => h.trim());
const need = ["Timestamp", "Item", "Amount", "Category", "Description", "Type"];
for (const col of need) {
  if (!header.includes(col)) die(`Missing column "${col}" in the CSV header: ${header.join(", ")}`);
}
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

console.log(`\n  Source:   ${file}  (${table.length - 1} data rows)`);
console.log(`  Target:   ${remote ? "REMOTE (production)" : "local"}\n`);

const ledgers = rowsOf(d1("SELECT id FROM ledgers ORDER BY created_at LIMIT 1"));
if (!ledgers.length) die("No ledger exists yet. Sign in to Coinbox once so bootstrap creates it.");
const ledgerId = ledgers[0].id;

const cats = rowsOf(d1("SELECT id, code, name FROM categories WHERE ledger_id IS NULL"));
const byName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c]));
const byCode = new Map(cats.map((c) => [c.code, c]));

const vehicles = rowsOf(d1("SELECT id, nickname FROM vehicles"));
const byNickname = new Map(vehicles.map((v) => [v.nickname.trim().toLowerCase(), v.id]));

// ===========================================================================
// Transform
// ===========================================================================

const seenContent = new Map();
const out = [];
const problems = [];
const unattributedVehicles = new Set();
let droppedDuplicate = 0;

for (let i = 1; i < table.length; i++) {
  const line = i + 1; // 1-based including the header, matching a text editor
  const r = table[i];
  const get = (c) => (r[idx[c]] ?? "").trim();

  const occurredOn = parseDate(get("Timestamp"));
  const amountSen = parseSen(get("Amount"));
  const item = get("Item");
  const description = get("Description");
  const rawType = get("Type");
  const rawCategory = get("Category");

  if (!occurredOn) { problems.push(`line ${line}: unparseable date "${get("Timestamp")}"`); continue; }
  if (amountSen === null) { problems.push(`line ${line}: unparseable amount "${get("Amount")}"`); continue; }
  if (amountSen <= 0) { problems.push(`line ${line}: non-positive amount "${get("Amount")}"`); continue; }

  // Debit is money IN, Credit is money OUT. That is the Sheet's convention and
  // it is the opposite of what a bank statement means by the same words, which
  // is exactly why source_type_raw is kept.
  let direction;
  if (rawType.toLowerCase() === "debit") direction = "in";
  else if (rawType.toLowerCase() === "credit") direction = "out";
  else { problems.push(`line ${line}: unknown Type "${rawType}"`); continue; }

  // RULE 4.
  const contentKey = `${occurredOn}|${item}|${amountSen}|${direction}|${description}`;
  const before = seenContent.get(contentKey) ?? 0;
  seenContent.set(contentKey, before + 1);
  if (before > 0) {
    const isKnown =
      occurredOn === DROP_DUPLICATE.on &&
      item === DROP_DUPLICATE.item &&
      amountSen === DROP_DUPLICATE.amountSen;
    if (isKnown) { droppedDuplicate++; continue; }
    problems.push(
      `line ${line}: content-identical to an earlier row and NOT the known double submission -- KEPT. "${item}" ${get("Amount")} on ${occurredOn}`,
    );
  }

  // RULE 3.
  const fix = CATEGORY_FIXES.find((f) => f.on === occurredOn && f.item === item);
  const wantedCode = fix ? fix.to : null;
  let category = wantedCode ? byCode.get(wantedCode) : byName.get(rawCategory.toLowerCase());
  if (!category) { problems.push(`line ${line}: no category matches "${rawCategory}"`); continue; }

  // RULES 1 and 2.
  const attributed = attributeVehicle(item, description);
  let vehicleId = null;
  if (attributed.nickname) {
    vehicleId = byNickname.get(attributed.nickname.toLowerCase()) ?? null;
    if (!vehicleId) unattributedVehicles.add(attributed.nickname);
  }

  out.push({
    line,
    occurredOn,
    item,
    description: description || null,
    categoryId: category.id,
    vehicleId,
    amountSen,
    direction,
    sourceTypeRaw: rawType,
    // Only recorded where it actually differs, so its presence means
    // "this row was corrected" rather than "this row was imported".
    sourceCategoryRaw: fix ? rawCategory : null,
    hash: createHash("sha256")
      .update(`${line}|${occurredOn}|${item}|${amountSen}|${direction}|${rawCategory}|${description}|${rawType}`)
      .digest("hex")
      .slice(0, 32),
  });
}

// ===========================================================================
// Report before touching anything
// ===========================================================================

const totalIn = out.filter((t) => t.direction === "in").reduce((a, t) => a + t.amountSen, 0);
const totalOut = out.filter((t) => t.direction === "out").reduce((a, t) => a + t.amountSen, 0);
const rm = (sen) => `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const byVehicle = {};
for (const t of out) {
  const key = t.vehicleId ? [...byNickname.entries()].find(([, id]) => id === t.vehicleId)?.[0] ?? "?" : "(none)";
  byVehicle[key] = (byVehicle[key] ?? 0) + 1;
}

console.log("  Parsed:");
console.log(`    rows to import      ${out.length}`);
console.log(`    duplicate dropped   ${droppedDuplicate}`);
console.log(`    money in            ${rm(totalIn)}`);
console.log(`    money out           ${rm(totalOut)}`);
console.log(`    net                 ${rm(totalIn - totalOut)}`);
console.log("\n  Vehicle attribution:");
for (const [k, v] of Object.entries(byVehicle).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(18)} ${v}`);
}
console.log(`\n  Category corrections: ${out.filter((t) => t.sourceCategoryRaw).length}`);

if (unattributedVehicles.size) {
  console.log(`\n  WARNING: no vehicle row named ${[...unattributedVehicles].join(", ")} -- those rows import unattributed.`);
}
if (problems.length) {
  console.log(`\n  ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.log(`    ${p}`);
  if (problems.length > 20) console.log(`    ... and ${problems.length - 20} more`);
}

if (dryRun) {
  console.log("\n  --dry-run: nothing written.\n");
  process.exit(problems.length ? 1 : 0);
}

// ===========================================================================
// Write
// ===========================================================================

const batchRows = rowsOf(d1(`SELECT id FROM import_batches WHERE ledger_id = ${lit(ledgerId)} AND source = ${lit(SOURCE)}`));
let batchId = batchRows[0]?.id ?? null;

if (reset && batchId) {
  console.log("\n  --reset: removing the previous batch and its transactions...");
  d1(
    `DELETE FROM transactions WHERE id IN (SELECT transaction_id FROM import_rows WHERE batch_id = ${lit(batchId)} AND transaction_id IS NOT NULL);
     DELETE FROM import_rows WHERE batch_id = ${lit(batchId)};
     DELETE FROM import_batches WHERE id = ${lit(batchId)};`,
  );
  batchId = null;
}

const now = new Date().toISOString();
if (!batchId) {
  batchId = `imp_${createHash("sha256").update(`${ledgerId}|${SOURCE}`).digest("hex").slice(0, 24)}`;
  d1(
    `INSERT INTO import_batches (id, ledger_id, source, row_count, started_at)
     VALUES (${lit(batchId)}, ${lit(ledgerId)}, ${lit(SOURCE)}, 0, ${lit(now)})`,
  );
}

const already = new Set(
  rowsOf(d1(`SELECT row_hash FROM import_rows WHERE batch_id = ${lit(batchId)}`)).map((r) => r.row_hash),
);
const todo = out.filter((t) => !already.has(t.hash));

console.log(`\n  Batch ${batchId}`);
console.log(`    already imported    ${already.size}`);
console.log(`    to insert now       ${todo.length}`);

if (todo.length) {
  const sql = [];
  for (const t of todo) {
    const txnId = `txn_${t.hash}`;
    sql.push(
      `INSERT INTO transactions (id, ledger_id, occurred_on, item, description, category_id, vehicle_id, amount_sen, direction, source_type_raw, source_category_raw, created_at, updated_at) VALUES (${lit(txnId)}, ${lit(ledgerId)}, ${lit(t.occurredOn)}, ${lit(t.item)}, ${lit(t.description)}, ${lit(t.categoryId)}, ${lit(t.vehicleId)}, ${t.amountSen}, ${lit(t.direction)}, ${lit(t.sourceTypeRaw)}, ${lit(t.sourceCategoryRaw)}, ${lit(now)}, ${lit(now)});`,
    );
    sql.push(
      `INSERT INTO import_rows (batch_id, row_hash, source_line, transaction_id) VALUES (${lit(batchId)}, ${lit(t.hash)}, ${t.line}, ${lit(txnId)});`,
    );
  }
  const tmp = join(tmpdir(), `coinbox-import-${Date.now()}.sql`);
  writeFileSync(tmp, sql.join("\n"), "utf8");
  try { d1(tmp, { isFile: true }); } finally { unlinkSync(tmp); }
}

d1(
  `UPDATE import_batches SET row_count = (SELECT COUNT(*) FROM import_rows WHERE batch_id = ${lit(batchId)}), finished_at = ${lit(new Date().toISOString())} WHERE id = ${lit(batchId)}`,
);

// ===========================================================================
// Reconcile. The point of the whole exercise.
// ===========================================================================

const check = rowsOf(
  d1(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN direction='in'  THEN amount_sen END), 0) AS in_sen,
            COALESCE(SUM(CASE WHEN direction='out' THEN amount_sen END), 0) AS out_sen,
            COALESCE(SUM(signed_sen), 0) AS net_sen
       FROM transactions WHERE ledger_id = ${lit(ledgerId)}`,
  ),
)[0];

const rows = [
  ["rows", out.length, check.n],
  ["money in", totalIn, check.in_sen],
  ["money out", totalOut, check.out_sen],
  ["net", totalIn - totalOut, check.net_sen],
];

console.log("\n  Reconciliation (parsed vs in the database):");
let mismatched = 0;
for (const [label, want, got] of rows) {
  const ok = Number(want) === Number(got);
  if (!ok) mismatched++;
  const fmt = label === "rows" ? String : rm;
  console.log(`    ${label.padEnd(12)} ${fmt(want).padStart(16)}   ${fmt(got).padStart(16)}   ${ok ? "ok" : "MISMATCH"}`);
}

console.log("");
if (mismatched) die(`${mismatched} figure(s) do not match. The import is NOT trustworthy.`);
if (problems.length) die(`Imported, but ${problems.length} row(s) were skipped or flagged above.`);
console.log(`  Import complete. ${check.n} transactions in the ledger.\n`);
