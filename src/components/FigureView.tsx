import { useId } from "react";
import type { Asset, FigureObject } from "../lib/model";
import { figureViewport } from "../lib/figure-editing";

/** A source-space clip prevents uncropped content appearing in letterboxing. */
export function FigureView({
  object,
  asset,
}: {
  object: FigureObject;
  asset?: Asset;
}) {
  const clipId = `figure-region-${useId().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (!asset)
    return (
      <g>
        <rect
          width={object.transform.width}
          height={object.transform.height}
          fill="#fff1f2"
        />
        <text x="12" y="28" fill="#be123c" fontSize="20">
          Missing figure
        </text>
      </g>
    );
  const viewport = figureViewport(object, asset);
  return (
    <svg
      {...viewport.attributes}
      data-figure-viewport="true"
      aria-label={object.alt || object.name}
    >
      <title>{object.alt || object.name}</title>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect {...viewport.region} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <image
          href={asset.dataUrl}
          width={viewport.sourceWidth}
          height={viewport.sourceHeight}
          preserveAspectRatio="xMidYMid meet"
        />
      </g>
    </svg>
  );
}
