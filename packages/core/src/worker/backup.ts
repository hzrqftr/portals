/**
 * Whole-database export. THE ONE LEGITIMATE UNSCOPED READER.
 *
 * Everything else that touches D1 goes through BaseScopedRepo, whose
 * tenantPredicate() is abstract and folded into every where() precisely so
 * that no unscoped query is expressible. A backup's requirement is the exact
 * inverse: every row of every table, belonging to everyone. It cannot be built
 * out of those classes, and should not be -- widening BaseScopedRepo to allow
 * an unscoped read would put that hole in the path of every repository in both
 * portals, to serve one caller that runs on a cron with no user attached.
 *
 * So it lives here instead, and the constraints that keep it honest are:
 *
 *   - It lives in packages/core/src/worker/, which check-db-imports.mjs
 *     already permits to touch env.DB. No allow-list was widened to land this.
 *     That matters: those regexes silently stopped matching once before (root
 *     CLAUDE.md, "Known traps") and the lint reported success while enforcing
 *     nothing.
 *   - It may NOT import the Drizzle client here -- rule 2 narrows that to
 *     repo.ts. Which is the right outcome anyway: this reads sqlite_master and
 *     PRAGMAs, and a typed schema would actively fight table discovery.
 *   - There is no route to it. It is called from a scheduled handler only.
 *
 * WHY THIS EXISTS AT ALL, given D1 Time Travel:
 *
 * Time Travel was measured on 2026-08-28, not assumed: it restores to any
 * bookmark within 30 days on this account. So the failure the specs feared --
 * a bad migration eating years of history -- is already covered, for free.
 * What Time Travel does not cover is what this is for: anything older than 30
 * days, loss of the Cloudflare account (the recovery mechanism lives inside
 * the thing it protects), and portability, since a bookmark is not a file you
 * can read, diff, or move to Postgres.
 *
 * That is why retention here is 90 days and not 30. Matching Time Travel's
 * window would add nothing on the time axis.
 */

/** The subset of D1Database this module needs. */
type Db = Pick<D1Database, "prepare">;

