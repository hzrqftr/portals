import { formatSen } from "@portals/core";

/**
 * The two read-only pieces of ServiceSheet, split out to keep that component
 * near the size guide once it grew an edit mode.
 */

/**
 * Spec 8.4 asks the save to confirm which clocks were reset. Saying "none"
 * plainly matters more than saying "two": a visit logged without line items
 * resets nothing by design, and the owner needs to see that now rather than
 * discover it as a stale due date months later.
 *
 * THREE CASES, NOT TWO, and the third is why this was rewritten.
 *
 * Until 2026-09-19 this listed every part on the visit under "Clocks reset",
 * because `parts` and "parts that set a schedule" were the same list for as
 * long as every part type in the catalogue carried an interval. `pt_tps`
 * (migration 0016) is the first that does not -- a sensor is replaced when it
 * fails, not on a schedule -- so it was announced as resetting a clock it
 * never touched. Caught on production, correcting a real record.
 *
 * `scheduled` therefore comes from `partsResettingAClock`: the parts that are
 * on the schedule, plus any this visit put on it. `changed` is the parts whose
 * schedule this visit changed -- only ever by the owner pressing a button on
 * the form (2026-09-20), so it is usually empty and said plainly when not.
 */
export function SavedConfirmation({
  parts,
  scheduled,
  changed,
  editing,
  attachmentWarning,
  onClose,
}: {
  /** Every part on the visit. Only distinguishes "some" from "none". */
  parts: string[];
  /** The subset that reset a maintenance clock. */
  scheduled: string[];
  /** The subset whose schedule this visit changed. */
  changed: string[];
  editing: boolean;
  /**
   * Set when the record saved but a receipt did not upload. Shown rather than
   * swallowed, and shown WITHOUT undoing the save: discarding a correctly
   * entered service because a photo failed is the worse outcome of the two.
   */
  attachmentWarning?: string | null;
  onClose: () => void;
}) {
  const unscheduled = parts.filter((p) => !scheduled.includes(p));

  return (
    <div>
      <h2 className="text-lg font-semibold">{editing ? "Service updated" : "Service saved"}</h2>
      {attachmentWarning && (
        <p className="mt-2 rounded-lg bg-status-soon-bg px-3 py-2 text-sm text-status-soon-fg">
          {attachmentWarning}
        </p>
      )}
      {parts.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          No parts are listed on this visit, so it resets no maintenance clock. Add the
          parts to the record if it included replacements.
        </p>
      ) : scheduled.length === 0 ? (
        // Parts WERE recorded; none of them is on a schedule. Saying "no parts
        // are listed" here would be plainly false, and saying "clocks reset"
        // above an empty list would be worse.
        <>
          <p className="mt-2 text-sm text-ink-muted">
            Recorded, but no maintenance clock changed &mdash; nothing on this visit is
            tracked on a schedule:
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-muted">
            {parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-faint">
            Give one an interval on the Schedule tab if you want it tracked.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            {editing ? "Clocks now set by this visit:" : "Clocks reset:"}
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-muted">
            {scheduled.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {unscheduled.length > 0 && (
            // Named rather than omitted: a part that vanishes from this screen
            // reads as a part that failed to save.
            <p className="mt-2 text-xs text-ink-faint">
              Also recorded, on no schedule: {unscheduled.join(", ")}.
            </p>
          )}
          {changed.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Schedule changed for: {changed.join(", ")}.
            </p>
          )}
          {editing && (
            // The one consequence of an edit that looks like a bug: nothing
            // stores what the schedule was before a visit changed it, so a
            // part removed from this visit keeps that schedule.
            <p className="mt-3 text-xs text-ink-faint">
              Removing a part from a visit does not change its schedule. Change it on the
              Schedule tab.
            </p>
          )}
        </>
      )}
      <button
        onClick={onClose}
        className="mt-5 w-full rounded-xl bg-ink py-3 font-medium text-page"
      >
        Done
      </button>
    </div>
  );
}

/** One line of the running cost breakdown. Read-only by design. */
export function Total({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className={"flex justify-between gap-4" + (strong ? " font-medium text-ink" : "")}>
      <dt className={strong ? "" : "text-ink-faint"}>{label}</dt>
      <dd className="tabular-nums">{formatSen(value)}</dd>
    </div>
  );
}
