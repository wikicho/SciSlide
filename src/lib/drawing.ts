import { newId } from "./model";
import type { ShapeObject, SlideObject } from "./model";

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlignmentGuide {
  axis: "x" | "y";
  position: number;
}

export type LineShape = ShapeObject & { shape: "line" | "arrow" };

export function isLineShape(object: SlideObject): object is LineShape {
  return (
    object.type === "shape" &&
    (object.shape === "line" || object.shape === "arrow")
  );
}

/** Keep positive frame dimensions even when the actual line is perfectly axial. */
function lineFrame(
  start: Point,
  end: Point,
): Pick<ShapeObject, "transform" | "line"> {
  const width = Math.max(0.01, Math.abs(end.x - start.x));
  const height = Math.max(0.01, Math.abs(end.y - start.y));
  const x = Math.min(start.x, end.x) - (width - Math.abs(end.x - start.x)) / 2;
  const y = Math.min(start.y, end.y) - (height - Math.abs(end.y - start.y)) / 2;
  return {
    transform: { x, y, width, height, rotation: 0 },
    line: {
      start: { x: (start.x - x) / width, y: (start.y - y) / height },
      end: { x: (end.x - x) / width, y: (end.y - y) / height },
    },
  };
}

export function shapeFromDrag(
  kind: ShapeObject["shape"],
  start: Point,
  end: Point,
): ShapeObject {
  const linear = kind === "line" || kind === "arrow";
  return {
    id: newId(),
    type: "shape",
    name:
      kind === "rect"
        ? "Rectangle"
        : kind === "ellipse"
          ? "Ellipse"
          : kind === "arrow"
            ? "Arrow"
            : "Line",
    shape: kind,
    transform: {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.max(0.01, Math.abs(end.x - start.x)),
      height: Math.max(0.01, Math.abs(end.y - start.y)),
      rotation: 0,
    },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    fill: linear ? "none" : "#e2eeeb",
    stroke: "#26867a",
    strokeWidth: 3,
    strokeStyle: "solid",
    ...(linear ? lineFrame(start, end) : {}),
    ...(kind === "arrow" ? { endArrow: true } : {}),
  };
}

