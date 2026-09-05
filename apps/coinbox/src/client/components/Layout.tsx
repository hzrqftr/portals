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
 */

/**
 * The other portal. Hardcoded rather than served from the API as a Worker var:
 * two stable workers.dev hostnames do not earn a config round trip, and the
 * indirection would put a nav link behind a network request.
 *
 * The dev branch is not a guess -- the port is pinned in odometry's
 * vite.config.ts with strictPort, precisely so this constant can be right.
 *
 * See the `Portal` type in @portals/core/client for why this link is shown
 * unconditionally.
 */
const ODOMETRY_URL = import.meta.env.DEV
  ? "http://localhost:5174"
  : "https://fleet-portal.hazriq-fitri95.workers.dev";

/**
 * The portal's sections, in the order they are used rather than alphabetically.
 *
 * Home is first and holds "/" even though it is empty today: taking the root
 * later would move the ledger's URL out from under any bookmark, and the
 * dashboard that will live here is the page the owner wants to land on.
 */
const NAV = [
  { label: "Home", href: "/" },
  { label: "Ledger", href: "/ledger" },
  { label: "Recurring", href: "/recurring" },
];

export function AppHeader({ crumb }: { crumb?: string }) {
  return (
    <CoreHeader
      // Smaller at 375px, where the wordmark shares a 56px bar with three nav
      // links. Entry happens on a phone, so the nav has to survive that width.
      wordmark={<span className="text-base font-semibold tracking-tight sm:text-xl">Coinbox</span>}
      // "Home" rather than "Ledger": "/" is the Home page now, and this is the
      // label the breadcrumb uses for whatever "/" is.
      homeLabel="Home"
      crumb={crumb}
      // Below the bar, not on it: beside a nav strip an inline crumb reads
      // "Home / Ledger" next to a nav item reading "Home", and pushes the
      // wordmark off screen to do it.
      crumbPlacement="below"
      nav={NAV}
      portals={[{ name: "Odometry", href: ODOMETRY_URL }]}
    />
  );
}
