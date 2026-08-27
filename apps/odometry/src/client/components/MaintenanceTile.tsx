import type { MaintenanceRow } from "../api/hooks";
import { STATUS_STYLES } from "./StatusPill";
import { PartIcon } from "./PartIcon";
import { relativeDays, formatKm } from "../lib/format";

/**
 * One part, as a tile. Spec 8.2.
 *
 * This replaces a full-width stacked card. Twenty parts as stacked cards was
 * roughly 2,000px of scrolling on a vehicle with no history, every row
 * repeating the same "No service on record yet" sentence -- a lot of screen
 * for very little information. As tiles the same twenty fit in five rows on a
 * laptop and ten on a phone.
 *
 * The status word is always rendered. The border tint is a second, redundant
 * channel, never the only one (spec 9).
 */
export function MaintenanceTile({
  row,
  onOpen,
}: {
  row: MaintenanceRow;
  onOpen: () => void;
}) {
  const s = STATUS_STYLES[row.status];

  return (
    <button
      onClick={onOpen}
      className={
        // w-full is load-bearing: a <button> shrinks to fit its text even at
        // display:flex, so without it each tile is only as wide as its part
        // name and the grid looks ragged despite equal column tracks.
        "flex h-full w-full flex-col rounded-xl bg-surface p-3 text-left ring-1 transition " +
        "hover:bg-inset focus:outline-none focus:ring-2 focus:ring-ink-muted " +
        s.ring
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span className={"rounded-lg p-1.5 " + s.chip}>
          <PartIcon category={row.part_category} />
        </span>
        <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + s.chip}>
          {s.label}
        </span>
      </div>

      <p className="mt-2 font-medium leading-tight">{row.part_name}</p>

      {/*
        Always two lines, even when the second has nothing to say.
        
        Tiles used to be equalised by auto-rows-fr, which only works within a
        single grid. Now that parts are grouped, each category is its own grid,
        so a group where no part has a due mileage came out shorter than one
        where a part does -- tiles the same size beside each other and a
        different size one heading down. Reserving the line here makes every
        tile the same height by construction, in any grid, at any breakpoint.
      */}
      <p className="mt-1 text-xs text-ink-muted">
        {row.status === "unknown"
          ? // Unmeasured, not overdue. The tile asks for a baseline rather
            // than raising a false alarm on a car that was only just added.
            "No service logged yet"
          : relativeDays(row.days_remaining)}
        <span className="block text-ink-faint">
          {row.status !== "unknown" && row.due_km !== null
            ? `at ${formatKm(row.due_km)}`
            : " "}
        </span>
      </p>

      <p className="mt-auto pt-2 text-[11px] text-ink-faint">
        <Interval row={row} />
      </p>
    </button>
  );
}

/**
 * "Every 5,000 km or 12 months".
 *
 * One number per part, so there is nothing to qualify. This used to tag a
 * value as "(one-off)" when the last service had set an interval different
 * from the vehicle's standing one -- a distinction that only made sense if
 * you already knew two numbers existed, and that mostly read as the app
 * disagreeing with the figure you had just typed.
 */
export function Interval({ row }: { row: MaintenanceRow }) {
  if (row.interval_km === null && row.interval_months === null) return <>No interval set</>;

  const parts = [
    row.interval_km === null ? null : `${row.interval_km.toLocaleString("en-MY")} km`,
    row.interval_months === null ? null : `${row.interval_months} months`,
  ].filter(Boolean);

  return <>Every {parts.join(" or ")}</>;
}
