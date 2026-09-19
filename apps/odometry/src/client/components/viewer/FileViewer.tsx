import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { viewerKind } from "./kind";
import { ImageView } from "./ImageView";
import { PdfView } from "./PdfView";
import { Unsupported } from "./Unsupported";

export interface ViewerItem {
  /** Same-origin content route for a saved file, or a blob: URL for a pending one. */
  url: string;
  filename: string;
  contentType: string;
}

/**
 * Zoom steps, relative to "fit". Below 1 zooms OUT past fit, as the browser's
 * own PDF viewer does -- asked for on 2026-09-19, to see a whole page (or a
 * whole receipt photo) with room around it.
 */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const FIT = ZOOMS.indexOf(1);

/**
 * The in-app viewer for attached files: images and PDFs, with previous/next
 * across the list it was opened from.
 *
 * A centred modal on a desktop (asked for on 2026-09-19 -- full screen was too
 * much), full screen on a phone, where a modal's margins would only take room
 * away from the document. Clicking the dimmed area around it closes it.
 *
 * IT MUST NOT CLOSE THE FORM UNDERNEATH IT. It is routinely opened from inside
 * a Sheet (the log-service form, the renewal save step), and two things would
 * otherwise leak through to that Sheet and dismiss it -- taking whatever was
 * typed with it:
 *
 *  1. Sheet closes on Escape through a WINDOW keydown listener. This viewer
 *     listens in the CAPTURE phase and stops the event there, so the Sheet's
 *     listener never hears it.
 *  2. React bubbles events from a portal to its REACT parent, not its DOM
 *     parent -- so a click in here would reach the Sheet's scrim onClick. The
 *     root stops propagation of every click.
 */
export function FileViewer({
  items,
  start,
  onClose,
}: {
  items: ViewerItem[];
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [zoomStep, setZoomStep] = useState(FIT);
  const item = items[Math.min(index, items.length - 1)];
  const count = items.length;

  const go = (delta: number) => {
    setIndex((i) => (i + delta + count) % count);
    setZoomStep(FIT);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && count > 1) go(1);
      else if (e.key === "ArrowLeft" && count > 1) go(-1);
      // The browser's own shortcuts would zoom the whole page instead.
      else if ((e.key === "+" || e.key === "=") && !e.ctrlKey && !e.metaKey)
        setZoomStep((z) => Math.min(z + 1, ZOOMS.length - 1));
      else if (e.key === "-" && !e.ctrlKey && !e.metaKey) setZoomStep((z) => Math.max(z - 1, 0));
      else if (e.key === "0" && !e.ctrlKey && !e.metaKey) setZoomStep(FIT);
      else return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // go/count are stable for the life of one viewer; onClose is the caller's.
  }, [onClose, count]);

  // Same page lock as Sheet -- but only if nothing has locked the page yet,
  // and only ever undone by the layer that applied it. When the viewer sits
  // inside a Sheet, the Sheet owns the lock. Restoring a recorded "fixed" here
  // was a real bug found in testing: if the Sheet unmounted first, this
  // cleanup ran after the Sheet's and re-froze the page for good.
  useEffect(() => {
    const { style } = document.body;
    if (style.position === "fixed") return;
    const previous = { position: style.position, top: style.top, width: style.width };
    const scrollY = window.scrollY;
    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.width = "100%";
    return () => {
      Object.assign(style, previous);
      window.scrollTo(0, scrollY);
    };
  }, []);

  if (!item) return null;
  const kind = viewerKind(item.contentType, item.filename);
  const zoom = ZOOMS[zoomStep] ?? 1;

  return createPortal(
    // The scrim. Every click is stopped here whatever else happens -- see the
    // comment above about the Sheet underneath -- and a click on the scrim
    // itself (not the panel) closes the viewer.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 sm:p-6"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Viewing ${item.filename}`}
      className={
        "flex h-full w-full flex-col overflow-hidden bg-surface " +
        "sm:h-[85vh] sm:max-w-4xl sm:rounded-2xl sm:border sm:border-edge sm:shadow-2xl"
      }
    >
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{item.filename}</p>
          {count > 1 && (
            <p className="text-xs text-ink-faint">
              {index + 1} of {count}
            </p>
          )}
        </div>
        {kind !== "unsupported" && (
          <div className="flex items-center rounded-lg border border-edge">
            <Btn label="Zoom out" disabled={zoomStep === 0} onClick={() => setZoomStep((z) => z - 1)}>
              &minus;
            </Btn>
            <Btn label="Fit" disabled={zoomStep === FIT} onClick={() => setZoomStep(FIT)}>
              <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            </Btn>
            <Btn
              label="Zoom in"
              disabled={zoomStep === ZOOMS.length - 1}
              onClick={() => setZoomStep((z) => z + 1)}
            >
              +
            </Btn>
          </div>
        )}
        <a
          href={item.url}
          download={item.filename}
          aria-label="Download"
          title="Download"
          className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-edge px-2 text-sm text-ink-muted hover:text-ink sm:px-3"
        >
          {/* An arrow on a phone, where the header has no room for the word. */}
          <span aria-hidden className="sm:hidden">&darr;</span>
          <span className="hidden sm:inline">Download</span>
        </a>
        <Btn label="Close" onClick={onClose} bordered>
          &times;
        </Btn>
      </div>

      <div className="relative min-h-0 flex-1">
        {kind === "image" && (
          <ImageView key={item.url} url={item.url} filename={item.filename} zoom={zoom} />
        )}
        {kind === "pdf" && (
          <PdfView key={item.url} url={item.url} filename={item.filename} zoom={zoom} />
        )}
        {kind === "unsupported" && (
          <Unsupported
            url={item.url}
            filename={item.filename}
            reason="There is no preview for this kind of file."
          />
        )}

        {count > 1 && (
          <>
            <NavBtn side="left" onClick={() => go(-1)} />
            <NavBtn side="right" onClick={() => go(1)} />
          </>
        )}
      </div>
    </div>
    </div>,
    document.body,
  );
}

function Btn({
  label,
  onClick,
  disabled,
  bordered,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  bordered?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={
        "flex h-9 min-w-9 items-center justify-center px-2 text-lg text-ink-muted hover:text-ink disabled:opacity-30 " +
        (bordered ? "rounded-lg border border-edge" : "")
      }
    >
      {children}
    </button>
  );
}

/** Large enough to hit with a thumb; sits over the file, not in the header. */
function NavBtn({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous file" : "Next file"}
      onClick={onClick}
      className={
        "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface/90 text-xl text-ink shadow " +
        (side === "left" ? "left-3" : "right-3")
      }
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
