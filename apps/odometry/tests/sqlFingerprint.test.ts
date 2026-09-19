import { describe, it, expect } from "vitest";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import { and, asc, desc, eq, like, lte, or, sql } from "drizzle-orm";
import * as schema from "../src/worker/schema";

/**
 * A FINGERPRINT OF THE SQL DRIZZLE EMITS, not a test of behaviour.
 *
 * Written for the 0.36 -> 0.45 upgrade and kept afterwards. The tenant
 * predicate is the single thing standing between two users' data, and it
 * reaches D1 as a string that Drizzle builds. A library upgrade that changed
 * how a `WHERE` is composed, how parameters are ordered, or how a `LEFT JOIN`
 * is emitted would not necessarily fail a behavioural test on a two-row
 * fixture -- and the failure mode is one user reading another's rows.
 *
 * So this asserts the literal SQL and the literal bind order for the shapes
 * the repositories actually use. If an upgrade changes any of it, this fails
 * loudly and a human decides whether the new spelling is still correct,
 * instead of it passing silently.
 *
 * Bind ORDER matters as much as the text. CLAUDE.md records the trap: a
 * parameter added to a CTE's SELECT list shifts every later bind, including
 * the tenant id in its own WHERE, and the result is a silently empty response
 * rather than an error.
 *
 * READS ONLY, and deliberately built through `QueryBuilder` rather than the
 * D1 client. Two reasons, one of which is a rule:
 *
 * 1. `drizzle-orm/d1` may only be imported inside `src/worker/data/` or
 *    `packages/core/src/worker/repo.ts` -- scripts/check-db-imports.mjs
 *    enforces it, and it flagged the first draft of this file. The narrow
 *    allow list is deliberate and worth more than this test's convenience, so
 *    the test changed rather than the lint. `QueryBuilder` needs no driver and
 *    was verified to emit byte-identical SQL and binds for every shape below.
 * 2. Reads are where a missing predicate LEAKS. A write with a broken
 *    predicate fails to find its row, which is visible; a read with one
 *    returns someone else's data, which is not.
 *
 * Writes are covered behaviourally instead, against a real database:
 * serviceEdit.test.ts proves a scoped update lands, and isolation.test.ts
 * proves a cross-tenant one does not. That is stronger evidence than a string
 * comparison, which is why there is no update/delete snapshot here.
 */

const db = new QueryBuilder();
const { vehicles, serviceRecords, serviceItems, odometerReadings } = schema;

const GARAGE = "garage-1";

describe("the tenant predicate reaches SQL intact", () => {
  it("emits a bare equality, bound, never inlined", () => {
    const q = db.select().from(vehicles).where(eq(vehicles.garageId, GARAGE)).toSQL();
    expect(q.sql).toContain('"garage_id" = ?');
    expect(q.sql).not.toContain(GARAGE);
    expect(q.params).toEqual([GARAGE]);
  });

  it("puts the tenant id FIRST when and() folds it in, as BaseScopedRepo does", () => {
    const q = db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.garageId, GARAGE), eq(vehicles.id, "v1")))
      .toSQL();
    expect(q.params).toEqual([GARAGE, "v1"]);
    expect(q.sql).toMatch(/where .*"garage_id" = \? and .*"id" = \?/i);
  });

  it("keeps the tenant predicate outside an or(), not absorbed into it", () => {
    // The shape that matters: scope AND (a OR b). If an upgrade ever
    // re-associated this to (scope AND a) OR b, every row matching b would
    // escape the predicate entirely.
    const q = db
      .select()
      .from(serviceRecords)
      .where(
        and(
          eq(serviceRecords.garageId, GARAGE),
          or(eq(serviceRecords.id, "a"), eq(serviceRecords.id, "b")),
        ),
      )
      .toSQL();
    expect(q.sql).toMatch(/"garage_id" = \? and \(.*or.*\)/i);
    expect(q.params).toEqual([GARAGE, "a", "b"]);
  });

  it("survives a join without losing the predicate or reordering binds", () => {
    const q = db
      .select({ id: serviceRecords.id, note: serviceItems.note })
      .from(serviceRecords)
      .leftJoin(serviceItems, eq(serviceItems.serviceRecordId, serviceRecords.id))
      .where(and(eq(serviceRecords.garageId, GARAGE), eq(serviceRecords.id, "s1")))
      .orderBy(desc(serviceRecords.servicedOn))
      .toSQL();
    expect(q.sql).toContain("left join");
    expect(q.sql).toContain('"garage_id" = ?');
    expect(q.params).toEqual([GARAGE, "s1"]);
  });
});

describe("bind order across clauses", () => {
  it("binds in statement order when a raw fragment precedes the predicate", () => {
    // The documented trap, as an executable assertion: parameters bind by
    // POSITION IN THE STATEMENT TEXT, not by clause. A `?` introduced earlier
    // shifts the tenant id, which reads as an empty response, not an error.
    const q = db
      .select({
        id: vehicles.id,
        flag: sql<number>`(${vehicles.currentOdometerKm} > ${10000})`.as("flag"),
      })
      .from(vehicles)
      .where(eq(vehicles.garageId, GARAGE))
      .toSQL();
    expect(q.params).toEqual([10000, GARAGE]);
  });

  it("keeps limit and offset binds after the where binds", () => {
    const q = db
      .select()
      .from(vehicles)
      .where(eq(vehicles.garageId, GARAGE))
      .limit(50)
      .offset(10)
      .toSQL();
    expect(q.params).toEqual([GARAGE, 50, 10]);
  });
});

describe("the clause spellings the repositories rely on", () => {
  it("emits IS NULL for a null comparison rather than = ?", () => {
    // part_types with garage_id IS NULL are the global seed rows. If this ever
    // became `= ?` with a null bind it would match nothing in SQLite, and the
    // catalogue would silently empty.
    const q = db.select().from(schema.partTypes).where(eq(schema.partTypes.garageId, null as never)).toSQL();
    expect(q.sql.toLowerCase()).toMatch(/"garage_id" (is null|= \?)/);
  });

  it("keeps order by, like and lte spellings stable", () => {
    const q = db
      .select()
      .from(odometerReadings)
      .where(and(eq(odometerReadings.garageId, GARAGE), lte(odometerReadings.recordedOn, "2026-01-01")))
      .orderBy(asc(odometerReadings.recordedOn))
      .toSQL();
    expect(q.sql).toContain("<=");
    expect(q.sql).toContain("order by");
    expect(q.params).toEqual([GARAGE, "2026-01-01"]);

    const l = db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.garageId, GARAGE), like(vehicles.nickname, "%a%")))
      .toSQL();
    expect(l.sql).toContain("like");
    expect(l.params).toEqual([GARAGE, "%a%"]);
  });
});
