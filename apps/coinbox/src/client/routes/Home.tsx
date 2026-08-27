import { Page, AppHeader, SectionTitle } from "../components/Layout";
import { useMe } from "../api/hooks";

export default function Home() {
  const me = useMe();

  return (
    <>
      <AppHeader />
      <Page>
        <div className="mt-8">
          <SectionTitle>Ledger</SectionTitle>
          <p className="mt-3 text-ink-muted">
            No transactions yet. The schema for these is still an open design
            decision &mdash; see <code className="text-ink">docs/coinbox-spec.md</code>.
          </p>
          {me.data && (
            <dl className="mt-6 space-y-1 text-sm text-ink-faint">
              <div>
                Signed in, ledger <code className="text-ink-muted">{me.data.ledgerId}</code>
              </div>
              <div>
                {me.data.currency} &middot; {me.data.timezone}
              </div>
            </dl>
          )}
          {me.isError && <p className="mt-6 text-status-overdue-fg">Could not load your ledger.</p>}
        </div>
      </Page>
    </>
  );
}
