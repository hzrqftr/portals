import type { ScheduleRow, ScheduleRowDraft } from "../api/hooks";

/**
 * The edit state behind the schedule table, as pure functions (2026-09-20).
 *
 * The table holds every cell as a string -- "" is a blank cell -- and only
 * the rows the owner actually changed are sent. Sending the whole table would
 * work too, but a save that rewrites forty rows to change one is a save whose
 * effect nobody can read back from the request.
 */

export interface CellDraft {
  intervalKm: string;
  intervalMonths: string;
  makerKm: string;
  makerMonths: string;
}

/** Edits so far, by part type id. A part absent here is unchanged. */
export type ScheduleEdits = Record<string, CellDraft>;

const str = (n: number | null) => (n === null ? "" : String(n));
const num = (s: string) => (s === "" ? null : Number(s));

export function cellsOf(row: ScheduleRow): CellDraft {
  return {
    intervalKm: str(row.interval_km),
    intervalMonths: str(row.interval_months),
    makerKm: str(row.maker_km),
    makerMonths: str(row.maker_months),
  };
}

/** What the row shows now: the edit if there is one, the saved figures if not. */
export function currentCells(row: ScheduleRow, edits: ScheduleEdits): CellDraft {
  return edits[row.part_type_id] ?? cellsOf(row);
}

function differs(a: CellDraft, b: CellDraft): boolean {
  return (
    a.intervalKm !== b.intervalKm ||
    a.intervalMonths !== b.intervalMonths ||
    a.makerKm !== b.makerKm ||
    a.makerMonths !== b.makerMonths
  );
}

/**
 * The rows to send. An edit typed and then typed back to what was saved is
 * not a change -- the count on the Save button must not claim one.
 */
export function changedRows(rows: ScheduleRow[], edits: ScheduleEdits): ScheduleRowDraft[] {
  return rows
    .filter((r) => edits[r.part_type_id] && differs(edits[r.part_type_id]!, cellsOf(r)))
    .map((r) => {
      const c = edits[r.part_type_id]!;
      return {
        partTypeId: r.part_type_id,
        intervalKm: num(c.intervalKm),
        intervalMonths: num(c.intervalMonths),
        makerKm: num(c.makerKm),
        makerMonths: num(c.makerMonths),
      };
    });
}

/** A zero anywhere. No interval is zero long, and the API refuses one. */
export function hasZero(c: CellDraft): boolean {
  return [c.intervalKm, c.intervalMonths, c.makerKm, c.makerMonths].some((v) => v === "0");
}

/**
 * Which of the owner's figures run LONGER than the maker recommends -- the
 * direction worth a warning. Shorter is the owner being careful; longer is
 * the owner stretching a part past what the manual allows. A clock with no
 * figure on either side has nothing to compare.
 */
export function longerThanMaker(c: CellDraft): { km: boolean; months: boolean } {
  const km = num(c.intervalKm);
  const months = num(c.intervalMonths);
  const mKm = num(c.makerKm);
  const mMonths = num(c.makerMonths);
  return {
    km: km !== null && mKm !== null && km > mKm,
    months: months !== null && mMonths !== null && months > mMonths,
  };
}

/** The generic figures, if the row has any and they differ from what is shown. */
export function resetTarget(row: ScheduleRow, c: CellDraft): { km: string; months: string } | null {
  if (row.default_km === null && row.default_months === null) return null;
  const km = str(row.default_km);
  const months = str(row.default_months);
  return km === c.intervalKm && months === c.intervalMonths ? null : { km, months };
}

export function isTracked(c: CellDraft): boolean {
  return c.intervalKm !== "" || c.intervalMonths !== "";
}
