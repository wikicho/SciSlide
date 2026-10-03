import type { Bounds, Point } from "./drawing";

type Axis = "x" | "y";
type SlideSize = { width: number; height: number };

export type SmartGuide =
  | {
      kind: "alignment";
      axis: Axis;
      position: number;
      from: number;
      to: number;
      anchor: "edge" | "center" | "slide";
    }
  | {
      kind: "spacing" | "size";
      axis: Axis;
      position: number;
      from: number;
      to: number;
      label: string;
    };

export interface ResizeSnapOptions {
  /** The existing bottom-right handle is width driven for constrained resizing. */
  aspectRatio?: number;
  minWidth?: number;
  minHeight?: number;
}

const EPSILON = 1e-7;
const AXES = ["x", "y"] as const;

interface Candidate {
  adjustment: number;
  priority: number;
  key: string;
  guides: (bounds: Bounds) => SmartGuide[];
}

function dimension(axis: Axis): "width" | "height" {
  return axis === "x" ? "width" : "height";
}

function perpendicular(axis: Axis): Axis {
  return axis === "x" ? "y" : "x";
}

function end(bounds: Bounds, axis: Axis): number {
  return bounds[axis] + bounds[dimension(axis)];
}

function center(bounds: Bounds, axis: Axis): number {
  return bounds[axis] + bounds[dimension(axis)] / 2;
}

function validBounds(bounds: Bounds): boolean {
  return (
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width > EPSILON &&
    bounds.height > EPSILON
  );
}

function boundedTolerance(tolerance: number): number {
  return Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;
}

function boundsKey(bounds: Bounds): string {
  return [bounds.x, bounds.y, bounds.width, bounds.height].join(",");
}

function canonicalTargets(targets: readonly Bounds[]): Bounds[] {
  return targets
    .filter(validBounds)
    .slice()
    .sort((a, b) => {
      for (const key of ["x", "y", "width", "height"] as const) {
        const difference = a[key] - b[key];
        if (difference) return difference;
      }
      return 0;
    });
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const distance = Math.abs(a.adjustment) - Math.abs(b.adjustment);
  if (Math.abs(distance) > EPSILON) return distance;
  return a.priority - b.priority || a.key.localeCompare(b.key);
}

function nearest(
  candidates: Candidate[],
  tolerance: number,
): Candidate | undefined {
  return candidates
    .filter(
      (candidate) => Math.abs(candidate.adjustment) <= tolerance + EPSILON,
    )
    .sort(compareCandidates)[0];
}

function label(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `${rounded} px` : "<0.1 px";
}

function alignmentGuide(
  axis: Axis,
  position: number,
  source: Bounds,
  target: Bounds,
  anchor: "edge" | "center" | "slide",
): SmartGuide {
  const cross = perpendicular(axis);
  return {
    kind: "alignment",
    axis,
    position,
    from: Math.min(source[cross], target[cross]),
    to: Math.max(end(source, cross), end(target, cross)),
    anchor,
  };
}

function alignmentCandidates(
  source: Bounds,
  targets: readonly Bounds[],
  slideSize: SlideSize,
  axis: Axis,
  resize: boolean,
): Candidate[] {
  const size = dimension(axis);
  const candidates: Candidate[] = [];
  const add = (
    target: Bounds,
    position: number,
    sourcePosition: number,
    multiplier: number,
    anchor: "edge" | "center" | "slide",
    priority: number,
    key: string,
  ) =>
    candidates.push({
      adjustment: (position - sourcePosition) * multiplier,
      priority,
      key,
      guides: (bounds) => [
        alignmentGuide(axis, position, bounds, target, anchor),
      ],
    });

  for (const target of targets) {
    const key = boundsKey(target);
    add(
      target,
      center(target, axis),
      center(source, axis),
      resize ? 2 : 1,
      "center",
      1,
      `center:${key}`,
    );
    for (const position of [target[axis], end(target, axis)]) {
      const edges = resize
        ? [end(source, axis)]
        : [source[axis], end(source, axis)];
      for (const edge of edges)
        add(
          target,
          position,
          edge,
          1,
          "edge",
          2,
          `edge:${position}:${edge}:${key}`,
        );
    }
  }

  if (
    Number.isFinite(slideSize.width) &&
    Number.isFinite(slideSize.height) &&
    slideSize.width > 0 &&
    slideSize.height > 0
  ) {
    const slide = { x: 0, y: 0, ...slideSize };
    add(
      slide,
      slideSize[size] / 2,
      center(source, axis),
      resize ? 2 : 1,
      "slide",
      3,
      "slide:center",
    );
    add(slide, slideSize[size], end(source, axis), 1, "slide", 3, "slide:end");
    if (!resize) add(slide, 0, source[axis], 1, "slide", 3, "slide:start");
  }
  return candidates;
}

