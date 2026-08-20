import { makeDb } from "./base";
import { VehicleRepo } from "./vehicles";
import { ServiceRepo } from "./services";
import { RenewalRepo } from "./renewals";
import { StatusRepo } from "./status";
import { PartTypeRepo } from "./partTypes";
import { SettingsRepo } from "./settings";
import { DashboardRepo } from "./dashboard";
import type { Env, Scope } from "../types";

export interface Repos {
  vehicles: VehicleRepo;
  services: ServiceRepo;
  renewals: RenewalRepo;
  status: StatusRepo;
  partTypes: PartTypeRepo;
  settings: SettingsRepo;
  dashboard: DashboardRepo;
}

/**
 * Built once per request from the resolved scope. Handlers get this object
 * and nothing else -- they never see env.DB, so they cannot write a query
 * that forgets the garage predicate.
 */
export function makeRepos(env: Env, scope: Scope): Repos {
  const { db, raw } = makeDb(env);
  return {
    vehicles: new VehicleRepo(db, raw, scope),
    services: new ServiceRepo(db, raw, scope),
    renewals: new RenewalRepo(db, raw, scope),
    status: new StatusRepo(db, raw, scope),
    partTypes: new PartTypeRepo(db, raw, scope),
    settings: new SettingsRepo(env, scope),
    dashboard: new DashboardRepo(db, raw, scope),
  };
}

export { VehicleRepo, ServiceRepo, RenewalRepo, StatusRepo, PartTypeRepo, SettingsRepo };
