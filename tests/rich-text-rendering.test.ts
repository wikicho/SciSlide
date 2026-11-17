// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideScene } from "../src/components/SlideScene";
import { createDemoDeck, type Deck, type TextObject } from "../src/lib/model";
import { objectBounds, selectionBounds } from "../src/lib/drawing";
import { exportDeckPdf, renderSlideSvg } from "../src/lib/export";
import { exportDeckPptx } from "../src/lib/export-pptx";
import * as equations from "../src/lib/equations";

const converter = vi.hoisted(() => ({ scenes: [] as SVGSVGElement[] }));
vi.mock("svg2pdf.js", () => ({
  svg2pdf: vi.fn(async (svg: SVGSVGElement) => {
    converter.scenes.push(svg.cloneNode(true) as SVGSVGElement);
  }),
}));

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
const EMU_PER_PX = 9525;

function textObject(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: "formatted-text",
    type: "text",
    name: "Formatted text",
    text: "Red blue",
    transform: { x: 100, y: 150, width: 360, height: 180, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    fontFamily: "Inter",
    fontSize: 20,
    fontWeight: 400,
    color: "#123456",
    align: "left",
    ...overrides,
  };
}

function textDeck(object: TextObject): Deck {
  const deck = createDemoDeck();
  deck.pageNumbers = undefined;
  deck.assets = [];
  deck.slides = [{ ...deck.slides[0], objects: [object] }];
  return deck;
}

function bytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function all(root: Document | Element, namespace: string, localName: string) {
  return [...root.getElementsByTagNameNS(namespace, localName)];
}

async function powerpoint(deck: Deck) {
  const zip = await JSZip.loadAsync(await bytes(await exportDeckPptx(deck)));
  const xml = new DOMParser().parseFromString(
    await zip.file("ppt/slides/slide1.xml")!.async("string"),
    "application/xml",
  );
  return { zip, xml };
}

function geometry(shape: Element) {
  const transform = all(shape, A, "xfrm")[0];
  const off = all(transform, A, "off")[0];
  const ext = all(transform, A, "ext")[0];
  return {
    x: Number(off.getAttribute("x")) / EMU_PER_PX,
    y: Number(off.getAttribute("y")) / EMU_PER_PX,
    width: Number(ext.getAttribute("cx")) / EMU_PER_PX,
    height: Number(ext.getAttribute("cy")) / EMU_PER_PX,
    rotation: Number(transform.getAttribute("rot") ?? 0) / 60000,
  };
}

