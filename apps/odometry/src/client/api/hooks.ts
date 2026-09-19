import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@portals/core/client";

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

export type VehicleType = "car" | "motorcycle";

export interface VehicleCard {
  id: string;
  nickname: string;
  vehicleType: VehicleType;
  plate: string | null;
  currentOdometerKm: number;
  odometerUpdatedOn: string | null;
  odometerAgeDays: number | null;
  worstStatus: Status;
}

/**
 * One vehicle, in full. `GET /api/vehicles/:id` has always returned every
 * column; the client just used to type it as a VehicleCard and so could not
 * see the spec it was already being handed.
 *
 * Distinct from VehicleCard, which is the dashboard's shape: that one carries
 * a rolled-up status and no spec, this one is the row itself.
 */
export interface VehicleDetails {
  id: string;
  nickname: string;
  vehicleType: VehicleType;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  fuelType: "petrol" | "diesel" | "hybrid" | "ev" | null;
  transmission: "manual" | "auto" | null;
  engineCc: number | null;
  vin: string | null;
  // The grant's vehicle details (migration 0018). Owner details are
  // deliberately not columns -- they live only in the grant PDF.
  engineNo: string | null;
  registeredOn: string | null;
  colour: string | null;
  currentOdometerKm: number;
  odometerUpdatedOn: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  notes: string | null;
  isActive: number;
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
  /** The part's schedule, as set on the schedule tab. */
  interval_km: number | null;
  interval_months: number | null;
  baseline_date: string | null;
  baseline_km: number | null;
  due_km: number | null;
  effective_due_date: string | null;
  km_remaining: number | null;
  days_remaining: number | null;
  low_confidence: number;
  status: Status;
}

export type ServiceTypeName = "minor" | "major" | "repair" | "inspection" | "other";

export const SERVICE_TYPES: { value: ServiceTypeName; label: string }[] = [
  { value: "minor", label: "Minor service" },
  { value: "major", label: "Major service" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
  { value: "other", label: "Other" },
];

export interface PartType {
  id: string;
  garage_id: string | null;
  code: string;
  name: string;
  category: string;
  /** For the vehicle type this list was fetched for. See migration 0008. */
  default_interval_km: number | null;
  default_interval_months: number | null;
}

export interface ServiceTemplate {
  serviceType: ServiceTypeName;
  partTypeId: string;
  partName: string;
  sortOrder: number;
}

export interface ServiceItem {
  id: string;
  partTypeId: string;
  partName: string | null;
  brand: string | null;
  spec: string | null;
  note: string | null;
  quantityMilli: number;
  unitCost: number | null;
  lineTotalCost: number | null;
  warrantyMonths: number | null;
  warrantyExpiresOn: string | null;
  intervalKmOverride: number | null;
  intervalMonthsOverride: number | null;
  nextDueKm: number | null;
}

export interface ServiceRecord {
  id: string;
  servicedOn: string;
  odometerKm: number;
  serviceType: ServiceTypeName | null;
  workshopName: string | null;
  /** What the workshop charged for the work itself. */
  labourCost: number | null;
  /** Sum of the line items. Derived, like totalCost. */
  partsCost: number | null;
  /** partsCost + labourCost, computed server-side. Never stored, never sent. */
  totalCost: number | null;
  notes: string | null;
  createdAt: string;
  items: ServiceItem[];
}

export interface Settings {
  timezone: string;
  distanceUnit: "km" | "mi";
  currency: string;
  dateFormat: string;
  dueSoonDays: number;
  dueSoonKm: number;
  fallbackKmPerDay: number;
  staleOdometerDays: number;
}

export interface Me {
  user: { id: string; email: string; displayName: string | null; timezone: string };
  settings: Omit<Settings, "timezone">;
  garages: { garageId: string; name: string; role: string }[];
  activeGarageId: string;
}

/** One request for the whole landing page (spec 7). */
export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: ["vehicle", id],
    queryFn: () => api<VehicleDetails>(`/vehicles/${id}`),
  });
}

export function useMaintenance(id: string) {
  return useQuery({
    queryKey: ["maintenance", id],
    queryFn: () => api<MaintenanceRow[]>(`/vehicles/${id}/maintenance`),
  });
}

export interface FuelFillRow {
  id: string;
  filledOn: string;
  readingKm: number;
  litresMilli: number;
  isFullTank: number;
  distanceKm: number | null;
  segmentLitresMilli: number | null;
  lPer100km: number | null;
  kmPerLitre: number | null;
}

