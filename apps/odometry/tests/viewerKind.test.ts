import { describe, it, expect } from "vitest";
import { viewerKind } from "../src/client/components/viewer/kind";

/**
 * Which viewer a file gets. Small, but it decides whether a receipt previews
 * or shows a download panel, and for a pending file it runs on whatever the
 * browser guessed.
 */
describe("viewerKind", () => {
  it("routes by the stored content type first", () => {
    expect(viewerKind("application/pdf", "anything.bin")).toBe("pdf");
    expect(viewerKind("image/jpeg", "scan.pdf")).toBe("image");
    expect(viewerKind("image/png", "x")).toBe("image");
    expect(viewerKind("image/webp", "x")).toBe("image");
  });

  it("tries HEIC as an image, so Safari can show it", () => {
    expect(viewerKind("image/heic", "IMG_0001.HEIC")).toBe("image");
  });

  it("falls back to the extension only when the type is empty", () => {
    expect(viewerKind("", "receipt.PDF")).toBe("pdf");
    expect(viewerKind("", "photo.jpeg")).toBe("image");
    expect(viewerKind("", "notes.txt")).toBe("unsupported");
    // A declared type is never overruled by the name.
    expect(viewerKind("text/html", "looks-like.pdf")).toBe("unsupported");
  });
});
