import type { MouseEvent } from "react";
import type { Attachment } from "../api/hooks";

/**
 * The rows of the Attachments list. Split out of Attachments.tsx when the
 * in-app viewer arrived, to keep both files readable.
 *
 * Clicking a file opens the viewer. The `href` stays on the link on purpose:
 * middle-click, Ctrl/Cmd-click and "open in new tab" still do what a link
 * does, and only a plain left click is intercepted.
 */

function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function SavedRow({
  file,
  href,
  busy,
  onOpen,
  onRemove,
}: {
  file: Attachment;
  href: string;
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const open = (e: MouseEvent) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    onOpen();
  };
  return (
    <li className="flex items-center gap-3 rounded-xl border border-edge bg-inset p-2">
      <a href={href} target="_blank" rel="noreferrer" onClick={open} tabIndex={-1} aria-hidden>
        <Thumb contentType={file.contentType} src={href} />
      </a>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={open}
        className="min-w-0 flex-1 text-sm text-ink hover:underline"
      >
        <span className="block truncate">{file.filename}</span>
        <span className="block text-xs text-ink-faint">{formatBytes(file.sizeBytes)}</span>
      </a>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={`Remove ${file.filename}`}
        className="shrink-0 rounded-lg px-2 py-1 text-sm text-ink-faint hover:text-status-overdue-fg disabled:opacity-40"
      >
        Remove
      </button>
    </li>
  );
}

/** A picked file not uploaded yet. Previewable from a local blob: URL. */
export function PendingRow({
  file,
  onOpen,
  onRemove,
}: {
  file: File;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-dashed border-edge bg-inset p-2">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-xs text-ink-faint">
          {file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink hover:underline">{file.name}</span>
          <span className="block text-xs text-ink-faint">
            {formatBytes(file.size)} · attaches when you save
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="shrink-0 rounded-lg px-2 py-1 text-sm text-ink-faint hover:text-status-overdue-fg"
      >
        Remove
      </button>
    </li>
  );
}

/**
 * A preview for images, a label for everything else.
 *
 * HEIC is deliberately in the label group: most browsers will not render it
 * in an <img>, and a broken thumbnail reads as a corrupt file, which it is not.
 * The viewer tries it anyway and falls back to a download panel.
 */
function Thumb({ contentType, src }: { contentType: string; src: string }) {
  const previewable =
    contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp";

  if (previewable) {
    return (
      <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-edge object-cover" />
    );
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-xs text-ink-faint">
      {contentType === "application/pdf" ? "PDF" : "IMG"}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
