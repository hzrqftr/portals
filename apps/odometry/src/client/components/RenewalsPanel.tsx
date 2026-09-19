import { useState } from "react";
import {
  renewalDocuments,
  useRenewals,
  useRenewalStatus,
  type Renewal,
  type RenewalType,
} from "../api/hooks";
import { formatSen } from "../lib/format";
import { CORE_RENEWALS, OTHER_RENEWALS, RENEWAL_LABELS } from "../lib/renewals";
import { RenewalCard } from "./RenewalCard";
import { RenewalSheet, type RenewalSheetMode } from "./RenewalSheet";
import { Attachments } from "./Attachments";

/**
 * Spec 8.2's Renewals section: the active record per type, then the history.
 *
 * Road tax and insurance always get a card. Inspection and warranty appear
 * once one has been added -- most vehicles never have either, and four empty
 * cards would make the two that matter harder to see.
 */
export function RenewalsPanel({ vehicleId }: { vehicleId: string }) {
  const history = useRenewals(vehicleId);
  const status = useRenewalStatus(vehicleId);
  const [sheet, setSheet] = useState<RenewalSheetMode | null>(null);

  if (history.isLoading || status.isLoading) {
    return <p className="mt-4 text-ink-muted">Loading&hellip;</p>;
  }

  const rows = history.data ?? [];
  const statuses = status.data ?? [];
  const activeIds = new Set(statuses.map((s) => s.id));
  const types: RenewalType[] = [
    ...CORE_RENEWALS,
    ...OTHER_RENEWALS.filter((t) => statuses.some((s) => s.type === t)),
  ];
  const past = rows.filter((r) => !activeIds.has(r.id));

  return (
    <section className="mt-4">
      <div className="grid gap-4 md:grid-cols-2">
        {types.map((type) => {
          const s = statuses.find((x) => x.type === type);
          return (
            <RenewalCard
              key={type}
              type={type}
              status={s}
              active={s && rows.find((r) => r.id === s.id)}
              onAdd={() => setSheet({ kind: "new", type })}
              onRenew={(previous) => setSheet({ kind: "new", type, previous })}
              onCorrect={(renewal) => setSheet({ kind: "correct", renewal })}
            />
          );
        })}
      </div>

      <button
        onClick={() => setSheet({ kind: "new", type: null })}
        className="mt-4 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:text-ink"
      >
        Add another (inspection, warranty…)
      </button>

      {past.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium uppercase tracking-wider text-ink-faint">History</h3>
          <ul className="mt-2 space-y-2">
            {past.map((r) => (
              <PastRow
                key={r.id}
                renewal={r}
                onCorrect={() => setSheet({ kind: "correct", renewal: r })}
              />
            ))}
          </ul>
        </div>
      )}

      {sheet && (
        <RenewalSheet vehicleId={vehicleId} mode={sheet} onClose={() => setSheet(null)} />
      )}
    </section>
  );
}

/**
 * A superseded renewal. Its documents load only when opened, so a long
 * history does not fire one request per row.
 */
function PastRow({ renewal, onCorrect }: { renewal: Renewal; onCorrect: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-edge bg-surface">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left text-sm"
      >
        <span className="min-w-0 flex-1">
          <span className="text-ink">{RENEWAL_LABELS[renewal.type]}</span>
          <span className="text-ink-faint"> &middot; until {renewal.expiresOn}</span>
          {renewal.provider && (
            <span className="block truncate text-ink-faint">{renewal.provider}</span>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-ink-muted">
          {renewal.cost === null ? "" : formatSen(renewal.cost)}
        </span>
      </button>
      {open && (
        <div className="border-t border-edge px-3 pb-3">
          <Attachments
            target={renewalDocuments(renewal.id)}
            title="Documents"
            emptyHint="No certificate attached."
            addLabel="Add a document (PDF or photo)"
          />
          <button
            onClick={onCorrect}
            className="mt-3 rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            Correct
          </button>
        </div>
      )}
    </li>
  );
}