export interface TableDump {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface Backup {
  version: 1;
  taken_at: string;
  database: string;
  /**
   * The migration ledger at the moment of the dump. This is the interlock:
   * restoring rows into a schema they were not taken from corrupts silently
   * rather than erroring -- a dropped column simply vanishes, a renamed one
   * arrives NULL. restore refuses on mismatch instead of guessing.
   */
  migrations: string[];
  tables: Record<string, TableDump>;
  row_counts: Record<string, number>;
}

/**
 * Tables that must never appear in a dump.
 *
 * `d1_migrations` is excluded deliberately rather than incidentally: a restore
 * applies migrations first, which repopulates it. Carrying the rows across
 * would collide with what the target already wrote. Its contents are captured
 * in `migrations` instead, where they serve as the interlock above.
 */
const SKIP_TABLES = /^(sqlite_|_cf_|d1_migrations$)/;

/**
 * Quote an identifier for interpolation. Table and column names cannot be
 * bound as parameters, so they are interpolated -- but every one of them comes
 * from sqlite_master or PRAGMA table_xinfo, i.e. from the database's own
 * catalogue rather than from user input. Doubling embedded quotes keeps that
 * true even for a table someone names awkwardly.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function listTables(db: Db): Promise<string[]> {
  const res = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all<{ name: string }>();

  return res.results.map((r) => r.name).filter((n) => !SKIP_TABLES.test(n));
}

/**
 * Real, writable columns of a table, in declaration order.
 *
 * Generated columns cannot be inserted into -- SQLite rejects any INSERT that
 * names one -- so they must not reach the dump. They recompute themselves on
 * restore from the expression in the schema.
 *
 * This is not hypothetical: docs/coinbox-spec.md 4.2 proposes
 * `transactions.signed_sen` as GENERATED ALWAYS AS (...) VIRTUAL, so the first
 * table this really has to protect has one.
 *
 * `table_xinfo` reports every column with a `hidden` flag (0 = ordinary,
 * 1 = hidden column of a virtual table, 2 = VIRTUAL generated, 3 = STORED
 * generated) and this filters on it explicitly.
 *
 * To be accurate about why: `table_info` would ALSO produce the right answer,
 * because it omits generated columns rather than reporting them. That was
 * verified by swapping it in and watching these tests keep passing, so do not
 * read this as "table_info is a bug." The choice is that an explicit filter is
 * visible to the next reader, whereas relying on table_info's omission means
 * the rule is enforced by something that is not written down anywhere. The
 * test below is what actually holds the behaviour, either way.
 */
export async function writableColumns(db: Db, table: string): Promise<string[]> {
  const res = await db
    .prepare(`PRAGMA table_xinfo(${quoteIdent(table)})`)
    .all<{ name: string; hidden: number }>();

  return res.results.filter((c) => c.hidden !== 2 && c.hidden !== 3).map((c) => c.name);
}

export async function dumpTable(db: Db, table: string): Promise<TableDump> {
  const columns = await writableColumns(db, table);

  // An ORDER BY makes two dumps of unchanged data byte-identical, which is
  // what lets you diff yesterday against today and see only real changes.
  // rowid is stable and present on every table here (no WITHOUT ROWID).
  const select = columns.map(quoteIdent).join(", ");
  const res = await db
    .prepare(`SELECT ${select} FROM ${quoteIdent(table)} ORDER BY rowid`)
    .all<Record<string, unknown>>();

  return { columns, rows: res.results };
}

async function appliedMigrations(db: Db): Promise<string[]> {
  const res = await db
    .prepare("SELECT name FROM d1_migrations ORDER BY id")
    .all<{ name: string }>();
  return res.results.map((r) => r.name);
}

/**
 * Dump every table. Discovery is driven by sqlite_master and never by a
 * hardcoded list -- a list would mean that when `transactions` lands, the most
 * valuable table in the database is silently absent from every backup until
 * somebody remembers to add it. Silently is the operative word: the job would
 * keep succeeding.
 */
export async function createBackup(db: Db, database = "fleet"): Promise<Backup> {
  const tables = await listTables(db);

  const dumps: Record<string, TableDump> = {};
  const counts: Record<string, number> = {};

  for (const table of tables) {
    const dump = await dumpTable(db, table);
    dumps[table] = dump;
    counts[table] = dump.rows.length;
  }

  return {
    version: 1,
    taken_at: new Date().toISOString(),
    database,
    migrations: await appliedMigrations(db),
    tables: dumps,
    row_counts: counts,
  };
}

/** `fleet/2026-08-28.json` -- one object per calendar day, UTC. */
export function backupKey(database: string, takenAt: Date): string {
  return `${database}/${takenAt.toISOString().slice(0, 10)}.json`;
}

export const RETENTION_DAYS = 90;

/**
 * Keys older than the retention window. Dates come from the key itself rather
 * than R2's upload timestamp, so a re-uploaded object is not treated as young.
 */
export function expiredKeys(keys: string[], now: Date, retentionDays = RETENTION_DAYS): string[] {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return keys.filter((key) => {
    const date = key.slice(key.lastIndexOf("/") + 1).replace(/\.json$/, "");
    // Anything not shaped like a date is left alone: this deletes things, and
    // an unrecognised key is not ours to remove.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    return date < cutoff;
  });
}

export interface BackupResult {
  key: string;
  bytes: number;
  tables: number;
  rows: number;
  pruned: string[];
}

/**
 * Dump the database to R2 and prune what has aged out.
 *
 * Writes before pruning, and prunes only on a successful write, so a failure
 * here can never leave fewer backups than it started with.
 */
export async function runBackup(
  db: Db,
  bucket: R2Bucket,
  options: { database?: string; now?: Date; retentionDays?: number } = {},
): Promise<BackupResult> {
  const database = options.database ?? "fleet";
  const now = options.now ?? new Date();

  const backup = await createBackup(db, database);
  const key = backupKey(database, now);
  const body = JSON.stringify(backup);

  await bucket.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      takenAt: backup.taken_at,
      rows: String(Object.values(backup.row_counts).reduce((a, b) => a + b, 0)),
    },
  });

  const listed = await bucket.list({ prefix: `${database}/` });
  const pruned = expiredKeys(
    listed.objects.map((o) => o.key),
    now,
    options.retentionDays,
  );
  for (const stale of pruned) await bucket.delete(stale);

  return {
    key,
    bytes: body.length,
    tables: Object.keys(backup.tables).length,
    rows: Object.values(backup.row_counts).reduce((a, b) => a + b, 0),
    pruned,
  };
}

/**
 * Order tables parents-first, so inserts never reference a row that does not
 * exist yet. Reverse it for deletes.
 *
 * This is not the approach that was tried first. The standard SQLite restore
 * idiom is `PRAGMA foreign_keys = OFF`, insert in any order, then
 * `foreign_key_check` -- and D1 IGNORES that pragma. It keeps enforcing
 * constraints statement by statement, so the restore failed with
 * SQLITE_CONSTRAINT_FOREIGNKEY on the first child row. Ordering is therefore
 * not a nicety here; it is the only mechanism available.
 *
 * foreign_key_check still runs at the end, because ordering only guarantees
 * that references resolve in the order applied -- it says nothing about
 * whether the dump's references were sound to begin with.
 */