/**
 * Fills for a vehicle. Read only from this portal -- they are created in
 * Coinbox, where the litres and the ringgit are keyed in together at the pump.
 */
export function useFuel(id: string) {
  return useQuery({
    queryKey: ["fuel", id],
    queryFn: () => api<FuelFillRow[]>(`/vehicles/${id}/fuel`),
  });
}

export function useServices(id: string) {
  return useQuery({
    queryKey: ["services", id],
    queryFn: () => api<ServiceRecord[]>(`/vehicles/${id}/services`),
  });
}

/** Reference data: global seed rows plus this garage's own. Rarely changes. */
/**
 * The catalogue, narrowed to one kind of vehicle.
 *
 * Pass the vehicle's type on a vehicle page: a bike must not be offered a
 * cabin filter, and the intervals that come back are that type's. Omit it only
 * where the question genuinely is not about one vehicle -- the garage-wide
 * service templates in Settings.
 */
export function usePartTypes(vehicleType?: VehicleType) {
  return useQuery({
    queryKey: ["part-types", vehicleType ?? "all"],
    queryFn: () =>
      api<PartType[]>(`/part-types${vehicleType ? `?vehicleType=${vehicleType}` : ""}`),
    staleTime: 5 * 60_000,
  });
}

/** Autocomplete from this garage's own history only (spec 8.4). */
export function useBrandSuggestions(partTypeId: string) {
  return useQuery({
    queryKey: ["brands", partTypeId],
    queryFn: () => api<{ brand: string; uses: number }[]>(`/part-types/${partTypeId}/brands`),
    enabled: partTypeId !== "",
    staleTime: 5 * 60_000,
  });
}

export function useServiceTemplates() {
  return useQuery({
    queryKey: ["service-templates"],
    queryFn: () => api<ServiceTemplate[]>("/service-templates"),
    staleTime: 5 * 60_000,
  });
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) =>
      api<Me>("/me/settings", { method: "PATCH", json: patch }),
    // Thresholds and the timezone feed every derived date in the app, so a
    // save invalidates everything rather than just the settings screen.
    onSuccess: (me) => {
      qc.setQueryData(["me"], me);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["maintenance"] });
    },
  });
}

export function usePutServiceTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      serviceType,
      partTypeIds,
    }: {
      serviceType: ServiceTypeName;
      partTypeIds: string[];
    }) =>
      api<ServiceTemplate[]>(`/service-templates/${serviceType}`, {
        method: "PUT",
        json: { partTypeIds },
      }),
    onSuccess: (rows) => qc.setQueryData(["service-templates"], rows),
  });
}

export function useCreatePartType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      category: string;
      defaultIntervalKm?: number | null;
      defaultIntervalMonths?: number | null;
    }) => api<{ id: string }>("/part-types", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["part-types"] }),
  });
}

export interface ServiceItemDraft {
  partTypeId: string;
  brand?: string;
  note?: string;
  spec?: string;
  quantityMilli: number;
  unitCost?: number;
  warrantyMonths?: number;
  /**
   * A schedule change the owner explicitly chose on this visit -- absent
   * otherwise, which leaves the schedule alone. An interval, never a due
   * point (invariant 6). See serviceTotals.toItemDrafts.
   */
  intervalKmOverride?: number;
  intervalMonthsOverride?: number;
}

export interface ServiceDraft {
  servicedOn: string;
  odometerKm: number;
  serviceType?: ServiceTypeName;
  workshopName?: string;
  labourCost?: number;
  notes?: string;
  items: ServiceItemDraft[];
}

/**
 * Not optimistic. Unlike a pump-side odometer reading, this is a considered
 * entry the user is watching complete -- and which clocks it reset is a
 * server-derived answer the client cannot honestly guess.
 */
export function useLogService(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ServiceDraft) =>
      api<{ id: string }>(`/vehicles/${vehicleId}/services`, { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      qc.invalidateQueries({ queryKey: ["maintenance", vehicleId] });
      qc.invalidateQueries({ queryKey: ["services", vehicleId] });
      qc.invalidateQueries({ queryKey: ["schedule", vehicleId] });
    },
  });
}

/**
 * Correcting a service after the fact (spec 8.4).
 *
 * Sends the WHOLE record, not a patch -- the parts list is a set, and there is
 * no way to express "remove this line" in a merge. See `serviceUpdate` in
 * @shared/zod.
 *
 * The same four invalidations as logging one, and all four earn their place:
 * correcting the odometer moves the vehicle's cached figure, the dashboard
 * card that reads it, and every maintenance due point derived from that
 * service (invariant 6). Refreshing only the history list would leave three
 * screens showing numbers the correction just falsified.
 */
