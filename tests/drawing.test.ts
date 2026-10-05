// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanupGroups,
  cloneObjectsWithGroups,
  duplicateSelectedObjects,
  editableSelection,
  expandSelection,
  groupObjects,
  isObjectLocked,
  lineWorldEndpoints,
  moveLineEndpoint,
  objectBounds,
  selectionBounds,
  shapeFromDrag,
  shapeStrokeDasharray,
  snapTranslation,
  ungroupObjects,
} from "../src/lib/drawing";
import {
  createBlankSlide,
  createDemoDeck,
  validateDeck,
} from "../src/lib/model";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));

function shape(kind: "rect" | "ellipse" | "line" | "arrow" = "rect") {
  return shapeFromDrag(kind, { x: 30, y: 40 }, { x: 180, y: 100 });
}

function closePoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

describe("direct shape geometry", () => {
  it.each([
    [
      { x: 100, y: 80 },
      { x: 20, y: 10 },
    ],
    [
      { x: 20, y: 80 },
      { x: 100, y: 10 },
    ],
    [
      { x: 100, y: 80 },
      { x: 20, y: 80 },
    ],
    [
      { x: 20, y: 80 },
      { x: 20, y: 10 },
    ],
    [
      { x: 20, y: 10 },
      { x: 20, y: 10 },
    ],
  ])(
    "keeps directed endpoints for reverse, axial, and zero-length drags",
    (start, end) => {
      const arrow = shapeFromDrag("arrow", start, end);
      const points = lineWorldEndpoints(arrow);
      closePoint(points.start, start);
      closePoint(points.end, end);
      expect(arrow.endArrow).toBe(true);
      expect(arrow.transform.width).toBeGreaterThan(0);
      expect(arrow.transform.height).toBeGreaterThan(0);
      const deck = createDemoDeck();
      deck.slides[0].objects.push(arrow);
      expect(() => validateDeck(deck)).not.toThrow();
    },
  );

  it("normalizes reverse box drags and uses geometric bounds after rotation", () => {
    const rect = shapeFromDrag("rect", { x: 180, y: 100 }, { x: 30, y: 40 });
    expect(rect.transform).toEqual({
      x: 30,
      y: 40,
      width: 150,
      height: 60,
      rotation: 0,
    });
    rect.transform.rotation = 90;
    const bounds = objectBounds(rect);
    expect(bounds.x).toBeCloseTo(75);
    expect(bounds.y).toBeCloseTo(-5);
    expect(bounds.width).toBeCloseTo(60);
    expect(bounds.height).toBeCloseTo(150);
  });

  it("edits either rotated endpoint while preserving the opposite world point and style", () => {
    const arrow = shape("arrow");
    arrow.transform.rotation = 37;
    arrow.startArrow = true;
    arrow.strokeStyle = "dashed";
    const before = structuredClone(arrow);
    const points = lineWorldEndpoints(arrow);
    const moved = moveLineEndpoint(arrow, "start", { x: 220, y: 90 });
    closePoint(lineWorldEndpoints(moved).start, { x: 220, y: 90 });
    closePoint(lineWorldEndpoints(moved).end, points.end);
    expect(moved.transform.rotation).toBe(0);
    expect(moved).toMatchObject({
      id: arrow.id,
      startArrow: true,
      endArrow: true,
      strokeStyle: "dashed",
    });
    const again = moveLineEndpoint(moved, "end", { x: 220, y: -100 });
    closePoint(lineWorldEndpoints(again).start, { x: 220, y: 90 });
    closePoint(lineWorldEndpoints(again).end, { x: 220, y: -100 });
    expect(arrow).toEqual(before);
  });

  it("scales dash spacing with stroke width and leaves legacy solid shapes unchanged", () => {
    const line = shape("line");
    delete line.strokeStyle;
    expect(shapeStrokeDasharray(line)).toBeUndefined();
    line.strokeWidth = 4;
    line.strokeStyle = "dashed";
    expect(shapeStrokeDasharray(line)).toBe("16 8");
    line.strokeStyle = "dotted";
    expect(shapeStrokeDasharray(line)).toBe("0 8");
  });
});

