import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";

/**
 * Page shell shared by every portal. Desktop-first, responsive down to 375px.
 */

/** One container class, so routes cannot drift apart. */
export const CONTAINER = "mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8";

export function Page({ children }: { children: ReactNode }) {
  return <div className={CONTAINER}>{children}</div>;
}

/** Section heading, consistent across routes. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wider text-ink-faint">{children}</h2>
  );
}

/**
 * A sibling portal this one can link to.
 *
 * SHOWN UNCONDITIONALLY, which is a decision rather than an oversight. The two
 * portals sit on two hostnames behind two Access applications with different
 * policies -- Odometry admits the household, Coinbox admits the owner alone --
 * so a co-member who follows Odometry's link lands on a Cloudflare denial page
 * instead of anywhere useful.
 *
 * That was the reason this prop went unused for as long as it did. It was
 * weighed and accepted on 2026-09-05: the owner is the only person who uses
 * both portals, and a hypothetical co-member's dead link is a smaller cost
 * than no navigation at all for the person who actually has both.
 *
 * If that co-member ever becomes real, the fix is filtering this list by
 * Access group membership -- which needs a groups claim that does not reach
 * the Worker today. ctx.access is not populated in production (which is why
 * the JWT assertion fallback exists in @portals/core/worker auth.ts), and the
 * assertion payload we parse carries no groups. Do not reach for an email
 * allowlist in wrangler.jsonc instead: it would duplicate the Access policy in
 * a second place, and the copy that drifts is the one nobody is looking at.
 */
export type Portal = { name: string; href: string };

/**
 * A top-level section of this portal.
 *
 * This is a different thing from `crumb`, and the distinction is worth
 * keeping: `crumb` expresses DEPTH -- you are inside something, here is the
 * way back -- while `nav` expresses BREADTH, the sections the app is divided
 * into. Odometry has depth and no breadth; Coinbox has breadth and, for now,
 * no depth. An app can want both, and neither implies the other.
 */
export type NavItem = { label: string; href: string };

/**
 * The top bar. The root link changes identity with depth, which is
 * deliberate: at the root it is the WORDMARK -- the app name in its display
 * face, the one piece of branding on screen -- while inside a breadcrumb it
 * is NAVIGATION, reading as a plain link at the same weight as the crumb
 * beside it. A script face next to plain crumb text looks like a mistake.
 *
 * `wordmark` is a node rather than a string because the display face is
 * per-portal: Odometry's is a subset font covering only its own letters.
 */
