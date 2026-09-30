import { useState } from "react";
import { DATE_INPUT, Field, INPUT, Sheet, SheetActions } from "@portals/core/client";
import { parseSen, senToInput } from "@portals/core";
import {
  useCreateFundEntry,
  useDeleteFundEntry,
  usePatchFundEntry,
  type FundEntry,
} from "../../api/hooks";

/**
 * Money in or out of the pot that is not a contribution: a family dinner, a
 * homestay deposit, the deposit coming back.
 *
 * Direction leads, as on the ledger's entry sheet, defaulting to out -- most
 * rows are spending, and a refund booked as spending should look wrong at a
 * glance. There is no category: the pot is a short list read top to bottom,
 * and the workbook never had one.
 */
export function FundEntrySheet({
  today,
  existing,
  onClose,
}: {
  today: string;
  existing?: FundEntry;
  onClose: () => void;
}) {
  const editing = existing !== undefined;
  const create = useCreateFundEntry();
  const patch = usePatchFundEntry();
  const del = useDeleteFundEntry();
  const mutation = editing ? patch : create;

  const [direction, setDirection] = useState<"in" | "out">(existing?.direction ?? "out");
  const [amount, setAmount] = useState(existing ? senToInput(existing.amountSen) : "");
  const [item, setItem] = useState(existing?.item ?? "");
  const [occurredOn, setOccurredOn] = useState(existing?.occurredOn ?? today);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const amountSen = parseSen(amount);
  const valid =
    amount.trim() !== "" && amountSen !== null && amountSen >= 0 && item.trim() !== "" && occurredOn !== "";

  function save() {
    if (!valid || amountSen === null) return;
    const draft = {
      occurredOn,
      item: item.trim(),
      description: description.trim() || null,
      amountSen,
      direction,
    };
    if (existing) patch.mutate({ id: existing.id, patch: draft }, { onSuccess: onClose });
    else create.mutate(draft, { onSuccess: onClose });
  }

  const title = editing ? "Edit pot entry" : "Spending or other money";

  return (
    <Sheet title={title} onClose={onClose}>
      <h2 className="pr-9 text-lg font-semibold">{title}</h2>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {(["out", "in"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            aria-pressed={direction === d}
            className={
              "rounded-xl border px-4 py-4 text-base font-semibold transition-colors " +
              (direction === d
                ? d === "out"
                  ? "border-status-overdue-fg bg-status-overdue-bg text-status-overdue-fg"
                  : "border-status-ok-fg bg-status-ok-bg text-status-ok-fg"
                : "border-edge bg-inset text-ink-muted hover:text-ink")
            }
          >
            {d === "out" ? "Out of the pot" : "Into the pot"}
          </button>
        ))}
      </div>

      <Field label="Amount">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint">
            RM
          </span>
          <input
            className={INPUT + " pl-12 text-lg tabular-nums"}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
      </Field>

      <Field label="What for">
        <input
          className={INPUT}
          placeholder="Dinner - Cili Kampung"
          maxLength={120}
          value={item}
          onChange={(e) => setItem(e.target.value)}
        />
      </Field>

      <Field label="Date">
        <input
          className={DATE_INPUT}
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
        />
      </Field>

      <Field label="Note">
        <input
          className={INPUT}
          placeholder="Optional"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      {(mutation.isError || del.isError) && (
        <p className="mt-2 text-sm text-status-overdue-fg">
          {((mutation.error ?? del.error) as Error).message}
        </p>
      )}

      <SheetActions
        onCancel={onClose}
        onConfirm={save}
        confirmLabel={editing ? "Save changes" : "Add"}
        busy={mutation.isPending}
        disabled={!valid}
      />

      {existing && (
        <button
          type="button"
          onClick={() =>
            confirmDelete ? del.mutate(existing.id, { onSuccess: onClose }) : setConfirmDelete(true)
          }
          disabled={del.isPending}
          className={
            "mt-3 w-full rounded-xl py-3 text-sm " +
            (confirmDelete
              ? "bg-status-overdue-fg font-medium text-page"
              : "border border-edge text-ink-muted hover:text-status-overdue-fg")
          }
        >
          {confirmDelete ? `Confirm: delete "${existing.item}"` : "Delete"}
        </button>
      )}
    </Sheet>
  );
}
