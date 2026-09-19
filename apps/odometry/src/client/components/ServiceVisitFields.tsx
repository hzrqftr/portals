import { SERVICE_TYPES, type ServiceTypeName } from "../api/hooks";
import { DATE_INPUT, Field, INPUT, Select, digitsOnly } from "@portals/core/client";

/**
 * What the visit was: when, at what odometer, of what type, and where.
 *
 * Split out of ServiceSheet alongside ServicePartsSection, so the sheet reads
 * as the four blocks it actually is -- the visit, the parts, the money, the
 * receipts -- rather than as one 400-line form. Stateless: every value and
 * setter belongs to the sheet's draft.
 */
export function ServiceVisitFields({
  servicedOn,
  odometer,
  serviceType,
  workshop,
  editing,
  onServicedOnChange,
  onOdometerChange,
  onServiceTypeChange,
  onWorkshopChange,
}: {
  servicedOn: string;
  odometer: string;
  serviceType: ServiceTypeName | "";
  workshop: string;
  editing: boolean;
  onServicedOnChange: (value: string) => void;
  onOdometerChange: (value: string) => void;
  /** Picking a type also merges that template's parts in -- see ServiceSheet. */
  onServiceTypeChange: (value: ServiceTypeName | "") => void;
  onWorkshopChange: (value: string) => void;
}) {
  return (
    <>
      {/* Stacked on a phone, paired from `sm` up. min-w-0 on Field stops
          the date control overlapping the odometer, but two columns at
          390px still leaves each field about 130px of text room for a
          control the platform draws to its own taste -- and this form gets
          filled in standing at a workshop counter, where a full-width tap
          target is worth more than a tidy pair. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date">
          <input
            type="date"
            value={servicedOn}
            onChange={(e) => onServicedOnChange(e.target.value)}
            // Capped on a phone. Stacking fixed the overlap, but a date is
            // a short fixed-length value and a full-bleed control for it
            // reads as a mistake. From `sm` it shares a row with the
            // odometer again and fills its own column.
            className={DATE_INPUT + " max-w-[13rem] sm:max-w-none"}
          />
        </Field>
        <Field label="Odometer (km)">
          <input
            type="text"
            inputMode="numeric"
            value={odometer}
            onChange={(e) => onOdometerChange(digitsOnly(e.target.value))}
            className={INPUT + " tabular-nums"}
          />
        </Field>
      </div>

      {editing && (
        // Said here rather than discovered afterwards. Correcting the date
        // or odometer also moves every maintenance due point derived from
        // this visit -- invariant 6 working correctly, and alarming if it
        // arrives unannounced.
        <p className="mt-1 text-xs text-ink-faint">
          Correcting the date or odometer also corrects the reading this visit
          recorded, and moves anything due from it.
        </p>
      )}

      <Field label="Type of service">
        <Select
          className="mt-1"
          value={serviceType}
          onChange={(e) => onServiceTypeChange(e.target.value as ServiceTypeName | "")}
        >
          <option value="">Not specified</option>
          {SERVICE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Workshop">
        <input
          value={workshop}
          onChange={(e) => onWorkshopChange(e.target.value)}
          className={INPUT}
        />
      </Field>
    </>
  );
}
