import {
  Droplet,
  Filter,
  Disc3,
  CircleDot,
  BatteryCharging,
  RefreshCw,
  Zap,
  Wrench,
  Waves,
  Cog,
  Thermometer,
  Gauge,
  type LucideIcon,
} from "lucide-react";

/**
 * An icon per part CATEGORY, not per part type.
 *
 * `part_category` already rides along on every maintenance row, so this needs
 * no new data. Keying off the twelve categories rather than the forty-odd part
 * types also means a custom part type the owner adds later gets a sensible
 * glyph for free instead of a blank square.
 */
const ICONS: Record<string, LucideIcon> = {
  fluid: Droplet,
  filter: Filter,
  brake: Disc3,
  tyre: CircleDot,
  battery: BatteryCharging,
  belt: RefreshCw,
  electrical: Zap,
  other: Wrench,
  // Added with migration 0007.
  suspension: Waves,
  drivetrain: Cog,
  cooling: Thermometer,
  engine: Gauge,
};

export function PartIcon({ category, className }: { category: string; className?: string }) {
  // Unknown categories fall back rather than rendering nothing: the CHECK
  // constraint makes that unreachable today, but a future migration adding a
  // category should not blank out the grid.
  const Icon = ICONS[category] ?? Wrench;
  return <Icon aria-hidden className={className ?? "h-5 w-5"} strokeWidth={1.75} />;
}
