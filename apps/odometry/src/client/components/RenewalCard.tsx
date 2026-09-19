import { formatSen } from "../lib/format";
import { RENEWAL_LABELS, relativeExpiry } from "../lib/renewals";
import {
  renewalDocuments,
  type Renewal,
  type RenewalStatus,
  type RenewalType,
} from "../api/hooks";
import { StatusPill, STATUS_STYLES } from "./StatusPill";
import { Attachments } from "./Attachments";

/**
 * One renewal type on one vehicle: the ACTIVE record, or a prompt to add one.
 *
 * `status` comes from the server's status query, not from comparing dates
 * here -- "today" is the owner's calendar date in their timezone, and only the
 * server computes it (invariant 5).
 */
export function RenewalCard({
  type,
  active,
  status,
  onAdd,
  onRenew,
  onCorrect,
}: {
  type: RenewalType;
  active: Renewal | undefined;
  status: RenewalStatus | undefined;
  onAdd: () => void;
  onRenew: (previous: Renewal) => void;
  onCorrect: (renewal: Renewal) => void;
}) {
  const label = RENEWAL_LABELS[type];

  if (!active || !status) {
    // A setup prompt, not an alert (spec 6.3): dashed, neutral, no pill.
    return (
      <div className="rounded-xl border border-dashed border-edge p-4">
        <h3 className="font-medium text-ink">{label}</h3>
        <p className="mt-1 text-sm text-ink-faint">Nothing recorded yet.</p>
        <button
          onClick={onAdd}
          className="mt-3 w-full rounded-xl border border-edge py-3 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Add {label.toLowerCase()}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-edge bg-surface p-4 ring-1 ${STATUS_STYLES[status.status].ring}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium text-ink">{label}</h3>
        <StatusPill status={status.status} />
      </div>
      <p className="mt-1 text-sm text-ink">
        {relativeExpiry(status.days_remaining)}
        <span className="text-ink-faint"> &middot; {active.expiresOn}</span>
      </p>

      <dl className="mt-3 space-y-1 text-sm">
        <Row label="Provider" value={active.provider} />
        <Row label="Reference" value={active.referenceNo} />
        <Row label="Cost" value={active.cost === null ? null : formatSen(active.cost)} />
      </dl>
      {active.notes && <p className="mt-2 text-sm text-ink-muted">{active.notes}</p>}

      <Attachments
        target={renewalDocuments(active.id)}
        title="Documents"
        emptyHint="No certificate attached."
        addLabel="Add a document (PDF or photo)"
      />

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onRenew(active)}
          className="flex-1 rounded-xl bg-ink py-3 text-sm font-medium text-page"
        >
          Renew
        </button>
        <button
          onClick={() => onCorrect(active)}
          className="rounded-xl border border-edge px-4 py-3 text-sm text-ink-muted hover:text-ink"
        >
          Correct
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className={"min-w-0 truncate " + (value === null ? "text-ink-faint" : "text-ink")}>
        {value ?? "Not set"}
      </dd>
    </div>
  );
}
