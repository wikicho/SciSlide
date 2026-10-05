import { editableSelection, selectionBounds } from "./drawing";
import type { Bounds } from "./drawing";
import type { SlideObject } from "./model";

export type SelectionAlignment =
  "left" | "center" | "right" | "top" | "middle" | "bottom";

export interface SelectionLayoutUnit {
  objects: SlideObject[];
  bounds: Bounds;
}

type ObjectMetrics = Record<string, { width: number; height: number }>;
const POSITION_TOLERANCE = 1e-6;
const SLIDE_MARGIN = 80;

/** A group is one layout unit, including hidden members; locked units stay put. */
export function selectionLayoutUnits(
  objects: readonly SlideObject[],
  ids: readonly string[],
  metrics?: ObjectMetrics,
): SelectionLayoutUnit[] {
  const selected = new Set(editableSelection(objects, ids));
  const groups = new Map<string, SlideObject[]>();
  for (const object of objects) {
    if (!selected.has(object.id)) continue;
    const key = object.groupId
      ? `group:${object.groupId}`
      : `object:${object.id}`;
    groups.set(key, [...(groups.get(key) ?? []), object]);
  }
  return [...groups.values()].map((members) => ({
    objects: members,
    bounds: selectionBounds(
      members,
      members.map((object) => object.id),
      metrics,
    )!,
  }));
}

function translate(
  unit: SelectionLayoutUnit,
  axis: "x" | "y",
  delta: number,
): boolean {
  if (Math.abs(delta) <= POSITION_TOLERANCE) return false;
  for (const object of unit.objects) object.transform[axis] += delta;
  return true;
}

/** Align a selection's visual bounds, or place one unit within slide margins. */
export function alignSelection(
  objects: readonly SlideObject[],
  ids: readonly string[],
  alignment: SelectionAlignment,
  slideSize: { width: number; height: number },
  metrics?: ObjectMetrics,
): boolean {
  const units = selectionLayoutUnits(objects, ids, metrics);
  if (!units.length) return false;
  const horizontal = ["left", "center", "right"].includes(alignment);
  const axis = horizontal ? "x" : "y";
  const size = horizontal ? "width" : "height";
  const start =
    units.length === 1
      ? SLIDE_MARGIN
      : Math.min(...units.map((unit) => unit.bounds[axis]));
  const end =
    units.length === 1
      ? slideSize[size] - SLIDE_MARGIN
      : Math.max(...units.map((unit) => unit.bounds[axis] + unit.bounds[size]));
  let changed = false;
  for (const unit of units) {
    const target =
      alignment === "left" || alignment === "top"
        ? start
        : alignment === "right" || alignment === "bottom"
          ? end - unit.bounds[size]
          : (start + end - unit.bounds[size]) / 2;
    changed = translate(unit, axis, target - unit.bounds[axis]) || changed;
  }
  return changed;
}

/** Equalize edge gaps while leaving the first and last visual units anchored. */
export function distributeSelection(
  objects: readonly SlideObject[],
  ids: readonly string[],
  axis: "x" | "y",
  metrics?: ObjectMetrics,
): boolean {
  const units = selectionLayoutUnits(objects, ids, metrics)
    .map((unit, index) => ({ ...unit, index }))
    .sort((a, b) => a.bounds[axis] - b.bounds[axis] || a.index - b.index);
  if (units.length < 3) return false;
  const size = axis === "x" ? "width" : "height";
  const first = units[0];
  const last = units[units.length - 1];
  const span = last.bounds[axis] + last.bounds[size] - first.bounds[axis];
  const occupied = units.reduce((total, unit) => total + unit.bounds[size], 0);
  const gap = (span - occupied) / (units.length - 1);
  // A cramped selection cannot have non-overlapping equal gaps within its anchors.
  if (gap < -POSITION_TOLERANCE) return false;
  const spacing = Math.max(0, gap);
  let cursor = first.bounds[axis] + first.bounds[size] + spacing;
  let changed = false;
  for (const unit of units.slice(1, -1)) {
    changed = translate(unit, axis, cursor - unit.bounds[axis]) || changed;
    cursor += unit.bounds[size] + spacing;
  }
  return changed;
}
