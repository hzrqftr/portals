import { useState } from "react";
import { todayIn } from "@portals/core";
import { AppHeader, Page, SectionTitle } from "../components/Layout";
import { RecurringList } from "../components/RecurringList";
import { RecurringSheet } from "../components/RecurringSheet";
import { useMe, useRecurring, type RecurringRule } from "../api/hooks";

/**
 * Recurring entries: the bills that repeat, declared once.
 *
 * DECLARED, not detected. Nothing here inspects the ledger to guess at a
 * pattern -- that is the "recurring-transaction detection" the spec puts out
 * of scope, and it stays out. The owner states the rule.
 */
export default function Recurring() {
  const me = useMe();
  const rules = useRecurring();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);

  // Invariant 5: "today" comes from the user's timezone, never the Worker's.
  // The nightly job does exactly the same thing per ledger, so the date shown
  // here and the date it posts on cannot disagree.
  const today = me.data ? todayIn(me.data.timezone) : "";

  return (
    <>
      <AppHeader crumb="Recurring" />
      <Page>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3 pt-6">
          <SectionTitle>Recurring</SectionTitle>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={!me.data}
            className="rounded-xl bg-ink px-4 py-2 font-medium text-page transition hover:opacity-90 disabled:opacity-50"
          >
            Add recurring entry
          </button>
        </div>

        <p className="max-w-prose text-sm text-ink-muted">
          These post themselves into the ledger at 1am on each due date. Entries they create
          are marked in the ledger and can be edited or deleted like any other.
        </p>

        {rules.isLoading && <p className="mt-6 text-ink-muted">Loading…</p>}
        {rules.isError && (
          <p className="mt-6 text-status-overdue-fg">{(rules.error as Error).message}</p>
        )}
        {rules.data && (
          <RecurringList rules={rules.data} today={today} onEdit={setEditing} />
        )}
      </Page>

      {adding && today && <RecurringSheet today={today} onClose={() => setAdding(false)} />}
      {editing && today && (
        <RecurringSheet today={today} existing={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
