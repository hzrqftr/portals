import { describe, it, expect } from "vitest";
import {
  checkAgainstSchedule,
  monthsBetween,
  suggestedInterval,
} from "../src/client/components/scheduleCheck";
import {
  changedRows,
  cellsOf,
  hasZero,
  longerThanMaker,
  resetTarget,
} from "../src/client/components/scheduleDraft";
import type { MaintenanceRow, ScheduleRow } from "../src/client/api/hooks";

/**
 * The early/late notice on the log-service form, and the schedule table's
 * edit state (2026-09-20). Both are pure, and both are silent when wrong: a
 * notice that cries "early" on every service trains the owner to ignore it,
 * and a save count that miscounts is a table nobody can trust.
 */

/** Oil: last changed at 50,000 km on 2026-01-10, every 10,000 km or 6 months. */
function oil(over: Partial<MaintenanceRow> = {}): MaintenanceRow {
  return {
    part_type_id: "pt_engine_oil",
    interval_km: 10_000,
    interval_months: 6,
    baseline_km: 50_000,
    baseline_date: "2026-01-10",
    ...over,
  } as MaintenanceRow;
}

describe("monthsBetween", () => {
  it("counts whole calendar months, not 30-day blocks", () => {
    expect(monthsBetween("2026-01-10", "2026-07-10")).toBe(6);
    expect(monthsBetween("2026-01-10", "2026-07-09")).toBe(5);
    expect(monthsBetween("2025-11-30", "2026-02-28")).toBe(2);
  });
});

describe("checkAgainstSchedule", () => {
  it("says the owner's example out loud: 6,000 km into a 10,000 km schedule is early", () => {
    const c = checkAgainstSchedule(oil(), 56_000, "2026-03-10");
    expect(c).toMatchObject({ kind: "early", byKm: 4_000, byMonths: 4 });
    // 6,000 km -- and the 6 months left alone. Offering "2 months" as well
    // would turn a shorter oil interval into a two-month time clock.
    expect(suggestedInterval(c)).toEqual({ km: 6_000, months: null });
  });

  it("suggests the clock that ran over when late", () => {
    expect(suggestedInterval(checkAgainstSchedule(oil(), 54_000, "2026-10-10"))).toEqual({
      km: null,
      months: 9,
    });
  });

  it("treats a replacement within a tenth of the interval as on schedule", () => {
    // 9,200 of 10,000 at five months: close enough. Calling this "early by
    // 800 km" on every service is how a notice becomes noise.
    expect(checkAgainstSchedule(oil(), 59_200, "2026-06-10").kind).toBe("on-schedule");
    expect(checkAgainstSchedule(oil(), 60_900, "2026-06-10").kind).toBe("on-schedule");
  });

  it("is late when EITHER clock ran past, whichever came first", () => {
    // Only 4,000 km, but nine months: the time clock ran out.
    expect(checkAgainstSchedule(oil(), 54_000, "2026-10-10")).toMatchObject({
      kind: "late",
      byKm: null,
      byMonths: 3,
    });
    // Inside six months, but 13,000 km: the distance clock ran out.
    expect(checkAgainstSchedule(oil(), 63_000, "2026-04-10")).toMatchObject({
      kind: "late",
      byKm: 3_000,
      byMonths: null,
    });
  });

  it("is on schedule, not early, once ONE clock has been reached", () => {
    // Only 3,000 km, but six months on: the time clock made it due.
    expect(checkAgainstSchedule(oil(), 53_000, "2026-07-10").kind).toBe("on-schedule");
  });

  it("judges a km-only schedule by km alone", () => {
    const row = oil({ interval_months: null });
    expect(checkAgainstSchedule(row, 55_000, "2027-01-10")).toMatchObject({
      kind: "early",
      byKm: 5_000,
      byMonths: null,
    });
  });

  it("says nothing it cannot measure", () => {
    expect(checkAgainstSchedule(undefined, 56_000, "2026-03-10").kind).toBe("untracked");
    expect(
      checkAgainstSchedule(oil({ baseline_km: null, baseline_date: null }), 56_000, "2026-03-10")
        .kind,
    ).toBe("no-baseline");
    // Backdated before the last replacement: an "early by" would be nonsense.
    expect(checkAgainstSchedule(oil(), 49_000, "2025-12-01").kind).toBe("no-baseline");
  });

  it("offers nothing to adopt when there is nothing off about it", () => {
    expect(suggestedInterval(checkAgainstSchedule(oil(), 59_800, "2026-07-10"))).toEqual({
      km: null,
      months: null,
    });
  });

  it("rounds a suggested km figure to the nearest 500, as a sticker would", () => {
    const c = checkAgainstSchedule(oil(), 56_180, "2026-03-10");
    expect(suggestedInterval(c).km).toBe(6_000);
  });
});

/** Spark plugs, tracked at 40,000 km / 24 months, no maker figure yet. */
function plugs(over: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    part_type_id: "pt_spark_plugs",
    part_name: "Spark plugs",
    part_category: "engine",
    is_custom: 0,
    applies: 1,
    interval_km: 40_000,
    interval_months: 24,
    maker_km: null,
    maker_months: null,
    default_km: 40_000,
    default_months: 24,
    ...over,
  };
}

describe("schedule table edits", () => {
  it("sends only rows that really changed", () => {
    const rows = [plugs(), plugs({ part_type_id: "pt_oil" })];
    const edits = {
      // Typed and typed back: not a change.
      pt_spark_plugs: cellsOf(rows[0]!),
      pt_oil: { ...cellsOf(rows[1]!), intervalKm: "6000" },
    };
    expect(changedRows(rows, edits)).toEqual([
      { partTypeId: "pt_oil", intervalKm: 6_000, intervalMonths: 24, makerKm: null, makerMonths: null },
    ]);
  });

  it("turns blank cells into nulls, which is how a part is untracked", () => {
    const rows = [plugs()];
    const edits = { pt_spark_plugs: { intervalKm: "", intervalMonths: "", makerKm: "", makerMonths: "" } };
    expect(changedRows(rows, edits)[0]).toMatchObject({ intervalKm: null, intervalMonths: null });
  });

  it("warns only when the owner's figure is LONGER than the maker's", () => {
    const base = { intervalKm: "50000", intervalMonths: "24", makerKm: "40000", makerMonths: "24" };
    expect(longerThanMaker(base)).toEqual({ km: true, months: false });
    expect(longerThanMaker({ ...base, intervalKm: "30000" })).toEqual({ km: false, months: false });
    expect(longerThanMaker({ ...base, makerKm: "" })).toEqual({ km: false, months: false });
  });

  it("offers a reset only when the figures differ from the default", () => {
    expect(resetTarget(plugs(), cellsOf(plugs()))).toBeNull();
    expect(resetTarget(plugs(), { ...cellsOf(plugs()), intervalKm: "50000" })).toEqual({
      km: "40000",
      months: "24",
    });
    expect(resetTarget(plugs({ default_km: null, default_months: null }), cellsOf(plugs()))).toBeNull();
  });

  it("catches a zero in any cell", () => {
    expect(hasZero({ ...cellsOf(plugs()), makerMonths: "0" })).toBe(true);
    expect(hasZero(cellsOf(plugs()))).toBe(false);
  });
});
