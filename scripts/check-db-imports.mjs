#!/usr/bin/env node
/**
 * Enforcement mechanism 1 of spec 5.2.
 *
 * D1 has no row-level security. The single thing standing between two users'
 * data is that every query carries its tenant predicate, and the only way to
 * keep that reliable is to make it impossible to write a query anywhere except
 * in a repository that adds the predicate for you.
 *
 * So: `env.DB`, the Drizzle client, and Cloudflare Access may appear only in
 * their designated files. This script fails the build if they leak out.
 * Discipline is not a control; this is.
 *
 * It walks the WHOLE workspace -- both portals and the shared package -- from
 * one place. That is the concrete reason the two portals share a repo: a
 * second repo would be outside this walk, and the invariant would quietly
 * degrade from a build failure into a good intention.
 *
 * Run: node scripts/check-db-imports.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: the latter leaves %20 in paths that
// contain a space, which every Windows home directory eventually does.
const ROOT = dirname(fileURLToPath(new URL(".", import.meta.url)));

/**
 * Allow lists are REGEXES, not string prefixes.
 *
 * They used to be prefixes like "src/worker/data/". When Odometry moved to
 * apps/odometry/ every one of them stopped matching -- and because a path
 * that matches no allow entry is only checked, not required, the failure
 * mode was a lint that reported success while enforcing nothing at all.
 * Anchored patterns make that specific silent failure impossible: an
 * `apps/*` path either matches deliberately or is flagged.
 */
const RULES = [
  {
    pattern: /\benv\.DB\b|\bDB:\s*D1Database\b/,
    // tests/ is allowed on purpose: seeding two tenants and asserting on raw
    // rows is how the isolation suites check the boundary from the outside.
    // Test code ships nowhere and grants no user any access.
    allow: [
      /^apps\/[^/]+\/src\/worker\/data\//,
      /^apps\/[^/]+\/src\/worker\/scope\.ts$/,
      /^apps\/[^/]+\/src\/worker\/types\.ts$/,
      /^apps\/[^/]+\/tests\//,
      /^packages\/core\/src\/worker\//,
    ],
    message:
      "env.DB may only be touched inside an app's src/worker/data/, its " +
      "scope.ts, or packages/core/src/worker/ (invariant 2)",
  },
  {
    pattern: /from\s+["']drizzle-orm\/d1["']/,
    allow: [/^apps\/[^/]+\/src\/worker\/data\//, /^packages\/core\/src\/worker\/repo\.ts$/],
    message:
      "the Drizzle D1 client may only be constructed in an app's " +
      "src/worker/data/ or in packages/core/src/worker/repo.ts",
  },
  {
    // Matches `getIdentity(` in ANY form.
    //
    // This rule used to read /\.access\.getIdentity\s*\(/, which never matched
    // the code it was written to protect: auth.ts destructures `access` off
    // the context first and calls `access.getIdentity()`, with no `.access.`
    // immediately before the call. The rule silently guarded nothing for as
    // long as it existed. Match the call itself, not one spelling of it.
    pattern: /\bgetIdentity\s*\(/,
    allow: [/^packages\/core\/src\/worker\/auth\.ts$/, /^apps\/[^/]+\/tests\//],
    message:
      "Cloudflare Access may only be called from getAuthenticatedUser() in " +
      "packages/core/src/worker/auth.ts (invariant 3) -- ONE identity " +
      "function across BOTH portals, keeping a swap to self-service signup a " +
      "one-file change",
  },
  {
    pattern: /\bREAL\b|\bFLOAT\b/,
    allow: [],
    only: [/^migrations\//],
    message: "money and quantities are INTEGER minor units; REAL corrupts totals silently",
  },
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".wrangler", ".vite"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|sql|mjs)$/.test(entry)) yield full;
  }
}

const failures = [];
let scanned = 0;

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (rel.startsWith("scripts/")) continue;
  scanned += 1;
  const source = readFileSync(file, "utf8");

  for (const rule of RULES) {
    if (rule.only && !rule.only.some((re) => re.test(rel))) continue;
    if (rule.allow.some((re) => re.test(rel))) continue;
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
console.log(`Tenant-isolation lint passed (${scanned} files scanned).`);