describe("flat persistent groups", () => {
  it("expands a selected group, includes hidden members, and merges complete units", () => {
    const objects = [shape(), shape("ellipse"), shape("line"), shape()];
    const first = groupObjects(
      objects,
      objects.slice(0, 2).map((object) => object.id),
    );
    objects[1].visible = false;
    expect(expandSelection(objects, [objects[0].id])).toEqual(
      objects.slice(0, 2).map((object) => object.id),
    );
    const merged = groupObjects(objects, [objects[1].id, objects[2].id]);
    expect(merged).not.toBe(first);
    expect(
      objects.slice(0, 3).every((object) => object.groupId === merged),
    ).toBe(true);
    expect(objects[3].groupId).toBeUndefined();
    ungroupObjects(objects, [objects[0].id]);
    expect(objects.every((object) => !object.groupId)).toBe(true);
  });

  it("protects an entire group if any member is locked, including duplication and ungrouping", () => {
    const objects = [shape(), shape(), shape()];
    const group = groupObjects(objects, [objects[0].id, objects[1].id]);
    objects[1].locked = true;
    expect(isObjectLocked(objects[0], objects)).toBe(true);
    expect(editableSelection(objects, [objects[0].id, objects[2].id])).toEqual([
      objects[2].id,
    ]);
    expect(duplicateSelectedObjects(objects, [objects[0].id])).toEqual([]);
    ungroupObjects(objects, [objects[0].id]);
    expect(objects[0].groupId).toBe(group);
    expect(groupObjects(objects, [objects[0].id, objects[2].id])).toBeNull();
  });

  it("duplicates complete groups with independent IDs, offsets, and deeply copied fields", () => {
    const objects = [shape("arrow"), shape(), shape()];
    const originalGroup = groupObjects(objects, [objects[0].id, objects[1].id]);
    const copies = duplicateSelectedObjects(objects, [objects[1].id]);
    expect(copies).toHaveLength(2);
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe(originalGroup);
    expect(
      copies.every((copy) => !objects.some((object) => object.id === copy.id)),
    ).toBe(true);
    expect(copies[0].transform.x).toBe(objects[0].transform.x + 32);
    copies[0].metadata.changed = true;
    expect(objects[0].metadata.changed).toBeUndefined();
    objects[1].locked = true;
    const slideCopies = cloneObjectsWithGroups(objects);
    expect(slideCopies[1].locked).toBe(true);
    expect(slideCopies[0].groupId).toBe(slideCopies[1].groupId);
    expect(slideCopies[0].groupId).not.toBe(originalGroup);
    const partial = cloneObjectsWithGroups([objects[0]]);
    expect(partial[0].groupId).toBeUndefined();
  });

  it("cleans up groups after individual deletion without altering surviving object IDs", () => {
    const objects = [shape(), shape(), shape()];
    groupObjects(objects, [objects[0].id, objects[1].id]);
    const remainingId = objects[1].id;
    objects.shift();
    cleanupGroups(objects);
    expect(objects[0].id).toBe(remainingId);
    expect(objects[0].groupId).toBeUndefined();
  });
});

describe("alignment guides", () => {
  it("finds the nearest stationary edge/center and slide edge with independent axis corrections", () => {
    const snapped = snapTranslation(
      { x: 100, y: 100, width: 40, height: 30 },
      { x: 53, y: -97 },
      [{ x: 150, y: 500, width: 80, height: 50 }],
      { width: 800, height: 600 },
      5,
    );
    expect(snapped).toEqual({
      dx: 50,
      dy: -100,
      guides: [
        { axis: "x", position: 150 },
        { axis: "y", position: 0 },
      ],
    });
  });

  it("honors zoom-derived tolerance without changing the shape's internal geometry", () => {
    const bounds = { x: 100, y: 100, width: 40, height: 30 };
    const targets = [{ x: 150, y: 300, width: 80, height: 40 }];
    const delta = { x: 55, y: 13 };
    const slide = { width: 800, height: 600 };
    expect(snapTranslation(bounds, delta, targets, slide, 3)).toEqual({
      dx: 55,
      dy: 13,
      guides: [],
    });
    expect(snapTranslation(bounds, delta, targets, slide, 6).dx).toBe(50);
    const a = shape();
    const b = shape();
    b.transform.x += 250;
    expect(selectionBounds([a, b], [a.id, b.id])).toEqual({
      x: 30,
      y: 40,
      width: 400,
      height: 60,
    });
    expect(selectionBounds([a], [])).toBeNull();
    expect(objectBounds(a, { width: 500, height: 80 }).width).toBe(500);
  });
});

describe("drawing document compatibility", () => {
  it("round trips lines, dash styles, arrowheads, transparent fills and groups in native format 0.5.0", async () => {
    const deck = createDemoDeck();
    const line = shape("line");
    const arrow = shape("arrow");
    const rect = shape();
    line.strokeStyle = "dotted";
    arrow.strokeStyle = "dashed";
    arrow.startArrow = true;
    rect.fill = "none";
    const objects = [line, arrow, rect];
    groupObjects(objects, [line.id, arrow.id]);
    deck.slides[0].objects.push(...objects);
    const archive = await buildDeckArchive(deck);
    const zip = await JSZip.loadAsync(await bytes(archive));
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(manifest).toMatchObject({
      formatVersion: "0.5.0",
      producer: { name: "SciSlide", version: "0.5.3" },
    });
    const loaded = await readDeckArchive(archive);
    expect(loaded.formatVersion).toBe("0.5.0");
    expect(loaded.slides[0].objects.slice(-3)).toEqual(objects);
    expect(await readDeckArchive(await buildDeckArchive(loaded))).toEqual(
      loaded,
    );
  });

  it("rejects malformed endpoints/styles and group collisions, while cleaning singleton groups on snapshots", () => {
    const deck = createDemoDeck();
    const line = shape("line");
    deck.slides[0].objects.push(line);
    line.line!.start.x = -0.1;
    expect(() => validateDeck(deck)).toThrow("Line start x");
    line.line!.start.x = 0;
    line.strokeStyle = "invalid" as never;
    expect(() => validateDeck(deck)).toThrow("stroke style");
    line.strokeStyle = "solid";
    line.groupId = deck.id;
    expect(() => validateDeck(deck)).toThrow("Group ID duplicates");
    line.groupId = "group-example";
    const other = shape();
    other.groupId = line.groupId;
    deck.slides[1].objects.push(other);
    expect(() => validateDeck(deck)).toThrow("multiple slides");
    delete other.groupId;
    const snapshot = validateDeck(deck);
    expect(snapshot.slides[0].objects.at(-1)?.groupId).toBeUndefined();
    expect(line.groupId).toBe("group-example");
    const duplicate = createBlankSlide();
    duplicate.objects = cloneObjectsWithGroups(deck.slides[0].objects);
    deck.slides.push(duplicate);
    expect(() => validateDeck(deck)).not.toThrow();
  });
});
