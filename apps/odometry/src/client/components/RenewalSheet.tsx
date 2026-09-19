import { useState } from "react";
import { parseSen } from "@portals/core";
import { INPUT, DATE_INPUT, Field, Select, Sheet, SheetActions } from "@portals/core/client";
import {
  renewalDocuments,
  useCorrectRenewal,
  useCreateRenewal,
  useDeleteRenewal,
  type Renewal,
  type RenewalDraft,
  type RenewalType,
} from "../api/hooks";
import { RENEWAL_LABELS } from "../lib/renewals";
import { Attachments } from "./Attachments";

/**
 * Two different jobs, kept apart on purpose (invariant 8):
 *
 *  - `new`     -- adding or RENEWING. Always inserts a new row. Renewing
 *                 pre-fills the provider and reference from the previous
 *                 policy, never the dates or the cost: those are the history.
 *  - `correct` -- fixing a typo in the words. Dates and cost are not editable
 *                 here because the server refuses them; a wrong expiry means
 *                 deleting the mistaken row and entering the right one.
 */
export type RenewalSheetMode =
  | { kind: "new"; type: RenewalType | null; previous?: Renewal }
  | { kind: "correct"; renewal: Renewal };

export function RenewalSheet({
  vehicleId,
  mode,
  onClose,
}: {
  vehicleId: string;
  mode: RenewalSheetMode;
  onClose: () => void;
}) {
  const seed = mode.kind === "correct" ? mode.renewal : mode.previous;
  const [type, setType] = useState<RenewalType | "">(
    mode.kind === "correct" ? mode.renewal.type : (mode.type ?? ""),
  );
  const [provider, setProvider] = useState(seed?.provider ?? "");
  const [referenceNo, setReferenceNo] = useState(seed?.referenceNo ?? "");
  const [notes, setNotes] = useState(mode.kind === "correct" ? (mode.renewal.notes ?? "") : "");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [cost, setCost] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = useCreateRenewal(vehicleId);
  const correct = useCorrectRenewal(vehicleId);
  const remove = useDeleteRenewal(vehicleId);

  const costSen = cost.trim() === "" ? undefined : parseSen(cost);
  const datesOk = expiresOn !== "" && (issuedOn === "" || issuedOn <= expiresOn);
  const valid =
    mode.kind === "correct" ||
    (type !== "" && datesOk && (costSen === undefined || (costSen !== null && costSen >= 0)));

  const heading =
    mode.kind === "correct"
      ? `Correct ${RENEWAL_LABELS[mode.renewal.type].toLowerCase()}`
      : mode.previous
        ? `Renew ${RENEWAL_LABELS[mode.previous.type].toLowerCase()}`
        : type
          ? `Add ${RENEWAL_LABELS[type].toLowerCase()}`
          : "Add a renewal";

  function save() {
    if (!valid) return;
    if (mode.kind === "correct") {
      correct.mutate(
        {
          id: mode.renewal.id,
          provider: provider.trim(),
          referenceNo: referenceNo.trim(),
          notes: notes.trim(),
        },
        { onSuccess: onClose },
      );
      return;
    }
    const draft: RenewalDraft = { type: type as RenewalType, expiresOn };
    if (provider.trim()) draft.provider = provider.trim();
    if (referenceNo.trim()) draft.referenceNo = referenceNo.trim();
    if (issuedOn) draft.issuedOn = issuedOn;
    if (costSen !== undefined && costSen !== null) draft.cost = costSen;
    if (notes.trim()) draft.notes = notes.trim();
    // Stay open on success: the next thing the owner has in hand is the
    // certificate itself, so offer to attach it while it is.
    create.mutate(draft, { onSuccess: (r) => setSavedId(r.id) });
  }

  if (savedId) {
    return (
      <Sheet title="Saved" onClose={onClose}>
        <h2 className="pr-9 text-lg font-semibold">Saved</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {RENEWAL_LABELS[type as RenewalType]} recorded, expiring {expiresOn}.
        </p>
        <Attachments
          target={renewalDocuments(savedId)}
          title="Documents"
          emptyHint="Attach the certificate or cover note, if you have it to hand."
          addLabel="Add a document (PDF or photo)"
        />
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-ink py-3 font-medium text-page"
        >
          Done
        </button>
      </Sheet>
    );
  }

  const error = (create.error ?? correct.error ?? remove.error) as Error | null;
  const busy = create.isPending || correct.isPending || remove.isPending;

  return (
    <Sheet title={heading} onClose={onClose}>
      <h2 className="pr-9 text-lg font-semibold">{heading}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {mode.kind === "correct"
          ? "Fix a typo in the words. Dates and cost are history and cannot be changed here."
          : "Renewing adds a new record. The previous one stays as history."}
      </p>

      {mode.kind === "new" && mode.type === null && (
        <Field label="Type">
          <Select
            className="mt-1"
            value={type}
            onChange={(e) => setType(e.target.value as RenewalType | "")}
          >
            <option value="">Choose…</option>
            {(Object.keys(RENEWAL_LABELS) as RenewalType[]).map((t) => (
              <option key={t} value={t}>
                {RENEWAL_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Provider">
          <input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder={type === "road_tax" ? "JPJ / MyEG" : "Etiqa"}
            maxLength={120}
            className={INPUT}
          />
        </Field>
        <Field label="Reference no.">
          <input
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
            placeholder="Policy or cover note no."
            maxLength={60}
            className={INPUT}
          />
        </Field>
      </div>

      {mode.kind === "new" && (
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label="Starts on">
            <input
              type="date"
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
              className={DATE_INPUT}
            />
          </Field>
          <Field label="Expires on">
            <input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className={DATE_INPUT}
            />
          </Field>
          <Field label="Cost (RM)">
            <input
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="90.00"
              className={INPUT + " tabular-nums"}
            />
          </Field>
        </div>
      )}
      {mode.kind === "new" && issuedOn !== "" && expiresOn !== "" && issuedOn > expiresOn && (
        <p className="mt-2 text-sm text-status-overdue-fg">It cannot expire before it starts.</p>
      )}

      <Field label="Notes">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          className={INPUT}
        />
      </Field>

      {error && <p className="mt-3 text-sm text-status-overdue-fg">{error.message}</p>}

      {confirmDelete && mode.kind === "correct" ? (
        <>
          <p className="mt-5 text-sm text-ink-muted">
            Delete this record and its documents? Only for one entered by mistake &mdash; a real
            past renewal is the cost history the forecast is built from.
          </p>
          <SheetActions
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => remove.mutate(mode.renewal.id, { onSuccess: onClose })}
            confirmLabel="Delete"
            busyLabel="Deleting…"
            busy={remove.isPending}
            tone="danger"
          />
        </>
      ) : (
        <>
          <SheetActions
            onCancel={onClose}
            onConfirm={save}
            confirmLabel="Save"
            busy={busy}
            disabled={!valid}
          />
          {mode.kind === "correct" && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="mt-3 w-full py-2 text-sm text-ink-faint hover:text-status-overdue-fg"
            >
              Entered by mistake? Delete it
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}
