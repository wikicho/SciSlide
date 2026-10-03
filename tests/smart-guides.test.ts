import { describe, expect, it } from "vitest";
import type { Bounds } from "../src/lib/drawing";
import { snapMove, snapResize } from "../src/lib/smart-guides";
import type { SmartGuide } from "../src/lib/smart-guides";

const slide = { width: 1000, height: 1000 };
const box = (x: number, y: number, width: number, height: number): Bounds => ({
  x,
  y,
  width,
  height,
});
const measurements = (guides: SmartGuide[], kind: "spacing" | "size") =>
  guides.filter((guide) => guide.kind === kind);

describe("bounded alignment guides", () => {
  it("aligns unequal-width centers and identifies the two objects' extent", () => {
    const result = snapMove(
      box(145, 100, 200, 50),
      { x: 3, y: 0 },
      [box(200, 400, 100, 80)],
      slide,
      6,
    );
    expect(result.dx).toBe(5);
    expect(result.guides).toContainEqual({
      kind: "alignment",
      axis: "x",
      position: 250,
      from: 100,
      to: 480,
      anchor: "center",
    });
  });

  it("allows an object's right edge to align with another's left", () => {
    const result = snapMove(
      box(100, 100, 100, 80),
      { x: 197, y: 0 },
      [box(400, 200, 130, 50)],
      slide,
      6,
    );
    expect(result.dx).toBe(200);
    expect(result.guides).toContainEqual({
      kind: "alignment",
      axis: "x",
      position: 400,
      from: 100,
      to: 250,
      anchor: "edge",
    });
  });

  it("aligns to slide centers with a slide-spanning center line", () => {
    const result = snapMove(
      box(441, 100, 120, 50),
      { x: 0, y: 0 },
      [],
      slide,
      6,
    );
    expect(result.dx).toBe(-1);
    expect(result.guides).toContainEqual({
      kind: "alignment",
      axis: "x",
      position: 500,
      from: 0,
      to: 1000,
      anchor: "slide",
    });
  });

  it("does not attract a center to an unrelated edge", () => {
    const result = snapMove(
      box(247, 100, 100, 60),
      { x: 0, y: 0 },
      [box(300, 300, 180, 100)],
      slide,
      6,
    );
    expect(result.dx).toBe(0);
    expect(result.guides.filter((guide) => guide.axis === "x")).toEqual([]);
  });

  it("uses the closest correction and a stable tie independent of target order", () => {
    const origin = box(150, 100, 100, 40);
    const targets = [box(254, 300, 10, 60), box(246, 500, 10, 60)];
    const first = snapMove(origin, { x: 0, y: 0 }, targets, slide, 6);
    const reversed = snapMove(
      origin,
      { x: 0, y: 0 },
      targets.slice().reverse(),
      slide,
      6,
    );
    expect(first).toEqual(reversed);
    expect(Math.abs(first.dx)).toBe(4);
    const closer = snapMove(
      origin,
      { x: 0, y: 0 },
      [box(255, 300, 10, 60), box(247, 500, 10, 60)],
      slide,
      6,
    );
    expect(closer.dx).toBe(-3);
  });

  it("respects tolerance and ignores degenerate or nonfinite boxes", () => {
    const origin = box(155, 100, 100, 40);
    const targets = [box(260, 300, 0, 60), box(NaN, 300, 20, 60)];
    expect(snapMove(origin, { x: 0, y: 0 }, targets, slide, 6).guides).toEqual(
      [],
    );
    expect(
      snapMove(origin, { x: 0, y: 0 }, [box(262, 300, 20, 60)], slide, 6).dx,
    ).toBe(0);
    expect(
      snapMove(box(0, 0, 0, 20), { x: 3, y: 4 }, targets, slide, 6),
    ).toEqual({ dx: 3, dy: 4, guides: [] });
  });
});

