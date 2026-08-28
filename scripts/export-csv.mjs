#!/usr/bin/env node
/**
 * Turn a backup into CSV files you can actually open.
 *
 *   npx wrangler r2 object get portals-backup/fleet/2026-08-28.json \
 *     --remote --file=b.json
 *   node scripts/export-csv.mjs b.json --out csv/
 *
 * WHY THIS EXISTS
 *
 * The nightly backup is JSON, which is the right format for restoring exactly
 * and the wrong format for reading. The stated justification for having an
 * export at all was portability -- "a file you can read, diff and move" -- and
 * JSON only delivers the machine half of that. This is the human half.
 *
 * It matters most for Coinbox specifically. The ledger it replaces is a Google
 * Sheet, and a system that takes your spreadsheet away had better be able to
 * hand it back. One CSV per table opens in Excel and imports into Sheets
 * directly.
 *
 * Input is a backup file rather than the live database on purpose: it needs no
 * credentials, works offline, and keeps the backup as the thing that is
 * genuinely portable rather than adding a second export path that could drift.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const outDir = argValue("--out") ?? "csv";
const onlyTable = argValue("--table");
const noBom = args.includes("--no-bom");
const rawMoney = args.includes("--raw-money");

function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!file) {
  die(
    "Usage: node scripts/export-csv.mjs <backup.json> [--out csv/] [--table vehicles]\n" +
      "                                  [--raw-money] [--no-bom]",
  );
}

/**
 * Columns holding money, which is stored as an integer count of sen
 * (CLAUDE.md invariant 1). RM 245.50 is the number 24550.
 *
 * Exporting that raw would be worse than not converting at all: a reader sees
 * 24550 and reads twenty-four thousand ringgit. So these are divided by 100
 * AND the header is renamed to end in `_rm`, which puts the unit in the file
 * itself rather than in documentation nobody has open.
 *
 * Two naming conventions are in play, which is why this is a list and not a
 * pattern: Odometry predates the `_sen` suffix and uses bare names, while
 * Coinbox's proposed transactions schema uses `amount_sen`. Anything ending in
 * `_sen` is picked up automatically, so new columns following the convention
 * need no change here.
 */
const MONEY_COLUMNS = new Set([
  "cost",
  "estimated_cost",
  "labour_cost",
  "purchase_price",
  "unit_cost",
]);

function isMoney(col) {
  return MONEY_COLUMNS.has(col) || col.endsWith("_sen");
}

/** `amount_sen` and `cost` both become `amount_rm` / `cost_rm`. */
function moneyHeader(col) {
  return `${col.replace(/_sen$/, "")}_rm`;
}

/** Integer thousandths, same reasoning as sen. See packages/core/src/money.ts. */
function isQuantity(col) {
  return col.endsWith("_milli");
}

function quantityHeader(col) {
  return col.replace(/_milli$/, "");
}

/**
 * RFC 4180. Quote anything containing a comma, quote, or newline, and double
 * embedded quotes.
 *
 * The leading-character guard is not decoration: Excel and Sheets both execute
 * a cell beginning with = + - or @ as a formula. A workshop named "=SUM" or a
 * description someone pasted is a formula injection into whoever opens the
 * file. Prefixing a tab makes it inert and still readable.
 */
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `\t${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const backup = JSON.parse(readFileSync(file, "utf8"));
if (backup.version !== 1) die(`Unsupported backup version: ${backup.version}`);

const tables = Object.keys(backup.tables).filter((t) => !onlyTable || t === onlyTable);
if (tables.length === 0) die(`No table named "${onlyTable}" in this backup.`);

mkdirSync(outDir, { recursive: true });

console.log(`\n  Backup: ${file}`);
console.log(`  Taken:  ${backup.taken_at}`);
console.log(`  Out:    ${outDir}/\n`);

let written = 0;
for (const table of tables) {
  const { columns, rows } = backup.tables[table];

  const header = columns.map((c) => {
    if (!rawMoney && isMoney(c)) return moneyHeader(c);
    if (isQuantity(c)) return quantityHeader(c);
    return c;
  });

  const lines = [header.map(csvCell).join(",")];

  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const v = row[c];
          if (v === null || v === undefined) return "";
          if (!rawMoney && isMoney(c)) return (Number(v) / 100).toFixed(2);
          if (isQuantity(c)) return (Number(v) / 1000).toString();
          return v;
        })
        .map(csvCell)
        .join(","),
    );
  }

  // Excel guesses the encoding without a BOM and mangles anything non-ASCII.
  // Sheets copes either way, so the BOM is the safer default.
  const body = (noBom ? "" : "﻿") + lines.join("\r\n") + "\r\n";
  const path = join(outDir, `${table}.csv`);
  writeFileSync(path, body, "utf8");

  const money = columns.filter((c) => !rawMoney && isMoney(c)).map(moneyHeader);
  console.log(
    `    ${table.padEnd(24)} ${String(rows.length).padStart(5)} rows` +
      (money.length ? `   money as ringgit: ${money.join(", ")}` : ""),
  );
  written++;
}

console.log(`\n  Wrote ${written} CSV files.`);
console.log(
  rawMoney
    ? "  --raw-money: money columns are integer sen, unconverted.\n"
    : "  Money columns end in _rm and are ringgit. Pass --raw-money for sen.\n",
);
