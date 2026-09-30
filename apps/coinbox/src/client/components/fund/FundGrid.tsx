import { formatSen } from "@portals/core";
import { cellState, monthsOf, type CellState } from "@shared/fundGrid";
import type { FundGrid as Grid, FundMember } from "../../api/hooks";

/**
 * Who has paid, month by month. DERIVED from contributions -- it replaces the
 * workbook's hand-ticked columns, which had already drifted from its own log.
 *
 * Tapping a cell is how a contribution is entered: one record, nothing to keep
 * in step. Every state has a word (in the legend and the cell's label), never
 * colour alone.
 *
 * Wider than a phone, so it scrolls sideways inside its own container rather
 * than pushing the page -- the one kind of element allowed to.
 */

const LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const LOOK: Record<CellState, { glyph: string; className: string; word: string }> = {
  paid: { glyph: "●", className: "text-status-ok-fg", word: "paid" },
  skipped: { glyph: "–", className: "text-ink-muted", word: "skipped, agreed" },
  auto: { glyph: "◌", className: "text-status-info-fg", word: "posts automatically" },
  open: { glyph: "○", className: "text-status-soon-fg", word: "not yet, tap to record" },
  future: { glyph: "·", className: "text-ink-faint", word: "future" },
  before: { glyph: "", className: "", word: "before the fund" },
};

export function FundGrid({
  members,
  grid,
  year,
  currentMonth,
  firstMonth,
  canBack,
  canForward,
  onYear,
  onCell,
  onMembers,
}: {
  members: FundMember[];
  grid: Grid | undefined;
  year: number;
  currentMonth: string;
  firstMonth: string | null;
  canBack: boolean;
  canForward: boolean;
  onYear: (year: number) => void;
  onCell: (member: FundMember, month: string) => void;
  onMembers: () => void;
}) {
  const months = monthsOf(year);
  const shown = members.filter((m) => m.isActive);

  return (
    <section className="mt-8 rounded-xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-ink-faint">Contributions</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous year"
            disabled={!canBack}
            onClick={() => onYear(year - 1)}
            className="rounded-lg border border-edge px-2.5 py-1 text-ink-muted hover:text-ink disabled:opacity-30"
          >
            ‹
          </button>
          <span className="w-12 text-center tabular-nums">{year}</span>
          <button
            type="button"
            aria-label="Next year"
            disabled={!canForward}
            onClick={() => onYear(year + 1)}
            className="rounded-lg border border-edge px-2.5 py-1 text-ink-muted hover:text-ink disabled:opacity-30"
          >
            ›
          </button>
          <button
            type="button"
            onClick={onMembers}
            className="ml-2 rounded-lg border border-edge px-3 py-1 text-sm text-ink-muted hover:text-ink"
          >
            Members
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">Add the people who pay into the fund to start.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-ink-faint">
                <th className="text-left font-normal" />
                {months.map((m, i) => (
                  <th key={m} className={"w-9 font-normal " + (m === currentMonth ? "text-ink" : "")}>
                    {LETTERS[i]}
                  </th>
                ))}
                <th className="pl-3 text-right font-normal">{year}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((member) => {
                const cells = grid?.cells.filter((c) => c.memberId === member.id) ?? [];
                const yearSen = cells.reduce((a, c) => a + c.paidSen, 0);
                return (
                  <tr key={member.id}>
                    <th className="pr-3 text-left font-medium">{member.name}</th>
                    {months.map((month) => {
                      const cell = cells.find((c) => c.forMonth === month) ?? null;
                      const state = cellState({
                        month,
                        currentMonth,
                        firstMonth,
                        cell,
                        rule: member.rule,
                      });
                      const look = LOOK[state];
                      // A payment that is not the member's usual amount shows its
                      // figure, so a changed agreement is visible in the grid.
                      const unusual =
                        state === "paid" && cell && cell.paidSen !== member.defaultSen;
                      const label = `${member.name}, ${month}: ${look.word}${cell && state === "paid" ? `, ${formatSen(cell.paidSen)}` : ""}`;
                      return (
                        <td key={month} className="text-center">
                          {state === "before" ? null : (
                            <button
                              type="button"
                              title={label}
                              aria-label={label}
                              onClick={() => onCell(member, month)}
                              className={
                                "h-8 w-9 rounded-md hover:bg-inset " +
                                look.className +
                                (unusual ? " text-[0.65rem] tabular-nums" : " text-base")
                              }
                            >
                              {unusual && cell ? Math.round(cell.paidSen / 100) : look.glyph}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="pl-3 text-right tabular-nums text-ink-muted">
                      {formatSen(yearSen)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
        {(["paid", "skipped", "auto", "open"] as const).map((s) => (
          <span key={s}>
            <span className={LOOK[s].className}>{LOOK[s].glyph}</span> {LOOK[s].word}
          </span>
        ))}
      </p>
    </section>
  );
}
