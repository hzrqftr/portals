import { useRef, useState } from "react";
import {
  attachmentUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
  type Attachment,
} from "../api/hooks";

/**
 * Receipts on a service visit.
 *
 * Two modes, because a receipt can be attached before the service record
 * exists (in the log-service form) and after it (from the history row):
 *
 *  - `serviceId` given  -> uploads immediately, lists what is already there.
 *  - `serviceId` null   -> holds the files locally and hands them back through
 *                          `onPendingChange`, for the caller to upload once it
 *                          has an id.
 *
 * PDF is the primary path on purpose: the owner scans invoices with a phone,
 * which produces a PDF. Images are the fallback, and `accept` is ordered to
 * say so.
 */
export function ServiceAttachments({
  serviceId,
  pending,
  onPendingChange,
}: {
  serviceId: string | null;
  pending?: File[];
  onPendingChange?: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const attachments = useAttachments(serviceId ?? "");
  const upload = useUploadAttachment(serviceId ?? "");
  const remove = useDeleteAttachment(serviceId ?? "");

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const picked = Array.from(files);

    if (serviceId === null) {
      onPendingChange?.([...(pending ?? []), ...picked]);
    } else {
      // One at a time, so a rejected file names itself instead of failing the
      // whole selection silently.
      for (const file of picked) {
        try {
          await upload.mutateAsync(file);
        } catch (e) {
          setError(`${file.name}: ${(e as Error).message}`);
        }
      }
    }
    // Let the same file be picked again after a failure.
    if (input.current) input.current.value = "";
  }

  const existing = attachments.data ?? [];
  const held = pending ?? [];
  const busy = upload.isPending || remove.isPending;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium uppercase tracking-wider text-ink-faint">Receipts</h3>

      {existing.length === 0 && held.length === 0 && (
        <p className="mt-2 text-sm text-ink-faint">
          Nothing attached. Scan the workshop invoice with your phone and add the PDF.
        </p>
      )}

      {(existing.length > 0 || held.length > 0) && (
        <ul className="mt-2 space-y-2">
          {existing.map((file) => (
            <SavedRow
              key={file.id}
              file={file}
              busy={busy}
              onRemove={() => {
                setError(null);
                remove.mutate(file.id, {
                  onError: (e) => setError((e as Error).message),
                });
              }}
            />
          ))}
          {held.map((file, i) => (
            <PendingRow
              key={`${file.name}-${i}`}
              file={file}
              onRemove={() => onPendingChange?.(held.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      )}

      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="hidden"
        onChange={(e) => void onPick(e.target.files)}
      />
      {/* Full-width thumb target at every breakpoint: this gets used on a
          phone, standing in a workshop, more often than at a desk. */}
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="mt-3 w-full rounded-xl border border-dashed border-edge py-3 text-sm font-medium text-ink-muted hover:border-ink-faint hover:text-ink disabled:opacity-40"
      >
        {upload.isPending ? "Uploading…" : "Add a receipt (PDF or photo)"}
      </button>

      {error && <p className="mt-2 text-sm text-status-overdue-fg">{error}</p>}
    </div>
  );
}

function SavedRow({
  file,
  busy,
  onRemove,
}: {
  file: Attachment;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-edge bg-inset p-2">
      <Thumb contentType={file.contentType} href={attachmentUrl(file.id)} />
      <a
        href={attachmentUrl(file.id)}
        target="_blank"
        rel="noreferrer"
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

function PendingRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-dashed border-edge bg-inset p-2">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-xs text-ink-faint">
        {file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG"}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <span className="block truncate text-ink">{file.name}</span>
        <span className="block text-xs text-ink-faint">
          {formatBytes(file.size)} · attaches when you save
        </span>
      </div>
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
 * HEIC is deliberately in the label group: browsers accept the upload but will
 * not render it in an <img>, so previewing it would show a broken image rather
 * than nothing. In practice iOS converts HEIC to JPEG on upload, so this is a
 * rare path -- but a broken thumbnail reads as a corrupt file, which it is not.
 */
function Thumb({ contentType, href }: { contentType: string; href: string }) {
  const previewable =
    contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp";

  if (previewable) {
    return (
      <img
        src={href}
        alt=""
        className="h-10 w-10 shrink-0 rounded-lg border border-edge object-cover"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-xs text-ink-faint">
      {contentType === "application/pdf" ? "PDF" : "IMG"}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
