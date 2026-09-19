import { INPUT, digitsOnly } from "@portals/core/client";
import { formatInterval, formatKm } from "../lib/format";
import { suggestedInterval, type ScheduleCheck } from "./scheduleCheck";
import type { ItemDraft } from "./ServiceItemRow";

/**
 * The line under a part on the log-service form that says how this
 * replacement sits against the schedule, and offers -- never imposes -- a
 * change to it (2026-09-20).
 *
 * The schedule is the owner's. This notice is the only place a service can
 * change it, and only through a button: "Keep my schedule" is what happens if
 * nothing is pressed.
 */
export function ScheduleNotice({
  check,
  item,
  partDefault,
  onChange,
}: {
  check: ScheduleCheck;
  item: ItemDraft;
  /** The generic interval for an untracked part, to pre-fill "Add to schedule". */
  partDefault: { km: number | null; months: number | null };
  onChange: (patch: Partial<ItemDraft>) => void;
}) {
  if (check.kind === "on-schedule" || check.kind === "no-baseline") return null;

  const adopt = (v: { km: number | null; months: number | null }) =>
    onChange({
      adopting: true,
      adoptKm: v.km === null ? "" : String(v.km),
      adoptMonths: v.months === null ? "" : String(v.months),
    });
  const keep = () => onChange({ adopting: false, adoptKm: "", adoptMonths: "" });

  if (item.adopting) {
    return (
      <div className="mt-2 rounded-lg border border-edge px-3 py-2">
        <p className="text-xs text-ink-muted">
          {check.kind === "untracked" ? "Add to schedule — every" : "Change schedule to every"}
        </p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Figure
            value={item.adoptKm}
            unit="km"
            onChange={(v) => onChange({ adoptKm: v })}
          />
          <Figure
            value={item.adoptMonths}
            unit="months"
            onChange={(v) => onChange({ adoptMonths: v })}
          />
        </div>
        <p className="mt-1 text-xs text-ink-faint">
          {check.kind === "untracked"
            ? "Whichever comes first. Leave one blank to use only the other."
            : "Leave a figure blank to keep that half of the schedule as it is."}
        </p>
        <button onClick={keep} className="mt-1 text-xs text-ink-faint underline">
          {check.kind === "untracked" ? "Don't track it" : "Keep my schedule"}
        </button>
      </div>
    );
  }

  if (check.kind === "untracked") {
    return (
      <p className="mt-2 text-xs text-ink-faint">
        Not on this vehicle&rsquo;s schedule.{" "}
        <button onClick={() => adopt(partDefault)} className="underline">
          Add to schedule
        </button>
      </p>
    );
  }

  const suggestion = suggestedInterval(check);
  const late = check.kind === "late";
  return (
    <div
      className={
        "mt-2 rounded-lg px-3 py-2 text-xs " +
        (late ? "bg-status-overdue-bg text-status-overdue-fg" : "bg-status-soon-bg text-status-soon-fg")
      }
    >
      <p>
        {late ? "Late" : "Early"} by {describeGap(check.byKm, check.byMonths)} &mdash; schedule
        is {formatInterval(check.intervalKm, check.intervalMonths)}.
      </p>
      <div className="mt-1 flex flex-wrap gap-x-4">
        <span className="opacity-80">Keeping my schedule</span>
        <button onClick={() => adopt(suggestion)} className="underline">
          Change to {formatInterval(suggestion.km, suggestion.months)}
        </button>
      </div>
    </div>
  );
}

function Figure({
  value,
  unit,
  onChange,
}: {
  value: string;
  unit: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-baseline gap-2">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(digitsOnly(e.target.value))}
        className={INPUT + " mt-0 py-2 tabular-nums"}
      />
      <span className="text-sm text-ink-faint">{unit}</span>
    </label>
  );
}

function months(n: number) {
  return `${n} month${n === 1 ? "" : "s"}`;
}

function describeGap(km: number | null, m: number | null) {
  const parts = [km !== null ? formatKm(km) : null, m !== null ? months(m) : null];
  return parts.filter(Boolean).join(" / ");
}
