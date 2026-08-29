import { useEffect, type ReactNode } from "react";

/**
 * The overlay shell every entry form sits in. Extracted from OdometerSheet,
 * ServiceSheet and VehicleSheet, which each repeated it.
 *
 * Responsive by shape, not just by width: a bottom sheet on a phone, where a
 * thumb reaches the bottom of the screen, and a centred modal on a desktop,
 * where a panel glued to the bottom edge of a 1440px monitor is the clearest
 * possible tell that a layout was designed for something else.
 */
export function Sheet({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Service logging needs the extra width for line items. */
  wide?: boolean;
}) {
  // Escape closes. Every sheet in the app previously had to be dismissed by
  // clicking the scrim, which is fine on a phone and unnatural on a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Lock the page behind the sheet.
   *
   * Without this, dragging anywhere on a phone -- over the scrim, or inside a
   * panel that has nothing to scroll -- scrolls the list underneath instead.
   * The sheet appears to be sitting on a surface that moves when you touch it,
   * and it gets worse as a form grows past one screen: you reach the last
   * field and the page starts travelling.
   *
   * `position: fixed` rather than `overflow: hidden`, because iOS Safari has
   * never honoured overflow-hidden on body reliably. The cost is that fixing
   * the body throws away the scroll offset, so it is captured first and
   * restored on close -- otherwise dismissing a sheet would jump you back to
   * the top of a 4,000-row ledger.
   */
  useEffect(() => {
    const { scrollY } = window;
    const { style } = document.body;
    const previous = { position: style.position, top: style.top, width: style.width };

    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.width = "100%";

    return () => {
      style.position = previous.position;
      style.top = previous.top;
      style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={
          // overscroll-contain: when the panel is scrolled to its end, keep
          // the momentum inside it instead of handing it to whatever is behind.
          "relative max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-edge bg-surface p-5 pb-8 " +
          "sm:rounded-2xl sm:pb-5 sm:shadow-2xl " +
          (wide ? "sm:max-w-2xl" : "sm:max-w-lg")
        }
      >
        {/*
          Escape and the scrim already close the sheet, but neither is visible.
          A dismiss control the eye can find is what most people reach for
          first, and the Cancel button at the bottom of a scrolling panel is
          often below the fold.

          sticky, not absolute: these panels scroll, and an absolute button
          scrolls away with the content it is meant to dismiss. Zero height
          keeps it out of the flow so it does not push the title down.
        */}
        <div className="sticky top-0 z-10 flex h-0 justify-end">
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-faint transition hover:bg-inset hover:text-ink focus:outline-none focus:ring-2 focus:ring-ink-muted"
          >
            <svg
              viewBox="0 0 20 20"
              aria-hidden
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

/** Cancel / confirm pair, identical in every sheet. */
export function SheetActions({
  onCancel,
  onConfirm,
  confirmLabel,
  busy = false,
  disabled = false,
  tone = "default",
  busyLabel = "Saving…",
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
  disabled?: boolean;
  /**
   * `danger` for an action that destroys something.
   *
   * Defaults to today's look, so every existing call site is unchanged. It
   * exists because a delete on financial history styled identically to Save is
   * a real misclick: the two buttons occupy the same position, in the same
   * colour, one row apart in muscle memory.
   */
  tone?: "default" | "danger";
  busyLabel?: string;
}) {
  return (
    <div className="mt-5 flex gap-3">
      <button
        onClick={onCancel}
        className="flex-1 rounded-xl border border-edge py-3 font-medium text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={disabled || busy}
        className={
          "flex-1 rounded-xl py-3 font-medium disabled:opacity-40 " +
          (tone === "danger"
            ? "bg-status-overdue-fg text-page"
            : "bg-ink text-page")
        }
      >
        {busy ? busyLabel : confirmLabel}
      </button>
    </div>
  );
}
