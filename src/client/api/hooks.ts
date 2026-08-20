import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export type Status = "overdue" | "due_soon" | "ok" | "unknown";

export interface AttentionItem {
  kind: "maintenance" | "renewal";
  vehicleId: string;
  nickname: string;
  label: string;
  status: Status;
  dueDate: string | null;
  daysRemaining: number | null;
  kmRemaining: number | null;
  lowConfidence: boolean;
}

export interface VehicleCard {
  id: string;
  nickname: string;
  plate: string | null;
  currentOdometerKm: number;
  odometerUpdatedOn: string | null;
  odometerAgeDays: number | null;
  worstStatus: Status;
}

export interface Dashboard {
  today: string;
  attention: AttentionItem[];
  vehicles: VehicleCard[];
  staleOdometers: { vehicleId: string; nickname: string; daysSince: number }[];
}

export interface MaintenanceRow {
  interval_id: string;
  part_type_id: string;
  part_name: string;
  part_category: string;
  baseline_date: string | null;
  baseline_km: number | null;
  due_km: number | null;
  effective_due_date: string | null;
  km_remaining: number | null;
  days_remaining: number | null;
  low_confidence: number;
  status: Status;
}

/** One request for the whole landing page (spec 7). */
export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
}

export function useVehicle(id: string) {
  return useQuery({ queryKey: ["vehicle", id], queryFn: () => api<VehicleCard>(`/vehicles/${id}`) });
}

export function useMaintenance(id: string) {
  return useQuery({
    queryKey: ["maintenance", id],
    queryFn: () => api<MaintenanceRow[]>(`/vehicles/${id}/maintenance`),
  });
}

/**
 * The single most important write in the app (spec 11.7). It is optimistic
 * because the user is standing at a pump and will close the tab the instant
 * it looks done -- waiting for a round trip to confirm loses the reading.
 */
export function useLogOdometer(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { readingKm: number; recordedOn: string }) =>
      api<void>(`/vehicles/${vehicleId}/odometer`, { method: "POST", json: input }),

    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["dashboard"] });
      const previous = qc.getQueryData<Dashboard>(["dashboard"]);
      qc.setQueryData<Dashboard>(["dashboard"], (old) =>
        old
          ? {
              ...old,
              vehicles: old.vehicles.map((v) =>
                v.id === vehicleId
                  ? {
                      ...v,
                      currentOdometerKm: input.readingKm,
                      odometerUpdatedOn: input.recordedOn,
                      odometerAgeDays: 0,
                    }
                  : v,
              ),
              staleOdometers: old.staleOdometers.filter((s) => s.vehicleId !== vehicleId),
            }
          : old,
      );
      return { previous };
    },

    // Rollback on failure (spec 9). A reading that silently vanished would
    // be worse than one that was never accepted.
    onError: (_err, _input, context) => {
      if (context?.previous) qc.setQueryData(["dashboard"], context.previous);
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["maintenance", vehicleId] });
    },
  });
}
