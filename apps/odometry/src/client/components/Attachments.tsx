import { useEffect, useMemo, useRef, useState } from "react";
import {
  attachmentUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
  serviceReceipts,
  type Attachment,
  type AttachmentTarget,
} from "../api/hooks";
import { PendingRow, SavedRow } from "./AttachmentRows";
import { FileViewer, type ViewerItem } from "./viewer/FileViewer";

/**
 * Files on a service visit, a renewal, or the vehicle's grant.
 *
 * Two modes, because a file can be attached before its parent exists (in the
 * log-service form) and after it:
 *
 *  - `target` given  -> uploads immediately, lists what is already there.
 *  - `target` null   -> holds the files locally and hands them back through
 *                       `onPendingChange`, for the caller to upload once it
 *                       has an id.
 *
 * PDF is the primary path on purpose: the owner scans paper with a phone,
 * which produces a PDF. Images are the fallback, and `accept` is ordered to
 * say so.
 *
 * Every file, saved or pending, opens in the in-app viewer (viewer/), with
 * previous/next across this list. This component is the ONLY uploader in
 * either portal, so wiring the viewer here puts it everywhere files attach.
 */
export function Attachments({
  target,
  title,
  emptyHint,
  addLabel,
  pending,
  onPendingChange,
}: {
  target: AttachmentTarget | null;
  title: string;
  emptyHint: string;
  addLabel: string;
  pending?: File[];
  onPendingChange?: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const attachments = useAttachments(target);
  const upload = useUploadAttachment(target);
  const remove = useDeleteAttachment(target);

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const picked = Array.from(files);

    if (target === null) {
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
  const [viewing, setViewing] = useState<number | null>(null);

  // Pending files have no server URL yet, so the viewer reads them from local
  // blob: URLs. Revoked whenever the pending list changes or this unmounts --
  // each one pins the file's bytes in memory until it is.
  const heldUrls = useMemo(() => held.map((f) => URL.createObjectURL(f)), [held]);
  useEffect(() => () => heldUrls.forEach((u) => URL.revokeObjectURL(u)), [heldUrls]);

  const items: ViewerItem[] = [
    ...existing.map((f) => ({
      url: attachmentUrl(target!, f.id),
      filename: f.filename,
      contentType: f.contentType,
    })),
    ...held.map((f, i) => ({ url: heldUrls[i]!, filename: f.name, contentType: f.type })),
  ];

  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium uppercase tracking-wider text-ink-faint">{title}</h3>

      {existing.length === 0 && held.length === 0 && (
        <p className="mt-2 text-sm text-ink-faint">{emptyHint}</p>
      )}

      {(existing.length > 0 || held.length > 0) && (
        <ul className="mt-2 space-y-2">
          {existing.map((file, i) => (
            <SavedRow
              key={file.id}
              file={file}
              href={attachmentUrl(target!, file.id)}
              busy={busy}
              onOpen={() => setViewing(i)}
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
              onOpen={() => setViewing(existing.length + i)}
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
        {upload.isPending ? "Uploading…" : addLabel}
      </button>

      {error && <p className="mt-2 text-sm text-status-overdue-fg">{error}</p>}

      {viewing !== null && items.length > 0 && (
        <FileViewer items={items} start={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

/** Receipts on a service visit: the original caller, unchanged in behaviour. */
export function ServiceAttachments({
  serviceId,
  pending,
  onPendingChange,
}: {
  serviceId: string | null;
  pending?: File[];
  onPendingChange?: (files: File[]) => void;
}) {
  return (
    <Attachments
      target={serviceId === null ? null : serviceReceipts(serviceId)}
      title="Receipts"
      emptyHint="Nothing attached. Scan the workshop invoice with your phone and add the PDF."
      addLabel="Add a receipt (PDF or photo)"
      pending={pending}
      onPendingChange={onPendingChange}
    />
  );
}
