import type { ShapeObject } from "./model";
import { isLineShape, shapeStrokeDasharray } from "./drawing";

export { isLineShape } from "./drawing";

export interface ShapePrimitive {
  tag: "rect" | "ellipse" | "path" | "polygon";
  attributes: Record<string, string | number>;
}

/** Normalized line ends live inside the object's transform, including rotation. */
export function lineEndpoints(object: ShapeObject) {
  const { width, height } = object.transform;
  const line = object.line ?? {
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  };
  return {
    start: { x: line.start.x * width, y: line.start.y * height },
    end: { x: line.end.x * width, y: line.end.y * height },
  };
}

/** Keep editor, presentation, SVG and PDF geometry identical. No SVG markers. */
export function shapeGeometry(object: ShapeObject): ShapePrimitive[] {
  const { width, height } = object.transform;
  const strokeWidth = object.strokeWidth;
  const attributes: Record<string, string | number> = {
    fill: object.fill,
    stroke: object.stroke,
    "stroke-width": strokeWidth,
  };
  const dasharray = shapeStrokeDasharray(object);
  if (dasharray) attributes["stroke-dasharray"] = dasharray;
  if (object.strokeStyle === "dotted") {
    attributes["stroke-linecap"] = "round";
  }
  if (!isLineShape(object)) {
    return [
      object.shape === "ellipse"
        ? {
            tag: "ellipse",
            attributes: {
              ...attributes,
              cx: width / 2,
              cy: height / 2,
              rx: width / 2,
              ry: height / 2,
            },
          }
        : {
            tag: "rect",
            attributes: { ...attributes, width, height, rx: 12 },
          },
    ];
  }
  const { start, end } = lineEndpoints(object);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const ux = length ? dx / length : 1;
  const uy = length ? dy / length : 0;
  const headLength = Math.min(Math.max(12, strokeWidth * 4), length / 3);
  const headWidth = headLength * 0.55;
  const hasStroke = strokeWidth > 0 && object.stroke !== "none";
  const startArrow = Boolean(object.startArrow && length && hasStroke);
  const endArrow = Boolean(
    (object.endArrow ?? object.shape === "arrow") && length && hasStroke,
  );
  const shaftStart = {
    x: start.x + (startArrow ? ux * headLength : 0),
    y: start.y + (startArrow ? uy * headLength : 0),
  };
  const shaftEnd = {
    x: end.x - (endArrow ? ux * headLength : 0),
    y: end.y - (endArrow ? uy * headLength : 0),
  };
  const primitives: ShapePrimitive[] = [
    {
      tag: "path",
      attributes: {
        ...attributes,
        fill: "none",
        "stroke-linecap": "round",
        d: `M ${shaftStart.x} ${shaftStart.y} L ${shaftEnd.x} ${shaftEnd.y}`,
      },
    },
  ];
  for (const [tip, sign, enabled] of [
    [start, 1, startArrow],
    [end, -1, endArrow],
  ] as const) {
    if (!enabled) continue;
    const base = {
      x: tip.x + ux * headLength * sign,
      y: tip.y + uy * headLength * sign,
    };
    primitives.push({
      tag: "polygon",
      attributes: {
        points: `${tip.x},${tip.y} ${base.x - uy * headWidth},${base.y + ux * headWidth} ${base.x + uy * headWidth},${base.y - ux * headWidth}`,
        fill: object.stroke,
        stroke: "none",
      },
    });
  }
  return primitives;
}
