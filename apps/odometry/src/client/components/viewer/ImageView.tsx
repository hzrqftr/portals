import { useState } from "react";
import { Unsupported } from "./Unsupported";

/**
 * One image, fitted to the viewer at zoom 1, drawn smaller below 1, and
 * enlarged inside a scroll container above 1 so it can be panned.
 *
 * Zoom is a width multiplier rather than a CSS transform: a transform does not
 * change layout size, so the scroll container would not know the image grew
 * and there would be nothing to pan to.
 */
export function ImageView({
  url,
  filename,
  zoom,
}: {
  url: string;
  filename: string;
  zoom: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Unsupported
        url={url}
        filename={filename}
        reason="This browser cannot display this image (HEIC photos only preview in Safari)."
      />
    );
  }

  // At or below "fit" the image is contained in the panel and, below it,
  // simply drawn smaller -- nothing to pan, so a transform is fine there.
  if (zoom <= 1) {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden p-4">
        <img
          src={url}
          alt={filename}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full rounded-lg object-contain transition-transform"
          style={zoom < 1 ? { transform: `scale(${zoom})` } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto overscroll-contain">
      {/* Above fit the wrapper grows and the scroll container supplies the
          panning -- a transform would not change layout size, so there would
          be nothing to scroll to. */}
      <div className="p-4" style={{ width: `${zoom * 100}%` }}>
        <img
          src={url}
          alt={filename}
          onError={() => setFailed(true)}
          className="w-full max-w-none rounded-lg"
        />
      </div>
    </div>
  );
}
