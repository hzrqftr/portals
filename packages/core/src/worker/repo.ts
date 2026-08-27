import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { and, type SQL } from "drizzle-orm";

/**
 * THE ONLY PLACE env.DB IS TOUCHED, alongside each app's data/ folder.
 * Invariant 2.
 *
 * D1 has no row-level security. There is nothing behind this code to catch a
 * missing tenant predicate -- a forgotten `WHERE` is not a bug that returns
 * too many rows, it is one user reading another user's data, and the database
 * hands it over without complaint.
 *
 * This base exists so the predicate cannot be left off by accident: `where()`
 * folds in `tenantPredicate()` on every call, and `tenantPredicate` is
 * abstract, so a subclass must state which column carries ownership. It
 * cannot inherit a default and quietly get it wrong.
 *
 * The two portals deliberately use DIFFERENT axes -- Odometry scopes by
 * garage so a household can share a fleet; Coinbox scopes by ledger so that
 * sharing a garage never exposes a ledger. That divergence is the whole
 * reason this is a parameter rather than a hardcoded column.
 */
export abstract class BaseScopedRepo<
  TSchema extends Record<string, unknown>,
  TScope,
  TTable = object,
> {
  constructor(
    protected readonly db: DrizzleD1Database<TSchema>,
    protected readonly raw: D1Database,
    protected readonly scope: TScope,
  ) {}

  /**
   * The tenant predicate. Every query in every subclass starts from this.
   * Implementations return an equality on whichever column carries ownership.
   */
  protected abstract tenantPredicate(table: TTable): SQL;

  /**
   * Combine further conditions through this rather than building a bare
   * `where()` clause, so the tenant predicate cannot be omitted.
   */
  protected where<T extends TTable>(table: T, ...conditions: (SQL | undefined)[]): SQL {
    return and(this.tenantPredicate(table), ...conditions) as SQL;
  }
}

/**
 * Builds the Drizzle client for a given schema. The schema is a parameter
 * because each portal has its own tables; a shared client closing over one
 * app's schema would silently type the other app's queries as unknown.
 */
export function makeDb<TSchema extends Record<string, unknown>>(
  binding: D1Database,
  schema: TSchema,
): { db: DrizzleD1Database<TSchema>; raw: D1Database } {
  return { db: drizzle(binding, { schema }), raw: binding };
}
