import { formatSen } from "@portals/core";
import type { FundEntry } from "../../api/hooks";
import { monthLabel } from "../StatTiles";

/**
 * Everything in the pot that is not a contribution, newest first -- one line
 * per payment, as the workbook had it. Contributions live in the grid and are
 * not repeated here.
 *
 * Magnitude with a sign glyph and colour; never a negative number on screen.
 */
export function FundEntryList({
  entries,
  onEdit,
}: {
  entries: FundEntry[];
  onEdit: (entry: FundEntry) => void;
}) {
  if (entries.length === 0) {
    return <p className="mt-4 text-sm text-ink-muted">Nothing spent from the pot yet.</p>;
  }

  return (
    <ul className="mt-4 divide-y divide-edge rounded-xl border border-edge bg-surface">
      {entries.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onEdit(e)}
            className="flex w-full items-baseline gap-3 px-4 py-3 text-left hover:bg-inset"
          >
            {/* Month, not day: the workbook dated most rows to the 1st. */}
            <span className="w-24 shrink-0 text-sm text-ink-faint">
              {monthLabel(e.occurredOn.slice(0, 7))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{e.item}</span>
              {e.description && (
                <span className="block truncate text-xs text-ink-faint">{e.description}</span>
              )}
            </span>
            <span
              className={
                "shrink-0 tabular-nums " +
                (e.direction === "out" ? "text-status-overdue-fg" : "text-status-ok-fg")
              }
            >
              {e.direction === "out" ? "−" : "+"}
              {formatSen(e.amountSen)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
