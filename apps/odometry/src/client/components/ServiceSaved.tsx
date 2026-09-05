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
 */
export function SavedConfirmation({
  parts,
  editing,
  onClose,
}: {
  parts: string[];
  editing: boolean;
  onClose: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{editing ? "Service updated" : "Service saved"}</h2>
      {parts.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          No parts are listed on this visit, so it resets no maintenance clock. Add the
          parts to the record if it included replacements.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            {editing ? "Clocks now set by this visit:" : "Clocks reset:"}
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-muted">
            {parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {editing && (
            // The one consequence of an edit that looks like a bug. Invariant
            // 6: the last service sets the vehicle's interval, and there is no
            // stored previous value to put back, so a part removed from this
            // visit keeps the schedule the visit gave it. Changing that is the
            // maintenance tab's job.
            <p className="mt-3 text-xs text-ink-faint">
              A part removed from this visit keeps the interval this visit set for it.
              Change it on the Maintenance tab.
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
