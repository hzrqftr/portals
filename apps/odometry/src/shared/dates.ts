/**
 * Calendar-date helpers. Spec 11.5, CLAUDE.md invariant 5.
 *
 * A calendar date here is always the string 'YYYY-MM-DD'. It is a date on a
 * wall calendar, not an instant in time. Road tax expires on a day, not at a
 * moment, and the Worker runs in UTC while the owner lives at UTC+8, so a
 * bare `new Date()` is the previous local day for eight hours out of every
 * twenty-four.
 *
 * Nothing outside this file may call `new Date()` to decide what day it is.
 */

export type CalendarDate = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string): value is CalendarDate {
  return DATE_RE.test(value);
}

/** Today, on the user's wall calendar. The only source of "now" in the app. */
export function todayIn(timezone: string): CalendarDate {
  // en-CA formats as YYYY-MM-DD, which is exactly the storage format.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Arithmetic on a calendar date. UTC is used purely as a stable arithmetic
 * frame here: the input has no time component and the output is formatted
 * straight back to one, so no timezone ever enters the calculation. This is
 * not the round-tripping that invariant 5 forbids -- that is about deciding
 * which day "today" is, which only `todayIn` may do.
 */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, d));
  // Clamp 31 Jan + 1 month to 28/29 Feb rather than rolling into March.
  if (target.getUTCDate() !== d) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const [ay, am, ad] = from.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = to.split("-").map(Number) as [number, number, number];
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

/** ISO 8601 UTC timestamp, for created_at / updated_at columns. */
export function nowIso(): string {
  return new Date().toISOString();
}
