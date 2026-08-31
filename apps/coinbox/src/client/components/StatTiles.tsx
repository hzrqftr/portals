import type { ReactNode } from "react";
import { formatSen } from "@portals/core";
import type { Dashboard } from "../api/hooks";

/**
 * The four figures at the top.
 *
 * Each one has to change what you would do this week, or it belongs further
 * down the page. In particular there is no savings rate here: `Savings`
 * appears in this ledger in BOTH directions, so money moving into savings is
 * indistinguishable from income and the rate would be confidently wrong.
 */

/** After this many days with nothing typed, every figure above is suspect. */
const STALE_DAYS = 5;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08" -> "August". Falls back to the raw key rather than throwing. */
export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** "2026-08" -> "August 2026". */
export function monthLabel(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/** Magnitude, colour and a prefix — never a negative number on screen. */
function Signed({ sen, className = "" }: { sen: number; className?: string }) {
  return (
    <span
      className={
        "tabular-nums " +
        (sen < 0 ? "text-status-overdue-fg" : "text-status-ok-fg") +
        " " +
        className
      }
    >
      {sen < 0 ? "−" : "+"}
      {formatSen(Math.abs(sen))}
    </span>
  );
}

function Tile({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-edge bg-surface p-5">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

function Note({ tone, children }: { tone: "ok" | "warn"; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={
          "h-2 w-2 shrink-0 rounded-full " +
          (tone === "ok" ? "bg-status-ok-fg" : "bg-status-soon-fg")
        }
      />
      <span className="text-xs text-ink-faint">{children}</span>
    </span>
  );
}

export function StatTiles({ data }: { data: Dashboard }) {
  const { focus, committed } = data;
  const stale =
    data.daysSinceTypedEntry !== null && data.daysSinceTypedEntry >= STALE_DAYS;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label={`Net, ${monthLabel(focus.month)}`}>
        <Signed sen={focus.netSen} className="text-4xl font-semibold leading-none" />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm tabular-nums text-ink-muted">
            In {formatSen(focus.inSen)} · Out {formatSen(focus.outSen)}
          </span>
          {focus.momDeltaSen === null ? (
            <span className="text-xs text-ink-faint">
              Nothing before it to compare with
            </span>
          ) : (
            <Note tone={focus.momDeltaSen >= 0 ? "ok" : "warn"}>
              {formatSen(Math.abs(focus.momDeltaSen))}{" "}
              {focus.momDeltaSen >= 0 ? "better" : "worse"} than{" "}
              {monthName(focus.previousMonth as string)}
            </Note>
          )}
        </div>
      </Tile>

      <Tile label={`Out, ${monthName(focus.month)}`}>
        <span className="text-2xl font-semibold leading-none tabular-nums text-ink">
          {formatSen(focus.outSen)}
        </span>
        <div className="flex flex-col gap-1.5">
          {focus.trailingOutAvgSen === null ? (
            <span className="text-sm text-ink-muted">No three-month history yet</span>
          ) : (
            <>
              <span className="text-sm tabular-nums text-ink-muted">
                3-month average {formatSen(focus.trailingOutAvgSen)}
              </span>
              <Note tone={focus.outSen <= focus.trailingOutAvgSen ? "ok" : "warn"}>
                {focus.trailingOutAvgSen === 0
                  ? "No baseline to compare with"
                  : `${Math.abs(
                      Math.round(
                        ((focus.outSen - focus.trailingOutAvgSen) /
                          focus.trailingOutAvgSen) *
                          100,
                      ),
                    )}% ${focus.outSen <= focus.trailingOutAvgSen ? "under" : "over"} your normal`}
              </Note>
            </>
          )}
        </div>
      </Tile>

      <Tile label={`Committed, next ${committed.days} days`}>
        <span className="text-2xl font-semibold leading-none tabular-nums text-status-soon-fg">
          {formatSen(Math.abs(committed.netSen))}
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink-muted">
            {committed.count === 0
              ? "No rules fall due"
              : `${committed.count} posting${committed.count === 1 ? "" : "s"} from your rules`}
          </span>
          <span className="text-xs text-ink-faint">
            Before you spend anything by hand
          </span>
        </div>
      </Tile>

      <Tile label="Last entry">
        <span
          className={
            "text-2xl font-semibold leading-none " +
            (stale ? "text-status-soon-fg" : "text-ink")
          }
        >
          {data.daysSinceTypedEntry === null
            ? "Never"
            : data.daysSinceTypedEntry === 0
              ? "Today"
              : `${data.daysSinceTypedEntry} day${data.daysSinceTypedEntry === 1 ? "" : "s"} ago`}
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">
            {data.lastTypedEntryOn ?? "Nothing typed yet"} · {focus.txnCount} entries in{" "}
            {monthName(focus.month)}
          </span>
          {/*
            Measured against the last TYPED entry, not the last entry of any
            kind. Recurring rules keep posting whether or not anyone opens the
            app, so the figures can look fresh while a fortnight of real
            spending is missing.
          */}
          <Note tone={stale ? "warn" : "ok"}>
            {stale ? "Figures may be incomplete" : "Figures are current"}
          </Note>
        </div>
      </Tile>
    </div>
  );
}

export { STALE_DAYS };
