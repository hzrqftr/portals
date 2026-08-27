import { AppHeader as CoreHeader } from "@portals/core/client";

export { Page, SectionTitle, CONTAINER } from "@portals/core/client";

/**
 * Coinbox's header: the shared chrome from @portals/core/client wearing this
 * portal's identity.
 *
 * The wordmark is plain body type for now. Odometry's display face is a font
 * subset to the eight letters of "Odometry", so it cannot be reused here, and
 * its licence is personal-use only -- picking a face for Coinbox is an open
 * decision. See docs/coinbox-spec.md.
 *
 * `portals` is deliberately not passed: cross-portal links are not wired up.
 * See the Portal type in @portals/core/client for why.
 */
export function AppHeader({ crumb }: { crumb?: string }) {
  return (
    <CoreHeader
      wordmark={<span className="text-xl font-semibold tracking-tight">Coinbox</span>}
      homeLabel="Ledger"
      crumb={crumb}
    />
  );
}
