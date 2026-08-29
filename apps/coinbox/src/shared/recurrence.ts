import type { CalendarDate } from "@portals/core";

/**
 * When a recurring rule falls due.
 *
 * Pure functions over calendar dates. No database, no `new Date()` to decide
 * what day it is -- "today" is always passed in, computed by `todayIn()` from
 * the owner's timezone. Same split as `categoryRules.ts`: this module decides,
 * the caller paints.
 *
 * ===========================================================================
 * THIS CANNOT BE DONE IN SQL, AND THAT IS NOT A PREFERENCE.
 * ===========================================================================
 *
 * SQLite's date() normalises an impossible date forward instead of clamping.
 * Measured, not assumed:
 *
 *     date('2026-01-31','+1 month')  ->  2026-03-03   (not 2026-02-28)
 *     date('2026-03-31','+1 month')  ->  2026-05-01   (not 2026-04-30)
 *
 * "Aggregate in SQL" is a standing invariant here (root CLAUDE.md, invariant
 * 4), so the reason this one calculation is exempt is written down where
 * someone about to "fix" it will read it. The failure it prevents is a payment
 * three days late, once a year, with nothing in any log.
 */

export interface Schedule {
  /** 1 = monthly, 3 = quarterly, 12 = yearly, N = every N months. */
  intervalMonths: number;
  /** The intended day. 31 means "the last day" in months that have no 31st. */
  dayOfMonth: number;
  /** Earliest permitted date, and the phase of the series. */
  startsOn: CalendarDate;
  /** Optional. After this, the series is over. */
  endsOn?: CalendarDate | null;
}