/** All participating boxes must share a real row/column, not just touch. */
function sharedBand(
  bounds: readonly Bounds[],
  axis: Axis,
): { from: number; to: number } | null {
  const cross = perpendicular(axis);
  const from = Math.max(...bounds.map((bound) => bound[cross]));
  const to = Math.min(...bounds.map((bound) => end(bound, cross)));
  return to - from > EPSILON ? { from, to } : null;
}

function intersectsBand(
  bounds: Bounds,
  axis: Axis,
  band: { from: number; to: number },
): boolean {
  const cross = perpendicular(axis);
  return (
    Math.min(end(bounds, cross), band.to) - Math.max(bounds[cross], band.from) >
    EPSILON
  );
}

/** Ignore distant rows; reject another neighbor or an overlapping row object. */
function clearSpacingSpan(
  source: Bounds,
  first: Bounds,
  second: Bounds,
  targets: readonly Bounds[],
  axis: Axis,
  band: { from: number; to: number },
): boolean {
  const from = Math.min(source[axis], first[axis], second[axis]);
  const to = Math.max(end(source, axis), end(first, axis), end(second, axis));
  return !targets.some(
    (target) =>
      target !== first &&
      target !== second &&
      intersectsBand(target, axis, band) &&
      Math.min(end(target, axis), to) - Math.max(target[axis], from) > EPSILON,
  );
}

function spacingCandidates(
  source: Bounds,
  targets: readonly Bounds[],
  axis: Axis,
  tolerance: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  const size = dimension(axis);
  const cross = perpendicular(axis);
  const eligible = targets.filter(
    (target) =>
      Math.min(end(source, cross), end(target, cross)) -
        Math.max(source[cross], target[cross]) >
      EPSILON,
  );
  const ordered = eligible.slice().sort((a, b) => a[axis] - b[axis]);
  for (let i = 0; i < ordered.length; i++) {
    const first = ordered[i];
    for (let j = i + 1; j < ordered.length; j++) {
      const second = ordered[j];
      const band = sharedBand([source, first, second], axis);
      if (!band) continue;
      const existingGap = second[axis] - end(first, axis);
      if (existingGap <= EPSILON) continue;
      const middleGap = (existingGap - source[size]) / 2;
      const placements = [
        { mode: "after", position: end(second, axis) + existingGap },
        {
          mode: "before",
          position: first[axis] - existingGap - source[size],
        },
        ...(middleGap > EPSILON
          ? [{ mode: "middle", position: end(first, axis) + middleGap }]
          : []),
      ] as const;
      for (const placement of placements) {
        const adjustment = placement.position - source[axis];
        if (Math.abs(adjustment) > tolerance + EPSILON) continue;
        const moved = { ...source, [axis]: placement.position };
        if (!clearSpacingSpan(moved, first, second, eligible, axis, band))
          continue;
        const guides = (bounds: Bounds): SmartGuide[] => {
          const finalBand = sharedBand([bounds, first, second], axis);
          if (
            !finalBand ||
            !clearSpacingSpan(bounds, first, second, targets, axis, finalBand)
          )
            return [];
          const gaps =
            placement.mode === "middle"
              ? [
                  [end(first, axis), bounds[axis]],
                  [end(bounds, axis), second[axis]],
                ]
              : placement.mode === "after"
                ? [
                    [end(first, axis), second[axis]],
                    [end(second, axis), bounds[axis]],
                  ]
                : [
                    [end(bounds, axis), first[axis]],
                    [end(first, axis), second[axis]],
                  ];
          const lengths = gaps.map(([from, to]) => to - from);
          if (
            lengths.some((length) => length <= EPSILON) ||
            Math.abs(lengths[0] - lengths[1]) > EPSILON
          )
            return [];
          const position = (finalBand.from + finalBand.to) / 2;
          return gaps.map(([from, to]) => ({
            kind: "spacing",
            axis,
            from,
            to,
            position,
            label: label(to - from),
          }));
        };
        candidates.push({
          adjustment,
          priority: 0,
          key: `${placement.mode}:${boundsKey(first)}:${boundsKey(second)}`,
          guides,
        });
      }
    }
  }
  return candidates;
}

