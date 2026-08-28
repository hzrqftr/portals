import { useState } from "react";
import { AppHeader, Page, SectionTitle } from "../components/Layout";
import { formatSen, todayIn } from "@portals/core";
import {
  useMe,
  useCategories,
  useVehicles,
  useTransactions,
  useSummary,
  type Transaction,
} from "../api/hooks";
import { TransactionSheet } from "../components/TransactionSheet";
import { TransactionList } from "../components/TransactionList";

export default function Home() {
  const me = useMe();
  const categories = useCategories();
  const vehicles = useVehicles();

  const [month, setMonth] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const filters = { ...(month ? { month } : {}), ...(categoryId ? { categoryId } : {}) };
  const transactions = useTransactions(filters);
  const summary = useSummary();

  // Invariant 5: "today" comes from the user's timezone, never the Worker's.
  // The Worker runs in UTC and the owner is at UTC+8, so a bare new Date()
  // puts eight hours of every evening on the wrong day.
  const today = me.data ? todayIn(me.data.timezone) : "";

  const vehicleNames = new Map((vehicles.data ?? []).map((v) => [v.id, v.nickname]));
  const months = summary.data ?? [];
  const shown = month ? months.filter((m) => m.month === month) : months;
  const totalIn = shown.reduce((a, m) => a + m.in_sen, 0);
  const totalOut = shown.reduce((a, m) => a + m.out_sen, 0);

  return (
    <>
      <AppHeader />
      <Page>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>Ledger</SectionTitle>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={!me.data}
            className="rounded-xl bg-ink px-4 py-2 font-semibold text-page disabled:opacity-50"
          >
            Add entry
          </button>
        </div>

        {/* Totals for whatever is currently in view, so the filter and the
            figures can never describe different things. */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-edge bg-surface px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-ink-faint">In</div>
            <div className="mt-1 tabular-nums text-lg font-semibold text-status-ok-fg">
              {formatSen(totalIn)}
            </div>
          </div>
          <div className="rounded-xl border border-edge bg-surface px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-ink-faint">Out</div>
            <div className="mt-1 tabular-nums text-lg font-semibold text-ink">
              {formatSen(totalOut)}
            </div>
          </div>
          <div className="col-span-2 rounded-xl border border-edge bg-surface px-4 py-3 sm:col-span-1">
            <div className="text-xs uppercase tracking-wider text-ink-faint">Net</div>
            <div
              className={
                "mt-1 tabular-nums text-lg font-semibold " +
                (totalIn - totalOut >= 0 ? "text-status-ok-fg" : "text-status-overdue-fg")
              }
            >
              {/* Magnitude plus a word, never a minus sign. */}
              {totalIn - totalOut >= 0 ? "up " : "down "}
              {formatSen(Math.abs(totalIn - totalOut))}
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <select
            className="rounded-xl border border-edge bg-inset px-3 py-2 text-ink"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            <option value="">All months</option>
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.month}
              </option>
            ))}
          </select>
          <select
            className="rounded-xl border border-edge bg-inset px-3 py-2 text-ink"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {transactions.isPending ? (
          <p className="text-ink-muted">Loading…</p>
        ) : transactions.isError ? (
          <p className="text-status-overdue-fg">{(transactions.error as Error).message}</p>
        ) : (
          <TransactionList
            transactions={transactions.data ?? []}
            vehicleNames={vehicleNames}
            onEdit={setEditing}
          />
        )}
      </Page>

      {adding && today && <TransactionSheet today={today} onClose={() => setAdding(false)} />}
      {editing && today && (
        <TransactionSheet today={today} existing={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
