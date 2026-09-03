import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@portals/core/client";
import type { TransactionCreate, TransactionPatch } from "@shared/zod";

interface Me {
  userId: string;
  ledgerId: string;
  timezone: string;
  currency: string;
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
}

// ---------------------------------------------------------------- reference

export interface Category {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}

export interface Vehicle {
  id: string;
  nickname: string;
  /** Cached current reading, so the entry form can sanity-check a new one. */
  currentOdometerKm: number;
}

/** Reference data, so it is worth a staleTime -- 16 rows that rarely change. */
export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/categories"),
    staleTime: 5 * 60_000,
  });
}

export function useVehicles() {
  return useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api<Vehicle[]>("/vehicles"),
    staleTime: 5 * 60_000,
  });
}

// ------------------------------------------------------------------- ledger

export interface Transaction {
  id: string;
  occurredOn: string;
  item: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  vehicleId: string | null;
  amountSen: number;
  direction: "in" | "out";
  /** 1 when a recurring rule posted this row rather than the owner typing it. */
  isRecurring: number;
}

export interface TransactionFilters {
  month?: string;
  categoryId?: string;
  direction?: "in" | "out";
  q?: string;
  /** "1" = only auto-posted, "0" = only typed. Absent shows both. */
  recurring?: "0" | "1";
}

export interface MonthSummary {
  month: string;
  in_sen: number;
  out_sen: number;
  net_sen: number;
  txn_count: number;
}

function queryString(filters: TransactionFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function useTransactions(filters: TransactionFilters = {}) {
  return useQuery({
    // Filters are part of the key, so each distinct view is cached separately
    // rather than clobbering the last one.
    queryKey: ["transactions", filters],
    queryFn: () => api<Transaction[]>(`/transactions${queryString(filters)}`),
  });
}

export function useSummary(month?: string) {
  return useQuery({
    queryKey: ["summary", month ?? "all"],
    queryFn: () => api<MonthSummary[]>(`/summary${month ? `?month=${month}` : ""}`),
  });
}

/**
 * The POST body, taken FROM THE ZOD SCHEMA rather than restated here.
 *
 * It used to be a hand-written mirror, which compiled happily while drifting
 * from the schema it was supposed to match -- the only thing that would have
 * caught a divergence was a 422 at runtime. `import type` is erased at build
 * time, so this costs nothing in the bundle and cannot go stale.
 */
export type TransactionDraft = TransactionCreate;

/**
 * Deliberately not optimistic.
 *
 * The one optimistic mutation in this workspace is Odometry's odometer update,
 * and its comment explains why it is the exception: a considered write should
 * wait for the server, because the row that comes back is the truth. Money is
 * the last thing that should appear in a list before it exists.
 */
export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransactionDraft) =>
      api<Transaction>("/transactions", { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/**
 * Patch one transaction, id passed at call time rather than at hook time.
 *
 * The table needs this: `useUpdateTransaction(id)` binds an id when the hook
 * is created, which is fine for a sheet editing one row and impossible for a
 * grid where any of 648 rows might be the next one touched. Hooks cannot be
 * called in a loop.
 */
export function usePatchTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TransactionPatch }) =>
      api<Transaction>(`/transactions/${id}`, { method: "PATCH", json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateTransaction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: TransactionPatch) =>
      api<Transaction>(`/transactions/${id}`, { method: "PATCH", json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ---------------------------------------------------------------- recurring

export interface RecurringRule {
  id: string;
  item: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  vehicleId: string | null;
  amountSen: number;
  direction: "in" | "out";
  intervalMonths: number;
  dayOfMonth: number;
  startsOn: string;
  endsOn: string | null;
  isActive: number;
  /** From the claims table, so it reflects what actually posted. */
  lastPostedOn: string | null;
  postedCount: number;
}

export interface RecurringDraft {
  item: string;
  description?: string | null;
  categoryId: string;
  vehicleId?: string | null;
  amountSen: number;
  direction: "in" | "out";
  intervalMonths: number;
  dayOfMonth: number;
  startsOn: string;
  endsOn?: string | null;
  isActive?: boolean;
}

export function useRecurring() {
  return useQuery({
    queryKey: ["recurring"],
    queryFn: () => api<RecurringRule[]>("/recurring"),
  });
}

/**
 * Rule mutations leave the ledger and the summary alone -- editing a schedule
 * posts nothing until the nightly run. They DO move the dashboard, because
 * "committed in the next 30 days" is projected from the rules themselves
 * rather than from anything that has been written yet.
 */
export function useCreateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecurringDraft) =>
      api<RecurringRule>("/recurring", { method: "POST", json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function usePatchRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<RecurringDraft> }) =>
      api<RecurringRule>(`/recurring/${id}`, { method: "PATCH", json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/recurring/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/**
 * Deleting an entry. Not optimistic, like every other mutation here: money
 * must not appear -- or disappear -- before the server has agreed.
 */
export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// -------------------------------------------------------------- dashboard

export interface MonthPoint {
  month: string;
  inSen: number;
  outSen: number;
  netSen: number;
  txnCount: number;
  /** Running total from the first month with data. The Sheet's "Total Loss". */
  cumulativeSen: number;
}

export interface CategoryEffect {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  netSen: number;
  normalSen: number;
  /** Positive helped the month's balance, negative cost it. */
  effectSen: number;
}

export interface UpcomingPosting {
  ruleId: string;
  item: string;
  categoryName: string;
  occurredOn: string;
  amountSen: number;
  direction: "in" | "out";
}

export interface VehicleCost {
  vehicleId: string;
  nickname: string;
  spendSen: number;
  distanceKm: number;
  senPerKm: number | null;
  txnCount: number;
  /** False when there are too few entries, or no odometer movement, to trust. */
  confident: boolean;
}

export interface Dashboard {
  today: string;
  month: string;
  months: MonthPoint[];
  ytdNetSen: number;
  focus: {
    month: string;
    inSen: number;
    outSen: number;
    netSen: number;
    txnCount: number;
    previousMonth: string | null;
    momDeltaSen: number | null;
    trailingOutAvgSen: number | null;
    categories: CategoryEffect[];
  };
  committed: {
    days: number;
    netSen: number;
    count: number;
    upcoming: UpcomingPosting[];
  };
  lastEntryOn: string | null;
  lastTypedEntryOn: string | null;
  daysSinceTypedEntry: number | null;
  vehicles: VehicleCost[];
}

/**
 * The whole landing page in one request.
 *
 * `month` is part of the key, so clicking through the year chart caches each
 * month separately rather than refetching the one you just left.
 *
 * `placeholderData` keeps the previous payload on screen while the next one
 * loads. Without it, selecting a month blanks the very chart you clicked --
 * the monthly series comes back identical every time, so re-rendering it from
 * scratch is a flicker with nothing behind it.
 */
export function useDashboard(month?: string) {
  return useQuery({
    queryKey: ["dashboard", month ?? "current"],
    queryFn: () => api<Dashboard>(`/dashboard${month ? `?month=${month}` : ""}`),
    placeholderData: (previous) => previous,
  });
}