export async function topologicalOrder(
  db: Db,
  tables: string[],
): Promise<string[]> {
  const deps = new Map<string, Set<string>>();
  const known = new Set(tables);

  for (const table of tables) {
    const res = await db
      .prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`)
      .all<{ table: string }>();

    // A self-reference would deadlock the sort and cannot be satisfied by
    // ordering anyway, so it is dropped: such a row has to be inserted with
    // the parent absent regardless. No table has one today.
    const parents = new Set(
      res.results.map((r) => r.table).filter((t) => t !== table && known.has(t)),
    );
    deps.set(table, parents);
  }

  const ordered: string[] = [];
  const placed = new Set<string>();

  // Kahn's algorithm, taking ties alphabetically so the output is stable
  // across runs and two dumps of unchanged data stay diffable.
  while (ordered.length < tables.length) {
    const ready = tables
      .filter((t) => !placed.has(t))
      .filter((t) => [...deps.get(t)!].every((p) => placed.has(p)))
      .sort();

    if (ready.length === 0) {
      // A cycle. Append whatever is left and let foreign_key_check be the
      // judge rather than silently dropping tables from the restore.
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

/**
 * Env-level entry point for a scheduled handler.
 *
 * This exists so that a Worker's index.ts never has to write `env.DB` --
 * check-db-imports.mjs forbids that outside data/, scope.ts, types.ts and this
 * package, and the right response to the lint is to satisfy it rather than to
 * widen it. The handler passes the whole env; the dereference happens here,
 * where it is allowed.
 *
 * Returns null when there is no bucket bound, which is the normal state under
 * `wrangler dev` and in tests. A missing binding is a skip, not a failure:
 * throwing would break local development for a job that has nowhere to write
 * anyway.
 */
export async function runScheduledBackup(
  env: { DB: D1Database; BACKUPS?: R2Bucket },
  options: { database?: string; now?: Date; retentionDays?: number } = {},
): Promise<BackupResult | null> {
  if (!env.BACKUPS) return null;
  return runBackup(env.DB, env.BACKUPS, options);
}

/**
 * Restore a dump into a database, in place of whatever is there.
 *
 * Shared by scripts/restore.mjs and the round-trip test, deliberately: the
 * thing the test exercises has to be the thing that actually runs, or the
 * test proves something about a second implementation nobody uses.
 *
 * docs/coinbox-spec.md 7.6 is explicit that the restore path must be
 * exercised rather than assumed, which is what apps/odometry/tests/backup.test.ts
 * does with this function.
 */
export async function restoreBackup(
  db: Pick<D1Database, "prepare" | "batch">,
  backup: Backup,
  options: { skipMigrationCheck?: boolean } = {},
): Promise<{ tables: number; rows: number }> {
  if (!options.skipMigrationCheck) {
    const target = await appliedMigrations(db);
    const same =
      target.length === backup.migrations.length &&
      target.every((name, i) => name === backup.migrations[i]);

    if (!same) {
      throw new Error(
        `Migration mismatch: backup was taken at [${backup.migrations.join(", ")}] ` +
          `but this database is at [${target.join(", ")}]. Restoring across a schema ` +
          `change loses columns silently, so this is a refusal rather than a warning.`,
      );
    }
  }

  const tables = Object.keys(backup.tables);
  const order = await topologicalOrder(db, tables);

  // Children first on the way out, parents first on the way back in. D1
  // enforces foreign keys on every statement and ignores the pragma that would
  // suspend them, so this ordering is what makes the restore possible at all.
  await db.batch(
    [...order].reverse().map((t) => db.prepare(`DELETE FROM ${quoteIdent(t)}`)),
  );

  let rows = 0;
  for (const table of order) {
    const dump = backup.tables[table];
    if (!dump) continue;
    const { columns, rows: data } = dump;
    if (data.length === 0) continue;

    const cols = columns.map(quoteIdent).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders})`;

    // Chunked: D1 caps how many statements one batch may carry, and a table
    // with thousands of rows would otherwise exceed it.
    const CHUNK = 200;
    for (let i = 0; i < data.length; i += CHUNK) {
      const slice = data.slice(i, i + CHUNK);
      await db.batch(
        slice.map((row: Record<string, unknown>) =>
          db.prepare(sql).bind(...columns.map((c: string) => row[c] ?? null)),
        ),
      );
    }
    rows += data.length;
  }

  // Ordering only guarantees references resolve in the order applied. It says
  // nothing about whether the dump's references were sound, so this still runs.
  const check = await db.prepare("PRAGMA foreign_key_check").all();
  if (check.results.length > 0) {
    throw new Error(
      `Restore left ${check.results.length} broken foreign key reference(s). ` +
        `The database is in the restored state but is NOT consistent.`,
    );
  }

  return { tables: tables.length, rows };
}
