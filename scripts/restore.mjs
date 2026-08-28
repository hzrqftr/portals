#!/usr/bin/env node
/**
 * Restore a backup written by packages/core/src/worker/backup.ts.
 *
 * docs/coinbox-spec.md 7.6: "the restore path must be exercised, not assumed."
 * The round trip is covered by apps/odometry/tests/backup.test.ts, which calls
 * the same restoreBackup() this script emits SQL for. This is the operator
 * front end to it -- the part a person runs at 2am when something has gone
 * wrong and nobody wants to be reading source.
 *
 *   node scripts/restore.mjs backup.json                     # local D1
 *   node scripts/restore.mjs backup.json --remote --i-mean-it
 *   node scripts/restore.mjs backup.json --dry-run
 *
 * --remote requires --i-mean-it because a restore is the one operation whose
 * whole purpose is to destroy the current contents. Every other destructive
 * path in this repo is a migration, which is at least additive by convention.
 */

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const remote = args.includes("--remote");
const confirmed = args.includes("--i-mean-it");
const dryRun = args.includes("--dry-run");
const skipMigrationCheck = args.includes("--skip-migration-check");

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!file) die("Usage: node scripts/restore.mjs <backup.json> [--remote --i-mean-it] [--dry-run]");
if (remote && !confirmed) {
  die(
    "Refusing to restore to REMOTE without --i-mean-it.\n" +
      "  This deletes every row in production and replaces it with the file's contents.",
  );
}

/**
 * Wrangler's JS entry point, invoked with the node that is already running.
 *
 * Not `npx wrangler`: on Windows npx is a .cmd shim, execFileSync does not
 * resolve shims (ENOENT), and naming npx.cmd explicitly then trips Node 24's
 * refusal to spawn a .cmd without a shell (EINVAL). Calling the .js directly
 * sidesteps both and behaves identically on every platform.
 */
const WRANGLER = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

/** Run a wrangler d1 command against the chosen target and return parsed JSON. */
function d1(sqlOrFile, { isFile = false } = {}) {
  const base = [
    WRANGLER,
    "d1",
    "execute",
    "fleet",
    "-c",
    "wrangler.jsonc",
    remote ? "--remote" : "--local",
  ];
  if (!remote) base.push("--persist-to", ".wrangler/state");
  base.push(isFile ? "--file" : "--command", sqlOrFile, "--json");

  const out = execFileSync(process.execPath, base, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // wrangler prints a banner before the JSON on some versions.
  const start = out.indexOf("[");
  return JSON.parse(start === -1 ? out : out.slice(start));
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  // D1 returns BLOBs as arrays of byte values.
  if (Array.isArray(v)) return `X'${v.map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const backup = JSON.parse(readFileSync(file, "utf8"));
if (backup.version !== 1) die(`Unsupported backup version: ${backup.version}`);

const target = remote ? "REMOTE (production)" : "local";
const tables = Object.keys(backup.tables);
const totalRows = Object.values(backup.row_counts).reduce((a, b) => a + b, 0);

console.log(`\n  Backup:   ${file}`);
console.log(`  Taken:    ${backup.taken_at}`);
console.log(`  Database: ${backup.database}`);
console.log(`  Target:   ${target}`);
console.log(`  Contents: ${totalRows} rows across ${tables.length} tables\n`);

// The interlock. Restoring rows into a schema they were not taken from loses
// data silently -- a dropped column vanishes, a renamed one arrives NULL --
// so this refuses rather than warning.
if (!skipMigrationCheck) {
  const res = d1("SELECT name FROM d1_migrations ORDER BY id");
  const current = (res[0]?.results ?? []).map((r) => r.name);
  const expected = backup.migrations ?? [];
  const same =
    current.length === expected.length && current.every((n, i) => n === expected[i]);

  if (!same) {
    die(
      `Migration mismatch.\n` +
        `  Backup:  [${expected.join(", ")}]\n` +
        `  Target:  [${current.join(", ")}]\n\n` +
        `  Restoring across a schema change loses columns silently.\n` +
        `  Bring the target to the backup's migration state first, or pass\n` +
        `  --skip-migration-check if you have verified the schemas match.`,
    );
  }
  console.log(`  Migrations match (${current.length} applied).\n`);
}

