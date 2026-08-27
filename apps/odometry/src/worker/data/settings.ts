import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { users, userSettings, garages, garageMembers } from "../schema";
import type { Env, Scope } from "../types";
import * as schema from "../schema";

/**
 * Settings are scoped by user_id rather than garage_id -- they belong to a
 * person, not a garage, so two members of the same garage can have different
 * due-soon thresholds and see different attention lists over the same data.
 */
export class SettingsRepo {
  private readonly db;
  constructor(
    env: Env,
    private readonly scope: Scope,
  ) {
    this.db = drizzle(env.DB, { schema });
  }

  async me() {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, this.scope.userId))
      .limit(1);
    const [settings] = await this.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, this.scope.userId))
      .limit(1);
    const memberships = await this.db
      .select({
        garageId: garages.id,
        name: garages.name,
        role: garageMembers.role,
      })
      .from(garageMembers)
      .innerJoin(garages, eq(garages.id, garageMembers.garageId))
      .where(eq(garageMembers.userId, this.scope.userId));

    return { user, settings, garages: memberships, activeGarageId: this.scope.garageId };
  }

  /**
   * timezone lives on `users` while the rest live on `user_settings`, so a
   * settings save can touch two tables. batch() keeps it atomic -- a timezone
   * that saved while the thresholds did not would quietly shift every due
   * date the user sees.
   */
  async update(patch: {
    timezone?: string;
    distanceUnit?: "km" | "mi";
    currency?: string;
    dateFormat?: string;
    dueSoonDays?: number;
    dueSoonKm?: number;
    fallbackKmPerDay?: number;
    staleOdometerDays?: number;
  }) {
    const { timezone, ...rest } = patch;
    if (timezone !== undefined) {
      await this.db.update(users).set({ timezone }).where(eq(users.id, this.scope.userId));
    }
    if (Object.keys(rest).length > 0) {
      await this.db
        .update(userSettings)
        .set(rest)
        .where(eq(userSettings.userId, this.scope.userId));
    }
    return this.me();
  }
}
