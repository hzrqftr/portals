import type { Env, Scope } from "../types";
import { makeDb } from "./base";

/**
 * Repository factory. Route handlers receive these already scoped and never
 * see the binding.
 *
 * Empty for now: the transactions and categories schema is an open design
 * question (see docs/coinbox-spec.md) and has deliberately not been written.
 * The wiring exists so that adding the first repository is adding a line
 * here, not introducing a pattern.
 */
export interface Repos {
  // transactions: TransactionRepo;
  // categories: CategoryRepo;
}

export function makeRepos(env: Env, _scope: Scope): Repos {
  // Touches the binding so the shape is proven before there is a repo to use
  // it, and so `makeDb` is not dead code the typechecker prunes.
  void makeDb(env);
  return {};
}
