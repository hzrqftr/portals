import { useState } from "react";
import { senToInput, fromQuantityMilli } from "@portals/core";
import type { ServiceRecord, ServiceTypeName } from "../api/hooks";
import type { ItemDraft } from "./ServiceItemRow";

/**
 * The form state behind ServiceSheet, seeded either blank (logging a new
 * visit) or from a saved record (correcting one).
 *
 * Split out of the sheet because seeding an EDIT is where the round trip can
 * quietly go wrong -- every value the form holds is a string, and the stored
 * shapes are sen, thousandths and an interval. Getting one of those inverses
 * wrong shows up as a figure that changes by itself when a record is opened
 * and saved untouched, which is exactly the class of bug nobody notices.
 */
export interface ServiceDraftState {
  servicedOn: string;
  odometer: string;
  serviceType: ServiceTypeName | "";
  workshop: string;
  labourCost: string;
  notes: string;
  items: ItemDraft[];
}

/**
 * `nextDueKm` is seeded from the ABSOLUTE figure the API already reconstructs
 * (`sr.odometer_km + si.interval_km_override`, see worker/data/services.ts),
 * which is the same absolute figure the form asks the user to type. The sheet
 * converts it back to an interval on save, so a record opened and saved
 * unchanged writes back exactly what it held.
 */
export function useServiceDraft(record: ServiceRecord | undefined, today: string, currentKm: number) {
  const [state, setState] = useState<ServiceDraftState>(() =>
    record ? fromRecord(record) : blank(today, currentKm),
  );

  const set = <K extends keyof ServiceDraftState>(key: K, value: ServiceDraftState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  return [state, set, setState] as const;
}

function blank(today: string, currentKm: number): ServiceDraftState {
  return {
    servicedOn: today,
    // Blank rather than "0" when the vehicle has no odometer yet: a prefilled
    // zero is a number the user can save without reading.
    odometer: String(currentKm || ""),
    serviceType: "",
    workshop: "",
    labourCost: "",
    notes: "",
    items: [],
  };
}

function fromRecord(record: ServiceRecord): ServiceDraftState {
  return {
    servicedOn: record.servicedOn,
    odometer: String(record.odometerKm),
    serviceType: record.serviceType ?? "",
    workshop: record.workshopName ?? "",
    labourCost: senToInput(record.labourCost),
    notes: record.notes ?? "",
    items: record.items.map((item) => ({
      key: item.id,
      partTypeId: item.partTypeId,
      partName: item.partName ?? "Part",
      brand: item.brand ?? "",
      spec: item.spec ?? "",
      note: item.note ?? "",
      // "" means "1", which is what the sheet's save path assumes. Writing
      // "1" here instead would be equivalent but noisier on screen.
      quantity: item.quantityMilli === 1000 ? "" : String(fromQuantityMilli(item.quantityMilli)),
      unitCost: senToInput(item.unitCost),
      warrantyMonths: item.warrantyMonths === null ? "" : String(item.warrantyMonths),
      nextDueKm: item.nextDueKm === null ? "" : String(item.nextDueKm),
    })),
  };
}
