import { useState } from "react";
import { Sheet, SheetActions, INPUT, Field } from "@portals/core/client";
import { parseSen } from "@portals/core";
import {
  useCategories,
  useVehicles,
  useCreateTransaction,
  useUpdateTransaction,
  type Transaction,
} from "../api/hooks";
import {
  initialFormState,
  applyCategoryChange,
  applyDirectionChange,
  showsVehicle,
  type FormState,
} from "@shared/categoryRules";

/**
 * The entry form. The reason this project exists.
 *
 * The three interaction rules it implements are NOT written here -- they live
 * as pure functions in @shared/categoryRules and are covered by
 * tests/form-logic.test.ts. This component holds state and paints; it does not
 * decide. That split is deliberate: the rules are the part that is wrong in a
 * way nobody notices, and behaviour reachable only by clicking is behaviour
 * that gets verified once and then drifts.
 */
export function TransactionSheet({
  today,
  existing,
  onClose,
}: {
  today: string;
  existing?: Transaction;
  onClose: () => void;
}) {
  const editing = existing !== undefined;
  const categories = useCategories();
  const vehicles = useVehicles();

  const create = useCreateTransaction();
  const update = useUpdateTransaction(existing?.id ?? "");
  const mutation = editing ? update : create;

  const [form, setForm] = useState<FormState>(() =>
    existing
      ? {
          categoryCode: existing.categoryCode,
          direction: existing.direction,
          vehicleId: existing.vehicleId,
          // An existing row's direction is a decision already made, so the
          // category must not overwrite it when the user edits something else.
          directionTouched: true,
        }
      : initialFormState(),
  );

  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [amount, setAmount] = useState(
    existing ? (existing.amountSen / 100).toFixed(2) : "",
  );
  const [item, setItem] = useState(existing?.item ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [occurredOn, setOccurredOn] = useState(existing?.occurredOn ?? today);

  const amountSen = parseSen(amount);
  const valid =
    occurredOn !== "" &&
    item.trim() !== "" &&
    categoryId !== "" &&
    amountSen !== null &&
    amountSen > 0;

  function pickCategory(id: string) {
    setCategoryId(id);
    const code = categories.data?.find((c) => c.id === id)?.code ?? null;
    // Rules 1 and 2 both live in here.
    setForm((f) => applyCategoryChange(f, code));
  }

  function save() {
    if (!valid || amountSen === null) return;

    const draft = {
      occurredOn,
      item: item.trim(),
      description: description.trim() || null,
      categoryId,
      vehicleId: form.vehicleId,
      amountSen,
      direction: form.direction,
    };

    mutation.mutate(draft, { onSuccess: onClose });
  }

  const vehicleVisible = showsVehicle(form.categoryCode);

  return (
    <Sheet title={editing ? "Edit entry" : "New entry"} onClose={onClose}>
      {/*
        Direction leads the form, per spec 8: `out` is the overwhelming
        majority, so a miscategorised inflow should be visually obvious rather
        than buried in a dropdown.
      */}
      <div className="grid grid-cols-2 gap-3">
        {(["out", "in"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setForm((f) => applyDirectionChange(f, d))}
            aria-pressed={form.direction === d}
            className={
              "rounded-xl border px-4 py-4 text-base font-semibold transition-colors " +
              (form.direction === d
                ? d === "out"
                  ? "border-status-overdue-fg bg-status-overdue-bg text-status-overdue-fg"
                  : "border-status-ok-fg bg-status-ok-bg text-status-ok-fg"
                : "border-edge bg-inset text-ink-muted hover:text-ink")
            }
          >
            {d === "out" ? "Money out" : "Money in"}
          </button>
        ))}
      </div>

      <Field label="Amount">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint">
            RM
          </span>
          <input
            className={INPUT + " pl-12 tabular-nums text-lg"}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            // Strips the minus sign entirely. Magnitude and direction are
            // separate by design, so a negative amount is not a refund -- it
            // is a bug, and the CHECK constraint would reject it anyway.
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
      </Field>

      <Field label="Item">
        <input
          className={INPUT}
          placeholder="Motorcycle fuel"
          maxLength={120}
          value={item}
          onChange={(e) => setItem(e.target.value)}
        />
      </Field>

      <Field label="Category">
        <select className={INPUT} value={categoryId} onChange={(e) => pickCategory(e.target.value)}>
          <option value="">Choose one</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      {/*
        Rule 2's visible half. The value is cleared by applyCategoryChange, not
        here -- unmounting a control must never be the thing that decides what
        gets submitted.
      */}
      {vehicleVisible && (
        <Field label="Vehicle">
          <select
            className={INPUT}
            value={form.vehicleId ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value || null }))}
          >
            <option value="">No particular vehicle</option>
            {vehicles.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nickname}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Date">
        <input
          className={INPUT}
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
        />
      </Field>

      <Field label="Description">
        <input
          className={INPUT}
          placeholder="Optional"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      {mutation.isError && (
        <p className="mt-2 text-sm text-status-overdue-fg">{(mutation.error as Error).message}</p>
      )}

      <SheetActions
        onCancel={onClose}
        onConfirm={save}
        confirmLabel={editing ? "Save changes" : "Add entry"}
        busy={mutation.isPending}
        disabled={!valid}
      />
    </Sheet>
  );
}