/** `YYYY-MM-DD` sorts lexicographically, which is why the format was chosen. */
function ymOf(date: CalendarDate): { year: number; month: number } {
  const [year, month] = date.split("-").map(Number) as [number, number, number];
  return { year, month };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Days in a month. `Date.UTC(y, m, 0)` is the last day of month `m` (1-based),
 * because day 0 of the next month is the last of this one.
 *
 * UTC is a stable arithmetic frame here, not a timezone decision -- the same
 * reasoning `addDays`/`addMonths` in @portals/core carry. Nothing in this file
 * decides which day today is.
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The occurrence date in one specific month, with the clamp applied.
 *
 * THE CLAMP IS APPLIED TO THE TARGET MONTH, NEVER CARRIED FORWARD. That is the
 * whole trick. Reaching the next occurrence with `addMonths(previous, n)` looks
 * right and drifts permanently: from 2026-02-28 it yields 2026-03-28, so one
 * February silently moves a day-31 rule to the 28th for the rest of its life.
 * Re-applying `dayOfMonth` to each target month instead gives
 * 31 -> 28 -> 31 -> 30 -> 31, which is what was asked for.
 */
export function occurrenceOn(
  year: number,
  month: number,
  dayOfMonth: number,
): CalendarDate {
  const day = Math.min(dayOfMonth, daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Months are counted from year 0 so interval arithmetic never touches a Date. */
function totalMonths(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromTotalMonths(total: number): { year: number; month: number } {
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/**
 * The nth occurrence of the series, counting from 0 at `startsOn`'s month.
 *
 * The phase lives in `startsOn` rather than in a column of its own: a rule
 * repeats in months where (month - month(startsOn)) % intervalMonths is 0. A
 * separate anchor column could drift out of agreement with this one.
 */
function occurrenceAt(schedule: Schedule, index: number): CalendarDate {
  const start = ymOf(schedule.startsOn);
  const { year, month } = fromTotalMonths(
    totalMonths(start.year, start.month) + index * schedule.intervalMonths,
  );
  return occurrenceOn(year, month, schedule.dayOfMonth);
}

/**
 * The first occurrence on or after `date`, or null once the series has ended.
 *
 * "On or after", not "after": a rule whose first due date is today posts today.
 */
export function firstOccurrenceOnOrAfter(
  schedule: Schedule,
  date: CalendarDate,
): CalendarDate | null {
  const floor = date > schedule.startsOn ? date : schedule.startsOn;
  const start = ymOf(schedule.startsOn);
  const target = ymOf(floor);

  // Jump straight to the right neighbourhood rather than walking month by
  // month -- a yearly rule started in 2022 would otherwise loop 50 times.
  const gap =
    totalMonths(target.year, target.month) - totalMonths(start.year, start.month);
  let index = Math.max(0, Math.floor(gap / schedule.intervalMonths));

  // Then step. At most a couple of iterations: the jump can land one period
  // short (the clamped day falls before `floor` within the same month) and
  // never more, but the loop is written to be correct rather than clever.
  for (let guard = 0; guard < 4; guard++) {
    const candidate = occurrenceAt(schedule, index);
    if (candidate >= floor) {
      if (schedule.endsOn && candidate > schedule.endsOn) return null;
      return candidate;
    }
    index += 1;
  }
  return null;
}

/**
 * Every occurrence that has come due but has not been posted yet.
 *
 * `afterExclusive` is the last occurrence already posted for this rule, read
 * from `recurring_postings`. Passing null means nothing has posted yet, so the
 * series starts at `startsOn`.
 *
 * There is deliberately NO stored `next_due_on` cursor. The claims table is
 * already the source of truth for what has happened, so a cursor would be a
 * cache of a derivable fact -- and a cache that is wrong posts money on the
 * wrong day. Deriving the position from the claims each run cannot drift.
 *
 * `limit` bounds the catch-up. Twelve absorbs any realistic outage in one run
 * and is a hard stop on a date bug that fails to advance, which would
 * otherwise loop until the Worker is killed.
 */
export function dueOccurrences(
  schedule: Schedule,
  afterExclusive: CalendarDate | null,
  today: CalendarDate,
  limit = 12,
): CalendarDate[] {
  const from = afterExclusive
    ? nextAfter(schedule, afterExclusive)
    : firstOccurrenceOnOrAfter(schedule, schedule.startsOn);

  const out: CalendarDate[] = [];
  let cursor = from;
  while (cursor && cursor <= today && out.length < limit) {
    if (schedule.endsOn && cursor > schedule.endsOn) break;
    out.push(cursor);
    cursor = nextAfter(schedule, cursor);
  }
  return out;
}

/** The occurrence strictly after `date`. Null once past `endsOn`. */
export function nextAfter(
  schedule: Schedule,
  date: CalendarDate,
): CalendarDate | null {
  const start = ymOf(schedule.startsOn);
  const here = ymOf(date);
  const gap =
    totalMonths(here.year, here.month) - totalMonths(start.year, start.month);
  let index = Math.max(0, Math.floor(gap / schedule.intervalMonths));

  for (let guard = 0; guard < 4; guard++) {
    const candidate = occurrenceAt(schedule, index);
    if (candidate > date) {
      if (schedule.endsOn && candidate > schedule.endsOn) return null;
      return candidate;
    }
    index += 1;
  }
  return null;
}

const ORDINALS = ["th", "st", "nd", "rd"] as const;

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${ORDINALS[n % 10] ?? "th"}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The cadence in words, for the Recurring table.
 *
 * "the last day" rather than "the 31st" when the day cannot exist every month,
 * because that is what the rule actually does and showing "31st" next to a
 * February date reads as a bug.
 */
export function describeSchedule(schedule: Schedule): string {
  const day =
    schedule.dayOfMonth === 31 ? "the last day" : `the ${ordinal(schedule.dayOfMonth)}`;

  if (schedule.intervalMonths === 12) {
    const { month } = ymOf(schedule.startsOn);
    return `Yearly in ${MONTHS[month - 1]}, on ${day}`;
  }
  if (schedule.intervalMonths === 1) return `Monthly on ${day}`;
  return `Every ${schedule.intervalMonths} months on ${day}`;
}
