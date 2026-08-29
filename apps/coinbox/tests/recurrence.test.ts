import { describe, it, expect } from "vitest";
import {
  daysInMonth,
  describeSchedule,
  dueOccurrences,
  firstOccurrenceOnOrAfter,
  nextAfter,
  occurrenceOn,
  ordinal,
  type Schedule,
} from "../src/shared/recurrence";

/**
 * When a recurring rule falls due.
 *
 * No database and no `cloudflare:test` -- these are pure functions, so this is
 * the cheap fast layer, mirroring form-logic.test.ts. Everything here is a
 * silent failure in production: a rule that drifts off the 31st, a series that
 * outlives its end date, a catch-up that never terminates. None of them throw.
 */

const monthly = (over: Partial<Schedule> = {}): Schedule => ({
  intervalMonths: 1,
  dayOfMonth: 15,
  startsOn: "2026-09-01",
  endsOn: null,
  ...over,
});

describe("the month-end clamp", () => {
  /**
   * THE REGRESSION THIS WHOLE MODULE EXISTS FOR.
   *
   * The round trip is the test, not the first step. An implementation that
   * reaches the next date with addMonths(previous, 1) passes "Jan 31 -> Feb 28"
   * and then fails here, returning 2026-03-28 -- because the clamp gets carried
   * forward and the rule silently sits on the 28th for the rest of its life.
   * Asserting only the February step would pass against exactly that bug.
   */
  it("clamps into February and RETURNS to the 31st in March", () => {
    const rule = monthly({ dayOfMonth: 31, startsOn: "2026-01-31" });

    expect(nextAfter(rule, "2026-01-31")).toBe("2026-02-28");
    expect(nextAfter(rule, "2026-02-28")).toBe("2026-03-31");
    expect(nextAfter(rule, "2026-03-31")).toBe("2026-04-30");
    expect(nextAfter(rule, "2026-04-30")).toBe("2026-05-31");
  });

  it("gives 29 February in a leap year", () => {
    const rule = monthly({ dayOfMonth: 31, startsOn: "2028-01-31" });
    expect(nextAfter(rule, "2028-01-31")).toBe("2028-02-29");
    expect(nextAfter(rule, "2028-02-29")).toBe("2028-03-31");
  });

  it("clamps a 30th rule in February and leaves 30-day months alone", () => {
    const rule = monthly({ dayOfMonth: 30, startsOn: "2026-01-30" });
    expect(nextAfter(rule, "2026-01-30")).toBe("2026-02-28");
    expect(nextAfter(rule, "2026-03-30")).toBe("2026-04-30");
  });

  it("knows the length of every month it needs", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29); // leap
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("applies the clamp to the month asked for, not the month before", () => {
    expect(occurrenceOn(2026, 2, 31)).toBe("2026-02-28");
    expect(occurrenceOn(2026, 3, 31)).toBe("2026-03-31");
    expect(occurrenceOn(2026, 1, 5)).toBe("2026-01-05");
  });
});

describe("intervals and phase", () => {
  it("rolls over the year boundary", () => {
    const rule = monthly({ dayOfMonth: 15, startsOn: "2026-12-15" });
    expect(nextAfter(rule, "2026-12-15")).toBe("2027-01-15");
  });

  it("keeps a quarterly rule in phase with its start month", () => {
    const rule = monthly({ intervalMonths: 3, dayOfMonth: 1, startsOn: "2026-02-01" });
    // February, then May, August, November -- never March.
    expect(nextAfter(rule, "2026-02-01")).toBe("2026-05-01");
    expect(nextAfter(rule, "2026-05-01")).toBe("2026-08-01");
    expect(nextAfter(rule, "2026-08-01")).toBe("2026-11-01");
    expect(nextAfter(rule, "2026-11-01")).toBe("2027-02-01");
  });

  it("returns one date a year for a yearly rule", () => {
    const rule = monthly({ intervalMonths: 12, dayOfMonth: 20, startsOn: "2026-03-20" });
    expect(nextAfter(rule, "2026-03-20")).toBe("2027-03-20");
  });

  it("clamps a quarterly rule that lands on a short month", () => {
    const rule = monthly({ intervalMonths: 3, dayOfMonth: 31, startsOn: "2026-08-31" });
    expect(nextAfter(rule, "2026-08-31")).toBe("2026-11-30");
    expect(nextAfter(rule, "2026-11-30")).toBe("2027-02-28");
    expect(nextAfter(rule, "2027-02-28")).toBe("2027-05-31");
  });

  it("skips straight to the right period instead of walking every month", () => {
    // A yearly rule started years ago must not need 50 iterations to answer.
    const rule = monthly({ intervalMonths: 12, dayOfMonth: 1, startsOn: "2000-06-01" });
    expect(firstOccurrenceOnOrAfter(rule, "2026-01-01")).toBe("2026-06-01");
  });
});

