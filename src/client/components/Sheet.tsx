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
          "max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-edge bg-surface p-5 pb-8 " +
          "sm:rounded-2xl sm:pb-5 sm:shadow-2xl " +
          (wide ? "sm:max-w-2xl" : "sm:max-w-lg")
        }
      >
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
