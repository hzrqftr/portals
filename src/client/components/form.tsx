import type { ReactNode } from "react";

/**
 * Form primitives shared by the entry sheets. Mobile-first: full-width
 * controls with a large tap target, designed at 375px.
 */

export const INPUT =
  "mt-1 w-full rounded-xl border border-stone-300 px-4 py-3 focus:border-stone-900 focus:outline-none";

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
      <span className="text-sm text-stone-600">{label}</span>
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
