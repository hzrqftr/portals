import { useState } from "react";
import { AppHeader, Page, SectionTitle } from "../components/Layout";
import { todayIn } from "@portals/core";
import {
  useMe,
  useCategories,
  useVehicles,
  useTransactions,
  useSummary,
} from "../api/hooks";
import { TransactionSheet } from "../components/TransactionSheet";
import { TransactionTable } from "../components/TransactionTable";

/** Matches the API's default page size, so "is there more?" is answerable. */
const LIST_LIMIT = 500;

export default function Home() {
  const me = useMe();
  const categories = useCategories();
  const vehicles = useVehicles();

  const [month, setMonth] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [adding, setAdding] = useState(false);

  const filters = { ...(month ? { month } : {}), ...(categoryId ? { categoryId } : {}) };
  const transactions = useTransactions(filters);
  const summary = useSummary();

  // Invariant 5: "today" comes from the user's timezone, never the Worker's.
  // The Worker runs in UTC and the owner is at UTC+8, so a bare new Date()
  // puts eight hours of every evening on the wrong day.
  const today = me.data ? todayIn(me.data.timezone) : "";

  // The summary is still fetched, but only to populate the month filter --
  // one row per month is exactly the list of months that have entries.
  const months = summary.data ?? [];

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
          <TransactionTable
            transactions={transactions.data ?? []}
            categories={categories.data ?? []}
            vehicles={vehicles.data ?? []}
            truncated={(transactions.data?.length ?? 0) >= LIST_LIMIT}
          />
        )}
      </Page>

      {/* The sheet is for ADDING only now. A blank row needs the direction
          defaults and the conditional vehicle field; a correction does not,
          and the table handles those in place. */}
      {adding && today && <TransactionSheet today={today} onClose={() => setAdding(false)} />}
    </>
  );
}