/** Guides are temporary geometry; nothing is written into the slide model. */
export function snapMove(
  bounds: Bounds,
  delta: Point,
  targets: readonly Bounds[],
  slideSize: SlideSize,
  tolerance: number,
): { dx: number; dy: number; guides: SmartGuide[] } {
  const result = { dx: delta.x, dy: delta.y, guides: [] as SmartGuide[] };
  if (!validBounds(bounds) || !Number.isFinite(delta.x + delta.y))
    return result;
  const validTargets = canonicalTargets(targets);
  const threshold = boundedTolerance(tolerance);
  const proposed = { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y };
  const alignments = AXES.map((axis) =>
    nearest(
      alignmentCandidates(proposed, validTargets, slideSize, axis, false),
      threshold,
    ),
  );
  const spacing: [Map<string, Candidate>, Map<string, Candidate>] = [
    new Map(),
    new Map(),
  ];
  // Try raw and aligned rows/columns, then spacing-adjusted ones. Every primary
  // correction remains relative to the raw pointer proposal, not a previous snap.
  for (let pass = 0; pass < 2; pass++) {
    for (const [index, axis] of AXES.entries()) {
      const other = 1 - index;
      const cross = perpendicular(axis);
      const crossCorrections = new Set([
        0,
        alignments[other]?.adjustment ?? 0,
        ...Array.from(
          spacing[other].values(),
          (candidate) => candidate.adjustment,
        ),
      ]);
      for (const correction of crossCorrections) {
        const source = { ...proposed, [cross]: proposed[cross] + correction };
        for (const candidate of spacingCandidates(
          source,
          validTargets,
          axis,
          threshold,
        ))
          spacing[index].set(candidate.key, candidate);
      }
    }
  }

  const choices = AXES.map((_, index) => [
    alignments[index],
    ...spacing[index].values(),
  ]);
  const combinations = choices[0].flatMap((x) =>
    choices[1].map((y) => {
      const moved = {
        ...proposed,
        x: proposed.x + (x?.adjustment ?? 0),
        y: proposed.y + (y?.adjustment ?? 0),
      };
      const xGuides = x?.guides(moved) ?? [];
      const yGuides = y?.guides(moved) ?? [];
      return { x, y, moved, xGuides, yGuides };
    }),
  );
  const chosen = combinations
    .filter(
      ({ x, y, xGuides, yGuides }) =>
        (!x || xGuides.length > 0) && (!y || yGuides.length > 0),
    )
    .sort((a, b) => {
      const count =
        Number(Boolean(b.x)) +
        Number(Boolean(b.y)) -
        Number(Boolean(a.x)) -
        Number(Boolean(a.y));
      if (count) return count;
      const distance =
        Math.abs(a.x?.adjustment ?? 0) +
        Math.abs(a.y?.adjustment ?? 0) -
        Math.abs(b.x?.adjustment ?? 0) -
        Math.abs(b.y?.adjustment ?? 0);
      if (Math.abs(distance) > EPSILON) return distance;
      return (
        (a.x && b.x ? compareCandidates(a.x, b.x) : 0) ||
        (a.y && b.y ? compareCandidates(a.y, b.y) : 0)
      );
    })[0];
  if (!chosen) return result;
  result.dx = chosen.moved.x - bounds.x;
  result.dy = chosen.moved.y - bounds.y;
  result.guides = [...chosen.xGuides, ...chosen.yGuides];
  return result;
}

function sizeGuides(axis: Axis, source: Bounds, target: Bounds): SmartGuide[] {
  const cross = perpendicular(axis);
  return [source, target].map((bounds) => ({
    kind: "size",
    axis,
    from: bounds[axis],
    to: end(bounds, axis),
    position: end(bounds, cross) + 12,
    label: label(bounds[dimension(axis)]),
  }));
}

