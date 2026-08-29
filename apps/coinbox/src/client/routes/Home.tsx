import { AppHeader, Page, SectionTitle } from "../components/Layout";

/**
 * The landing page.
 *
 * Deliberately empty. It holds "/" from the start because taking the root
 * later would move the ledger out from under a bookmark, and because a
 * dashboard is what the owner wants to land on -- it is simply not built yet.
 *
 * What goes here is the half of the Google Sheet that is NOT the log: the
 * monthly averages and charts the owner still opens the Sheet for. Until that
 * exists, this says so plainly rather than showing an invented placeholder
 * metric, which would be worse than an honest blank.
 */
export default function Home() {
  return (
    <>
      <AppHeader />
      <Page>
        <div className="pt-6">
          <SectionTitle>Home</SectionTitle>
        </div>

        <div className="mt-4 rounded-xl border border-edge bg-surface p-8 text-center">
          <p className="text-ink">Nothing here yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            A dashboard will live here — monthly totals and the averages still kept in the
            Sheet. Until then, the ledger and your recurring entries are in the menu above.
          </p>
        </div>
      </Page>
    </>
  );
}
