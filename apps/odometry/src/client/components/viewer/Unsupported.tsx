/**
 * What the viewer shows for a file it cannot draw -- in practice HEIC photos
 * outside Safari, or a PDF that fails to parse. Never a blank panel: a blank
 * reads as a corrupt file, which it is not.
 */
export function Unsupported({
  url,
  filename,
  reason,
}: {
  url: string;
  filename: string;
  reason: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="max-w-sm text-sm text-ink-muted">{reason}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border border-edge px-4 py-2.5 text-sm text-ink-muted hover:text-ink"
        >
          Open in a new tab
        </a>
        <a
          href={url}
          download={filename}
          className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-page"
        >
          Download
        </a>
      </div>
    </div>
  );
}
