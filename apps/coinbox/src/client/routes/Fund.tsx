import { useState } from "react";
import { AppHeader, Page, SectionTitle } from "../components/Layout";
import { FundTiles } from "../components/fund/FundTiles";
import { FundGrid } from "../components/fund/FundGrid";
import { FundEntryList } from "../components/fund/FundEntryList";
import { ContributionSheet } from "../components/fund/ContributionSheet";
import { FundEntrySheet } from "../components/fund/FundEntrySheet";
import { MembersSheet } from "../components/fund/MembersSheet";
import { BankCheckSheet } from "../components/fund/BankCheckSheet";
import {
  useFund,
  useFundEntries,
  useFundGrid,
  type FundEntry,
  type FundMember,
} from "../api/hooks";

/**
 * The Family fund: a pot the siblings pay into monthly, spent on the family.
 * docs/coinbox-spec.md §11.
 *
 * A SEPARATE BOOK from the ledger. Nothing on this page is personal spending,
 * and nothing here reaches the Home dashboard -- the owner's own share already
 * left the ledger once, as its recurring entry.
 *
 * "Today" is the server's, computed from the owner's timezone (GET /api/fund),
 * so this page and the nightly posting agree on which month it is.
 */
export default function Fund() {
  const fund = useFund();
  const entries = useFundEntries();
  const currentYear = fund.data ? Number(fund.data.month.slice(0, 4)) : null;
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked ?? currentYear;

  const grid = useFundGrid(year);
  // The tiles always describe THIS month, whichever year the grid shows. Same
  // query key as the grid when they coincide, so no second request then.
  const thisYearGrid = useFundGrid(currentYear);

  const [cell, setCell] = useState<{ member: FundMember; month: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FundEntry | null>(null);
  const [members, setMembers] = useState(false);
  const [checking, setChecking] = useState(false);

  const data = fund.data;
  const firstYear = data?.firstMonth ? Number(data.firstMonth.slice(0, 4)) : currentYear;

  return (
    <>
      <AppHeader crumb="Family fund" />
      <Page>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pt-6">
          <SectionTitle>Family fund</SectionTitle>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={!data}
            className="rounded-xl bg-ink px-4 py-2 font-medium text-page transition hover:opacity-90 disabled:opacity-50"
          >
            Record spending
          </button>
        </div>

        {fund.isLoading && <p className="text-ink-muted">Loading…</p>}
        {fund.isError && <p className="text-status-overdue-fg">{(fund.error as Error).message}</p>}

        {data && year !== null && currentYear !== null && (
          <>
            <FundTiles summary={data} grid={thisYearGrid.data} onCheck={() => setChecking(true)} />

            <FundGrid
              members={data.members}
              grid={grid.data}
              year={year}
              currentMonth={data.month}
              firstMonth={data.firstMonth}
              canBack={firstYear !== null && year > firstYear}
              // One year ahead, for paying in advance; no further.
              canForward={year < currentYear + 1}
              onYear={setPicked}
              onCell={(member, month) => setCell({ member, month })}
              onMembers={() => setMembers(true)}
            />

            <h2 className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-faint">
              Spending and other money
            </h2>
            {entries.data && <FundEntryList entries={entries.data} onEdit={setEditing} />}
          </>
        )}
      </Page>

      {cell && data && (
        <ContributionSheet
          member={cell.member}
          month={cell.month}
          existing={
            grid.data?.contributions.filter(
              (c) => c.memberId === cell.member.id && c.forMonth === cell.month,
            ) ?? []
          }
          today={data.today}
          onClose={() => setCell(null)}
        />
      )}
      {adding && data && <FundEntrySheet today={data.today} onClose={() => setAdding(false)} />}
      {editing && data && (
        <FundEntrySheet today={data.today} existing={editing} onClose={() => setEditing(null)} />
      )}
      {members && data && <MembersSheet members={data.members} onClose={() => setMembers(false)} />}
      {checking && data && <BankCheckSheet today={data.today} onClose={() => setChecking(false)} />}
    </>
  );
}
