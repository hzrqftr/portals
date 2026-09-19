import { useEffect, useRef, useState } from "react";

/**
 * The in-place editing primitives behind TransactionTable, and the class
 * strings that keep them from moving the layout.
 *
 * Split out of the table so the metric pairs below sit next to each other:
 * CONTENT and EDITOR must stay identical, and they are far easier to keep that
 * way in one 130-line file than at opposite ends of a 570-line one.
 */

/**
 * NOTHING HERE MAY CHANGE A CELL'S HEIGHT WHEN IT ENTERS EDIT MODE.
 *
 * The first version wrapped the editor in a bordered, padded input inside an
 * already-padded cell, so every click made its row jump taller and the whole
 * table shuffled. Clicking a cell should look like focusing text, not like
 * swapping one control for another.
 *
 * So the display span and the editor share identical metrics -- same font
 * size, same line-height, no padding, no border, transparent background --
 * and the focus affordance is a `ring`, which is a box-shadow and therefore
 * costs no layout at all. `h-9` on the cell content pins the height so even a
 * select, which has its own intrinsic sizing, cannot push the row around.
 */
export const CELL = "px-3 py-1.5 align-middle transition-colors";
export const CONTENT = "flex h-9 min-w-0 items-center text-sm leading-5";

/** Editor and display must be metrically identical. Change both or neither. */
const EDITOR =
  "h-9 w-full min-w-0 appearance-none border-0 p-0 text-sm leading-5 text-ink " +
  "focus:outline-none focus:ring-0";

const EDITOR_INPUT = EDITOR + " bg-transparent";

/**
 * A SELECT MUST NOT BE bg-transparent.
 *
 * `color-scheme: dark` normally makes Chrome paint the option popup dark, but
 * once `appearance-none` is set the browser stops using the native rendering
 * and paints the popup from the author's background instead. Transparent
 * resolves to white, which is how this ended up as pale grey text on a white
 * list -- unreadable, and nothing about it looked like a CSS bug.
 *
 * So the control and its options get explicit colours from the palette.
 */
const EDITOR_SELECT = EDITOR + " bg-inset [&>option]:bg-surface [&>option]:text-ink";

export const HEAD =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-ink-faint whitespace-nowrap";

/** Ring, not border: box-shadow paints inside the box and moves nothing. */
export const RING = "bg-inset ring-1 ring-inset ring-ink-muted";

export function CellInput({
  value,
  type = "text",
  align = "left",
  onCommit,
  onCancel,
}: {
  value: string;
  type?: "text" | "date" | "decimal";
  align?: "left" | "right";
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();

    if (type === "date") {
      // A date cell's first click should open the calendar, not select the
      // text and wait for a second click on an icon that only appears once
      // focused. Typing still works with the picker open, so keying in a date
      // stays available -- it is just no longer the only thing on offer.
      try {
        el.showPicker?.();
      } catch {
        /* unsupported: the field is focused and typeable, picker on click */
      }
      return;
    }

    // Everything else selects, so typing replaces rather than appends.
    el.select();
  }, [type]);

  return (
    <input
      ref={ref}
      className={EDITOR_INPUT + (align === "right" ? " text-right tabular-nums" : "")}
      type={type === "date" ? "date" : "text"}
      inputMode={type === "decimal" ? "decimal" : undefined}
      value={draft}
      onChange={(e) =>
        setDraft(type === "decimal" ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value)
      }
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(draft);
        // Escape must not commit. A cell opened by accident has to be
        // escapable without writing anything -- there is no undo behind this.
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

export function CellSelect({
  value,
  children,
  onCommit,
  onCancel,
}: {
  value: string;
  children: React.ReactNode;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // One click should open the list, not merely focus a control that then
    // needs a second click. There is no other way to open a native select
    // programmatically; showPicker is the supported one, and it throws where
    // it is unavailable rather than no-opping, so it is guarded.
    try {
      el.showPicker?.();
    } catch {
      /* older browsers: the select is focused, a second click opens it */
    }
  }, []);

  return (
    <select
      ref={ref}
      className={EDITOR_SELECT}
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      {children}
    </select>
  );
}
