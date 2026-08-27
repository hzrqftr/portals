import { useQuery } from "@tanstack/react-query";
import { api } from "@portals/core/client";

export interface Me {
  userId: string;
  ledgerId: string;
  timezone: string;
  currency: string;
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
}
