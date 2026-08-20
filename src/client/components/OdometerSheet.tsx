import { useState } from "react";
import { useLogOdometer } from "../api/hooks";

/**
 * Spec 8.5: one tap from the dashboard, numeric keypad, one field, save and
 * dismiss, under ten seconds. Spec 11.7 rates this as load-bearing rather
 * than polish -- if logging a reading is a chore, readings stop, projections
 * decay, and the app quietly becomes wrong.
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
    log.mutate(
      { readingKm: Math.round(reading), recordedOn: today },
      { onSuccess: onClose },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{nickname}</h2>
        <p className="mt-1 text-sm text-stone-600">
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
          className="mt-4 w-full rounded-xl border border-stone-300 px-4 py-4 text-2xl tabular-nums focus:border-stone-900 focus:outline-none"
        />

        {log.isError && (
          <p className="mt-2 text-sm text-red-700">{(log.error as Error).message}</p>
        )}

        <div className="mt-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-stone-300 py-3 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!valid || log.isPending}
            className="flex-1 rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-40"
          >
            {log.isPending ? "Saving\u2026" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