export function useUpdateService(vehicleId: string, serviceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ServiceDraft) =>
      api<ServiceRecord>(`/services/${serviceId}`, { method: "PATCH", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      qc.invalidateQueries({ queryKey: ["maintenance", vehicleId] });
      qc.invalidateQueries({ queryKey: ["services", vehicleId] });
      qc.invalidateQueries({ queryKey: ["schedule", vehicleId] });
    },
  });
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

/**
 * Which files, and through which routes. Three owners share one component and
 * one set of hooks: receipts on a service, documents on a renewal, and the
 * vehicle's grant. Each has its own routes on the server (and its own table),
 * so the target carries both paths rather than the hooks guessing them.
 */
export interface AttachmentTarget {
  /** TanStack Query key for the list. */
  queryKey: readonly [string, string];
  /** List and upload, relative to /api. */
  listPath: string;
  /** One file lives at `${itemBase}/:id`, bytes at `${itemBase}/:id/content`. */
  itemBase: string;
}

export function serviceReceipts(serviceId: string): AttachmentTarget {
  return {
    queryKey: ["attachments", serviceId],
    listPath: `/services/${serviceId}/attachments`,
    itemBase: "/attachments",
  };
}

export function renewalDocuments(renewalId: string): AttachmentTarget {
  return {
    queryKey: ["renewal-documents", renewalId],
    listPath: `/renewals/${renewalId}/attachments`,
    itemBase: "/renewal-attachments",
  };
}

export function grantDocuments(vehicleId: string): AttachmentTarget {
  return {
    queryKey: ["grant-documents", vehicleId],
    listPath: `/vehicles/${vehicleId}/grant`,
    itemBase: "/grant-documents",
  };
}

/** Where the bytes come from. Used directly as a link and an image source. */
export function attachmentUrl(target: AttachmentTarget, id: string): string {
  return `/api${target.itemBase}/${id}/content`;
}

/** `null` while the parent does not exist yet -- nothing to list. */
export function useAttachments(target: AttachmentTarget | null) {
  return useQuery({
    queryKey: target?.queryKey ?? ["attachments", ""],
    queryFn: () => api<Attachment[]>(target!.listPath),
    enabled: target !== null,
  });
}

/**
 * One file per call. Multiple selections are a loop at the call site, so a
 * failure names the file that failed instead of sinking the whole batch.
 *
 * NOTE the shape of the api() call. Passing `body` rather than `json` is what
 * makes this multipart: api() only stringifies and sets a content-type when
 * `json` is present, and everything else passes through untouched. Do NOT add
 * a content-type header here -- the browser has to set it, because only it
 * knows the multipart boundary it generated.
 */
export function uploadAttachment(target: AttachmentTarget, file: File): Promise<Attachment> {
  const form = new FormData();
  form.set("file", file);
  return api<Attachment>(target.listPath, { method: "POST", body: form });
}

export function useUploadAttachment(target: AttachmentTarget | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadAttachment(target!, file),
    onSuccess: () => {
      if (target) qc.invalidateQueries({ queryKey: target.queryKey });
    },
  });
}

