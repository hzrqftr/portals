import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

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
 * NOTHING PASSES THIS YET, and that is deliberate. The portals sit on two
 * hostnames behind two Access applications, so a user may hold access to one
 * or both, and a link shown to someone without access leads to a Cloudflare
 * denial page rather than anywhere useful.
 *
 * Driving it correctly would mean reading Access group membership -- but
 * ctx.access is not populated in production (which is why the JWT assertion
 * fallback exists in @portals/core/worker auth.ts), and the assertion payload
 * we parse carries no groups claim. So there is no group information reaching
 * the Worker today.
 *
 * The prop exists so that when there IS, turning on cross-portal navigation
 * is passing an array here rather than reworking the chrome in two apps.
 */
export type Portal = { name: string; href: string };

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
  settingsHref,
  portals = [],
}: {
  wordmark: ReactNode;
  homeLabel: string;
  crumb?: string;
  settingsHref?: string;
  portals?: Portal[];
}) {
  const { pathname } = useLocation();
  // No point offering a link to the page you are already on.
  const onSettings = settingsHref !== undefined && pathname === settingsHref;

  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-page/90 backdrop-blur">
      <div className={CONTAINER.replace("pb-24", "") + " flex h-14 items-center gap-2"}>
        {crumb && <BackButton />}
        {crumb ? (
          <Link to="/" className="shrink-0 text-ink-muted hover:text-ink">
            {homeLabel}
          </Link>
        ) : (
          <Link to="/" className="shrink-0 hover:text-ink">
            {wordmark}
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
