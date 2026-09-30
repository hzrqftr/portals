import type { ReactNode } from "react";
import { formatSen } from "@portals/core";
import { cellState, checkTone } from "@shared/fundGrid";
import type { FundGrid, FundSummary } from "../../api/hooks";
import { monthName } from "../StatTiles";

/**
 * The three figures above the grid: the pot, this month, and the bank check.
 *
 * "This month" names each member's state rather than totting up an expected
 * figure. Contributions are not fixed -- a member may skip by agreement, and
 * the agreed amount can change -- so "RM 200 of RM 600" would state a target
 * nobody set.
 */

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-5">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </div>
  );
}

const STATE_WORDS = {
  paid: "paid",
  skipped: "skipped (agreed)",
  auto: "posts automatically",
  open: "not yet",
  future: "not yet",
  before: "not yet",
} as const;

export function FundTiles({
  summary,
  grid,
  onCheck,
}: {
  summary: FundSummary;
  /** The CURRENT year's grid, for this month's cells. */
  grid: FundGrid | undefined;
  onCheck: () => void;
}) {
  const check = summary.latestCheck;
  const tone = check ? checkTone(check.gapSen) : null;
  const active = summary.members.filter((m) => m.isActive);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile label="In the pot">
        <span className="text-2xl font-semibold tabular-nums">{formatSen(summary.balanceSen)}</span>
        {/*
          The bank also pays a small monthly dividend at a rate the owner does
          not track, so the account is normally a little ahead of this. Said
          here rather than left for a reconciliation to discover.
        */}
        <span className="text-xs text-ink-faint">
          Recorded contributions and spending. The bank may hold a little more (dividends).
        </span>
      </Tile>

      <Tile label={`This month · ${monthName(summary.month)}`}>
        {active.length === 0 && <span className="text-sm text-ink-muted">No members yet.</span>}
        <ul className="flex flex-col gap-1 text-sm">
          {active.map((m) => {
            const cell = grid?.cells.find((c) => c.memberId === m.id && c.forMonth === summary.month);
            const state = cellState({
              month: summary.month,
              currentMonth: summary.month,
              firstMonth: summary.firstMonth,
              cell: cell ?? null,
              rule: m.rule,
            });
            return (
              <li key={m.id} className="flex justify-between gap-2">
                <span>{m.name}</span>
                <span className={state === "paid" ? "text-status-ok-fg" : "text-ink-muted"}>
                  {state === "paid" && cell ? formatSen(cell.paidSen) : STATE_WORDS[state]}
                  {state === "auto" && m.rule ? `, day ${m.rule.dayOfMonth}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </Tile>

      <Tile label="Bank check">
        {check && tone ? (
          <>
            <span className="text-2xl font-semibold tabular-nums">{formatSen(check.balanceSen)}</span>
            <span className="text-xs text-ink-faint">on {check.checkedOn}</span>
            <span
              className={
                "text-sm " + (tone === "short" ? "text-status-overdue-fg" : "text-ink-muted")
              }
            >
              {tone === "short"
                ? `▼ ${formatSen(-check.gapSen)} less than recorded`
                : tone === "ahead"
                  ? `${formatSen(check.gapSen)} more than recorded`
                  : "Matches the record"}
            </span>
          </>
        ) : (
          <span className="text-sm text-ink-muted">
            Type in the account balance to check nothing has gone missing.
          </span>
        )}
        <button
          type="button"
          onClick={onCheck}
          className="mt-1 self-start rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
        >
          {check ? "Update" : "Check the bank"}
        </button>
      </Tile>
    </div>
  );
}
