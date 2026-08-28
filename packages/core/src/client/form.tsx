import type { ReactNode, SelectHTMLAttributes } from "react";

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

/**
 * A styled `<select>` with a chevron this codebase controls.
 *
 * WHY NOT JUST USE INPUT ON A NATIVE SELECT, as every call site used to:
 * the browser draws its own arrow hard against the right border and ignores
 * `padding-right` when placing it. So a control with 16px of space before its
 * text had about 4px after its arrow, and looked lopsided at every size. It
 * was wrong in both portals, which is why the fix belongs here.
 *
 * `appearance-none` removes the native arrow, and the replacement is
 * positioned to mirror the left text inset exactly -- `pl-4` pairs with
 * `right-4`, `pl-3` with `right-3` -- so the gaps are equal by construction
 * rather than by tuning.
 *
 * THE OPTION COLOURS ARE NOT OPTIONAL. `color-scheme: dark` normally makes
 * Chrome paint the popup dark, but it stops applying the moment `appearance`
 * is overridden -- the popup then takes the author's background, and an
 * unstyled one renders white with pale text. That cost an afternoon in
 * Coinbox's table; it is set explicitly here so it cannot recur.
 */
const SELECT_BASE =
  "w-full appearance-none rounded-xl border border-edge bg-inset text-ink " +
  "focus:border-ink-muted focus:outline-none [&>option]:bg-surface [&>option]:text-ink";

export function Select({
  size = "md",
  className = "",
  children,
  ...rest
  // The native `size` on a select is a row count, and intersecting a string
  // union with it collapses to `never`. It is omitted rather than renamed
  // because a multi-row select is not a control this design system has.
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  /** `md` matches INPUT's metrics; `sm` is the compact filter-row size. */
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "py-2 pl-3 pr-9" : "py-3 pl-4 pr-10";
  const icon = size === "sm" ? "right-3 h-4 w-4" : "right-4 h-4 w-4";

  return (
    <div className={"relative " + className}>
      <select className={`${SELECT_BASE} ${pad}`} {...rest}>
        {children}
      </select>
      {/* pointer-events-none so the chevron is decoration -- clicking it must
          still open the select underneath, not swallow the click. */}
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted ${icon}`}
      >
        <path d="M6 8l4 4 4-4" />
      </svg>
    </div>
  );
}

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
      <Select
        className="mt-1"
        value={value}
        onChange={(e) => onChange(e.target.value as T | "")}
      >
        <option value="">Not sure</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Strips anything that is not a digit, so numeric fields stay parseable. */
export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}
