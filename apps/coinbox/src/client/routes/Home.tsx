import { useState } from "react";
import { todayIn } from "@portals/core";
import { AppHeader, Page, SectionTitle } from "../components/Layout";
import { StatTiles, monthLabel, monthName, STALE_DAYS } from "../components/StatTiles";
import { YearChart } from "../components/YearChart";
import { MonthSpend } from "../components/MonthSpend";
import { ComingUp, VehicleCosts } from "../components/DashboardPanels";
import { TransactionSheet } from "../components/TransactionSheet";
import { useDashboard, useMe } from "../api/hooks";

/**
 * The landing page.
 *
 * This is the half of the Google Sheet that was NOT the log -- the monthly
 * surplus/deficit table and the totals the owner still opened the Sheet for.
 * The whole thing arrives from `GET /api/dashboard` in one round trip, already
 * aggregated in SQL, rather than being composed here from five requests.
 *
 * ONE SELECTION DRIVES THE PAGE. Picking a month in the year chart re-fetches
 * with `?month=`, and the breakdown beneath it follows. That is deliberately
 * the only interactive control: the chart is the navigator and the panel is
 * the answer, so there is nothing to keep in sync by hand.
 */
export default function Home() {
  const me = useMe();
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);

  const dashboard = useDashboard(month);

  // Invariant 5: "today" comes from the user's timezone, never the browser's
  // or the Worker's. Only needed for the entry sheet -- every figure on this
  // page was already dated by the server against the same timezone.
  const today = me.data ? todayIn(me.data.timezone) : "";

  const data = dashboard.data;
  const stale =
    data?.daysSinceTypedEntry !== null &&
    data?.daysSinceTypedEntry !== undefined &&
    data.daysSinceTypedEntry >= STALE_DAYS;

  return (
    <>
      <AppHeader />
      <Page>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex items-baseline gap-2.5">
            <SectionTitle>{data ? monthLabel(data.focus.month) : "Home"}</SectionTitle>
            {data && data.focus.month !== data.today.slice(0, 7) && (
              <button
                type="button"
                onClick={() => setMonth(undefined)}
                className="text-xs text-ink-muted underline hover:text-ink"
              >
                back to this month
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={!me.data}
            className="rounded-xl bg-ink px-4 py-2 font-semibold text-page disabled:opacity-50"
          >
            Add entry
          </button>
        </div>

        {dashboard.isPending ? (
          <p className="text-ink-muted">Loading…</p>
        ) : dashboard.isError ? (
          <p className="text-status-overdue-fg">{(dashboard.error as Error).message}</p>
        ) : data ? (
          <div className="flex flex-col gap-4">
            {/*
              Honest degradation. If nothing has been typed for a while the
              figures below are as good as the last entry and no better, and
              saying so is worth more than a confident wrong total. The one
              figure a lapse cannot spoil is what the rules will post, because
              the cron does not need anyone to open the app.
            */}
            {stale && data.lastTypedEntryOn && (
              <div className="flex items-start gap-3 rounded-xl bg-status-soon-bg p-4">
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden
                  className="mt-0.5 h-5 w-5 shrink-0 text-status-soon-fg"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 2.8 1.8 17h16.4L10 2.8Z" />
                  <path d="M10 8v3.6" />
                  <path d="M10 14.4h.01" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-status-soon-fg">
                    Nothing entered for {data.daysSinceTypedEntry} days
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    The last entry you typed was {data.lastTypedEntryOn}. Recurring
                    rules have kept posting, but anything you have spent by hand
                    since then is not counted below.
                  </p>
                </div>
              </div>
            )}

            <StatTiles data={data} />

            <YearChart
              months={data.months}
              selected={data.focus.month}
              onSelect={setMonth}
              ytdNetSen={data.ytdNetSen}
            />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <MonthSpend
                  month={data.focus.month}
                  monthLabel={monthName(data.focus.month)}
                  categories={data.focus.categorySpend}
                />
              </div>
              <ComingUp committed={data.committed} />
            </div>

            <VehicleCosts vehicles={data.vehicles} />
          </div>
        ) : null}
      </Page>

      {/*
        onClose fires on cancel as well as on save, so it must not navigate.
        Saving invalidates ["dashboard"], and the page behind the sheet
        redraws with the new entry in it.
      */}
      {adding && today && (
        <TransactionSheet today={today} onClose={() => setAdding(false)} />
      )}
    </>
  );
}