function resizeCandidates(
  source: Bounds,
  targets: readonly Bounds[],
  slideSize: SlideSize,
  axis: Axis,
  minimum: number,
): Candidate[] {
  const size = dimension(axis);
  return [
    ...targets
      .filter((target) => target[size] >= minimum)
      .map((target) => ({
        adjustment: target[size] - source[size],
        priority: 0,
        key: `size:${boundsKey(target)}`,
        guides: (bounds: Bounds) => sizeGuides(axis, bounds, target),
      })),
    ...alignmentCandidates(source, targets, slideSize, axis, true),
  ].filter((candidate) => source[size] + candidate.adjustment >= minimum);
}

/** Snap the bottom-right handle while the top-left stays fixed. */
export function snapResize(
  origin: Bounds,
  proposed: { width: number; height: number },
  targets: readonly Bounds[],
  slideSize: SlideSize,
  tolerance: number,
  options: ResizeSnapOptions = {},
): { width: number; height: number; guides: SmartGuide[] } {
  const minimum = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) ? Math.max(0.01, value) : 1;
  const minWidth = minimum(options.minWidth);
  const minHeight = minimum(options.minHeight);
  const finite = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 1;
  const requestedWidth = finite(proposed.width, origin.width);
  const requestedHeight = finite(proposed.height, origin.height);
  let width = Math.max(minWidth, requestedWidth);
  let height = Math.max(minHeight, requestedHeight);
  const ratio = options.aspectRatio;
  const constrained =
    ratio !== undefined && Number.isFinite(ratio) && ratio > 0;
  if (constrained) {
    width = Math.max(width, minHeight * ratio);
    height = width / ratio;
  }
  const result = { width, height, guides: [] as SmartGuide[] };
  if (
    !validBounds(origin) ||
    requestedWidth < minWidth ||
    requestedHeight < minHeight
  )
    return result;

  const source = { ...origin, width, height };
  const validTargets = canonicalTargets(targets);
  const threshold = boundedTolerance(tolerance);
  const axisCandidates = AXES.map((axis) => ({
    axis,
    candidates: resizeCandidates(
      source,
      validTargets,
      slideSize,
      axis,
      axis === "x" ? minWidth : minHeight,
    ),
  }));

  if (constrained) {
    // A single candidate changes both dimensions; test the whole handle's
    // displacement so a small height correction cannot cause a large width jump.
    const choices = axisCandidates
      .flatMap(({ axis, candidates }) =>
        candidates.map((candidate) => {
          const dw =
            axis === "x" ? candidate.adjustment : candidate.adjustment * ratio;
          const dh = dw / ratio;
          return { candidate, axis, dw, dh, distance: Math.hypot(dw, dh) };
        }),
      )
      .filter(
        ({ dw, dh, distance }) =>
          distance <= threshold + EPSILON &&
          width + dw >= minWidth &&
          height + dh >= minHeight,
      )
      .sort((a, b) => {
        const distance = a.distance - b.distance;
        return Math.abs(distance) > EPSILON
          ? distance
          : a.candidate.priority - b.candidate.priority ||
              `${a.axis}:${a.candidate.key}`.localeCompare(
                `${b.axis}:${b.candidate.key}`,
              );
      });
    const chosen = choices[0];
    if (chosen) {
      result.width = width + chosen.dw;
      result.height = result.width / ratio;
      const resized = { ...origin, ...result };
      result.guides = chosen.candidate.guides(resized);
      for (const axis of AXES) {
        const target = validTargets.find(
          (bounds) =>
            Math.abs(bounds[dimension(axis)] - resized[dimension(axis)]) <=
            EPSILON,
        );
        if (
          target &&
          !result.guides.some(
            (guide) => guide.kind === "size" && guide.axis === axis,
          )
        )
          result.guides.push(...sizeGuides(axis, resized, target));
      }
    }
    return result;
  }

  const chosen = axisCandidates.map(({ axis, candidates }) => ({
    axis,
    candidate: nearest(candidates, threshold),
  }));
  for (const { axis, candidate } of chosen) {
    if (candidate) result[dimension(axis)] += candidate.adjustment;
  }
  const resized = { ...origin, ...result };
  for (const { candidate } of chosen) {
    if (candidate) result.guides.push(...candidate.guides(resized));
  }
  return result;
}
