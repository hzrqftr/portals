#!/usr/bin/env node
/**
 * Enforcement mechanism 1 of spec 5.2.
 *
 * D1 has no row-level security. The single thing standing between two users'
 * data is that every query carries `WHERE garage_id = ?`, and the only way to
 * keep that reliable is to make it impossible to write a query anywhere except
 * in a repository that adds the predicate for you.
 *
 * So: `env.DB`, the Drizzle client, and Cloudflare Access may appear only in
 * their designated files. This script fails the build if they leak out.
 * Discipline is not a control; this is.
 *
 * Run: node scripts/check-db-imports.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the latter leaves %20 in paths that
// contain a space, which every Windows home directory eventually does.
const ROOT = dirname(fileURLToPath(new URL(".", import.meta.url)));

const RULES = [
  {
    pattern: /\benv\.DB\b|\bDB:\s*D1Database\b/,
    // tests/ is allowed on purpose: seeding two garages and asserting on raw
    // rows is how the isolation suite checks the boundary from the outside.
    // Test code ships nowhere and grants no user any access.
    allow: ["src/worker/data/", "src/worker/auth.ts", "src/worker/types.ts", "tests/"],
    message: "env.DB may only be touched inside src/worker/data/ (invariant 2)",
  },
  {
    pattern: /from\s+["']drizzle-orm\/d1["']/,
    allow: ["src/worker/data/"],
    message: "the Drizzle D1 client may only be constructed in src/worker/data/",
  },
  {
    pattern: /\.access\.getIdentity\s*\(/,
    allow: ["src/worker/auth.ts"],
    message:
      "Cloudflare Access may only be called from getAuthenticatedUser() in " +
      "src/worker/auth.ts (invariant 3) -- keeping the swap to self-service " +
      "signup a one-file change",
  },
  {
    pattern: /\bREAL\b|\bFLOAT\b/,
    allow: [],
    only: ["migrations/"],
    message: "money and quantities are INTEGER minor units; REAL corrupts totals silently",
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|sql|mjs)$/.test(entry)) yield full;
  }
}

const failures = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (rel.startsWith("scripts/")) continue;
  const source = readFileSync(file, "utf8");

  for (const rule of RULES) {
    if (rule.only && !rule.only.some((p) => rel.startsWith(p))) continue;
    if (rule.allow.some((p) => rel.startsWith(p))) continue;
    // Split on /\r?\n/, not "\n". A CRLF checkout leaves a trailing carriage
    // return on every line, and `.` never matches one -- so the comment
    // stripping below silently stops matching and this linter starts reporting
    // prose as violations. It fails CLOSED, which is the right direction for a
    // security check, but it fails on a fresh clone rather than on a real
    // problem. .gitattributes now pins the checkout to LF; this is the belt to
    // that pair of braces.
    const lines = source.split(/\r?\n/);
    lines.forEach((line, i) => {
      // Skip comments: these identifiers are discussed by name in the docs
      // and comments throughout, and flagging prose helps nobody.
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*(\*|--).*$/, "");
      if (rule.pattern.test(code)) {
        failures.push(`${rel}:${i + 1}  ${rule.message}\n    ${line.trim()}`);
      }
    });
  }
}

if (failures.length > 0) {
  console.error("\nTenant-isolation lint failed:\n");
  for (const f of failures) console.error("  " + f + "\n");
  console.error(`${failures.length} violation(s). See spec 5.2.\n`);
  process.exit(1);
}
console.log("Tenant-isolation lint passed.");
