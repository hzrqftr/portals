import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

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
 * back-to-home link and the dashboard alone had a Settings link, so Settings
 * was unreachable from a vehicle page without going home first.
 *
 * A breadcrumb rather than a duplicate home link: the wordmark already
 * returns home, so `crumb` says where you are instead of repeating how to
 * leave.
 *
 * The back arrow is a different thing from the home link and both are needed.
 * The home link always goes to the dashboard; the arrow returns to whatever
 * you were looking at. Reaching Settings from a vehicle page and pressing
 * "Dashboard" lands on the dashboard, which is not where you came from --
 * that is the gap the arrow closes.
 *
 * The root link changes identity with depth, which is deliberate. At the
 * root it is the WORDMARK: the app name in the display face, the one piece
 * of branding on screen. Inside a breadcrumb it is NAVIGATION, so it reads
 * "Dashboard" in the body font and sits at the same weight as the crumb
 * beside it. A script face next to plain crumb text looked like a mistake,
 * and "Odometry / Waja" named the app where the user expected a place.
 */
export function AppHeader({ crumb }: { crumb?: string }) {
  const { pathname } = useLocation();
  // No point offering a link to the page you are already on.
  const onSettings = pathname === "/settings";
  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-page/90 backdrop-blur">
      <div className={CONTAINER.replace("pb-24", "") + " flex h-14 items-center gap-2"}>
        {crumb && <BackButton />}
        {crumb ? (
          <Link to="/" className="shrink-0 text-ink-muted hover:text-ink">
            Dashboard
          </Link>
        ) : (
          <Link
            to="/"
            className="shrink-0 font-wordmark text-2xl leading-none hover:text-ink"
          >
            Odometry
          </Link>
        )}
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

/**
 * Back to wherever you were.
 *
 * Falls through to the dashboard when there is nothing to go back to --
 * opening a vehicle link directly, or landing here after a refresh. React
 * Router tracks its own position in `history.state.idx`; at 0 there is no
 * app history behind us, and calling navigate(-1) would walk the user out of
 * the app entirely.
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

/** Section heading, consistent across routes. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wider text-ink-faint">{children}</h2>
  );
}