export function AppHeader({
  wordmark,
  homeLabel,
  crumb,
  crumbPlacement = "inline",
  nav = [],
  settingsHref,
  portals = [],
}: {
  wordmark: ReactNode;
  homeLabel: string;
  crumb?: string;
  /**
   * Where the breadcrumb sits.
   *
   * `inline` (the default, and what Odometry uses) puts it on the bar in place
   * of the wordmark. `below` gives it a second row inside the same sticky
   * header, which is what a portal with a `nav` strip wants: side by side, a
   * crumb reading "Home / Ledger" next to a nav item reading "Home" is the
   * same word twice in an inch, and the wordmark disappears to make room for
   * the duplication.
   *
   * Both rows are inside the sticky <header>, so both stay pinned. That is a
   * deliberate cost -- roughly 96px of permanent chrome instead of 56 -- taken
   * because the back button is then always one tap away, wherever you are in a
   * long list.
   */
  crumbPlacement?: "inline" | "below";
  /** Defaults to [], so a portal that passes nothing renders exactly as before. */
  nav?: NavItem[];
  settingsHref?: string;
  portals?: Portal[];
}) {
  const { pathname } = useLocation();
  // No point offering a link to the page you are already on.
  const onSettings = settingsHref !== undefined && pathname === settingsHref;

  const showCrumbInline = crumb !== undefined && crumbPlacement === "inline";
  const showCrumbBelow = crumb !== undefined && crumbPlacement === "below";

  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-page/90 backdrop-blur">
      <div className={CONTAINER.replace("pb-24", "") + " flex h-14 items-center gap-2"}>
        {showCrumbInline && <BackButton />}
        {showCrumbInline ? (
          <Link to="/" className="shrink-0 text-ink-muted hover:text-ink">
            {homeLabel}
          </Link>
        ) : (
          <Link to="/" className="shrink-0 hover:text-ink">
            {wordmark}
          </Link>
        )}
        {showCrumbInline && (
          <>
            <span aria-hidden className="text-ink-faint">
              /
            </span>
            <span className="min-w-0 truncate text-ink-muted">{crumb}</span>
          </>
        )}
        {nav.length > 0 && (
          <nav aria-label="Sections" className="ml-2 flex min-w-0 shrink items-center gap-0.5">
            {nav.map((n) => (
              <NavLink
                key={n.href}
                to={n.href}
                // Load-bearing: "/" is a prefix of every route, so without
                // `end` the home link is active on every page.
                end={n.href === "/"}
                className={({ isActive }) =>
                  "shrink-0 rounded-lg px-2 py-1.5 text-sm transition sm:px-2.5 " +
                  (isActive
                    ? "bg-inset font-medium text-ink"
                    : "text-ink-muted hover:bg-inset hover:text-ink")
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-4">
          {portals.map((p) => (
            <a key={p.href} href={p.href} className="text-sm text-ink-muted hover:text-ink">
              {p.name}
            </a>
          ))}
          {settingsHref !== undefined && !onSettings && (
            <Link to={settingsHref} className="text-sm text-ink-muted hover:text-ink">
              Settings
            </Link>
          )}
        </div>
      </div>

      {/*
        The breadcrumb's own row. INSIDE the sticky <header>, so it stays
        pinned with the bar above it rather than scrolling away.

        Anything positioned against the header's height must account for this:
        a `sticky top-14` strip (Odometry's VehicleDetail tabs) assumes a 56px
        header and would slide under a 96px one. Nothing does that in a portal
        using `below` today, which is why this is a comment rather than a
        shared constant.
      */}
      {showCrumbBelow && (
        // The divider sits on this full-width wrapper, NOT on the container
        // below it. On the container it inherits max-w-7xl and stops short at
        // both ends, which reads as a rule that failed to draw rather than a
        // deliberate inset -- especially directly above the header's own
        // edge-to-edge border-b.
        <div className="border-t border-edge">
          <nav
            aria-label="Breadcrumb"
            className={
              CONTAINER.replace("pb-24", "") + " flex h-10 items-center gap-2 text-sm"
            }
          >
            <BackButton />
            <Link to="/" className="shrink-0 text-ink-muted hover:text-ink">
              {homeLabel}
            </Link>
            <span aria-hidden className="text-ink-faint">
              /
            </span>
            <span className="min-w-0 truncate text-ink" aria-current="page">
              {crumb}
            </span>
          </nav>
        </div>
      )}
    </header>
  );
}

/**
 * Back to wherever you were.
 *
 * Falls through to the root when there is nothing to go back to -- opening a
 * deep link directly, or landing here after a refresh. React Router tracks
 * its own position in `history.state.idx`; at 0 there is no app history
 * behind us, and navigate(-1) would walk the user out of the app entirely.
 */
function BackButton() {
  const navigate = useNavigate();
  const canGoBack = (window.history.state?.idx ?? 0) > 0;

  return (
    <button
      onClick={() => (canGoBack ? navigate(-1) : navigate("/"))}
      aria-label="Back"
      className="-ml-1.5 rounded-lg p-1.5 text-ink-muted transition hover:bg-inset hover:text-ink focus:outline-none focus:ring-2 focus:ring-ink-muted"
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12.5 4l-6 6 6 6" />
      </svg>
    </button>
  );
}
