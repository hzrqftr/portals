import { useState } from "react";
import { Field, INPUT, Select, Sheet, SheetActions } from "@portals/core/client";
import { parseSen } from "@portals/core";
import {
  useCategories,
  useVehicles,
  useCreateRecurring,
  usePatchRecurring,
  type RecurringRule,
} from "../api/hooks";
import {
  initialFormState,
  applyCategoryChange,
  applyDirectionChange,
  showsVehicle,
  isUnusualDirection,
  partitionByDirection,
  type FormState,
} from "@shared/categoryRules";
import { ScheduleFields, type ScheduleValue } from "./ScheduleFields";

/**
 * Declaring a recurring entry.
 *
 * The transaction half is deliberately the same shape and the same rules as
 * TransactionSheet -- the category picker REORDERS by direction and never
 * filters, and hiding the vehicle field clears it -- because what this
 * produces is a transaction. Those rules live in @shared/categoryRules and are
 * covered by tests/form-logic.test.ts; this component holds state and paints.
 *
 * There is no date field. The schedule supplies it.
 */
export function RecurringSheet({
  today,
  existing,
  onClose,
}: {
  today: string;
  existing?: RecurringRule;
  onClose: () => void;
}) {
  const editing = existing !== undefined;
  const categories = useCategories();
  const vehicles = useVehicles();

  const create = useCreateRecurring();
  const patch = usePatchRecurring();
  const mutation = editing ? patch : create;

  const [form, setForm] = useState<FormState>(() =>
    existing
      ? {
          categoryCode: existing.categoryCode,
          direction: existing.direction,
          vehicleId: existing.vehicleId,
          // An existing rule's direction is a decision already made.
          directionTouched: true,
        }
      : initialFormState(),
  );

  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [amount, setAmount] = useState(existing ? (existing.amountSen / 100).toFixed(2) : "");
  const [item, setItem] = useState(existing?.item ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [schedule, setSchedule] = useState<ScheduleValue>(() => ({
    intervalMonths: existing?.intervalMonths ?? 1,
    dayOfMonth: existing?.dayOfMonth ?? Number(today.slice(8, 10)),
    // A NEW rule cannot start before today -- forward-only, enforced by the
    // server as well. An EXISTING one keeps whatever it has, including a start
    // now in the past, which is normal for a rule that has been running.
    startsOn: existing?.startsOn ?? today,
    endsOn: existing?.endsOn ?? null,
  }));

  const amountSen = parseSen(amount);
  const valid =
    item.trim() !== "" &&
    categoryId !== "" &&
    // A blank amount is a slip; a typed 0 is a statement. The owner's history
    // holds RM 0.00 water bills on purpose, and a recurring bill that is
    // sometimes zero is the same fact. The guard is on emptiness, not value.
    amount.trim() !== "" &&
    amountSen !== null &&
    amountSen >= 0 &&
    schedule.startsOn !== "" &&
    (schedule.endsOn === null || schedule.endsOn >= schedule.startsOn);

  function pickCategory(id: string) {
    setCategoryId(id);
    const code = categories.data?.find((c) => c.id === id)?.code ?? null;
    setForm((f) => applyCategoryChange(f, code));
  }

  function save() {
    if (!valid || amountSen === null) return;

    const draft = {
      item: item.trim(),
      description: description.trim() || null,
      categoryId,
      vehicleId: form.vehicleId,
      amountSen,
      direction: form.direction,
      intervalMonths: schedule.intervalMonths,
      dayOfMonth: schedule.dayOfMonth,
      startsOn: schedule.startsOn,
      endsOn: schedule.endsOn,
    };

    if (editing) {
      patch.mutate({ id: existing.id, patch: draft }, { onSuccess: onClose });
    } else {
      create.mutate(draft, { onSuccess: onClose });
    }
  }

  const vehicleVisible = showsVehicle(form.categoryCode);
  const { usual, other } = partitionByDirection(categories.data ?? [], form.direction);
  const unusual = isUnusualDirection(form);
  const categoryName = categories.data?.find((c) => c.id === categoryId)?.name;

  return (
    <Sheet title={editing ? "Edit recurring entry" : "New recurring entry"} onClose={onClose} wide>
      {/* pr-9 keeps clear of Sheet's zero-height sticky close button. */}
      <h2 className="pr-9 text-lg font-semibold">
        {editing ? "Edit recurring entry" : "New recurring entry"}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        This posts itself into the ledger on each due date.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
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

      {unusual && categoryName && (
        <p className="mt-2 text-sm text-ink-faint">
          Unusual for {categoryName} — saving anyway is fine.
        </p>
      )}

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
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
      </Field>

      <Field label="Item">
        <input
          className={INPUT}
          placeholder="Personal insurance"
          maxLength={120}
          value={item}
          onChange={(e) => setItem(e.target.value)}
        />
      </Field>

      <Field label="Category">
        {/* Reordered by direction, never filtered. See categoryRules. */}
        <Select className="mt-1" value={categoryId} onChange={(e) => pickCategory(e.target.value)}>
          <option value="">Choose one</option>
          <optgroup label={form.direction === "in" ? "Usually money in" : "Usually money out"}>
            {usual.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other">
            {other.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>

      {vehicleVisible && (
        <Field label="Vehicle">
          <Select
            className="mt-1"
            value={form.vehicleId ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value || null }))}
          >
            <option value="">No particular vehicle</option>
            {vehicles.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nickname}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <ScheduleFields value={schedule} onChange={setSchedule} today={today} />

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
        confirmLabel={editing ? "Save changes" : "Add recurring entry"}
        busy={mutation.isPending}
        disabled={!valid}
      />
    </Sheet>
  );
}