describe("equal edge-to-edge spacing", () => {
  it("balances a middle object between neighbors of different widths", () => {
    const result = snapMove(
      box(294, 100, 60, 40),
      { x: 0, y: 0 },
      [box(100, 80, 80, 100), box(460, 120, 150, 80)],
      slide,
      5,
    );
    expect(result.dx).toBe(-4);
    expect(measurements(result.guides, "spacing")).toEqual([
      {
        kind: "spacing",
        axis: "x",
        from: 180,
        to: 290,
        position: 130,
        label: "110 px",
      },
      {
        kind: "spacing",
        axis: "x",
        from: 350,
        to: 460,
        position: 130,
        label: "110 px",
      },
    ]);
  });

  it.each([
    [
      335,
      120,
      340,
      [
        [140, 200],
        [280, 340],
      ],
    ],
    [
      -45,
      120,
      -40,
      [
        [80, 140],
        [240, 300],
      ],
    ],
  ])("extends an existing row on either side", (x, width, snappedX, gaps) => {
    const targets =
      x > 0
        ? [box(40, 100, 100, 60), box(200, 100, 80, 60)]
        : [box(140, 100, 100, 60), box(300, 100, 80, 60)];
    const result = snapMove(
      box(x, 100, width, 60),
      { x: 0, y: 0 },
      targets,
      slide,
      6,
    );
    expect(x + result.dx).toBe(snappedX);
    expect(
      measurements(result.guides, "spacing").map(({ from, to }) => [from, to]),
    ).toEqual(gaps);
    expect(
      measurements(result.guides, "spacing").every(
        (guide) => guide.label === "60 px",
      ),
    ).toBe(true);
  });

  it("applies the same geometry to vertical columns", () => {
    const result = snapMove(
      box(100, 294, 40, 60),
      { x: 0, y: 0 },
      [box(80, 100, 100, 80), box(120, 460, 80, 150)],
      slide,
      5,
    );
    expect(result.dy).toBe(-4);
    expect(measurements(result.guides, "spacing")).toEqual([
      {
        kind: "spacing",
        axis: "y",
        from: 180,
        to: 290,
        position: 130,
        label: "110 px",
      },
      {
        kind: "spacing",
        axis: "y",
        from: 350,
        to: 460,
        position: 130,
        label: "110 px",
      },
    ]);
  });

  it("does not compare different rows, touching rows, or overlapping neighbors", () => {
    const origin = box(294, 100, 60, 40);
    for (const targets of [
      [box(100, 300, 80, 100), box(460, 400, 150, 80)],
      [box(100, 140, 80, 100), box(460, 140, 150, 80)],
      [box(100, 100, 400, 40), box(460, 100, 150, 40)],
    ]) {
      const result = snapMove(origin, { x: 0, y: 0 }, targets, slide, 5);
      expect(measurements(result.guides, "spacing")).toEqual([]);
    }
  });

  it("requires actual neighbors and rejects a blocking or overlapping object", () => {
    const origin = box(294, 100, 60, 40);
    const base = [box(100, 80, 80, 100), box(460, 120, 150, 80)];
    for (const blocker of [box(240, 120, 30, 60), box(150, 120, 70, 60)]) {
      const result = snapMove(
        origin,
        { x: 0, y: 0 },
        [...base, blocker],
        slide,
        5,
      );
      expect(measurements(result.guides, "spacing")).toEqual([]);
    }
    const distantRow = snapMove(
      origin,
      { x: 0, y: 0 },
      [...base, box(240, 300, 30, 60)],
      slide,
      5,
    );
    expect(measurements(distantRow.guides, "spacing")).toHaveLength(2);
  });

  it("does not snap a gap when the other axis removes the row overlap", () => {
    const result = snapMove(
      box(336, 79, 120, 80),
      { x: 0, y: 0 },
      [box(40, 0, 100, 80), box(200, 0, 80, 80)],
      slide,
      6,
    );
    // The raw pointer overlaps the row by 1 px, but y snaps to its bottom edge.
    expect(result.dy).toBe(1);
    expect(result.dx).toBe(0);
    expect(measurements(result.guides, "spacing")).toEqual([]);
  });

  it("rejects zero/negative gaps and positions outside the tolerance", () => {
    const origin = box(294, 100, 280, 40);
    const targets = [box(100, 100, 80, 40), box(460, 100, 150, 40)];
    expect(
      measurements(
        snapMove(origin, { x: 0, y: 0 }, targets, slide, 5).guides,
        "spacing",
      ),
    ).toEqual([]);
    const distant = snapMove(
      box(301, 100, 60, 40),
      { x: 0, y: 0 },
      targets,
      slide,
      5,
    );
    expect(distant.dx).toBe(0);
    expect(measurements(distant.guides, "spacing")).toEqual([]);
  });
});

