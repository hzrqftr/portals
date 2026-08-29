import { useEffect, useState } from "react";
import { AppHeader, Page, SectionTitle } from "../components/Layout";
import { todayIn } from "@portals/core";
import { Select } from "@portals/core/client";
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

/** The search input, matched to Select's `sm` metrics so the row lines up. */
const FILTER = "w-full rounded-xl border border-edge bg-inset px-3 py-2 text-ink";

export default function Ledger() {
  const me = useMe();
  const categories = useCategories();
  const vehicles = useVehicles();

  const [month, setMonth] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const [recurring, setRecurring] = useState<"" | "0" | "1">("");
  const [search, setSearch] = useState<string>("");
  const [adding, setAdding] = useState(false);

  // Debounced, so typing "Motorcycle fuel" is one request rather than fifteen.
  // The query key includes the filters, so an un-debounced search would also
  // spawn a cache entry per keystroke.
  const [query, setQuery] = useState<string>("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const filters = {
    ...(month ? { month } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(direction ? { direction } : {}),
    ...(recurring ? { recurring } : {}),
    // Omitted when empty rather than sent blank: the API's `q` is min(1), so
    // an empty string is a 422 rather than "no filter".
    ...(query ? { q: query } : {}),
  };
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
      <AppHeader crumb="Ledger" />
      <Page>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 pt-6">
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

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <Select size="sm" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All months</option>
              {months.map((m) => (
                <option key={m.month} value={m.month}>
                  {m.month}
                </option>
              ))}
            </Select>

            <Select size="sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select
              size="sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "" | "in" | "out")}
            >
              <option value="">All types</option>
              <option value="out">Out</option>
              <option value="in">In</option>
            </Select>

            {/* Which entries the system posted. Worth a filter rather than
                only a per-row marker: "what has been posting itself?" is a
                question about the whole ledger, not about one row. */}
            <Select
              size="sm"
              value={recurring}
              onChange={(e) => setRecurring(e.target.value as "" | "0" | "1")}
            >
              <option value="">All entries</option>
              <option value="1">Recurring only</option>
              <option value="0">Typed only</option>
            </Select>
          </div>

          {/* Right-aligned, under the Add entry button. Searching is a
              different gesture from narrowing, so it sits apart from the
              three selects rather than becoming a fourth one. */}
          <div className="relative w-full sm:w-64">
            <input
              // The native search-cancel button is suppressed and replaced
              // below: keeping both gave two X's side by side, and the native
              // one is styled differently in every browser.
              className={
                FILTER + " w-full pr-8 [&::-webkit-search-cancel-button]:appearance-none"
              }
              type="search"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink"
              >
                &times;
              </button>
            )}
          </div>
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
