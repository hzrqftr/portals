import type { ReactNode } from "react";

/**
 * Form primitives shared by the entry sheets.
 *
 * Almost all input styling lives in INPUT, so the dark palette reaches most
 * of the form surface from this one constant. Controls stay large enough to
 * be a comfortable tap target at 375px even though the layout is now
 * desktop-first -- the odometer flow (spec 8.5) happens at a petrol pump.
 */

export const INPUT =
  "mt-1 w-full rounded-xl border border-edge bg-inset px-4 py-3 text-ink " +
  "placeholder:text-ink-faint focus:border-ink-muted focus:outline-none";

export function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={"mt-4 block " + className}>
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * A select whose empty option is a real answer, not a prompt. "Not sure" is
 * chosen over "None" deliberately: the fields using this drive maintenance
 * seeding, and a guess recorded as fact is worse than an admitted gap.
 */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | "";
  options: readonly { value: T; label: string }[];
  onChange: (next: T | "") => void;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | "")}
        className={INPUT}
      >
        <option value="">Not sure</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Strips anything that is not a digit, so numeric fields stay parseable. */
export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}
