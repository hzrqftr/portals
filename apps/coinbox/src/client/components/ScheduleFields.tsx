import { DATE_INPUT, Field, Select, INPUT } from "@portals/core/client";
import { describeSchedule, ordinal } from "@shared/recurrence";

/**
 * The "how often" half of a recurring entry.
 *
 * Split out of RecurringSheet rather than inlined: the sheet is already
 * carrying the whole transaction template, and TransactionSheet next door is
 * 272 lines for the template alone. Adding a schedule to that in one file
 * lands well past the ~200-line guideline on day one.
 */

export interface ScheduleValue {
  intervalMonths: number;
  dayOfMonth: number;
  startsOn: string;
  endsOn: string | null;
}

/**
 * The intervals the owner actually asked for: monthly, quarterly, half-yearly
 * and yearly. Weekly was explicitly excluded, and an arbitrary N is a text
 * field's worth of complexity for a case nobody has.
 */
const INTERVALS = [
  { value: 1, label: "Every month" },
  { value: 3, label: "Every 3 months" },
  { value: 6, label: "Every 6 months" },
  { value: 12, label: "Every year" },
];

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function ScheduleFields({
  value,
  onChange,
  today,
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  today: string;
}) {
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });

  return (
    <>
      <Field label="How often">
        <Select
          className="mt-1"
          value={value.intervalMonths}
          onChange={(e) => set({ intervalMonths: Number(e.target.value) })}
        >
          {INTERVALS.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="On day">
        <Select
          className="mt-1"
          value={value.dayOfMonth}
          onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
        >
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {/* 31 is offered and MEANS "the last day". Months without a 31st
                  clamp to their own last day rather than skipping. */}
              {d === 31 ? "The last day" : ordinal(d)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Starting">
        {/* min={today}: forward-only is a rule of the system, rejected by the
            server too, but the picker should not offer what will be refused. */}
        <input
          type="date"
          className={DATE_INPUT + " mt-1"}
          value={value.startsOn}
          min={today}
          onChange={(e) => set({ startsOn: e.target.value })}
        />
      </Field>

      <Field label="Until (optional)">
        <input
          type="date"
          className={DATE_INPUT + " mt-1"}
          value={value.endsOn ?? ""}
          min={value.startsOn}
          onChange={(e) => set({ endsOn: e.target.value || null })}
        />
        <span className="mt-1 block text-xs text-ink-faint">
          Leave empty to keep going indefinitely.
        </span>
      </Field>

      <p className="mt-4 rounded-lg bg-inset px-3 py-2 text-sm text-ink-muted">
        {describeSchedule({
          intervalMonths: value.intervalMonths,
          dayOfMonth: value.dayOfMonth,
          startsOn: value.startsOn,
          endsOn: value.endsOn,
        })}
        {value.endsOn ? `, until ${value.endsOn}` : ""}
      </p>
    </>
  );
}
