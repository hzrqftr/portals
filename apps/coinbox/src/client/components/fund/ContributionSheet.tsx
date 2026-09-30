import { useState } from "react";
import { DATE_INPUT, Field, INPUT, Sheet, SheetActions } from "@portals/core/client";
import { formatSen, parseSen, senToInput } from "@portals/core";
import {
  useCreateFundEntry,
  useDeleteFundEntry,
  type FundContribution,
  type FundMember,
} from "../../api/hooks";
import { monthLabel } from "../StatTiles";
import { monthActions } from "@shared/fundGrid";

/**
 * One member, one month: what is recorded, and a way to record more.
 *
 * Opened by tapping a grid cell. Two outcomes, because contributions are not a
 * fixed amount: PAID (the amount pre-fills with the member's usual figure and
 * can be changed), or SKIPPED BY AGREEMENT, which records RM 0.00 so the month
 * reads as accounted for rather than forgotten.
 *
 * A month holds ONE state. Skipping replaces a hand-entered payment (after a
 * second tap, since it deletes a money record), and paying replaces a skip; the
 * server does the delete and insert in one batch. Which applies is decided by
 * monthActions() in @shared/fundGrid, tested in tests/fund-grid-logic.test.ts.
 *
 * A contribution posted by a recurring entry is shown but not deletable here:
 * it is the same payment as a ledger row, and is removed from the Ledger,
 * which takes the pot's copy with it.
 */
export function ContributionSheet({
  member,
  month,
  existing,
  today,
  onClose,
}: {
  member: FundMember;
  month: string;
  existing: FundContribution[];
  today: string;
  onClose: () => void;
}) {
  const create = useCreateFundEntry();
  const del = useDeleteFundEntry();
  const [amount, setAmount] = useState(senToInput(member.defaultSen));
  const [occurredOn, setOccurredOn] = useState(today);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const actions = monthActions(existing);

  const amountSen = parseSen(amount);
  // Blank is a slip; a typed 0 would be a skip, which has its own button.
  const valid = amount.trim() !== "" && amountSen !== null && amountSen > 0 && occurredOn !== "";

  function record(sen: number, replaceMonth: boolean) {
    create.mutate(
      { memberId: member.id, forMonth: month, amountSen: sen, direction: "in", occurredOn, replaceMonth },
      { onSuccess: onClose },
    );
  }

  function skip() {
    // Skipping over money deletes a record: ask once more, naming the amount.
    if (actions.removesSen > 0 && !confirmSkip) {
      setConfirmSkip(true);
      return;
    }
    record(0, true);
  }

  const title = `${member.name} · ${monthLabel(month)}`;

  return (
    <Sheet title={title} onClose={onClose}>
      <h2 className="pr-9 text-lg font-semibold">{title}</h2>

      {existing.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {existing.map((c) => (
            <li key={c.id} className="rounded-xl border border-edge bg-inset p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {c.amountSen === 0 ? "Skipped (agreed)" : formatSen(c.amountSen)}
                  <span className="text-ink-faint"> · {c.occurredOn}</span>
                </span>
                {c.transactionId ? (
                  <span className="text-xs text-ink-faint">from your recurring entry</span>
                ) : confirming === c.id ? (
                  <button
                    type="button"
                    onClick={() => del.mutate(c.id, { onSuccess: onClose })}
                    className="rounded-lg bg-status-overdue-fg px-3 py-1 text-page"
                  >
                    Confirm delete
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(c.id)}
                    className="text-ink-muted hover:text-status-overdue-fg"
                  >
                    Delete
                  </button>
                )}
              </div>
              {c.transactionId && (
                <p className="mt-1 text-xs text-ink-faint">
                  To remove it, delete that entry in the Ledger. The pot follows.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-sm text-ink-muted">
        {actions.isSkipped
          ? "Skipped by agreement. A payment recorded below replaces the skip."
          : existing.length
            ? "Record another payment for this month (adds to it)"
            : "Record this month"}
      </p>

      <Field label="Amount">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint">
            RM
          </span>
          <input
            className={INPUT + " pl-12 text-lg tabular-nums"}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
      </Field>

      <Field label="Paid on">
        <input
          className={DATE_INPUT}
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
        />
      </Field>

      {(create.isError || del.isError) && (
        <p className="mt-2 text-sm text-status-overdue-fg">
          {((create.error ?? del.error) as Error).message}
        </p>
      )}

      <SheetActions
        onCancel={onClose}
        onConfirm={() => amountSen !== null && record(amountSen, actions.paymentReplaces)}
        confirmLabel={actions.paymentReplaces ? "Record payment instead" : "Record payment"}
        busy={create.isPending}
        disabled={!valid}
      />
      {actions.canSkip && (
        <button
          type="button"
          onClick={skip}
          disabled={create.isPending || occurredOn === ""}
          className={
            "mt-3 w-full rounded-xl py-3 text-sm disabled:opacity-40 " +
            (confirmSkip
              ? "bg-status-overdue-fg font-medium text-page"
              : "border border-edge text-ink-muted hover:text-ink")
          }
        >
          {actions.removesSen === 0
            ? "Skipped this month by agreement (RM 0.00)"
            : confirmSkip
              ? `Confirm: remove ${formatSen(actions.removesSen)} and mark skipped`
              : `Mark as skipped instead (removes ${formatSen(actions.removesSen)})`}
        </button>
      )}
      {actions.hasLinked && (
        <p className="mt-3 text-xs text-ink-faint">
          This month was paid by your recurring entry, so it cannot be marked skipped here.
        </p>
      )}
    </Sheet>
  );
}
