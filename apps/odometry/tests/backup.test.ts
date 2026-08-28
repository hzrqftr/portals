import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb } from "./helpers";
import {
  createBackup,
  restoreBackup,
  listTables,
  writableColumns,
  backupKey,
  expiredKeys,
  type Backup,
} from "@portals/core/worker";

/**
 * THE RESTORE DRILL, RUN BY MACHINE.
 *
 * docs/coinbox-spec.md 7.6 is blunt about the part people skip: "the restore
 * path must be exercised, not assumed." A backup nobody has restored from is a
 * belief, not a backup -- and the failure mode is that you discover this on the
 * day you need it, which is the worst possible day to discover anything.
 *
 * So the round trip runs here on every `npm test`, against the real schema
 * (vitest.config.ts applies the real migrations/ folder), using the same
 * restoreBackup() that scripts/restore.mjs drives. Testing a second
 * implementation of restore would prove nothing about the one that runs.
 *
 * These tests were made to fail on purpose before being committed, per
 * CLAUDE.md: a table was dropped from the dump and the count assertion was
 * watched to fail, then restored.
 */

const A = "alice@example.com";
const B = "bob@example.com";

async function seedVehicle(email: string, nickname: string, plate: string) {
  const call = as(email);
  const res = await call("/api/vehicles", {
    method: "POST",
    json: { nickname, plate, fuelType: "petrol", currentOdometerKm: 50_000 },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("whole-database backup and restore", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("round-trips every row, and proves integrity afterwards", async () => {
    const aVehicle = await seedVehicle(A, "ALICE_CAR", "ALICE_1111");
    await seedVehicle(B, "BOB_CAR", "BOB_9999");

    const backup = await createBackup(env.DB);

    // Sanity: the dump must actually contain both tenants. A backup that
    // quietly captured one garage would pass every later assertion here.
    expect(backup.row_counts.users).toBe(2);
    expect(backup.row_counts.garages).toBe(2);
    expect(backup.row_counts.vehicles).toBe(2);
    expect(backup.migrations.length).toBeGreaterThan(0);

    const vehiclesBefore = backup.tables.vehicles!.rows;
    const aliceRowBefore = vehiclesBefore.find((r) => r.id === aVehicle);
    expect(aliceRowBefore).toBeDefined();

    // Destroy everything the backup is supposed to be able to bring back.
    await resetDb();
    const emptied = await env.DB.prepare("SELECT COUNT(*) AS n FROM vehicles").first<{
      n: number;
    }>();
    expect(emptied!.n).toBe(0);

    const result = await restoreBackup(env.DB, backup);
    expect(result.rows).toBeGreaterThan(0);

    // Row counts, table by table, against what the dump claimed.
    for (const [table, expected] of Object.entries(backup.row_counts)) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).first<{
        n: number;
      }>();
      expect(`${table}=${row!.n}`).toBe(`${table}=${expected}`);
    }

    // A spot-checked row must come back field for field, not merely in count.
    const after = await createBackup(env.DB);
    const aliceRowAfter = after.tables.vehicles!.rows.find((r) => r.id === aVehicle);
    expect(aliceRowAfter).toEqual(aliceRowBefore);

    // Integrity proven, not inferred from insert order.
    const fk = await env.DB.prepare("PRAGMA foreign_key_check").all();
    expect(fk.results).toEqual([]);
  });

  it("re-dumps identically after a restore", async () => {
    await seedVehicle(A, "ALICE_CAR", "ALICE_1111");

    const first = await createBackup(env.DB);
    await restoreBackup(env.DB, first);
    const second = await createBackup(env.DB);

    // taken_at differs by construction; everything describing the data must not.
    expect(second.tables).toEqual(first.tables);
    expect(second.row_counts).toEqual(first.row_counts);
  });

  it("picks up new tables without being told, generated columns included", async () => {
    // The claim made when this was built: discovery reads sqlite_master, so a
    // table added later is backed up without anyone remembering. Migration
    // 0011 then added transactions, categories and the import tables. This
    // asserts the claim against them rather than trusting it.
    const backup = await createBackup(env.DB);

    for (const t of ["transactions", "categories", "import_batches", "import_rows"]) {
      expect(`${t} in backup: ${t in backup.tables}`).toBe(`${t} in backup: true`);
    }

    // And the generated column is excluded from the REAL table now, not just
    // from the synthetic probe below. transactions.signed_sen cannot be
    // inserted into, so a dump containing it would fail on restore.
    expect(backup.tables.transactions!.columns).toContain("amount_sen");
    expect(backup.tables.transactions!.columns).not.toContain("signed_sen");
  });

  it("excludes d1_migrations and D1's internal tables", async () => {
    const tables = await listTables(env.DB);

    expect(tables).toContain("vehicles");
    expect(tables).toContain("users");
    // d1_migrations is captured as the manifest interlock instead: carrying its
    // rows would collide with what applying migrations to the target wrote.
    expect(tables).not.toContain("d1_migrations");
    expect(tables.some((t) => t.startsWith("_cf_"))).toBe(false);
    expect(tables.some((t) => t.startsWith("sqlite_"))).toBe(false);
  });

  it("refuses to restore across a schema change", async () => {
    await seedVehicle(A, "ALICE_CAR", "ALICE_1111");
    const backup = await createBackup(env.DB);

    const wrongSchema: Backup = {
      ...backup,
      migrations: [...backup.migrations, "0099_a_migration_this_db_has_not_seen.sql"],
    };

    // Silent is the danger: a dropped column vanishes and a renamed one arrives
    // NULL, with no error at any point. This has to be a refusal.
    await expect(restoreBackup(env.DB, wrongSchema)).rejects.toThrow(/Migration mismatch/);

    // And the escape hatch has to work, for the case where someone has checked.
    await expect(
      restoreBackup(env.DB, wrongSchema, { skipMigrationCheck: true }),
    ).resolves.toBeDefined();
  });
});

