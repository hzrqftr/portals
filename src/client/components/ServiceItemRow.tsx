import { useState } from "react";
import { useBrandSuggestions } from "../api/hooks";
import { INPUT, digitsOnly } from "./form";
import { formatKm } from "../lib/format";
import { specPlaceholder } from "../lib/partCategories";

/**
 * One line item on a service. Spec 8.4.
 *
 * A line item is what actually resets a maintenance clock (invariant 7), so
 * this is the part of the form that matters most and the part most worth
 * keeping short. Brand, spec, cost and warranty are all optional -- a part
 * fitted is a fact worth recording even when the receipt is lost.
 */

export interface ItemDraft {
  key: string;
  partTypeId: string;
  partName: string;
  brand: string;
  spec: string;
  quantity: string;
  unitCost: string;
  warrantyMonths: string;
  /** Absolute odometer figure, as the workshop sticker writes it. "" = default. */
  nextDueKm: string;
}

export function ServiceItemRow({
  item,
  partTypeCode,
  defaultNextDueKm,
  odometerKm,
  onChange,
  onRemove,
}: {
  item: ItemDraft;
  partTypeCode: string;
  /** odometer + this part's configured interval, or null if it has none. */
  defaultNextDueKm: number | null;
  odometerKm: number | null;
  onChange: (next: ItemDraft) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const brands = useBrandSuggestions(item.partTypeId);
  const set = (patch: Partial<ItemDraft>) => onChange({ ...item, ...patch });

  // Shown filled with the derived default until the user overrides it. The
  // default follows the odometer field, so correcting the odometer corrects
  // this too -- which is the same property the stored interval gives us on
  // the server side.
  const shownNextDue =
    item.nextDueKm !== "" ? item.nextDueKm : defaultNextDueKm !== null ? String(defaultNextDueKm) : "";

  const typedNextDue = item.nextDueKm === "" ? null : Number(item.nextDueKm);
  const nextDueTooLow =
    typedNextDue !== null && odometerKm !== null && typedNextDue <= odometerKm;

  return (
    <li className="rounded-xl border border-edge bg-inset p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{item.partName}</p>
        <button
          onClick={onRemove}
          aria-label={`Remove ${item.partName}`}
          className="shrink-0 px-2 text-ink-faint hover:text-ink"
        >
          &times;
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          list={`brands-${item.key}`}
          value={item.brand}
          onChange={(e) => set({ brand: e.target.value })}
          placeholder="Brand"
          className={INPUT + " mt-0 py-2"}
        />
        <datalist id={`brands-${item.key}`}>
          {brands.data?.map((b) => (
            <option key={b.brand} value={b.brand} />
          ))}
        </datalist>

        <input
          value={item.spec}
          onChange={(e) => set({ spec: e.target.value })}
          placeholder={specPlaceholder(partTypeCode)}
          className={INPUT + " mt-0 py-2"}
        />
      </div>

      <label className="mt-2 block">
        <span className="text-xs text-ink-muted">Next due at</span>
        <div className="flex items-baseline gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={shownNextDue}
            onChange={(e) => set({ nextDueKm: digitsOnly(e.target.value) })}
            placeholder="not tracked"
            className={INPUT + " mt-0 py-2 tabular-nums"}
          />
          <span className="text-sm text-ink-faint">km</span>
        </div>
      </label>
      {nextDueTooLow ? (
        <p className="mt-1 text-xs text-status-overdue-fg">
          Must be past the service odometer of {formatKm(odometerKm)}.
        </p>
      ) : (
        defaultNextDueKm === null &&
        item.nextDueKm === "" && (
          <p className="mt-1 text-xs text-ink-faint">
            No interval set for this part &mdash; enter one to start tracking it.
          </p>
        )
      )}

      {open ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-xs text-ink-muted">Qty</span>
            <input
              type="text"
              inputMode="decimal"
              value={item.quantity}
              onChange={(e) => set({ quantity: e.target.value.replace(/[^0-9.]/g, "") })}
              placeholder="1"
              className={INPUT + " mt-0 py-2"}
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">Unit RM</span>
            <input
              type="text"
              inputMode="decimal"
              value={item.unitCost}
              onChange={(e) => set({ unitCost: e.target.value.replace(/[^0-9.]/g, "") })}
              placeholder="0.00"
              className={INPUT + " mt-0 py-2"}
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted">Warranty</span>
            <input
              type="text"
              inputMode="numeric"
              value={item.warrantyMonths}
              onChange={(e) => set({ warrantyMonths: digitsOnly(e.target.value) })}
              placeholder="months"
              className={INPUT + " mt-0 py-2"}
            />
          </label>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-2 text-xs text-ink-faint underline">
          Cost, quantity and warranty
        </button>
      )}
    </li>
  );
}
