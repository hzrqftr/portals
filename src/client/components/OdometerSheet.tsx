import { useState } from "react";
import { useLogOdometer } from "../api/hooks";
import { Sheet, SheetActions } from "./Sheet";

/**
 * Spec 8.5: one tap from the dashboard, numeric keypad, one field, save and
 * dismiss, under ten seconds. Spec 11.7 rates this as load-bearing rather
 * than polish -- if logging a reading is a chore, readings stop, projections
 * decay, and the app quietly becomes wrong.
 *
 * The layout went desktop-first, but this flow did not: the single field is
 * oversized and the buttons stay full-width at every breakpoint, because
 * this is the one screen used one-handed while holding a fuel nozzle.
 */
export function OdometerSheet({
  vehicleId,
  nickname,
  currentKm,
  today,
  onClose,
}: {
  vehicleId: string;
  nickname: string;
  currentKm: number;
  today: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const log = useLogOdometer(vehicleId);

  const reading = Number(value);
  const valid = value !== "" && Number.isFinite(reading) && reading >= 0;

  function save() {
    if (!valid) return;
    log.mutate({ readingKm: Math.round(reading), recordedOn: today }, { onSuccess: onClose });
  }

  return (
    <Sheet title={`Update odometer — ${nickname}`} onClose={onClose}>
      <h2 className="text-lg font-semibold">{nickname}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Last recorded {currentKm.toLocaleString("en-MY")} km
      </p>

      <input
        // inputMode numeric brings up the keypad, not the full keyboard.
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="Odometer now"
        className="mt-4 w-full rounded-xl border border-edge bg-inset px-4 py-4 text-2xl tabular-nums text-ink placeholder:text-ink-faint focus:border-ink-muted focus:outline-none"
      />

      {log.isError && (
        <p className="mt-2 text-sm text-status-overdue-fg">{(log.error as Error).message}</p>
      )}

      <SheetActions
        onCancel={onClose}
        onConfirm={save}
        confirmLabel="Save"
        busy={log.isPending}
        disabled={!valid}
      />
    </Sheet>
  );
}
