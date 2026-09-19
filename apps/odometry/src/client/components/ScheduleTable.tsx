import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { INPUT } from "@portals/core/client";
import { useSaveSchedule, useSchedule, type ScheduleRow } from "../api/hooks";
import { categoryLabel, groupByCategory } from "../lib/partCategories";
import { CustomPartDialog } from "./CustomPartDialog";
import { SCHEDULE_GRID, ScheduleRowEditor } from "./ScheduleRowEditor";
import {
  changedRows,
  currentCells,
  hasZero,
  isTracked,
  type ScheduleEdits,
} from "./scheduleDraft";

/**
 * The vehicle's maintenance schedule as one table (spec 8.2, 2026-09-20).
 *
 * Every part that fits the vehicle, down the side; the owner's months and km;
 * the manufacturer's months and km beside them for reference. A blank pair
 * means the part is not tracked. This is the one place the schedule is set --
 * a logged service changes it only if the owner presses "Change to ..." on
 * the service form.
 *
 * Nothing saves until "Save schedule": a table of forty rows edited cell by
 * cell is easier to trust when the changes are gathered, counted, and then
 * written together (the API batches them atomically).
 */
export function ScheduleTable({ vehicleId }: { vehicleId: string }) {
  const schedule = useSchedule(vehicleId);
  const save = useSaveSchedule(vehicleId);
  const qc = useQueryClient();
  const [edits, setEdits] = useState<ScheduleEdits>({});
  const [query, setQuery] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);

  if (schedule.isLoading) return <p className="mt-4 text-sm text-ink-faint">Loading&hellip;</p>;
  const rows = schedule.data ?? [];

  const changes = changedRows(rows, edits);
  const invalid = rows.some((r) => edits[r.part_type_id] && hasZero(edits[r.part_type_id]!));
  const q = query.trim().toLowerCase();
  const matches = (r: ScheduleRow) => q === "" || r.part_name.toLowerCase().includes(q);

  const fitting = rows.filter((r) => r.applies === 1 && matches(r));
  const misfits = rows.filter((r) => r.applies === 0 && matches(r));
  const trackedCount = rows.filter((r) => isTracked(currentCells(r, edits))).length;

  const editor = (r: ScheduleRow) => (
    <ScheduleRowEditor
      key={r.part_type_id}
      row={r}
      cells={currentCells(r, edits)}
      dirty={changes.some((c) => c.partTypeId === r.part_type_id)}
      onChange={(next) => setEdits((prev) => ({ ...prev, [r.part_type_id]: next }))}
    />
  );

  return (
    <section className="mt-4">
      <p className="text-sm text-ink-muted">
        Tracking {trackedCount} of {rows.length} parts. Whichever comes first &mdash; months or
        km &mdash; makes a part due. Leave both blank to stop tracking a part. The maker columns
        are for the manual&rsquo;s figures, to compare against; nothing is due from them.
      </p>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search parts…"
        className={INPUT + " mt-3"}
      />

      <div className={SCHEDULE_GRID + " mt-4 hidden px-3 text-xs text-ink-faint sm:grid"}>
        <span>Part</span>
        <span className="text-right">Months</span>
        <span className="text-right">Km</span>
        <span className="text-right">Maker mo.</span>
        <span className="text-right">Maker km</span>
      </div>
      <div className={SCHEDULE_GRID + " mt-4 px-3 text-xs text-ink-faint sm:hidden"}>
        <span>Part</span>
        <span className="text-right">Months</span>
        <span className="text-right">Km</span>
      </div>

      {groupByCategory(fitting, (r) => r.part_category).map((group) => (
        <div key={group.category} className="mt-3 rounded-xl border border-edge bg-surface px-3 py-1">
          <h3 className="pt-2 text-xs font-medium uppercase tracking-wider text-ink-faint">
            {categoryLabel(group.category)}
          </h3>
          <ul>{group.rows.map(editor)}</ul>
        </div>
      ))}

      {misfits.length > 0 && (
        // Tracked from before the vehicle's fuel type changed. Listed so they
        // can be cleared, rather than left on the schedule where nothing on
        // screen would say they no longer belong.
        <div className="mt-3 rounded-xl border border-status-soon-fg/40 bg-surface px-3 py-1">
          <h3 className="pt-2 text-xs font-medium uppercase tracking-wider text-status-soon-fg">
            No longer fits this vehicle&rsquo;s fuel type
          </h3>
          <p className="text-xs text-ink-faint">Clear both figures to stop tracking.</p>
          <ul>{misfits.map(editor)}</ul>
        </div>
      )}

      {q !== "" && fitting.length + misfits.length === 0 && (
        <p className="mt-4 text-sm text-ink-muted">No parts match &ldquo;{query.trim()}&rdquo;.</p>
      )}

      <div className="mt-4">
        {addingCustom ? (
          <CustomPartDialog
            onCreated={() => {
              setAddingCustom(false);
              qc.invalidateQueries({ queryKey: ["schedule", vehicleId] });
            }}
            onCancel={() => setAddingCustom(false)}
          />
        ) : (
          <button
            onClick={() => setAddingCustom(true)}
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Add a part that is not listed
          </button>
        )}
      </div>

      {(changes.length > 0 || save.isError) && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-edge bg-page/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {save.isError && (
            <p className="mb-2 text-sm text-status-overdue-fg">{(save.error as Error).message}</p>
          )}
          {invalid && (
            <p className="mb-2 text-sm text-status-overdue-fg">
              An interval cannot be 0. Leave the cell blank instead.
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-muted">
              {changes.length} unsaved change{changes.length === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEdits({});
                  save.reset();
                }}
                className="rounded-xl border border-edge px-4 py-2 text-sm text-ink-muted hover:text-ink"
              >
                Discard
              </button>
              <button
                onClick={() => save.mutate(changes, { onSuccess: () => setEdits({}) })}
                disabled={invalid || changes.length === 0 || save.isPending}
                className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-page disabled:opacity-40"
              >
                {save.isPending ? "Saving…" : "Save schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
