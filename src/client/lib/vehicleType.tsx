import { Car, Bike, type LucideIcon } from "lucide-react";
import type { VehicleType } from "../api/hooks";

/**
 * How a vehicle type is shown. One module because the add form, the details
 * panel and the dashboard card all name and draw it, and three copies would
 * drift.
 */
export const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: "car", label: "Car" },
  { value: "motorcycle", label: "Motorbike" },
];

const ICONS: Record<VehicleType, LucideIcon> = {
  car: Car,
  motorcycle: Bike,
};

export function vehicleTypeLabel(type: VehicleType): string {
  return VEHICLE_TYPES.find((t) => t.value === type)?.label ?? "Car";
}

export function VehicleTypeIcon({
  type,
  className,
}: {
  type: VehicleType;
  className?: string;
}) {
  const Icon = ICONS[type] ?? Car;
  return <Icon aria-hidden className={className ?? "h-4 w-4"} strokeWidth={1.75} />;
}
