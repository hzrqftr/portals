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
 * A date input that behaves like the text inputs beside it.
 *
 * Native date controls report a LARGE INTRINSIC MINIMUM WIDTH -- enough for
 * the formatted date plus the platform's own picker chrome -- and on iOS that
 * minimum is wider than half a phone screen. `w-full` alone does not save you:
 * a grid or flex item defaults to `min-width: auto`, so the TRACK grows to fit
 * that minimum and the neighbouring field is overlapped rather than shrunk.
 * `Field` carries `min-w-0` for that reason; this constant is the other half.
 *
 * `::-webkit-date-and-time-value` is where the text actually lives, and it is
 * not left-aligned by default -- iOS pushes it toward the trailing edge, so a
 * date sat visibly off-centre next to a left-aligned odometer.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS SET `appearance: none`. That is the
 * usual advice for taming these controls, and it is the same trap documented
 * on Select below: Chrome stops honouring `color-scheme: dark` the moment
 * `appearance` is overridden, and the native picker would render white on a
 * dark form. `:root { color-scheme: dark }` in each app's index.css is
 * load-bearing precisely here.
 */
export const DATE_INPUT =
  INPUT +
  // `block` is not decoration. INPUT relies on `w-full` to fill its line, and
  // an input is inline-block by default -- so the moment a max-width makes one
  // NARROWER than its line, the label's <span> flows up beside it and that one
  // field grows a side label while every other field keeps its label on top.
  " block min-w-0 [&::-webkit-date-and-time-value]:text-left";

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
    // min-w-0: a Field is often a grid item, and grid items refuse to shrink
    // below their content's intrinsic minimum unless told otherwise. A native
    // date control's minimum is wide enough to push its neighbour off the
    // track, which is exactly what it did to the odometer field.
    <label className={"mt-4 block min-w-0 " + className}>
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
