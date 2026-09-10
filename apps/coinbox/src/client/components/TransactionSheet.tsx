import { useState } from "react";
import { DATE_INPUT, Field, INPUT, Select, Sheet, SheetActions } from "@portals/core/client";
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
  isUnusualDirection,
  partitionByDirection,
  type FormState,
} from "@shared/categoryRules";
import {
  applyVehicleChange,
  initialFuelState,
  isFuelComplete,
  parseLitresMilli,
  parseOdometerKm,
  type FuelState,
} from "@shared/fuelRules";
import { FuelFields } from "./FuelFields";

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

  /**
   * Always starts empty, even when editing. `fuel` is absent from
   * transactionPatch, so an edit cannot carry one -- see the note there for
   * why correcting a fill means deleting the entry and re-entering it.
   */
  const [fuel, setFuel] = useState<FuelState>(initialFuelState);

  const amountSen = parseSen(amount);
  const valid =
    occurredOn !== "" &&
    item.trim() !== "" &&
    categoryId !== "" &&
    // A BLANK amount is a slip; a typed 0 is a statement. The owner records
    // RM 0.00 water bills on purpose -- a month billed nothing still has to
    // appear, or the monthly average he tracks is computed over fewer months
    // and comes out high. So the guard is on emptiness, not on the value.
    amount.trim() !== "" &&
    amountSen !== null &&
    amountSen >= 0 &&
    // A half-filled fill-up block is a slip, not a statement: the API would
    // reject it, and it is cheaper to say so before the round trip.
    isFuelComplete(fuel);

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
      ...(fuel.isFill && form.vehicleId
        ? {
            fuel: {
              odometerKm: parseOdometerKm(fuel.odometerKm) ?? 0,
              litresMilli: parseLitresMilli(fuel.litres) ?? 0,
              isFullTank: fuel.isFullTank,
            },
          }
        : {}),
    };

    mutation.mutate(draft, { onSuccess: onClose });
  }

  const vehicleVisible = showsVehicle(form.categoryCode);

  const { usual, other } = partitionByDirection(categories.data ?? [], form.direction);

  // Never blocking. Eight of the owner's 648 rows are exactly this case, and
  // all eight are legitimate -- money from his mother for house repairs is
  // Household-in, a KWSP withdrawal is Savings-in. The note is for the mis-tap,
  // not for the exception.
  const unusual = isUnusualDirection(form);
  const categoryName = categories.data?.find((c) => c.id === categoryId)?.name;

  return (
    <Sheet title={editing ? "Edit entry" : "New entry"} onClose={onClose}>
      {/*
        Sheet renders its close button in a zero-height sticky row, so the
        first thing a child paints sits underneath it. `pr-9` is how every
        other sheet in the workspace keeps clear of it (see VehicleSheet and
        PartDetailSheet, which say so). Without this heading the direction
        buttons ran straight under the X.

        The heading also gives the sheet a visible name: `title` on Sheet is
        only an aria-label, so without an h2 the panel is unlabelled on screen.
      */}
      <h2 className="pr-9 text-lg font-semibold">{editing ? "Edit entry" : "New entry"}</h2>

      {/*
        Direction leads the form, per spec 8: `out` is the overwhelming
        majority, so a miscategorised inflow should be visually obvious rather
        than buried in a dropdown.
      */}
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
        {/*
          REORDERED BY DIRECTION, NEVER FILTERED. Picking Money In floats
          Salary, Extra Income and Miscellaneous to the top, which is the
          mis-tap this guards against -- but everything stays reachable under
          "Other". Filtering would make five real entries unenterable,
          including RM 3,000 from the owner's mother for the roof, which is
          filed as Household and arrives as money in.
        */}
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

      {/*
        Rule 2's visible half. The value is cleared by applyCategoryChange, not
        here -- unmounting a control must never be the thing that decides what
        gets submitted.
      */}
      {vehicleVisible && (
        <Field label="Vehicle">
          <Select
            className="mt-1"
            value={form.vehicleId ?? ""}
            onChange={(e) => {
              const next = e.target.value || null;
              setForm((f) => ({ ...f, vehicleId: next }));
              // An odometer belongs to a vehicle. Losing one loses the other.
              setFuel((f) => applyVehicleChange(f, next));
            }}
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

      {/*
        Only offered once a vehicle is chosen: a fill with no vehicle has
        nowhere to put the odometer, and the API rejects it. Editing never
        shows it, because transactionPatch carries no fuel block.
      */}
      {vehicleVisible && form.vehicleId && !editing && (
        <FuelFields
          state={fuel}
          onChange={setFuel}
          amountSen={amountSen}
          lastOdometerKm={
            vehicles.data?.find((v) => v.id === form.vehicleId)?.currentOdometerKm ?? null
          }
        />
      )}

      <Field label="Date">
        <input
          className={DATE_INPUT}
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
