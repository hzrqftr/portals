import { Field, INPUT } from "@portals/core/client";
import { formatSen } from "@portals/core";
import {
  applyFillToggle,
  fuelWarning,
  parseLitresMilli,
  parseOdometerKm,
  senPerLitre,
  type FuelState,
} from "@shared/fuelRules";

/**
 * The fill-up block: the physical half of a refuelling.
 *
 * NONE OF THIS IS LEDGER DATA. The odometer and the litres travel through the
 * entry form on their way to Odometry, which owns the vehicle facts. The ledger
 * keeps the ringgit and the vehicle attribution it already had.
 *
 * It lives in its own file because TransactionSheet was already over the ~200
 * line guide before this existed. The rules it applies are in
 * @shared/fuelRules, covered by tests/form-logic.test.ts -- this paints.
 */
export function FuelFields({
  state,
  onChange,
  amountSen,
  lastOdometerKm,
}: {
  state: FuelState;
  onChange: (next: FuelState) => void;
  amountSen: number | null;
  /** The vehicle's current cached reading, or null if it has none yet. */
  lastOdometerKm: number | null;
}) {
  const litresMilli = parseLitresMilli(state.litres);
  const odometerKm = parseOdometerKm(state.odometerKm);
  const perLitre = senPerLitre(amountSen, litresMilli);
  const warning = fuelWarning(litresMilli, odometerKm, lastOdometerKm);

  return (
    <div className="mt-4 rounded-xl border border-edge bg-inset/40 p-3">
      <button
        type="button"
        aria-pressed={state.isFill}
        onClick={() => onChange(applyFillToggle(state, !state.isFill))}
        className={
          "flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left " +
          (state.isFill ? "text-ink" : "text-ink-muted")
        }
      >
        <span
          className={
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border " +
            (state.isFill ? "border-ink bg-ink text-page" : "border-edge")
          }
        >
          {state.isFill ? "✓" : ""}
        </span>
        <span className="text-sm">Refueling</span>
      </button>

      {state.isFill && (
        <div className="mt-1">
          <Field label="Odometer now">
            <div className="relative">
              <input
                // inputMode numeric brings up the keypad, not the full
                // keyboard. type="number" is used nowhere in this workspace.
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={state.odometerKm}
                onChange={(e) =>
                  onChange({ ...state, odometerKm: e.target.value.replace(/[^0-9]/g, "") })
                }
                placeholder={lastOdometerKm ? String(lastOdometerKm) : "0"}
                className={INPUT + " pr-10 tabular-nums"}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint">
                km
              </span>
            </div>
          </Field>
          {lastOdometerKm !== null && lastOdometerKm > 0 && (
            <p className="mt-1 text-xs text-ink-faint">
              Last recorded: {lastOdometerKm.toLocaleString()} km
            </p>
          )}

          <Field label="Litres">
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={state.litres}
                onChange={(e) =>
                  onChange({ ...state, litres: e.target.value.replace(/[^0-9.]/g, "") })
                }
                placeholder="0.00"
                className={INPUT + " pr-10 tabular-nums"}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-faint">
                L
              </span>
            </div>
          </Field>
          {/*
            Derived, never typed. It is here as the typo check: if this does not
            match the pump, either the amount or the litres is wrong, and this
            is the only moment anyone can still tell.
          */}
          {perLitre !== null && (
            <p className="mt-1 text-xs text-ink-faint">{formatSen(perLitre)} per litre</p>
          )}

          {/*
            CONSUMPTION IS ONLY COMPUTABLE FULL TANK TO FULL TANK, so this is a
            fact about the fill, not a preference. A partial fill's litres are
            carried into the next full-tank segment rather than being divided by
            their own distance, which would produce a plausible wrong number.
          */}
          <Field label="Tank">
            <div className="mt-1 grid grid-cols-2 gap-2">
              <TankButton
                selected={state.isFullTank}
                onClick={() => onChange({ ...state, isFullTank: true })}
                label="Full"
              />
              <TankButton
                selected={!state.isFullTank}
                onClick={() => onChange({ ...state, isFullTank: false })}
                label="Partial"
              />
            </div>
          </Field>
          {!state.isFullTank && (
            <p className="mt-1 text-xs text-ink-faint">
              Counted towards the next full tank, not on its own.
            </p>
          )}

          {/* Never blocks. See fuelWarning in @shared/fuelRules for why. */}
          {warning && <p className="mt-3 text-sm text-status-soon-fg">{warning}</p>}
        </div>
      )}
    </div>
  );
}

function TankButton({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={
        "rounded-xl border px-4 py-3 text-sm transition " +
        (selected ? "border-ink-muted bg-inset text-ink" : "border-edge text-ink-muted")
      }
    >
      {label}
    </button>
  );
}
