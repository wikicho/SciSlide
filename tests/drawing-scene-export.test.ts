// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideScene } from "../src/components/SlideScene";
import { exportDeckPdf, renderSlideSvg } from "../src/lib/export";
import { createDemoDeck, type Deck, type ShapeObject } from "../src/lib/model";
import { lineEndpoints, shapeGeometry } from "../src/lib/shape-geometry";

// Use the library's real ESM implementation rather than its Node-resolved UMD
// entry, which expects a browser-global jsPDF in the jsdom environment.
vi.mock("svg2pdf.js", () => import("svg2pdf.js/dist/svg2pdf.es.js"));

function shape(overrides: Partial<ShapeObject> = {}): ShapeObject {
  return {
    id: "test-arrow",
    type: "shape",
    name: "Scientific callout",
    shape: "arrow",
    transform: { x: 110, y: 90, width: 300, height: 120, rotation: 15 },
    opacity: 0.5,
    visible: true,
    locked: false,
    metadata: {},
    fill: "none",
    stroke: "#123456",
    strokeWidth: 3,
    strokeStyle: "dashed",
    line: { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
    ...overrides,
  };
}

function drawingDeck(objects: ShapeObject[] = [shape()]): Deck {
  const deck = createDemoDeck();
  deck.slides = [{ ...deck.slides[0], title: "Vector drawing", objects }];
  deck.pageNumbers = undefined;
  deck.assets = [];
  return deck;
}

function blobBytes(blob: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("vector drawing scenes and export", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve(), add: vi.fn() },
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "FontFace",
      class {
        async load() {
          return this;
        }
      },
    );
    vi.stubGlobal("fetch", async (url: URL) => {
      const bytes = await readFile(
        resolve("public/fonts", url.pathname.split("/").pop()!),
      );
      return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from(bytes).buffer,
      };
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses explicit vector arrowheads and the same dashed transparent geometry in the scene and SVG", async () => {
    const deck = drawingDeck();
    const arrow = deck.slides[0].objects[0] as ShapeObject;
    await act(async () =>
      root.render(createElement(SlideScene, { deck, slide: deck.slides[0] })),
    );
    const exported = await renderSlideSvg(deck, deck.slides[0], 0);
    const editorPath = host.querySelector("g > path")!;
    const exportPath = exported.querySelector("g > path")!;
    expect(exportPath.getAttribute("d")).toBe(editorPath.getAttribute("d"));
    expect(exportPath.getAttribute("stroke-dasharray")).toBe("12 6");
    expect(exportPath.getAttribute("fill")).toBe("none");
    const head = exported.querySelector("polygon")!;
    expect(head.getAttribute("points")?.startsWith("300,0 ")).toBe(true);
    expect(head.getAttribute("points")).toBe(
      host.querySelector("polygon")!.getAttribute("points"),
    );
    expect(head.getAttribute("fill")).toBe(arrow.stroke);
    expect(exported.querySelector("g")?.getAttribute("opacity")).toBe("0.5");
    expect(exported.querySelector("g")?.getAttribute("transform")).toBe(
      "translate(110 90) rotate(15 150 60)",
    );
    expect(exported.querySelector("marker,image,foreignObject")).toBeNull();
  });

  it("handles reversed and two-headed lines without nonfinite geometry or oversized heads", () => {
    const object = shape({
      shape: "line",
      strokeStyle: "dotted",
      startArrow: true,
      endArrow: true,
      transform: { x: 0, y: 0, width: 9, height: 20, rotation: 0 },
      line: { start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
    });
    const primitives = shapeGeometry(object);
    expect(primitives).toHaveLength(3);
    expect(primitives[0].attributes.d).toBe("M 6 0 L 3 0");
    expect(primitives[0].attributes["stroke-dasharray"]).toBe("0 6");
    const headPoints = String(primitives[1].attributes.points)
      .split(" ")
      .map((point) => point.split(",").map(Number));
    expect(headPoints.map((point) => point[0])).toEqual([9, 6, 6]);
    expect(headPoints[1][1]).toBeCloseTo(-1.65);
    expect(headPoints[2][1]).toBeCloseTo(1.65);
    expect(JSON.stringify(primitives)).not.toMatch(/NaN|Infinity/);
    expect(lineEndpoints(object)).toEqual({
      start: { x: 9, y: 0 },
      end: { x: 0, y: 0 },
    });
    object.line!.end = { ...object.line!.start };
    expect(shapeGeometry(object)).toHaveLength(1);
    expect(shapeGeometry(object)[0].attributes.d).toBe("M 9 0 L 9 0");
    expect(shapeGeometry(shape({ endArrow: false }))).toHaveLength(1);
  });

  it("selects lines by a widened stroke and edits only their endpoints", async () => {
    const deck = drawingDeck();
    const onPointer = vi.fn();
    const onResize = vi.fn();
    const onEndpoint = vi.fn();
    await act(async () =>
      root.render(
        createElement(SlideScene, {
          deck,
          slide: deck.slides[0],
          selected: ["test-arrow"],
          onPointer,
          onResize,
          onEndpoint,
        }),
      ),
    );
    const hit = host.querySelector("[data-line-hit]")!;
    expect(hit.getAttribute("pointer-events")).toBe("stroke");
    expect(hit.getAttribute("stroke-width")).toBe("16");
    expect(host.querySelector("g > rect[fill=transparent]")).toBeNull();
    expect(host.querySelectorAll(".endpoint-handle")).toHaveLength(2);
    expect(host.querySelector(".resize-handle")).toBeNull();
    await act(async () =>
      host
        .querySelector(".endpoint-handle")!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    );
    expect(onEndpoint).toHaveBeenCalledOnce();
    expect(onEndpoint.mock.calls[0][2]).toBe("start");
    expect(onPointer).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("hides endpoint and corner handles for locked or grouped objects", async () => {
    for (const object of [
      shape({ locked: true }),
      shape({ groupId: "group-1" }),
      shape({ shape: "rect", locked: true }),
      shape({ shape: "ellipse", groupId: "group-1" }),
    ]) {
      const deck = drawingDeck([object]);
      await act(async () =>
        root.render(
          createElement(SlideScene, {
            deck,
            slide: deck.slides[0],
            selected: [object.id],
            onPointer: vi.fn(),
            onResize: vi.fn(),
            onEndpoint: vi.fn(),
          }),
        ),
      );
      expect(host.querySelector(".selection")).not.toBeNull();
      expect(host.querySelector(".endpoint-handle,.resize-handle")).toBeNull();
    }
  });

  it("captures drawing above existing objects and keeps previews and guides out of playback and exports", async () => {
    const deck = drawingDeck();
    let captureTarget: SVGSVGElement | null = null;
    const onDrawStart = vi.fn((event) => {
      captureTarget = event.currentTarget;
    });
    const onPointer = vi.fn();
    const onBackground = vi.fn();
    const props = {
      deck,
      slide: deck.slides[0],
      drawing: true,
      onDrawStart,
      onPointer,
      onBackground,
      draftShape: shape({ id: "draft-only" }),
      guides: [{ axis: "x" as const, position: 400 }],
    };
    await act(async () => root.render(createElement(SlideScene, props)));
    expect(host.querySelector("[data-drawing-preview]")).not.toBeNull();
    expect(
      host.querySelector("[data-alignment-guides] path")?.getAttribute("d"),
    ).toBe("M 400 0 V 900");
    await act(async () =>
      host
        .querySelector("[data-line-hit]")!
        .dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
        ),
    );
    expect(onDrawStart).toHaveBeenCalledOnce();
    expect(captureTarget).toBe(host.querySelector("svg"));
    expect(onPointer).not.toHaveBeenCalled();
    expect(onBackground).not.toHaveBeenCalled();
    await act(async () =>
      root.render(createElement(SlideScene, { ...props, playback: true })),
    );
    expect(
      host.querySelector("[data-drawing-preview],[data-alignment-guides]"),
    ).toBeNull();
    const exported = await renderSlideSvg(deck, deck.slides[0], 0);
    expect(
      exported.querySelector(
        "[data-drawing-preview],[data-alignment-guides],[data-line-hit],.selection",
      ),
    ).toBeNull();
    expect(exported.querySelectorAll("polygon")).toHaveLength(1);
  });

  it("converts dashed arrows and unfilled outlines into real PDF paths without rasterization", async () => {
    // This uses the genuine svg2pdf converter. Shape-only scenes require no
    // mocked SVG text metrics, and jsPDF embeds the real bundled Inter fonts.
    const deck = drawingDeck([
      shape(),
      shape({ id: "outline", shape: "ellipse", strokeStyle: "dotted" }),
    ]);
    const bytes = await blobBytes(await exportDeckPdf(deck));
    const source = bytes.toString("latin1");
    expect(source).toMatch(/^%PDF-/);
    expect(source).not.toContain("/Subtype /Image");
    const streams = [
      ...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g),
    ].map((match) => {
      const bytes = Buffer.from(match[1], "latin1");
      try {
        return inflateSync(bytes).toString("latin1");
      } catch {
        return bytes.toString("latin1");
      }
    });
    const drawingStream = streams.find((stream) => /\nS\n/.test(stream));
    expect(drawingStream).toBeDefined();
    expect(drawingStream).toMatch(/\[[\d. ]+\] 0\. d/);
    expect(drawingStream).toMatch(/\n[\d.\- ]+ l\n/);
    expect(drawingStream).toMatch(/\nf\n/); // Solid arrowhead polygon.
    expect(drawingStream).toContain("/GS1 gs"); // Half-opacity shape.
  });
});