/**
 * Generated columns are the trap this codebase will actually hit.
 *
 * docs/coinbox-spec.md 4.2 proposes transactions.signed_sen as
 * GENERATED ALWAYS AS (...) VIRTUAL. SQLite rejects any INSERT that names a
 * generated column, so a dump built on PRAGMA table_info -- which does not
 * report them -- works perfectly right up until that table exists, and then
 * fails on the one table this whole exercise is for.
 *
 * No table has a generated column yet, so this test makes one. It is here to
 * fail the day someone "simplifies" table_xinfo back to table_info.
 */
describe("generated columns", () => {
  beforeAll(migrate);

  beforeEach(async () => {
    await resetDb();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS gen_probe (
         id          TEXT PRIMARY KEY,
         amount_sen  INTEGER NOT NULL CHECK (amount_sen > 0),
         direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
         signed_sen  INTEGER GENERATED ALWAYS AS
                       (CASE direction WHEN 'out' THEN -amount_sen ELSE amount_sen END) VIRTUAL
       )`,
    ).run();
  });

  afterEach(async () => {
    await env.DB.prepare("DROP TABLE IF EXISTS gen_probe").run();
  });

  it("omits them from the dump, and lets SQLite recompute them on restore", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO gen_probe (id, amount_sen, direction) VALUES (?, ?, ?)").bind(
        "t1",
        24_550,
        "out",
      ),
      env.DB.prepare("INSERT INTO gen_probe (id, amount_sen, direction) VALUES (?, ?, ?)").bind(
        "t2",
        1_000,
        "in",
      ),
    ]);

    const columns = await writableColumns(env.DB, "gen_probe");
    expect(columns).toEqual(["id", "amount_sen", "direction"]);
    expect(columns).not.toContain("signed_sen");

    const backup = await createBackup(env.DB);
    expect(backup.tables.gen_probe!.columns).not.toContain("signed_sen");

    // The restore is the half that would actually throw.
    await env.DB.prepare("DELETE FROM gen_probe").run();
    await restoreBackup(env.DB, backup);

    const rows = await env.DB.prepare(
      "SELECT id, signed_sen FROM gen_probe ORDER BY id",
    ).all<{ id: string; signed_sen: number }>();

    // Recomputed by the expression, never carried in the file.
    expect(rows.results).toEqual([
      { id: "t1", signed_sen: -24_550 },
      { id: "t2", signed_sen: 1_000 },
    ]);
  });
});

/**
 * The R2 half. There is no R2 binding in the test environment, so the bucket
 * is a stand-in -- but the code under test is the real runScheduledBackup(),
 * including the order it does things in, which is the part that matters:
 * it writes before it prunes, and prunes only after a successful write.
 */
function fakeBucket(existing: string[] = []) {
  const objects = new Map<string, string>(existing.map((k) => [k, "{}"]));
  const deleted: string[] = [];

  return {
    deleted,
    objects,
    put: async (key: string, body: string) => {
      objects.set(key, body);
    },
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key })),
    }),
    delete: async (key: string) => {
      objects.delete(key);
      deleted.push(key);
    },
  } as unknown as R2Bucket & { deleted: string[]; objects: Map<string, string> };
}

describe("the scheduled job", () => {
  beforeAll(migrate);
  beforeEach(resetDb);

  it("skips rather than throwing when no bucket is bound", async () => {
    // The normal state under `wrangler dev`. Throwing here would break local
    // development for a job that has nowhere to write anyway.
    const { runScheduledBackup } = await import("@portals/core/worker");
    await expect(runScheduledBackup({ DB: env.DB })).resolves.toBeNull();
  });

  it("writes one object per day and prunes what has aged out", async () => {
    const { runScheduledBackup } = await import("@portals/core/worker");
    await seedVehicle(A, "ALICE_CAR", "ALICE_1111");

    const bucket = fakeBucket([
      "fleet/2026-08-27.json", // yesterday, keep
      "fleet/2026-01-01.json", // long past, prune
      "fleet/notes.txt", // not ours, never touch
    ]);

    const result = await runScheduledBackup(
      { DB: env.DB, BACKUPS: bucket },
      { now: new Date("2026-08-28T18:00:00Z") },
    );

    expect(result).not.toBeNull();
    expect(result!.key).toBe("fleet/2026-08-28.json");
    expect(result!.rows).toBeGreaterThan(0);
    expect(bucket.objects.has("fleet/2026-08-28.json")).toBe(true);

    expect(bucket.deleted).toEqual(["fleet/2026-01-01.json"]);
    expect(bucket.objects.has("fleet/2026-08-27.json")).toBe(true);
    expect(bucket.objects.has("fleet/notes.txt")).toBe(true);

    // What landed must be a restorable backup, not merely a file.
    const written = JSON.parse(bucket.objects.get("fleet/2026-08-28.json")!);
    expect(written.version).toBe(1);
    expect(written.migrations.length).toBeGreaterThan(0);
    expect(written.row_counts.vehicles).toBe(1);
  });
});

describe("retention", () => {
  it("keys one object per calendar day", () => {
    expect(backupKey("fleet", new Date("2026-08-28T18:00:00Z"))).toBe("fleet/2026-08-28.json");
  });

  it("expires only what is past the window", () => {
    const now = new Date("2026-08-28T00:00:00Z");
    const keys = [
      "fleet/2026-08-27.json", // yesterday
      "fleet/2026-05-30.json", // 90 days
      "fleet/2026-05-01.json", // well past
    ];

    const expired = expiredKeys(keys, now, 90);
    expect(expired).toEqual(["fleet/2026-05-01.json"]);
  });

  it("never deletes a key it does not recognise", () => {
    // This function deletes things. An unrecognised key is not ours to remove.
    const keys = ["fleet/notes.txt", "fleet/README", "fleet/2020-01-01.json"];
    expect(expiredKeys(keys, new Date("2026-08-28T00:00:00Z"), 90)).toEqual([
      "fleet/2020-01-01.json",
    ]);
  });

  it("is longer than D1 Time Travel's 30-day window", async () => {
    // The whole justification for this feature. Measured on 2026-08-28:
    // `wrangler d1 time-travel info fleet --timestamp=<31 days ago>` is
    // rejected with "within the last 30 days". A retention shorter than that
    // would add nothing Time Travel does not already do for free.
    const { RETENTION_DAYS } = await import("@portals/core/worker");
    expect(RETENTION_DAYS).toBeGreaterThan(30);
  });
});
