import { useState } from "react";
import { Unsupported } from "./Unsupported";

/**
 * One image, fitted to the viewer at zoom 1, enlarged inside a scroll
 * container above that so it can be panned by dragging (touch) or scrolling.
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

  return (
    <div className="h-full overflow-auto overscroll-contain">
      <div
        className="flex min-h-full items-center justify-center p-4"
        // At zoom 1 the image fits the box; beyond that the wrapper grows and
        // the scroll container above supplies the panning.
        style={zoom > 1 ? { width: `${zoom * 100}%` } : undefined}
      >
        <img
          src={url}
          alt={filename}
          onError={() => setFailed(true)}
          className={
            zoom > 1
              ? "w-full max-w-none rounded-lg"
              : "max-h-full max-w-full rounded-lg object-contain"
          }
          style={zoom > 1 ? undefined : { maxHeight: "calc(100vh - 8rem)" }}
        />
      </div>
    </div>
  );
}