describe("resize alignment and matching dimensions", () => {
  it("matches width and height, showing the actual source and reference sizes", () => {
    const origin = box(100, 100, 80, 60);
    const target = box(600, 600, 300, 150);
    const result = snapResize(
      origin,
      { width: 297, height: 147 },
      [target],
      slide,
      6,
    );
    expect(result.width).toBe(300);
    expect(result.height).toBe(150);
    expect(measurements(result.guides, "size")).toEqual([
      {
        kind: "size",
        axis: "x",
        from: 100,
        to: 400,
        position: 262,
        label: "300 px",
      },
      {
        kind: "size",
        axis: "x",
        from: 600,
        to: 900,
        position: 762,
        label: "300 px",
      },
      {
        kind: "size",
        axis: "y",
        from: 100,
        to: 250,
        position: 412,
        label: "150 px",
      },
      {
        kind: "size",
        axis: "y",
        from: 600,
        to: 750,
        position: 912,
        label: "150 px",
      },
    ]);
  });

  it("aligns resized far edges and centers while leaving the top-left fixed", () => {
    const origin = box(100, 100, 80, 60);
    const edge = snapResize(
      origin,
      { width: 297, height: 73 },
      [box(400, 400, 180, 200)],
      slide,
      6,
    );
    expect(edge.width).toBe(300);
    expect(edge.guides).toContainEqual({
      kind: "alignment",
      axis: "x",
      position: 400,
      from: 100,
      to: 600,
      anchor: "edge",
    });
    const center = snapResize(
      origin,
      { width: 294, height: 73 },
      [box(200, 400, 100, 200)],
      slide,
      6,
    );
    expect(center.width).toBe(300);
    expect(center.guides).toContainEqual({
      kind: "alignment",
      axis: "x",
      position: 250,
      from: 100,
      to: 600,
      anchor: "center",
    });
  });

  it("preserves photo/Shift aspect ratios and reports both genuinely matching sizes", () => {
    const result = snapResize(
      box(100, 100, 200, 100),
      { width: 297, height: 148.5 },
      [box(600, 600, 300, 150)],
      slide,
      6,
      { aspectRatio: 2, minWidth: 24, minHeight: 24 },
    );
    expect(result.width).toBe(300);
    expect(result.height).toBe(150);
    expect(measurements(result.guides, "size")).toHaveLength(4);
  });

  it("does not distort a ratio or jump horizontally for a nearby height", () => {
    const result = snapResize(
      box(100, 100, 200, 100),
      { width: 298, height: 74.5 },
      [box(600, 600, 700, 80)],
      slide,
      6,
      { aspectRatio: 4 },
    );
    expect(result.width).toBe(298);
    expect(result.height).toBe(74.5);
    expect(result.guides).toEqual([]);
  });

  it("selects one closest constrained candidate instead of snapping axes separately", () => {
    const result = snapResize(
      box(100, 100, 200, 100),
      { width: 296, height: 148 },
      [box(600, 600, 300, 140), box(700, 800, 400, 149)],
      slide,
      6,
      { aspectRatio: 2 },
    );
    expect(result.width).toBe(298);
    expect(result.height).toBe(149);
    expect(result.width / result.height).toBe(2);
    expect(
      result.guides.every(
        (guide) => guide.kind !== "size" || guide.label === "149 px",
      ),
    ).toBe(true);
  });

  it("clamps tiny dimensions without guides and preserves the ratio at both minima", () => {
    const result = snapResize(
      box(100, 100, 200, 100),
      { width: 0, height: 0 },
      [box(500, 500, 24, 24)],
      slide,
      6,
      { aspectRatio: 4, minWidth: 24, minHeight: 24 },
    );
    expect(result).toEqual({ width: 96, height: 24, guides: [] });
    const free = snapResize(
      box(100, 100, 40, 40),
      { width: -2, height: 0 },
      [],
      slide,
      6,
      { minWidth: 24, minHeight: 24 },
    );
    expect(free).toEqual({ width: 24, height: 24, guides: [] });
  });
});
