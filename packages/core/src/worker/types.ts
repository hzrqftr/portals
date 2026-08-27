/**
 * Bindings and identity shared by every portal.
 *
 * Each app extends `CoreEnv` with its own bindings (ASSETS, R2, queues) rather
 * than widening this one -- a binding only one portal has does not belong in
 * the type both portals import.
 */
export interface CoreEnv {
  DB: D1Database;
  ENVIRONMENT: string;

  /**
   * Access team domain and application audience tag, used only to verify the
   * Cf-Access-Jwt-Assertion header when the runtime does not populate
   * ctx.access. See auth.ts. Both must be set for that fallback to engage;
   * with either missing, requests without a runtime identity are rejected.
   *
   * ACCESS_AUD differs per portal: each has its own Access application, and
   * accepting the other's audience would let a token minted for one portal
   * open the other.
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/**
 * Who is making the request. Deliberately the whole of it: identity is an
 * email and a display name, and nothing about what that person may see.
 * Authorisation is each portal's own scope object, resolved separately.
 */
export interface AuthUser {
  email: string;
  name: string | null;
}
