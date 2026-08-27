import type { Status } from "../api/hooks";

/**
 * Status is never communicated by colour alone (spec 9). Every pill carries
 * its word as well as its colour, so it survives colourblindness, greyscale
 * printing, and glare on a phone screen in a car park at noon.
 *
 * This matters more in the tile grid than it did in the old list: a tile is
 * mostly colour, so the word is the only thing actually saying what is wrong.
 */
export const STATUS_STYLES: Record<Status, { chip: string; ring: string; label: string }> = {
  overdue: {
    chip: "bg-status-overdue-bg text-status-overdue-fg",
    ring: "ring-status-overdue-fg/30",
    label: "Overdue",
  },
  due_soon: {
    chip: "bg-status-soon-bg text-status-soon-fg",
    ring: "ring-status-soon-fg/30",
    label: "Due soon",
  },
  ok: {
    chip: "bg-status-ok-bg text-status-ok-fg",
    ring: "ring-status-ok-fg/20",
    label: "OK",
  },
  unknown: {
    chip: "bg-status-unknown-bg text-status-unknown-fg",
    ring: "ring-edge",
    label: "Not set up",
  },
};

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}
    >
      {s.label}
    </span>
  );
}
