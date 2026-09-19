/**
 * Which viewer a file gets.
 *
 * For a SAVED file `contentType` is the type the server sniffed from the bytes
 * at upload, not what the browser claimed -- see
 * packages/core/src/worker/attachments.ts. For a PENDING file (picked but not
 * yet uploaded) it is the browser's guess, which is fine: it is the user's own
 * file, previewed locally, and the upload still sniffs it properly.
 *
 * HEIC is "image" on purpose. Safari renders it; every other browser fails to
 * load it, and ImageView falls back to the Unsupported panel on that error.
 * Guessing "unsupported" up front would deny Safari users a preview they can
 * actually see.
 */
export type ViewerKind = "image" | "pdf" | "unsupported";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

export function viewerKind(contentType: string, filename: string): ViewerKind {
  const type = contentType.toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (IMAGE_TYPES.has(type)) return "image";
  // A pending file can arrive with an empty type (some Android pickers do
  // this), so the extension is the fallback -- never the first answer.
  if (type === "") {
    if (/\.pdf$/i.test(filename)) return "pdf";
    if (IMAGE_EXT.test(filename)) return "image";
  }
  return "unsupported";
}