const before = d1(
  `SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM ${quoteIdent(t)}) AS ${quoteIdent(t)}`).join(", ")}`,
);
console.log("  Row counts before:");
for (const [t, n] of Object.entries(before[0]?.results?.[0] ?? {})) {
  console.log(`    ${t.padEnd(28)} ${n}`);
}

/**
 * Order tables parents-first.
 *
 * `PRAGMA foreign_keys = OFF` is the textbook way to make restore order
 * irrelevant, and D1 IGNORES IT -- it keeps enforcing constraints statement by
 * statement. That was found the hard way: the first version of this failed
 * with SQLITE_CONSTRAINT_FOREIGNKEY on the first child row. Ordering is the
 * only mechanism actually available, so it is not optional here.
 *
 * Mirrors topologicalOrder() in packages/core/src/worker/backup.ts.
 */
function orderTables() {
  const deps = new Map();
  for (const t of tables) {
    const res = d1(`PRAGMA foreign_key_list(${quoteIdent(t)})`);
    const parents = new Set(
      (res[0]?.results ?? [])
        .map((r) => r.table)
        .filter((p) => p !== t && tables.includes(p)),
    );
    deps.set(t, parents);
  }

  const ordered = [];
  const placed = new Set();
  while (ordered.length < tables.length) {
    const ready = tables
      .filter((t) => !placed.has(t))
      .filter((t) => [...deps.get(t)].every((p) => placed.has(p)))
      .sort();
    if (ready.length === 0) {
      ordered.push(...tables.filter((t) => !placed.has(t)).sort());
      break;
    }
    for (const t of ready) {
      ordered.push(t);
      placed.add(t);
    }
  }
  return ordered;
}

const order = orderTables();

// Build one SQL file rather than issuing thousands of --command calls: each
// one is a separate wrangler process and an HTTP round trip on --remote.
const sql = [];

// Children first on the way out.
for (const t of [...order].reverse()) sql.push(`DELETE FROM ${quoteIdent(t)};`);

// Parents first on the way back in.
for (const t of order) {
  const { columns, rows } = backup.tables[t];
  if (!rows?.length) continue;
  const cols = columns.map(quoteIdent).join(", ");
  // Multi-row VALUES is fine in D1; it is compound SELECT that is capped
  // (root CLAUDE.md, "Known traps"). Chunked anyway to keep statements sane.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows
      .slice(i, i + CHUNK)
      .map((r) => `(${columns.map((c) => literal(r[c])).join(", ")})`)
      .join(",\n  ");
    sql.push(`INSERT INTO ${quoteIdent(t)} (${cols}) VALUES\n  ${values};`);
  }
}

const script = sql.join("\n");

if (dryRun) {
  console.log(`\n  --dry-run: ${sql.length} statements, ${script.length} bytes. Nothing executed.\n`);
  process.exit(0);
}

const tmp = join(tmpdir(), `portals-restore-${Date.now()}.sql`);
writeFileSync(tmp, script, "utf8");

try {
  console.log(`\n  Restoring ${sql.length} statements...`);
  d1(tmp, { isFile: true });
} finally {
  unlinkSync(tmp);
}

const after = d1(
  `SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM ${quoteIdent(t)}) AS ${quoteIdent(t)}`).join(", ")}`,
);
console.log("\n  Row counts after:");
let mismatched = 0;
for (const [t, n] of Object.entries(after[0]?.results?.[0] ?? {})) {
  const want = backup.row_counts[t] ?? 0;
  const ok = n === want;
  if (!ok) mismatched++;
  console.log(`    ${t.padEnd(28)} ${String(n).padEnd(8)} ${ok ? "" : `EXPECTED ${want}`}`);
}

// Integrity is proven here rather than assumed from insert order. This catches
// a reference the dump itself got wrong, which ordering never would.
const fk = d1("PRAGMA foreign_key_check");
const broken = fk[0]?.results ?? [];

console.log("");
if (broken.length > 0) {
  die(
    `Restore left ${broken.length} broken foreign key reference(s).\n` +
      `  The database holds the restored rows but is NOT consistent.\n` +
      `  ${JSON.stringify(broken.slice(0, 3))}`,
  );
}
if (mismatched > 0) die(`${mismatched} table(s) do not match the backup's row counts.`);

console.log(`  Restore complete. ${totalRows} rows, foreign keys check clean.\n`);