describe("firstOccurrenceOnOrAfter", () => {
  it("includes the date itself -- a rule due today posts today", () => {
    const rule = monthly({ dayOfMonth: 15, startsOn: "2026-09-15" });
    expect(firstOccurrenceOnOrAfter(rule, "2026-09-15")).toBe("2026-09-15");
  });

  it("moves to next month when this month's day has passed", () => {
    const rule = monthly({ dayOfMonth: 15, startsOn: "2026-09-01" });
    expect(firstOccurrenceOnOrAfter(rule, "2026-09-20")).toBe("2026-10-15");
  });

  it("never returns anything before startsOn", () => {
    const rule = monthly({ dayOfMonth: 15, startsOn: "2026-09-01" });
    expect(firstOccurrenceOnOrAfter(rule, "2020-01-01")).toBe("2026-09-15");
  });
});

describe("dueOccurrences", () => {
  it("returns nothing when the next date has not arrived", () => {
    const rule = monthly({ dayOfMonth: 15, startsOn: "2026-09-01" });
    expect(dueOccurrences(rule, null, "2026-09-14")).toEqual([]);
  });

  it("returns the occurrence on the day itself", () => {
    const rule = monthly({ dayOfMonth: 15, startsOn: "2026-09-01" });
    expect(dueOccurrences(rule, null, "2026-09-15")).toEqual(["2026-09-15"]);
  });

  /** A missed cron run, or a Worker that was down. Catch-up is in order. */
  it("catches up every missed occurrence in one run, oldest first", () => {
    const rule = monthly({ dayOfMonth: 1, startsOn: "2026-06-01" });
    expect(dueOccurrences(rule, "2026-06-01", "2026-09-05")).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
  });

  it("starts after the last posted occurrence, never repeating it", () => {
    const rule = monthly({ dayOfMonth: 1, startsOn: "2026-06-01" });
    expect(dueOccurrences(rule, "2026-09-01", "2026-09-30")).toEqual([]);
  });

  /**
   * The bound is a hard stop on a date bug that fails to advance. Without it
   * such a bug loops until the Worker is killed, which in a cron is invisible.
   */
  it("bounds the catch-up rather than looping unboundedly", () => {
    const rule = monthly({ dayOfMonth: 1, startsOn: "2020-01-01" });
    expect(dueOccurrences(rule, null, "2026-09-01")).toHaveLength(12);
    expect(dueOccurrences(rule, null, "2026-09-01", 3)).toEqual([
      "2020-01-01",
      "2020-02-01",
      "2020-03-01",
    ]);
  });

  it("stops at the end date", () => {
    const rule = monthly({ dayOfMonth: 1, startsOn: "2026-06-01", endsOn: "2026-08-01" });
    expect(dueOccurrences(rule, null, "2026-12-01")).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
  });

  it("yields nothing once the end date has passed", () => {
    const rule = monthly({ dayOfMonth: 1, startsOn: "2026-06-01", endsOn: "2026-07-01" });
    expect(dueOccurrences(rule, "2026-07-01", "2026-12-01")).toEqual([]);
    expect(nextAfter(rule, "2026-07-01")).toBeNull();
  });
});

describe("describing the cadence", () => {
  it("names the pattern the way the rule behaves", () => {
    expect(describeSchedule(monthly({ dayOfMonth: 1 }))).toBe("Monthly on the 1st");
    expect(describeSchedule(monthly({ dayOfMonth: 22 }))).toBe("Monthly on the 22nd");
    expect(describeSchedule(monthly({ intervalMonths: 3, dayOfMonth: 15 }))).toBe(
      "Every 3 months on the 15th",
    );
    expect(
      describeSchedule(monthly({ intervalMonths: 12, dayOfMonth: 20, startsOn: "2026-03-20" })),
    ).toBe("Yearly in March, on the 20th");
  });

  /**
   * A day-31 rule shows "the last day", not "the 31st". Showing "31st" beside
   * a 28 February date reads as a bug rather than as the clamp working.
   */
  it("calls a 31st rule what it actually is", () => {
    expect(describeSchedule(monthly({ dayOfMonth: 31 }))).toBe("Monthly on the last day");
  });

  it("gets the awkward ordinals right", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th"); // not 11st
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(31)).toBe("31st");
  });
});
