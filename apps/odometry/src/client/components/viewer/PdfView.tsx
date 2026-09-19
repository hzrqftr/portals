import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Unsupported } from "./Unsupported";

/**
 * A PDF, drawn by PDF.js onto canvases -- one per page, stacked.
 *
 * PDF.js rather than the browser's own viewer (owner decision, 2026-09-19):
 * Android Chrome shows nothing for a PDF inside a page, and iPhone Safari can
 * stop at page one. Drawing it ourselves looks the same everywhere.
 *
 * CANVAS ONLY, ON PURPOSE. No text layer and no annotation layer: a canvas is
 * pixels, so nothing inside an uploaded PDF can become a clickable link or a
 * form on this origin. Do not add those layers without thinking that through.
 *
 * The library is ~1 MB and most visits never open a PDF, so it is imported
 * lazily on first use (its own chunk) and the worker is a separate static
 * asset. The LEGACY build carries polyfills that iPhones before Safari 17.4
 * need.
 */

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<Pdfjs> | null = null;

function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjs;
}

export function PdfView({ url, filename, zoom }: { url: string; filename: string; zoom: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [aspect, setAspect] = useState(1.414); // A4 until page one says otherwise
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Torn down through the loading task: in PDF.js 6 that is what owns the
    // worker-side document, and destroying it also aborts a load in flight.
    let task: ReturnType<Pdfjs["getDocument"]> | null = null;
    setDoc(null);
    setFailed(false);
    // Same origin, so the Access cookie goes with the request and the
    // garage-scoped content route authorises it exactly as a link would.
    loadPdfjs()
      .then((lib) => {
        if (cancelled) throw new Error("cancelled");
        task = lib.getDocument({ url });
        return task.promise;
      })
      .then(async (d) => {
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        setAspect(first.height / first.width);
        setDoc(d);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      void (task as ReturnType<Pdfjs["getDocument"]> | null)?.destroy();
    };
  }, [url]);

  // Pages are drawn to the width of the viewer, so they follow a rotated phone.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Measured once now as well as on every resize: relying on the observer's
    // first report alone left the pages at zero width in testing.
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (failed) {
    return (
      <Unsupported url={url} filename={filename} reason="This PDF could not be displayed here." />
    );
  }

  const pageWidth = Math.max(0, (width - 32) * zoom);
  return (
    <div ref={box} data-pdf-scroll className="h-full overflow-auto overscroll-contain">
      {!doc ? (
        <p className="p-6 text-center text-sm text-ink-muted">Loading&hellip;</p>
      ) : (
        <div className="mx-auto flex flex-col items-center gap-3 p-4" style={{ width: pageWidth + 32 }}>
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} number={i + 1} width={pageWidth} aspect={aspect} />
          ))}
          <p className="text-xs text-ink-faint">
            {doc.numPages} {doc.numPages === 1 ? "page" : "pages"}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One page. Drawn only once it scrolls near the viewport, so a 30-page PDF on
 * a phone renders the page being looked at, not all thirty.
 */
function PdfPage({
  doc,
  number,
  width,
  aspect,
}: {
  doc: PDFDocumentProxy;
  number: number;
  width: number;
  aspect: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(width * aspect);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    // The pages scroll inside the viewer's own box, not the window, so that
    // box is the root -- otherwise the look-ahead margin never applies and a
    // page only starts drawing once it is already on screen.
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), {
      root: el.closest("[data-pdf-scroll]"),
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || width <= 0 || !canvas.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    void doc.getPage(number).then((page) => {
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      const el = canvas.current;
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      setHeight(base.height * scale);
      task = page.render({ canvas: el, viewport });
      // A re-render (zoom, resize) cancels the one in flight; that rejection
      // is expected and not an error worth showing.
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, width, visible]);

  return (
    <canvas
      ref={canvas}
      aria-label={`Page ${number}`}
      // No background class: PDF.js paints the page's own paper colour, and a
      // raw `bg-white` is exactly what the palette rule forbids.
      className="rounded bg-inset shadow"
      style={{ width, height }}
    />
  );
}
