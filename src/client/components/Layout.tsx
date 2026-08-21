import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

/**
 * Page shell. Desktop-first, responsive down to 375px.
 *
 * The old layout was `max-w-lg` everywhere, which is a phone column stretched
 * onto a monitor. This widens to 7xl and lets the grids inside decide their
 * own column counts per breakpoint.
 */

/** One container class, so the three routes cannot drift apart. */
export const CONTAINER = "mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6 lg:px-8";

export function Page({ children }: { children: ReactNode }) {
  return <div className={CONTAINER}>{children}</div>;
}

/**
 * The top bar, shared by every route. Previously each route rendered its own
 * "← Fleet" link and the dashboard alone had a Settings link, so Settings was
 * unreachable from a vehicle page without going home first.
 *
 * A breadcrumb rather than a back link: the wordmark already returns home, so
 * a separate "← Fleet" beside it just renders the word Fleet twice. `crumb`
 * says where you are instead of repeating how to leave.
 */
export function AppHeader({ crumb }: { crumb?: string }) {
  // No point offering a link to the page you are already on.
  const onSettings = useLocation().pathname === "/settings";
  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-page/90 backdrop-blur">
      <div className={CONTAINER.replace("pb-24", "") + " flex h-14 items-center gap-2"}>
        <Link to="/" className="font-semibold tracking-tight hover:text-ink">
          Fleet
        </Link>
        {crumb && (
          <>
            <span aria-hidden className="text-ink-faint">
              /
            </span>
            <span className="min-w-0 truncate text-ink-muted">{crumb}</span>
          </>
        )}
        {!onSettings && (
          <Link to="/settings" className="ml-auto text-sm text-ink-muted hover:text-ink">
            Settings
          </Link>
        )}
      </div>
    </header>
  );
}

/** Section heading, consistent across routes. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wider text-ink-faint">{children}</h2>
  );
}