export function useDeleteAttachment(target: AttachmentTarget | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`${target!.itemBase}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      if (target) qc.invalidateQueries({ queryKey: target.queryKey });
    },
  });
}

// --- renewals ----------------------------------------------------------

export type RenewalType = "road_tax" | "insurance" | "inspection" | "warranty";

/** A row of GET /vehicles/:id/renewals -- the full history, newest expiry first. */
export interface Renewal {
  id: string;
  vehicleId: string;
  type: RenewalType;
  provider: string | null;
  referenceNo: string | null;
  issuedOn: string | null;
  expiresOn: string;
  cost: number | null;
  notes: string | null;
}

/**
 * A row of GET /vehicles/:id/renewals/status: the ACTIVE renewal per type,
 * with its status computed server-side against the owner's own "today".
 * snake_case because it is raw SQL, like the dashboard's own query.
 */
export interface RenewalStatus {
  id: string;
  type: RenewalType;
  expires_on: string;
  days_remaining: number;
  status: Exclude<Status, "unknown">;
}

export interface RenewalDraft {
  type: RenewalType;
  provider?: string;
  referenceNo?: string;
  issuedOn?: string;
  expiresOn: string;
  cost?: number;
  notes?: string;
}

export function useRenewals(vehicleId: string) {
  return useQuery({
    queryKey: ["renewals", vehicleId],
    queryFn: () => api<Renewal[]>(`/vehicles/${vehicleId}/renewals`),
  });
}

export function useRenewalStatus(vehicleId: string) {
  return useQuery({
    queryKey: ["renewal-status", vehicleId],
    queryFn: () => api<RenewalStatus[]>(`/vehicles/${vehicleId}/renewals/status`),
  });
}

/** Everything a renewal write can move: both lists and the attention list. */
function invalidateRenewals(qc: ReturnType<typeof useQueryClient>, vehicleId: string) {
  qc.invalidateQueries({ queryKey: ["renewals", vehicleId] });
  qc.invalidateQueries({ queryKey: ["renewal-status", vehicleId] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
}

/** Always an INSERT -- renewing never edits the previous row (invariant 8). */
export function useCreateRenewal(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RenewalDraft) =>
      api<{ id: string }>(`/vehicles/${vehicleId}/renewals`, { method: "POST", json: input }),
    onSuccess: () => invalidateRenewals(qc, vehicleId),
  });
}

/** Corrections to the words only. Dates and cost are refused server-side. */
export function useCorrectRenewal(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      provider?: string;
      referenceNo?: string;
      notes?: string;
    }) => api<Renewal>(`/renewals/${id}`, { method: "PATCH", json: patch }),
    onSuccess: () => invalidateRenewals(qc, vehicleId),
  });
}

/** For a row entered by mistake. Not how a real renewal is changed. */
export function useDeleteRenewal(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/renewals/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateRenewals(qc, vehicleId),
  });
}

/**
 * One row of a vehicle's schedule table (spec 8.2, 2026-09-20). Snake case
 * because it is the SQL row as-is, like MaintenanceRow.
 */
export interface ScheduleRow {
  part_type_id: string;
  part_name: string;
  part_category: string;
  is_custom: number;
  /** 0: tracked, but no longer fits the vehicle's fuel. Shown so it can be cleared. */
  applies: number;
  /** The owner's schedule. Both null: not tracked. */
  interval_km: number | null;
  interval_months: number | null;
  /** The manual's figure. A reference only; nothing is due from it. */
  maker_km: number | null;
  maker_months: number | null;
  /** The generic figure, for "reset to default". */
  default_km: number | null;
  default_months: number | null;
}

export interface ScheduleRowDraft {
  partTypeId: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  makerKm: number | null;
  makerMonths: number | null;
}

export function useSchedule(vehicleId: string) {
  return useQuery({
    queryKey: ["schedule", vehicleId],
    queryFn: () => api<ScheduleRow[]>(`/vehicles/${vehicleId}/schedule`),
  });
}

/**
 * Saves the rows the owner changed. The response is the whole new table, so
 * it is written straight into the cache rather than refetched.
 */
export function useSaveSchedule(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: ScheduleRowDraft[]) =>
      api<ScheduleRow[]>(`/vehicles/${vehicleId}/schedule`, {
        method: "PUT",
        json: { rows },
      }),
    onSuccess: (rows) => {
      qc.setQueryData(["schedule", vehicleId], rows);
      // Due points are computed from the schedule, so every status moves.
      qc.invalidateQueries({ queryKey: ["maintenance", vehicleId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface VehicleDraft {
  nickname: string;
  vehicleType?: VehicleType;
  // null clears the field on an edit; undefined leaves it alone. See
  // `vehiclePatch` in shared/zod for why the distinction is load-bearing.
  plate?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  fuelType?: "petrol" | "diesel" | "hybrid" | "ev" | null;
  transmission?: "manual" | "auto" | null;
  vin?: string | null;
  engineNo?: string | null;
  registeredOn?: string | null;
  colour?: string | null;
  currentOdometerKm?: number;
}

/**
 * Deliberately not optimistic, unlike odometer logging. The server assigns
 * the id and seeds this vehicle's maintenance intervals from the part-type
 * defaults, filtered by fuel type -- none of which the client can predict, so
 * there is nothing honest to render until it replies.
 */
export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VehicleDraft) =>
      api<VehicleCard>("/vehicles", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });
}

/**
 * Editing a vehicle's spec. The endpoint has existed since the API was
 * written; nothing in the client ever called it, which is why make, model and
 * year were write-once at creation and invisible afterwards.
 */
export function useUpdateVehicle(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: VehicleDraft) =>
      api<VehicleDetails>(`/vehicles/${id}`, { method: "PATCH", json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle", id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      // A fuel change moves which parts the schedule offers.
      qc.invalidateQueries({ queryKey: ["schedule", id] });
    },
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
