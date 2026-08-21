import { useState } from "react";
import type { MaintenanceRow } from "../api/hooks";
import { MaintenanceTile } from "./MaintenanceTile";
import { PartIcon } from "./PartIcon";
import { categoryLabel, groupByCategory } from "../lib/partCategories";

/**
 * The maintenance grid, grouped by part category. Spec 8.2.
 *
 * One flat grid worked at nineteen parts. At forty-odd it is a wall, and
 * finding one specific part means reading every tile -- so parts are grouped
 * under headings you can collapse, and "where is the absorber" becomes "look
 * under Suspension".
 *
 * Anything overdue or due soon is pulled OUT of its group and pinned above
 * them all. Grouping is for browsing; the attention list is the reason the app
 * exists, and burying an overdue brake pad inside a collapsed "Brakes" section
 * would trade the whole point of the page for tidiness.
 *
 * Presentation only, over an array already in memory. No aggregation moves
 * into JS and invariant 4 is untouched.
 */
export function MaintenanceGroups({
  rows,
  onOpen,
}: {
  rows: MaintenanceRow[];
  onOpen: (row: MaintenanceRow) => void;
}) {
  // Collapsed rather than expanded state, so a category the owner has never
  // touched -- including one added by a future migration -- starts open.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const needsAttention = (r: MaintenanceRow) =>
    r.status === "overdue" || r.status === "due_soon";

  const attention = rows.filter(needsAttention);
  const groups = groupByCategory(
    rows.filter((r) => !needsAttention(r)),
    (r) => r.part_category,
  );

  const toggle = (category: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(category)) next.add(category);
      return next;
    });

  return (
    <>
      {attention.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-status-overdue-fg">
            Needs attention
            <span className="ml-1.5 text-ink-faint">{attention.length}</span>
          </h3>
          <TileGrid rows={attention} onOpen={onOpen} />
        </section>
      )}

      {groups.map(({ category, rows: groupRows }) => {
        const isCollapsed = collapsed.has(category);
        return (
          <section key={category} className="mt-6">
            <button
              onClick={() => toggle(category)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 border-b border-edge pb-2 text-left"
            >
              <span className="text-ink-faint">
                <PartIcon category={category} className="h-4 w-4" />
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                {categoryLabel(category)}
              </span>
              <span className="text-xs text-ink-faint">{groupRows.length}</span>
              <Chevron open={!isCollapsed} />
            </button>

            {!isCollapsed && <TileGrid rows={groupRows} onOpen={onOpen} />}
          </section>
        );
      })}
    </>
  );
}

/**
 * The tile grid itself, identical in every group so tiles stay the same size
 * across the whole page rather than each group sizing to its own contents.
 * auto-rows-fr equalises the row heights; w-full on the button inside the tile
 * does the same for widths.
 */
function TileGrid({
  rows,
  onOpen,
}: {
  rows: MaintenanceRow[];
  onOpen: (row: MaintenanceRow) => void;
}) {
  return (
    <ul className="mt-3 grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {rows.map((row) => (
        <li key={row.interval_id} className="h-full">
          <MaintenanceTile row={row} onOpen={() => onOpen(row)} />
        </li>
      ))}
    </ul>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={"ml-auto h-4 w-4 shrink-0 text-ink-faint transition " + (open ? "rotate-90" : "")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 5l5 5-5 5" />
    </svg>
  );
}
