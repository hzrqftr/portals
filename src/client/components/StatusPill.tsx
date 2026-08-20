import type { Status } from "../api/hooks";

/**
 * Status is never communicated by colour alone (spec 9). Every pill carries
 * its word as well as its colour, so it survives colourblindness, greyscale
 * printing, and glare on a phone screen in a car park at noon.
 */
const STYLES: Record<Status, { bg: string; text: string; label: string }> = {
  overdue: { bg: "bg-red-100", text: "text-red-900", label: "Overdue" },
  due_soon: { bg: "bg-amber-100", text: "text-amber-900", label: "Due soon" },
  ok: { bg: "bg-green-100", text: "text-green-900", label: "OK" },
  unknown: { bg: "bg-stone-200", text: "text-stone-700", label: "Not set up" },
};

export function StatusPill({ status }: { status: Status }) {
  const s = STYLES[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}