function rotate(point: Point, center: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function lineWorldEndpoints(object: ShapeObject): {
  start: Point;
  end: Point;
} {
  const t = object.transform;
  const line = object.line ?? { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
  const center = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  const world = (point: Point) =>
    rotate(
      { x: t.x + point.x * t.width, y: t.y + point.y * t.height },
      center,
      t.rotation,
    );
  return { start: world(line.start), end: world(line.end) };
}

/** Reframe in slide coordinates so the opposite endpoint stays exactly fixed. */
export function moveLineEndpoint(
  object: ShapeObject,
  endpoint: "start" | "end",
  world: Point,
): ShapeObject {
  const endpoints = lineWorldEndpoints(object);
  endpoints[endpoint] = world;
  return { ...object, ...lineFrame(endpoints.start, endpoints.end) };
}

export function shapeStrokeDasharray(object: ShapeObject): string | undefined {
  const width = Math.max(1, object.strokeWidth);
  return object.strokeStyle === "dashed"
    ? `${width * 4} ${width * 2}`
    : object.strokeStyle === "dotted"
      ? `0 ${width * 2}`
      : undefined;
}

/** A group member with a lock makes every member of that group immovable. */
export function isObjectLocked(
  object: SlideObject,
  objects: readonly SlideObject[],
): boolean {
  return (
    object.locked ||
    Boolean(
      object.groupId &&
      objects.some((other) => other.groupId === object.groupId && other.locked),
    )
  );
}

export function expandSelection(
  objects: readonly SlideObject[],
  ids: readonly string[],
): string[] {
  const selected = new Set(ids);
  const groups = new Set(
    objects
      .filter((object) => selected.has(object.id) && object.groupId)
      .map((object) => object.groupId!),
  );
  return objects
    .filter(
      (object) =>
        selected.has(object.id) ||
        Boolean(object.groupId && groups.has(object.groupId)),
    )
    .map((object) => object.id);
}

export function editableSelection(
  objects: readonly SlideObject[],
  ids: readonly string[],
): string[] {
  const selected = new Set(expandSelection(objects, ids));
  const lockedGroups = new Set(
    objects
      .filter((object) => object.locked && object.groupId)
      .map((object) => object.groupId!),
  );
  return objects
    .filter(
      (object) =>
        selected.has(object.id) &&
        !object.locked &&
        (!object.groupId || !lockedGroups.has(object.groupId)),
    )
    .map((object) => object.id);
}

/** Mutates group metadata only. Existing groups flatten into one new group. */
export function groupObjects(
  objects: SlideObject[],
  ids: readonly string[],
): string | null {
  const selected = new Set(editableSelection(objects, ids));
  if (selected.size < 2) return null;
  const groupId = newId();
  for (const object of objects)
    if (selected.has(object.id)) object.groupId = groupId;
  cleanupGroups(objects);
  return groupId;
}

export function ungroupObjects(
  objects: SlideObject[],
  ids: readonly string[],
): void {
  const selected = new Set(editableSelection(objects, ids));
  for (const object of objects)
    if (selected.has(object.id)) delete object.groupId;
}

/** Deleting a group down to one object removes its meaningless group identity. */
export function cleanupGroups(objects: SlideObject[]): void {
  const counts = new Map<string, number>();
  for (const object of objects)
    if (object.groupId)
      counts.set(object.groupId, (counts.get(object.groupId) ?? 0) + 1);
  for (const object of objects)
    if (object.groupId && counts.get(object.groupId) === 1)
      delete object.groupId;
}

/** Also used when duplicating a slide, where locked objects must be copied. */
export function cloneObjectsWithGroups(
  objects: readonly SlideObject[],
  offset: Point = { x: 0, y: 0 },
): SlideObject[] {
  const groups = new Map<string, string>();
  const copies = objects.map((object) => {
    const copy = structuredClone(object);
    copy.id = newId();
    copy.transform.x += offset.x;
    copy.transform.y += offset.y;
    if (copy.groupId) {
      if (!groups.has(copy.groupId)) groups.set(copy.groupId, newId());
      copy.groupId = groups.get(copy.groupId)!;
    }
    return copy;
  });
  cleanupGroups(copies);
  return copies;
}

export function duplicateSelectedObjects(
  objects: readonly SlideObject[],
  ids: readonly string[],
  offset: Point = { x: 32, y: 32 },
): SlideObject[] {
  const selected = new Set(editableSelection(objects, ids));
  return cloneObjectsWithGroups(
    objects.filter((object) => selected.has(object.id)),
    offset,
  );
}

function boundsOfPoints(points: readonly Point[]): Bounds {
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
  };
}

export function objectBounds(
  object: SlideObject,
  dimensions?: { width: number; height: number },
): Bounds {
  if (isLineShape(object)) {
    const endpoints = lineWorldEndpoints(object);
    return boundsOfPoints([endpoints.start, endpoints.end]);
  }
  const t = object.transform;
  const width = dimensions?.width ?? t.width;
  const height = dimensions?.height ?? t.height;
  const center = { x: t.x + width / 2, y: t.y + height / 2 };
  return boundsOfPoints(
    [
      { x: t.x, y: t.y },
      { x: t.x + width, y: t.y },
      { x: t.x + width, y: t.y + height },
      { x: t.x, y: t.y + height },
    ].map((point) => rotate(point, center, t.rotation)),
  );
}

export function selectionBounds(
  objects: readonly SlideObject[],
  ids: readonly string[],
  metrics?: Record<string, { width: number; height: number }>,
): Bounds | null {
  const selected = new Set(ids);
  const bounds = objects
    .filter((object) => selected.has(object.id))
    .map((object) => objectBounds(object, metrics?.[object.id]));
  return bounds.length
    ? boundsOfPoints(
        bounds.flatMap((bound) => [
          { x: bound.x, y: bound.y },
          { x: bound.x + bound.width, y: bound.y + bound.height },
        ]),
      )
    : null;
}

/** Independent nearest edge/center snapping per axis; tolerance is in slide pixels. */
export function snapTranslation(
  bounds: Bounds,
  delta: Point,
  targets: readonly Bounds[],
  slideSize: { width: number; height: number },
  tolerance: number,
): { dx: number; dy: number; guides: AlignmentGuide[] } {
  const guides: AlignmentGuide[] = [];
  const snapped = { dx: delta.x, dy: delta.y, guides };
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const move = axis === "x" ? "dx" : "dy";
    const source = [
      bounds[axis],
      bounds[axis] + bounds[size] / 2,
      bounds[axis] + bounds[size],
    ];
    const candidates = [
      0,
      slideSize[size] / 2,
      slideSize[size],
      ...targets.flatMap((target) => [
        target[axis],
        target[axis] + target[size] / 2,
        target[axis] + target[size],
      ]),
    ];
    let best: { adjustment: number; position: number } | undefined;
    for (const position of candidates)
      for (const edge of source) {
        const adjustment = position - (edge + snapped[move]);
        if (
          Math.abs(adjustment) <= Math.max(0, tolerance) &&
          (!best || Math.abs(adjustment) < Math.abs(best.adjustment))
        )
          best = { adjustment, position };
      }
    if (best) {
      snapped[move] += best.adjustment;
      guides.push({ axis, position: best.position });
    }
  }
  return snapped;
}
