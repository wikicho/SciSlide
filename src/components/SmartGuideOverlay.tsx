import type { AlignmentGuide } from "../lib/drawing";
import type { SmartGuide } from "../lib/smart-guides";

export type SceneGuide = SmartGuide | AlignmentGuide;

/** Temporary editor aids. All distances are in slide units; badges stay screen-sized. */
export function SmartGuideOverlay({
  guides,
  slideSize,
  scale = 1,
}: {
  guides: SceneGuide[];
  slideSize: { width: number; height: number };
  scale?: number;
}) {
  const unit = 1 / (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const tick = 5 * unit;
  const fontSize = 12 * unit;

  return (
    <g data-alignment-guides="true" pointerEvents="none" aria-hidden="true">
      {guides.map((guide, index) => {
        const key = `${guide.axis}:${guide.position}:${index}`;
        if (!("kind" in guide)) {
          return (
            <path
              key={key}
              data-guide-kind="alignment"
              data-guide-axis={guide.axis}
              data-guide-line="true"
              d={
                guide.axis === "x"
                  ? `M ${guide.position} 0 V ${slideSize.height}`
                  : `M 0 ${guide.position} H ${slideSize.width}`
              }
              fill="none"
              stroke="#c026d3"
              strokeWidth="1"
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          );
        }

        const alignment = guide.kind === "alignment";
        const color = alignment
          ? "#c026d3"
          : guide.kind === "spacing"
            ? "#b45309"
            : "#0e7490";
        // An alignment's axis identifies its coordinate, while a measurement's
        // axis identifies the direction in which distance is measured.
        const vertical = alignment ? guide.axis === "x" : guide.axis === "y";
        const line = vertical
          ? `M ${guide.position} ${guide.from} V ${guide.to}`
          : `M ${guide.from} ${guide.position} H ${guide.to}`;
        const caps = vertical
          ? `M ${guide.position - tick} ${guide.from} H ${guide.position + tick} M ${guide.position - tick} ${guide.to} H ${guide.position + tick}`
          : `M ${guide.from} ${guide.position - tick} V ${guide.position + tick} M ${guide.to} ${guide.position - tick} V ${guide.position + tick}`;
        const middle = (guide.from + guide.to) / 2;
        const label = alignment ? "" : guide.label;
        const badgeWidth = (label.length * 7 + 12) * unit;
        const badgeHeight = 22 * unit;
        const preferredLabelX = vertical
          ? guide.position + 10 * unit + badgeWidth / 2
          : middle;
        const preferredLabelY = vertical ? middle : guide.position - 14 * unit;
        const labelX = Math.max(
          badgeWidth / 2 + unit,
          Math.min(slideSize.width - badgeWidth / 2 - unit, preferredLabelX),
        );
        const labelY = Math.max(
          badgeHeight / 2 + unit,
          Math.min(slideSize.height - badgeHeight / 2 - unit, preferredLabelY),
        );

        return (
          <g
            key={key}
            data-guide-kind={guide.kind}
            data-guide-axis={guide.axis}
            data-guide-anchor={alignment ? guide.anchor : undefined}
          >
            <path
              data-guide-line="true"
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="1"
              strokeDasharray={
                alignment ? `${5 * unit} ${4 * unit}` : undefined
              }
              vectorEffect="non-scaling-stroke"
            />
            <path
              data-guide-ticks="true"
              d={caps}
              fill="none"
              stroke={color}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {alignment && guide.anchor !== "edge" && (
              <circle
                data-guide-center="true"
                cx={vertical ? guide.position : middle}
                cy={vertical ? middle : guide.position}
                r={2.5 * unit}
                fill="white"
                stroke={color}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {!alignment && (
              <g data-guide-label="true">
                <rect
                  x={labelX - badgeWidth / 2}
                  y={labelY - badgeHeight / 2}
                  width={badgeWidth}
                  height={badgeHeight}
                  rx={4 * unit}
                  fill={guide.kind === "spacing" ? "#fffbeb" : "#ecfeff"}
                  stroke={color}
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={labelX}
                  y={labelY}
                  fontSize={fontSize}
                  fill={color}
                  fontFamily="Inter, sans-serif"
                  fontWeight="500"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
