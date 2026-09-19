import { makeDb } from "./base";
import { VehicleRepo } from "./vehicles";
import { ServiceRepo } from "./services";
import {
  AttachmentRepo,
  SERVICE_RECEIPTS,
  RENEWAL_DOCUMENTS,
  VEHICLE_GRANT,
} from "./attachments";
import { RenewalRepo } from "./renewals";
import { StatusRepo } from "./status";
import { PartTypeRepo } from "./partTypes";
import { SettingsRepo } from "./settings";
import { ServiceTemplateRepo } from "./serviceTemplates";
import { DashboardRepo } from "./dashboard";
import { FuelRepo } from "./fuel";
import type { Env, Scope } from "../types";

export interface Repos {
  vehicles: VehicleRepo;
  services: ServiceRepo;
  /** Receipts on service records. The name predates the other two owners. */
  attachments: AttachmentRepo;
  renewalDocuments: AttachmentRepo;
  grantDocuments: AttachmentRepo;
  renewals: RenewalRepo;
  status: StatusRepo;
  partTypes: PartTypeRepo;
  settings: SettingsRepo;
  serviceTemplates: ServiceTemplateRepo;
  dashboard: DashboardRepo;
  fuel: FuelRepo;
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
    services: new ServiceRepo(db, raw, scope, env),
    attachments: new AttachmentRepo(db, raw, scope, env, SERVICE_RECEIPTS),
    renewalDocuments: new AttachmentRepo(db, raw, scope, env, RENEWAL_DOCUMENTS),
    grantDocuments: new AttachmentRepo(db, raw, scope, env, VEHICLE_GRANT),
    renewals: new RenewalRepo(db, raw, scope, env),
    status: new StatusRepo(db, raw, scope),
    partTypes: new PartTypeRepo(db, raw, scope),
    settings: new SettingsRepo(env, scope),
    serviceTemplates: new ServiceTemplateRepo(db, raw, scope),
    dashboard: new DashboardRepo(db, raw, scope),
    fuel: new FuelRepo(db, raw, scope),
  };
}

export {
  VehicleRepo,
  ServiceRepo,
  AttachmentRepo,
  RenewalRepo,
  StatusRepo,
  PartTypeRepo,
  SettingsRepo,
  ServiceTemplateRepo,
  FuelRepo,
};
