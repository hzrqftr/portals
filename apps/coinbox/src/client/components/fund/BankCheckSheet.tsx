import { useState } from "react";
import { DATE_INPUT, Field, INPUT, Sheet, SheetActions } from "@portals/core/client";
import { parseSen } from "@portals/core";
import { useCreateFundCheck } from "../../api/hooks";

/**
 * "What does the bank say?" -- typed in from the banking app.
 *
 * Compared with the recorded pot as at the same date, never applied to it: a
 * mistyped balance cannot change a total. History is kept, so a shortfall can
 * be traced back to when it opened.
 */
export function BankCheckSheet({ today, onClose }: { today: string; onClose: () => void }) {
  const create = useCreateFundCheck();
  const [amount, setAmount] = useState("");
  const [checkedOn, setCheckedOn] = useState(today);
  const balanceSen = parseSen(amount);
  const valid = amount.trim() !== "" && balanceSen !== null && balanceSen >= 0 && checkedOn !== "";

  return (
    <Sheet title="Check the bank" onClose={onClose}>
      <h2 className="pr-9 text-lg font-semibold">Check the bank</h2>
      <p className="mt-2 text-sm text-ink-muted">
        The fund account's balance, as your bank shows it. A little more than recorded is normal
        (dividends). Less means something recorded never arrived, or was spent unrecorded.
      </p>

      <Field label="Balance">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint">
            RM
          </span>
          <input
            className={INPUT + " pl-12 text-lg tabular-nums"}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
      </Field>

      <Field label="As of">
        <input
          className={DATE_INPUT}
          type="date"
          value={checkedOn}
          onChange={(e) => setCheckedOn(e.target.value)}
        />
      </Field>

      {create.isError && (
        <p className="mt-2 text-sm text-status-overdue-fg">{(create.error as Error).message}</p>
      )}

      <SheetActions
        onCancel={onClose}
        onConfirm={() =>
          balanceSen !== null && create.mutate({ checkedOn, balanceSen }, { onSuccess: onClose })
        }
        confirmLabel="Save check"
        busy={create.isPending}
        disabled={!valid}
      />
    </Sheet>
  );
}
