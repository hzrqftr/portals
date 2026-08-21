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
          "relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-edge bg-surface p-5 pb-8 " +
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
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
  disabled?: boolean;
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
        className="flex-1 rounded-xl bg-ink py-3 font-medium text-page disabled:opacity-40"
      >
        {busy ? "Saving…" : confirmLabel}
      </button>
    </div>
  );
}
