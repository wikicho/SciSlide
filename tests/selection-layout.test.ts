import { describe, expect, it } from "vitest";
import { objectBounds, shapeFromDrag } from "../src/lib/drawing";
import {
  alignSelection,
  distributeSelection,
  selectionLayoutUnits,
} from "../src/lib/selection-layout";
import type { SelectionAlignment } from "../src/lib/selection-layout";
import type { EquationObject, SlideObject } from "../src/lib/model";

const slideSize = { width: 1600, height: 900 };
const rectangle = (x: number, y: number, width = 100, height = 80) =>
  shapeFromDrag("rect", { x, y }, { x: x + width, y: y + height });
const ids = (objects: SlideObject[]) => objects.map((object) => object.id);

describe("selection alignment", () => {
  it.each<[SelectionAlignment, "x" | "y", number]>([
    ["left", "x", 80],
    ["center", "x", 750],
    ["right", "x", 1420],
    ["top", "y", 80],
    ["middle", "y", 410],
    ["bottom", "y", 740],
  ])("places one unit at the slide's %s", (alignment, axis, expected) => {
    const object = rectangle(200, 250);
    expect(alignSelection([object], [object.id], alignment, slideSize)).toBe(
      true,
    );
    expect(object.transform[axis]).toBe(expected);
    expect(object.transform[axis === "x" ? "y" : "x"]).toBe(
      axis === "x" ? 250 : 200,
    );
    expect(alignSelection([object], [object.id], alignment, slideSize)).toBe(
      false,
    );
  });

  it.each<[SelectionAlignment, "x" | "y", number, number]>([
    ["left", "x", 100, 100],
    ["center", "x", 300, 250],
    ["right", "x", 500, 400],
    ["top", "y", 100, 100],
    ["middle", "y", 310, 250],
    ["bottom", "y", 520, 400],
  ])(
    "aligns several units against their shared %s bounds",
    (alignment, axis, a, b) => {
      const objects = [rectangle(100, 100), rectangle(400, 400, 200, 200)];
      expect(alignSelection(objects, ids(objects), alignment, slideSize)).toBe(
        true,
      );
      expect(objects.map((object) => object.transform[axis])).toEqual([a, b]);
    },
  );

  it("moves a complete group including hidden members and excludes a locked group", () => {
    const objects = [
      rectangle(200, 200),
      rectangle(400, 300),
      rectangle(800, 100),
      rectangle(1000, 200),
    ];
    objects[0].groupId = objects[1].groupId = "editable";
    objects[1].visible = false;
    objects[2].groupId = objects[3].groupId = "locked";
    objects[3].locked = true;
    const units = selectionLayoutUnits(objects, [objects[0].id, objects[2].id]);
    expect(units).toHaveLength(1);
    expect(units[0].objects).toEqual(objects.slice(0, 2));
    expect(units[0].bounds).toEqual({
      x: 200,
      y: 200,
      width: 300,
      height: 180,
    });
    expect(
      alignSelection(
        objects,
        [objects[0].id, objects[2].id],
        "bottom",
        slideSize,
      ),
    ).toBe(true);
    expect(objects.map((object) => object.transform.y)).toEqual([
      640, 740, 100, 200,
    ]);
  });

  it("aligns rotated frames, line endpoints and live equation metrics by visual bounds", () => {
    const rotated = rectangle(200, 200, 100, 40);
    rotated.transform.rotation = 90;
    const line = shapeFromDrag("line", { x: 500, y: 300 }, { x: 500, y: 500 });
    const equation: EquationObject = {
      ...rectangle(900, 600),
      type: "equation",
      latex: "x",
      style: {},
      displayMode: true,
      description: "x",
    };
    const objects = [rotated, line, equation];
    const metrics = { [equation.id]: { width: 300, height: 50 } };
    const sourceLine = structuredClone(line.line);
    alignSelection(objects, ids(objects), "right", slideSize, metrics);
    for (const object of objects) {
      const bounds = objectBounds(object, metrics[object.id]);
      expect(bounds.x + bounds.width).toBeCloseTo(1200);
    }
    expect(line.line).toEqual(sourceLine);
    expect(equation.transform.width).toBe(100);
    expect(rotated.transform.rotation).toBe(90);
  });

  it("does not claim a change for empty, locked or already aligned selections", () => {
    expect(alignSelection([], [], "left", slideSize)).toBe(false);
    const locked = rectangle(100, 100);
    locked.locked = true;
    expect(alignSelection([locked], [locked.id], "left", slideSize)).toBe(
      false,
    );
    const objects = [rectangle(100, 100), rectangle(100 + 1e-8, 300)];
    const before = structuredClone(objects);
    expect(alignSelection(objects, ids(objects), "left", slideSize)).toBe(
      false,
    );
    expect(objects).toEqual(before);
  });
});

describe("equal-gap selection distribution", () => {
  it.each(["x", "y"] as const)(
    "equalizes unequal-size units on %s and preserves anchors",
    (axis) => {
      const objects =
        axis === "x"
          ? [
              rectangle(100, 20, 80),
              rectangle(250, 30, 120),
              rectangle(700, 40, 200),
            ]
          : [
              rectangle(20, 100, 100, 80),
              rectangle(30, 250, 100, 120),
              rectangle(40, 700, 100, 200),
            ];
      const before = structuredClone(objects);
      expect(distributeSelection(objects, ids(objects), axis)).toBe(true);
      expect(objects[1].transform[axis]).toBe(380);
      expect(objects[0]).toEqual(before[0]);
      expect(objects[2]).toEqual(before[2]);
      expect(objects[1].transform[axis === "x" ? "y" : "x"]).toBe(
        axis === "x" ? 30 : 30,
      );
      expect(distributeSelection(objects, ids(objects), axis)).toBe(false);
    },
  );

  it("treats groups as one unit, skips locked objects, and uses input order to break position ties", () => {
    const first = rectangle(0, 0, 10, 10);
    const middle = rectangle(0, 20, 10, 10);
    const hidden = rectangle(10, 20, 10, 10);
    const last = rectangle(300, 30, 10, 10);
    const locked = rectangle(100, 50, 200, 10);
    middle.groupId = hidden.groupId = "pair";
    hidden.visible = false;
    locked.locked = true;
    const objects = [first, middle, hidden, locked, last];
    expect(distributeSelection(objects, ids(objects), "x")).toBe(true);
    expect(first.transform.x).toBe(0);
    expect(middle.transform.x).toBe(145);
    expect(hidden.transform.x).toBe(155);
    expect(last.transform.x).toBe(300);
    expect(locked.transform.x).toBe(100);
  });

  it("requires three independent units and leaves crowded arrangements untouched", () => {
    const objects = [
      rectangle(0, 0, 100),
      rectangle(30, 100, 100),
      rectangle(80, 200, 100),
    ];
    const before = structuredClone(objects);
    expect(distributeSelection(objects, ids(objects), "x")).toBe(false);
    expect(objects).toEqual(before);
    objects[0].groupId = objects[1].groupId = "pair";
    expect(distributeSelection(objects, ids(objects), "y")).toBe(false);
    expect(distributeSelection([], [], "x")).toBe(false);
  });

  it("allows zero gaps without changing the last anchor", () => {
    const objects = [
      rectangle(0, 0, 10),
      rectangle(1, 0, 20),
      rectangle(30, 0, 30),
    ];
    expect(distributeSelection(objects, ids(objects), "x")).toBe(true);
    expect(objects.map((object) => object.transform.x)).toEqual([0, 10, 30]);
  });
});
