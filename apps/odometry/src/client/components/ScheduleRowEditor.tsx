import { digitsOnly } from "@portals/core/client";
import type { ScheduleRow } from "../api/hooks";
import { formatInterval } from "../lib/format";
import {
  isTracked,
  longerThanMaker,
  resetTarget,
  type CellDraft,
} from "./scheduleDraft";

/**
 * One part in the schedule table: the owner's months and km, then the
 * maker's months and km.
 *
 * The grid is shared with the header in ScheduleTable (SCHEDULE_GRID). On a
 * phone only Part | Months | Km fit, so the maker pair drops to a second line
 * under the part name; from `sm` up, `sm:contents` dissolves that wrapper and
 * the pair takes the last two columns.
 */
export const SCHEDULE_GRID =
  "grid grid-cols-[minmax(0,1fr)_4.5rem_6.5rem] sm:grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_7rem] items-center gap-x-2 gap-y-1";

const CELL =
  "w-full rounded-lg border bg-inset px-2 py-1.5 text-right text-sm tabular-nums " +
  "placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-ink-muted";

export function ScheduleRowEditor({
  row,
  cells,
  dirty,
  onChange,
}: {
  row: ScheduleRow;
  cells: CellDraft;
  dirty: boolean;
  onChange: (next: CellDraft) => void;
}) {
  const tracked = isTracked(cells);
  const longer = longerThanMaker(cells);
  const reset = resetTarget(row, cells);
  const set = (key: keyof CellDraft) => (v: string) => onChange({ ...cells, [key]: digitsOnly(v) });

  const cell = (key: keyof CellDraft, label: string, warn = false, maker = false) => (
    <input
      type="text"
      inputMode="numeric"
      aria-label={`${row.part_name} ${label}`}
      value={cells[key]}
      onChange={(e) => set(key)(e.target.value)}
      placeholder="—"
      className={
        CELL +
        (warn
          ? " border-status-soon-fg text-status-soon-fg"
          : maker
            ? " border-edge text-ink-muted"
            : " border-edge")
      }
    />
  );

  return (
    <li className={SCHEDULE_GRID + " border-t border-edge py-2 first:border-t-0"}>
      <div className="min-w-0">
        <p className={"truncate text-sm " + (tracked ? "font-medium" : "text-ink-faint")}>
          {row.part_name}
          {dirty && <span className="ml-1 text-ink-faint" title="Unsaved">&bull;</span>}
        </p>
        {(longer.km || longer.months) && (
          <p className="text-xs text-status-soon-fg">Longer than the maker recommends</p>
        )}
        {reset && (
          <button
            onClick={() => onChange({ ...cells, intervalKm: reset.km, intervalMonths: reset.months })}
            className="text-left text-xs text-ink-faint underline"
          >
            {tracked ? "Reset to" : "Use"} {formatInterval(row.default_km, row.default_months)}
          </button>
        )}
      </div>
      {cell("intervalMonths", "months", longer.months)}
      {cell("intervalKm", "km", longer.km)}
      <div className="col-span-3 grid grid-cols-[minmax(0,1fr)_4.5rem_6.5rem] items-center gap-x-2 sm:contents">
        <span className="text-right text-xs text-ink-faint sm:hidden">Maker</span>
        {cell("makerMonths", "maker months", false, true)}
        {cell("makerKm", "maker km", false, true)}
      </div>
    </li>
  );
}
