import type { Env, Scope } from "../types";
import { makeDb } from "./base";
import { TransactionRepo } from "./transactions";
import { CategoryRepo, VehicleRepo } from "./categories";
import { RecurringRepo } from "./recurring";

/**
 * Repository factory. Route handlers receive these already scoped and never
 * see the binding.
 *
 * `transactions` and `categories` carry the ledger predicate through
 * LedgerScopedRepo. `vehicles` is the deliberate exception -- it answers
 * Odometry's garage question, because that is the axis vehicles live on. See
 * the comment on VehicleRepo before assuming that is a bug.
 */
export interface Repos {
  transactions: TransactionRepo;
  categories: CategoryRepo;
  vehicles: VehicleRepo;
  recurring: RecurringRepo;
}

export function makeRepos(env: Env, scope: Scope): Repos {
  const { db, raw } = makeDb(env);
  return {
    transactions: new TransactionRepo(db, raw, scope),
    categories: new CategoryRepo(db, raw, scope),
    vehicles: new VehicleRepo(db, raw, scope),
    recurring: new RecurringRepo(db, raw, scope),
  };
}
