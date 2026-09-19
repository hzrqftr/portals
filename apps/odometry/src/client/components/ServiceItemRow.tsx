import { useState } from "react";
import { useBrandSuggestions } from "../api/hooks";
import { INPUT, digitsOnly } from "@portals/core/client";
import { specPlaceholder } from "../lib/partCategories";
import type { ScheduleCheck } from "./scheduleCheck";
import { ScheduleNotice } from "./ScheduleNotice";

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
  /** Free text about THIS part, e.g. "incl. RM28 O-ring". Max 200 server-side. */
  note: string;
  quantity: string;
  unitCost: string;
  warrantyMonths: string;
  /**
   * The owner chose to change this part's schedule on this visit. Off by
   * default: a service leaves the schedule alone unless asked (2026-09-20).
   */
  adopting: boolean;
  /** The new interval while adopting. "" leaves that half unchanged. */
  adoptKm: string;
  adoptMonths: string;
}

export function ServiceItemRow({
  item,
  partTypeCode,
  check,
  partDefault,
  onChange,
  onRemove,
}: {
  item: ItemDraft;
  partTypeCode: string;
  /** How this replacement sits against the schedule. Null when editing a saved visit. */
  check: ScheduleCheck | null;
  partDefault: { km: number | null; months: number | null };
  onChange: (next: ItemDraft) => void;
  onRemove: () => void;
}) {
  // Collapsed for a part just added, open for one that already carries any of
  // these. Correcting a record must not hide the values it holds behind a
  // button the owner has no reason to press -- a note or a cost that is only
  // visible after a click reads as data that was lost.
  const [open, setOpen] = useState(
    item.unitCost !== "" ||
      item.quantity !== "" ||
      item.warrantyMonths !== "" ||
      item.note !== "",
  );
  const brands = useBrandSuggestions(item.partTypeId);
  const set = (patch: Partial<ItemDraft>) => onChange({ ...item, ...patch });

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

      {check && <ScheduleNotice check={check} item={item} partDefault={partDefault} onChange={set} />}

      {open ? (
        <>
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

          {/*
            Full width and below the costs, not beside them. It sits in this
            disclosure rather than next to Brand and Spec because the case that
            earns it is annotating a PRICE -- a fuel filter billed at RM 76
            where RM 28 of it was the O-ring. Brand and spec identify the part;
            this explains the number.
          */}
          <label className="mt-2 block">
            <span className="text-xs text-ink-muted">Note</span>
            <input
              value={item.note}
              onChange={(e) => set({ note: e.target.value.slice(0, 200) })}
              placeholder="Anything about this part"
              className={INPUT + " mt-0 py-2"}
            />
          </label>
        </>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-2 text-xs text-ink-faint underline">
          Cost, quantity and notes
        </button>
      )}
    </li>
  );
}
