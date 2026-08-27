import { AppHeader as CoreHeader } from "@portals/core/client";

export { Page, SectionTitle, CONTAINER } from "@portals/core/client";

/**
 * Odometry's header: the shared chrome from @portals/core/client, wearing
 * this portal's identity.
 *
 * The wordmark is a node rather than a string because `font-wordmark` is a
 * subset face covering only the letters in "Odometry" -- applying it to any
 * other text falls back mid-word. See index.css.
 *
 * `portals` is deliberately not passed. See the Portal type in
 * @portals/core/client for why cross-portal links are not wired up yet.
 */
export function AppHeader({ crumb }: { crumb?: string }) {
  return (
    <CoreHeader
      wordmark={<span className="font-wordmark text-2xl leading-none">Odometry</span>}
      homeLabel="Dashboard"
      crumb={crumb}
      settingsHref="/settings"
    />
  );
}
