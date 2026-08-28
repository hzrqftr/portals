import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@portals/core/client";

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
}

export interface TransactionFilters {
  month?: string;
  categoryId?: string;
  direction?: "in" | "out";
  q?: string;
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

export interface TransactionDraft {
  occurredOn: string;
  item: string;
  description?: string | null;
  categoryId: string;
  vehicleId?: string | null;
  amountSen: number;
  direction: "in" | "out";
}

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
    },
  });
}

export function useUpdateTransaction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TransactionDraft>) =>
      api<Transaction>(`/transactions/${id}`, { method: "PATCH", json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}