describe("formatted and content-fit text rendering", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onMetrics = vi.fn();

  beforeEach(() => {
    converter.scenes = [];
    onMetrics.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve(), load: async () => [], add() {} },
    });
    vi.stubGlobal(
      "FontFace",
      class {
        async load() {
          return this;
        }
      },
    );
    vi.stubGlobal("fetch", async (url: URL) => {
      const font = await readFile(
        new NodeURL(
          `../public/fonts/${url.pathname.split("/").pop()!}`,
          import.meta.url,
        ),
      );
      return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from(font).buffer,
      };
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      drawImage() {},
      clearRect() {},
      setTransform() {},
      scale() {},
      measureText(value: string) {
        const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 20);
        return { width: [...value].length * size * 0.5 };
      },
    } as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG);
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 100;
        naturalHeight = 30;
        width = 100;
        height = 30;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_source: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
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

  async function render(deck: Deck) {
    await act(async () =>
      root.render(
        createElement(SlideScene, {
          deck,
          slide: deck.slides[0],
          selected: [deck.slides[0].objects[0].id],
          onPointer: () => undefined,
          onMetrics,
        }),
      ),
    );
  }

  function frame() {
    const selection = host.querySelector<SVGRectElement>(".selection > rect")!;
    const hit = host.querySelector<SVGRectElement>(
      '.canvas-object > rect[fill="transparent"]',
    )!;
    return { selection, hit, group: selection.parentElement!.parentElement! };
  }

  function fakeEquations() {
    return vi
      .spyOn(equations, "renderEquation")
      .mockImplementation(async (_source, _font, _size, color) => ({
        width: 40,
        height: 30,
        baseline: 20,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><path fill="${color}" d="M0 0L10 10"/></svg>`,
      }));
  }

  it("renders plain partial colors without changing the base style or legacy frame", async () => {
    const object = textObject({
      textStyles: [{ start: 0, end: 3, color: "#ff0000" }],
    });
    const original = structuredClone(object);
    await render(textDeck(object));
    const runs = [...host.querySelectorAll("[data-inline-math] text")];
    expect(runs.map((run) => run.textContent).join("")).toBe("Red blue");
    expect(
      runs.find((run) => run.textContent === "Red")?.getAttribute("fill"),
    ).toBe("#ff0000");
    expect(
      runs.find((run) => run.textContent === "blue")?.getAttribute("fill"),
    ).toBe(object.color);
    expect(frame().selection.getAttribute("width")).toBe("360");
    expect(frame().selection.getAttribute("height")).toBe("180");
    expect(object).toEqual(original);
  });

  it("uses partial colors for both native text and inline equation paths", async () => {
    const equation = fakeEquations();
    const object = textObject({
      text: "A $x$ B",
      textStyles: [
        { start: 0, end: 1, color: "#ff0000" },
        { start: 2, end: 5, color: "#008800" },
      ],
    });
    await render(textDeck(object));
    expect(
      host
        .querySelector("[data-inline-math-fragment] path")
        ?.getAttribute("fill"),
    ).toBe("#008800");
    expect(
      [...host.querySelectorAll("[data-inline-math] text")]
        .find((run) => run.textContent === "A")
        ?.getAttribute("fill"),
    ).toBe("#ff0000");
    expect(equation).toHaveBeenCalledWith(
      "x",
      expect.any(String),
      20,
      "#008800",
      false,
    );
  });

  it("fits selection, hit area, metrics and rotation to natural content while preserving font size and hard newlines", async () => {
    const object = textObject({
      text: "Longer line\nTiny",
      autoFit: "content",
      align: "center",
      transform: { x: 100, y: 150, width: 360, height: 180, rotation: 18 },
    });
    await render(textDeck(object));
    const { selection, hit, group } = frame();
    for (const rectangle of [selection, hit]) {
      expect(rectangle.getAttribute("width")).toBe("110");
      expect(rectangle.getAttribute("height")).toBe("52");
    }
    expect(group.getAttribute("transform")).toBe(
      "translate(100 150) rotate(18 55 26)",
    );
    expect(onMetrics).toHaveBeenLastCalledWith(object.id, 110, 52);
    expect(host.querySelectorAll("[data-inline-math-line]")).toHaveLength(2);
    expect(
      [...host.querySelectorAll("[data-inline-math] text")].every(
        (run) => run.getAttribute("font-size") === "20",
      ),
    ).toBe(true);
    expect(object.fontSize).toBe(20);
    expect(object.transform).toEqual({
      x: 100,
      y: 150,
      width: 360,
      height: 180,
      rotation: 18,
    });
  });

  it("updates fitted width and height when content grows and the document becomes narrower", async () => {
    const object = textObject({ text: "Short", autoFit: "content" });
    await render(textDeck(object));
    expect(onMetrics).toHaveBeenLastCalledWith(object.id, 50, 26);
    const updated = { ...object, text: "abcdefghijklmnopqrstuvwxy" };
    const deck = textDeck(updated);
    deck.slideSize.width = 100;
    await render(deck);
    expect(onMetrics).toHaveBeenLastCalledWith(object.id, 100, 78);
    expect(host.querySelectorAll("[data-inline-math-line]")).toHaveLength(3);
    deck.slideSize.width = 300;
    await render({ ...deck });
    expect(onMetrics).toHaveBeenLastCalledWith(object.id, 250, 26);
  });

  it("keeps the fitted live editor, rotation, source panel and selection synchronized across equal-height edits and cancellation", async () => {
    const object = textObject({
      text: "Short",
      autoFit: "content",
      transform: { x: 100, y: 150, width: 360, height: 180, rotation: 90 },
    });
    const deck = textDeck(object);
    const finished = vi.fn();
    function EditingScene() {
      const [value, setValue] = useState("Longer line");
      const [editing, setEditing] = useState(true);
      return createElement(SlideScene, {
        deck,
        slide: deck.slides[0],
        selected: [object.id],
        onPointer: () => undefined,
        onMetrics,
        textEditing: editing
          ? {
              objectId: object.id,
              value,
              onChange: setValue,
              onFinish: (apply) => {
                finished(apply);
                setEditing(false);
              },
            }
          : undefined,
      });
    }
    await act(async () => root.render(createElement(EditingScene)));
    const expectEditor = (width: number, sourceY: number) => {
      const { selection, group } = frame();
      expect(Number(selection.getAttribute("width"))).toBe(width);
      expect(Number(selection.getAttribute("height"))).toBe(26);
      const transform = `translate(100 150) rotate(90 ${width / 2} 13)`;
      expect(group.getAttribute("transform")).toBe(transform);
      expect(
        host
          .querySelector("[data-inline-text-preview]")
          ?.getAttribute("transform"),
      ).toBe(transform);
      expect(
        Number(host.querySelector("foreignObject")?.getAttribute("y")),
      ).toBeCloseTo(sourceY);
      expect(onMetrics).toHaveBeenLastCalledWith(object.id, width, 26);
    };
    expectEditor(110, 246);
    const editor = host.querySelector<HTMLTextAreaElement>(
      ".inline-text-editor",
    )!;
    const input = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(editor, value);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await input("Short");
    expectEditor(50, 216);
    await input("Different");
    expectEditor(90, 236);
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(finished).toHaveBeenCalledExactlyOnceWith(false);
    expect(host.querySelector(".inline-text-editor")).toBeNull();
    expect(Number(frame().selection.getAttribute("width"))).toBe(50);
    expect(onMetrics).toHaveBeenLastCalledWith(object.id, 50, 26);
    expect(object.text).toBe("Short");
    expect(object.fontSize).toBe(20);
  });

  it("uses fitted text dimensions for shared rotation bounds and keeps legacy overflow centered as before", () => {
    const object = textObject({
      autoFit: "content",
      transform: { x: 100, y: 150, width: 160, height: 26, rotation: 90 },
    });
    const fitted = objectBounds(object, { width: 60, height: 52 });
    expect(fitted.x).toBeCloseTo(104);
    expect(fitted.y).toBeCloseTo(146);
    expect(fitted.width).toBeCloseTo(52);
    expect(fitted.height).toBeCloseTo(60);
    expect(
      selectionBounds([object], [object.id], {
        [object.id]: { width: 60, height: 52 },
      }),
    ).toEqual(fitted);
    const legacy = objectBounds(
      { ...object, autoFit: undefined },
      { width: 60, height: 52 },
    );
    expect(legacy.x).toBeCloseTo(141);
    expect(legacy.y).toBeCloseTo(83);
    expect(legacy.width).toBeCloseTo(52);
    expect(legacy.height).toBeCloseTo(160);
  });

  it("hands SVG and PDF the same colored runs and fitted rotation geometry", async () => {
    const object = textObject({
      autoFit: "content",
      textStyles: [{ start: 0, end: 3, color: "#ff0000" }],
      transform: { x: 100, y: 150, width: 360, height: 180, rotation: 18 },
    });
    const deck = textDeck(object);
    const svg = await renderSlideSvg(deck, deck.slides[0], 0);
    await exportDeckPdf(deck);
    const pdfScene = converter.scenes[0];
    const runs = (scene: SVGSVGElement) =>
      [...scene.querySelectorAll("g > text")].map((run) => [
        run.textContent,
        run.getAttribute("fill"),
        run.getAttribute("font-size"),
      ]);
    expect(runs(pdfScene)).toEqual(runs(svg));
    expect(runs(svg)).toContainEqual(["Red", "#ff0000", "20"]);
    expect(runs(svg)).toContainEqual(["blue", "#123456", "20"]);
    expect(svg.querySelector("g")?.getAttribute("transform")).toBe(
      "translate(100 150) rotate(18 40 13)",
    );
    expect(pdfScene.querySelector("g")?.getAttribute("transform")).toBe(
      svg.querySelector("g")?.getAttribute("transform"),
    );
  });

  it("preserves colored content-fit paragraphs as one native PowerPoint shape with measured blank lines", async () => {
    const object = textObject({
      text: "Red blue\n\nEnd",
      autoFit: "content",
      opacity: 0.5,
      textStyles: [{ start: 0, end: 3, color: "#ff0000" }],
    });
    const { xml } = await powerpoint(textDeck(object));
    const shapes = all(xml, P, "sp");
    expect(shapes).toHaveLength(1);
    expect(all(xml, P, "pic")).toHaveLength(0);
    expect(geometry(shapes[0])).toMatchObject({
      width: 80,
      height: 78,
      rotation: 0,
    });
    expect(all(shapes[0], A, "p")).toHaveLength(3);
    const red = all(shapes[0], A, "r").find(
      (run) => all(run, A, "t")[0]?.textContent === "Red",
    )!;
    expect(all(red, A, "srgbClr")[0].getAttribute("val")).toBe("FF0000");
    expect(all(red, A, "alpha")[0].getAttribute("val")).toBe("50000");
    const blue = all(shapes[0], A, "r").find(
      (run) => all(run, A, "t")[0]?.textContent === "blue",
    )!;
    expect(all(blue, A, "srgbClr")[0].getAttribute("val")).toBe("123456");
    expect(
      all(shapes[0], A, "rPr").every(
        (run) => run.getAttribute("sz") === "1500",
      ),
    ).toBe(true);
  });

  it("rotates native colored text and equation graphics around the same fitted parent in PowerPoint", async () => {
    fakeEquations();
    const object = textObject({
      text: "A $x$ B",
      autoFit: "content",
      textStyles: [
        { start: 0, end: 1, color: "#ff0000" },
        { start: 2, end: 5, color: "#008800" },
      ],
      transform: { x: 100, y: 150, width: 360, height: 180, rotation: 90 },
    });
    const { xml, zip } = await powerpoint(textDeck(object));
    const native = all(xml, P, "sp");
    const a = native.find((shape) =>
      all(shape, A, "t").some((run) => run.textContent === "A"),
    )!;
    expect(geometry(a)).toEqual({
      x: 137,
      y: 117,
      width: 10,
      height: 26,
      rotation: 90,
    });
    expect(all(a, A, "srgbClr")[0].getAttribute("val")).toBe("FF0000");
    const picture = all(xml, P, "pic")[0];
    expect(geometry(picture)).toEqual({
      x: 120,
      y: 150,
      width: 40,
      height: 30,
      rotation: 90,
    });
    const images = await Promise.all(
      Object.values(zip.files)
        .filter((entry) => entry.name.endsWith(".svg"))
        .map((entry) => entry.async("string")),
    );
    expect(images.some((source) => source.includes('fill="#008800"'))).toBe(
      true,
    );
  });
});
