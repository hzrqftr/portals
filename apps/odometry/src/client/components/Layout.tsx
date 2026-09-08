import { AppHeader as CoreHeader } from "@portals/core/client";

export {
  Page,
  SectionTitle,
  CONTAINER,
  STICKY_UNDER_BAR,
  STICKY_UNDER_BAR_AND_CRUMB,
} from "@portals/core/client";

/**
 * Odometry's header: the shared chrome from @portals/core/client, wearing
 * this portal's identity.
 *
 * The wordmark is a node rather than a string because `font-wordmark` is a
 * subset face covering only the letters in "Odometry" -- applying it to any
 * other text falls back mid-word. See index.css.
 */

/**
 * The other portal. Hardcoded rather than served from /api/me as a Worker var:
 * two stable workers.dev hostnames do not earn a config round trip, and the
 * indirection would put a nav link behind a network request.
 *
 * The dev branch is not a guess -- the port is pinned in coinbox's
 * vite.config.ts with strictPort, precisely so this constant can be right.
 *
 * See the `Portal` type in @portals/core/client for why this link is shown to
 * everyone even though Coinbox admits fewer people than Odometry does.
 */
const COINBOX_URL = import.meta.env.DEV
  ? "http://localhost:5173"
  : "https://coinbox.hazriq-fitri95.workers.dev";

export function AppHeader({ crumb }: { crumb?: string }) {
  return (
    <CoreHeader
      wordmark={<span className="font-wordmark text-2xl leading-none">Odometry</span>}
      homeLabel="Dashboard"
      crumb={crumb}
      // The crumb gets its own row rather than taking the wordmark's place.
      // `inline` swapped the two, so stepping into a vehicle cost the app both
      // its branding and its home link, and a deeper crumb would have had
      // nowhere to go. Anything sticky on a page WITH a crumb must now pin at
      // STICKY_UNDER_BAR_AND_CRUMB -- see VehicleDetail's tabs.
      crumbPlacement="below"
      settingsHref="/settings"
      portals={[{ name: "Coinbox", href: COINBOX_URL }]}
    />
  );
}
