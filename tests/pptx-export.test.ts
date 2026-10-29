// @vitest-environment jsdom
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportDeckPptx } from "../src/lib/export-pptx";
import {
  DEFAULT_PAGE_NUMBERS,
  type AnySlideObject,
  type Asset,
  type Deck,
  type EquationObject,
  type FigureObject,
  type ShapeObject,
  type TextObject,
} from "../src/lib/model";

// Use the real converter's ESM entry; its UMD entry expects a browser-global
// jsPDF when shared export scene helpers are imported under jsdom.
vi.mock("svg2pdf.js", () => import("svg2pdf.js/dist/svg2pdf.es.js"));

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/package/2006/relationships";
const EMU_PER_PX = 9525;
// A real, self-contained PNG lets PptxGenJS create its ordinary image package.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";

function text(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: "text-1",
    type: "text",
    name: "Editable paragraph",
    text: "Scientific result & <measurement>",
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: 700,
    color: "#123456",
    align: "left",
    transform: { x: 96, y: 48, width: 600, height: 120, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    ...overrides,
  };
}

function shape(overrides: Partial<ShapeObject> = {}): ShapeObject {
  return {
    id: "shape-1",
    type: "shape",
    name: "Editable callout",
    shape: "rect",
    transform: { x: 200, y: 240, width: 300, height: 150, rotation: 30 },
    opacity: 0.5,
    visible: true,
    locked: false,
    metadata: {},
    fill: "#fedcba",
    stroke: "#654321",
    strokeWidth: 4,
    strokeStyle: "dashed",
    ...overrides,
  };
}

function equation(overrides: Partial<EquationObject> = {}): EquationObject {
  return {
    id: "equation-1",
    type: "equation",
    name: "Mass equation",
    latex: "E=mc^2",
    style: { fontSize: 40, color: "#123456" },
    displayMode: true,
    description: "Energy and mass",
    transform: { x: 100, y: 180, width: 450, height: 80, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    ...overrides,
  };
}

function figure(overrides: Partial<FigureObject> = {}): FigureObject {
  return {
    id: "figure-1",
    type: "figure",
    name: "Cropped observation",
    assetId: "asset-1",
    alt: "Observation plot",
    transform: { x: 300, y: 200, width: 240, height: 120, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    ...overrides,
  };
}

function deck(objects: AnySlideObject[] = [text(), shape()]): Deck {
  return {
    formatVersion: "0.5.0",
    id: "pptx-test-deck",
    title: "Scientific results & observations",
    slideSize: { width: 1280, height: 720, unit: "px96" },
    theme: {
      equation: { fontSetId: "mathjax-stix2", fontSize: 40, color: "#123456" },
      fontFamily: "Inter",
    },
    assets: [],
    slides: [
      {
        id: "slide-1",
        title: "First result",
        background: "#fafbfc",
        notes: "Explain the uncertainty & <limits>.\nThen compare the samples.",
        objects,
      },
    ],
  };
}

async function bytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function exported(source: Deck): Promise<JSZip> {
  const blob = await exportDeckPptx(source);
  expect(blob.type).toBe(
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  return JSZip.loadAsync(await bytes(blob));
}

async function xml(zip: JSZip, path: string): Promise<Document> {
  const entry = zip.file(path);
  expect(entry, `Missing package part: ${path}`).not.toBeNull();
  const document = new DOMParser().parseFromString(
    await entry!.async("string"),
    "application/xml",
  );
  expect(document.querySelector("parsererror"), path).toBeNull();
  return document;
}

function all(root: Document | Element, namespace: string, localName: string) {
  return [...root.getElementsByTagNameNS(namespace, localName)];
}

function nativeTexts(root: Document | Element): string[] {
  return all(root, P, "sp")
    .filter((element) => all(element, P, "txBody").length > 0)
    .map((element) =>
      all(element, A, "t")
        .map((run) => run.textContent)
        .join(""),
    );
}

describe("PowerPoint export packages", () => {
  beforeEach(() => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve(),
        load: vi.fn(async () => []),
        add: vi.fn(),
      },
    });
    const context = {
      font: "",
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      scale: vi.fn(),
      measureText(value: string) {
        const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 16);
        return {
          width: [...value].length * size * 0.5,
          actualBoundingBoxAscent: size * (value === "x" ? 0.5 : 0.8),
          actualBoundingBoxDescent: value === "x" ? 0 : size * 0.2,
        };
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG);
    // jsdom cannot decode images. Preserve real equation/SVG generation and
    // package writing; replace only the browser rasterization prerequisite.
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 200;
        naturalHeight = 100;
        width = 200;
        height = 100;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_source: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a valid ordered presentation with custom dimensions, notes and background", async () => {
    const source = deck([text({ text: "First page" })]);
    source.slideSize = { width: 960, height: 720, unit: "px96" };
    source.slides.push({
      id: "slide-2",
      title: "Second result",
      background: "#112233",
      notes: "Second slide speaker note",
      objects: [text({ id: "text-2", text: "Second page" })],
    });
    const zip = await exported(source);
    const presentation = await xml(zip, "ppt/presentation.xml");
    const size = all(presentation, P, "sldSz")[0];
    expect(Number(size.getAttribute("cx"))).toBe(960 * EMU_PER_PX);
    expect(Number(size.getAttribute("cy"))).toBe(720 * EMU_PER_PX);
    expect(all(presentation, P, "sldId")).toHaveLength(2);
    expect(
      Object.keys(zip.files).filter((path) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(path),
      ),
    ).toHaveLength(2);
    const first = await xml(zip, "ppt/slides/slide1.xml");
    const second = await xml(zip, "ppt/slides/slide2.xml");
    expect(nativeTexts(first)).toContain("First page");
    expect(nativeTexts(second)).toContain("Second page");
    expect(all(first, P, "bg")[0].textContent).toBe("");
    expect(
      all(all(first, P, "bg")[0], A, "srgbClr")[0].getAttribute("val"),
    ).toBe("FAFBFC");
    expect(
      all(all(second, P, "bg")[0], A, "srgbClr")[0].getAttribute("val"),
    ).toBe("112233");
    const notes = await xml(zip, "ppt/notesSlides/notesSlide1.xml");
    const noteText = all(notes, A, "t")
      .map((run) => run.textContent)
      .join("\n");
    expect(noteText).toContain("Explain the uncertainty & <limits>.");
    expect(noteText).toContain("Then compare the samples.");
    expect(
      all(await xml(zip, "ppt/notesSlides/notesSlide2.xml"), A, "t")
        .map((run) => run.textContent)
        .join(" "),
    ).toContain("Second slide speaker note");
  });

  it("keeps ordinary text and drawings editable with object order, transforms and transparency", async () => {
    const source = deck([
      text(),
      shape({ build: { step: 8, effect: "appear", durationMs: 300 } }),
      text({
        id: "hidden",
        name: "Hidden text",
        text: "MUST STAY HIDDEN",
        visible: false,
      }),
      figure({ id: "transparent", opacity: 0, assetId: "missing-asset" }),
    ]);
    const before = structuredClone(source);
    const zip = await exported(source);
    const slide = await xml(zip, "ppt/slides/slide1.xml");
    expect(nativeTexts(slide)).toEqual(["Scientific result & <measurement>"]);
    expect(all(slide, P, "pic")).toHaveLength(0);
    const objects = all(slide, P, "sp");
    expect(objects).toHaveLength(2);
    const textTransform = all(objects[0], A, "xfrm")[0];
    expect(Number(all(textTransform, A, "off")[0].getAttribute("x"))).toBe(
      96 * EMU_PER_PX,
    );
    expect(
      Number(all(textTransform, A, "off")[0].getAttribute("y")),
    ).toBeCloseTo((48 - 32 * 0.1) * EMU_PER_PX, 0);
    expect(Number(all(textTransform, A, "ext")[0].getAttribute("cx"))).toBe(
      600 * EMU_PER_PX,
    );
    expect(all(objects[0], A, "rPr")[0].getAttribute("sz")).toBe("2400");
    expect(
      all(all(objects[0], A, "lnSpc")[0], A, "spcPts")[0].getAttribute("val"),
    ).toBe("3120");
    expect(all(objects[0], A, "latin")[0].getAttribute("typeface")).toBe(
      "Inter",
    );
    expect(all(objects[1], A, "prstGeom")[0].getAttribute("prst")).toBe(
      "roundRect",
    );
    expect(all(objects[1], A, "xfrm")[0].getAttribute("rot")).toBe(
      String(30 * 60000),
    );
    expect(
      all(objects[1], A, "alpha").map((entry) => entry.getAttribute("val")),
    ).toContain("50000");
    expect(all(objects[1], A, "prstDash")[0].getAttribute("val")).toMatch(
      /dash/i,
    );
    expect(source).toEqual(before);
  });

  it("derives visible page numbers from the current order and honors hideFirst", async () => {
    const source = deck([]);
    source.pageNumbers = {
      ...DEFAULT_PAGE_NUMBERS,
      startAt: 7,
      hideFirst: true,
      format: "number-total",
      position: "bottom-center",
    };
    source.slides.push({
      ...source.slides[0],
      id: "slide-2",
      title: "Second",
      notes: "",
    });
    const zip = await exported(source);
    expect(nativeTexts(await xml(zip, "ppt/slides/slide1.xml"))).toEqual([]);
    expect(nativeTexts(await xml(zip, "ppt/slides/slide2.xml"))).toContain(
      "8 / 8",
    );
  });

  it("converts CSS paints to native RGB and combines paint alpha with object opacity", async () => {
    const source = deck([
      text({ color: "#f00" }),
      shape({
        fill: "rgba(0, 128, 255, 0.25)",
        stroke: "transparent",
        opacity: 0.5,
      }),
    ]);
    source.slides[0].background = "white";
    source.pageNumbers = { ...DEFAULT_PAGE_NUMBERS, color: "navy" };
    const slide = await xml(await exported(source), "ppt/slides/slide1.xml");
    expect(
      all(all(slide, P, "bg")[0], A, "srgbClr")[0].getAttribute("val"),
    ).toBe("FFFFFF");
    const objects = all(slide, P, "sp");
    const textProperties = all(objects[0], A, "rPr")[0];
    expect(all(textProperties, A, "srgbClr")[0].getAttribute("val")).toBe(
      "FF0000",
    );
    const shapeProperties = all(objects[1], P, "spPr")[0];
    const fill = [...shapeProperties.children].find(
      (element) => element.localName === "solidFill",
    )!;
    expect(all(fill, A, "srgbClr")[0].getAttribute("val")).toBe("0080FF");
    expect(all(fill, A, "alpha")[0].getAttribute("val")).toBe("12500");
    expect(
      all(all(shapeProperties, A, "ln")[0], A, "alpha")[0].getAttribute("val"),
    ).toBe("0");
    const pageNumber = objects.find(
      (object) =>
        all(object, A, "t")
          .map((run) => run.textContent)
          .join("") === "1",
    )!;
    expect(pageNumber).toBeDefined();
    expect(
      all(all(pageNumber, A, "rPr")[0], A, "srgbClr")[0].getAttribute("val"),
    ).toBe("000080");
    for (const paint of all(slide, A, "srgbClr")) {
      expect(paint.getAttribute("val")).toMatch(/^[0-9A-F]{6}$/);
    }
  });

  it("keeps reversed two-headed lines as finite editable paths with solid arrow tips", async () => {
    const source = deck([
      shape({
        shape: "line",
        fill: "none",
        startArrow: true,
        endArrow: true,
        line: { start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
        transform: { x: 100, y: 100, width: 300, height: 120, rotation: 15 },
      }),
    ]);
    const zip = await exported(source);
    const slide = await xml(zip, "ppt/slides/slide1.xml");
    expect(all(slide, P, "pic")).toHaveLength(0);
    const drawings = all(slide, P, "sp");
    expect(drawings).toHaveLength(3);
    expect(all(slide, A, "custGeom")).toHaveLength(3);
    expect(all(slide, A, "close")).toHaveLength(2);
    const shaftPoints = all(drawings[0], A, "pt");
    expect(shaftPoints.map((point) => Number(point.getAttribute("x")))).toEqual(
      [284 * EMU_PER_PX, 16 * EMU_PER_PX],
    );
    for (const drawing of drawings) {
      expect(all(drawing, A, "xfrm")[0].getAttribute("rot")).toBe(
        String(15 * 60000),
      );
    }
    for (const tip of drawings.slice(1)) {
      const fill = [...tip.children].find(
        (element) => element.localName === "spPr",
      )!;
      const solidFill = [...fill.children].find(
        (element) => element.localName === "solidFill",
      )!;
      expect(all(solidFill, A, "srgbClr")[0].getAttribute("val")).toBe(
        "654321",
      );
      expect(all(solidFill, A, "alpha")[0].getAttribute("val")).toBe("50000");
      expect(all(all(tip, A, "ln")[0], A, "alpha")[0].getAttribute("val")).toBe(
        "0",
      );
    }
    expect(new XMLSerializer().serializeToString(slide)).not.toMatch(
      /NaN|Infinity/,
    );
  });

  it("embeds rendered equation vectors with a fallback image instead of raw TeX", async () => {
    const source = deck([
      equation(),
      text({
        id: "inline-text",
        text: "Before $\\chi$ after",
        transform: { x: 80, y: 360, width: 900, height: 100, rotation: 0 },
      }),
    ]);
    const zip = await exported(source);
    const slide = await xml(zip, "ppt/slides/slide1.xml");
    const images = all(slide, P, "pic");
    expect(images.length).toBeGreaterThanOrEqual(2);
    const svgPaths = Object.keys(zip.files).filter((path) =>
      /^ppt\/media\/.*\.svg$/i.test(path),
    );
    const pngPaths = Object.keys(zip.files).filter((path) =>
      /^ppt\/media\/.*\.png$/i.test(path),
    );
    expect(svgPaths.length).toBeGreaterThanOrEqual(2);
    expect(pngPaths.length).toBeGreaterThanOrEqual(2);
    const vectors = await Promise.all(svgPaths.map((path) => xml(zip, path)));
    expect(
      vectors.every((vector) => vector.getElementsByTagName("path").length > 0),
    ).toBe(true);
    const prose = nativeTexts(slide).join(" ");
    expect(prose).toContain("Before");
    expect(prose).toContain("after");
    expect(prose).not.toMatch(/\\chi|\$|E=mc\^2/);
    const embeddedText = vectors
      .flatMap((vector) =>
        [...vector.getElementsByTagName("text")].map(
          (element) => element.textContent,
        ),
      )
      .join(" ");
    expect(embeddedText).not.toMatch(/\\chi|\$|E=mc\^2/);
    const rels = await xml(zip, "ppt/slides/_rels/slide1.xml.rels");
    const imageTargets = all(rels, R, "Relationship")
      .filter((rel) => rel.getAttribute("Type")?.endsWith("/image"))
      .map((rel) => rel.getAttribute("Target"));
    for (const target of imageTargets) {
      expect(zip.file(`ppt/${target!.replace(/^\.\.\//, "")}`)).not.toBeNull();
    }
    expect(source.slides[0].objects[1]).toMatchObject({
      text: "Before $\\chi$ after",
    });
  });

  it("rotates all inline fragments about their shared text frame and preserves opacity", async () => {
    const paragraph = text({
      text: "Before $\\chi$ after",
      opacity: 0.4,
      transform: { x: 80, y: 360, width: 900, height: 100, rotation: 0 },
    });
    const source = deck([paragraph]);
    const original = await xml(await exported(source), "ppt/slides/slide1.xml");
    paragraph.transform.rotation = 90;
    const rotated = await xml(await exported(source), "ppt/slides/slide1.xml");
    const fragments = (slide: Document) =>
      [...all(slide, P, "spTree")[0].children].filter((element) =>
        ["sp", "pic"].includes(element.localName),
      );
    const before = fragments(original);
    const after = fragments(rotated);
    expect(before.length).toBeGreaterThanOrEqual(3);
    expect(all(original, P, "pic")).toHaveLength(1);
    expect(after).toHaveLength(before.length);
    const center = (element: Element) => {
      const transform = all(element, A, "xfrm")[0];
      const offset = all(transform, A, "off")[0];
      const extent = all(transform, A, "ext")[0];
      return {
        x:
          (Number(offset.getAttribute("x")) +
            Number(extent.getAttribute("cx")) / 2) /
          EMU_PER_PX,
        y:
          (Number(offset.getAttribute("y")) +
            Number(extent.getAttribute("cy")) / 2) /
          EMU_PER_PX,
      };
    };
    for (const [index, fragment] of after.entries()) {
      const previousCenter = center(before[index]);
      const actualCenter = center(fragment);
      // A clockwise quarter-turn about the parent's center (530px, 410px).
      expect(actualCenter.x).toBeCloseTo(530 - (previousCenter.y - 410), 3);
      expect(actualCenter.y).toBeCloseTo(410 + (previousCenter.x - 530), 3);
      expect(all(fragment, A, "xfrm")[0].getAttribute("rot")).toBe(
        String(90 * 60000),
      );
    }
    expect(all(rotated, A, "alphaModFix")[0].getAttribute("amt")).toBe("40000");
    expect(all(after[0], A, "alpha")[0].getAttribute("val")).toBe("40000");
  });

  it("preserves the requested source crop inside the embedded figure SVG", async () => {
    const source = deck([
      figure({
        crop: { x: 0.25, y: 0.125, width: 0.5, height: 0.375 },
        opacity: 0.4,
        transform: { x: 300, y: 200, width: 240, height: 120, rotation: -20 },
      }),
    ]);
    const asset: Asset = {
      id: "asset-1",
      name: "observation.png",
      mime: "image/png",
      dataUrl: PNG,
      width: 800,
      height: 400,
    };
    source.assets = [asset];
    const before = structuredClone(source);
    const zip = await exported(source);
    const slide = await xml(zip, "ppt/slides/slide1.xml");
    expect(all(slide, P, "pic")).toHaveLength(1);
    const picture = all(slide, P, "pic")[0];
    const transform = all(picture, A, "xfrm")[0];
    const rotation = Number(transform.getAttribute("rot")) / 60000;
    expect((rotation + 360) % 360).toBe(340);
    expect(Number(all(transform, A, "ext")[0].getAttribute("cx"))).toBe(
      240 * EMU_PER_PX,
    );
    expect(Number(all(transform, A, "ext")[0].getAttribute("cy"))).toBe(
      120 * EMU_PER_PX,
    );
    const svgPaths = Object.keys(zip.files).filter((path) =>
      /^ppt\/media\/.*\.svg$/i.test(path),
    );
    expect(svgPaths).toHaveLength(1);
    const svg = await xml(zip, svgPaths[0]);
    const viewport = svg.querySelector('[data-figure-viewport="true"]');
    expect(viewport?.getAttribute("viewBox")).toBe("200 50 400 150");
    expect(viewport?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(viewport?.getAttribute("overflow")).toBe("hidden");
    expect(svg.querySelector('g[opacity="0.4"]')).not.toBeNull();
    expect(
      svg.getElementsByTagName("image")[0].getAttribute("href") ??
        svg
          .getElementsByTagName("image")[0]
          .getAttributeNS("http://www.w3.org/1999/xlink", "href"),
    ).toBe(PNG);
    expect(source).toEqual(before);
  });

  it("bounds graphic raster dimensions while preserving extreme logical sizes", async () => {
    const source = deck([
      figure({
        transform: { x: 0, y: 0, width: 100000, height: 0.01, rotation: 0 },
      }),
    ]);
    const assetSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#123456"/></svg>';
    source.assets = [
      {
        id: "asset-1",
        name: "logical-size.svg",
        mime: "image/svg+xml",
        dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(assetSvg)}`,
        width: 100,
        height: 100,
      },
    ];
    const zip = await exported(source);
    const slide = await xml(zip, "ppt/slides/slide1.xml");
    const picture = all(slide, P, "pic")[0];
    const extent = all(all(picture, A, "xfrm")[0], A, "ext")[0];
    expect(Number(extent.getAttribute("cx"))).toBe(100000 * EMU_PER_PX);
    expect(Number(extent.getAttribute("cy"))).toBe(
      Math.round(0.01 * EMU_PER_PX),
    );
    const svgPaths = Object.keys(zip.files).filter((path) =>
      /^ppt\/media\/.*\.svg$/i.test(path),
    );
    expect(svgPaths).toHaveLength(1);
    const svg = (await xml(zip, svgPaths[0])).documentElement;
    for (const dimension of ["width", "height"]) {
      const intrinsicSize = Number(svg.getAttribute(dimension));
      expect(intrinsicSize).toBeGreaterThanOrEqual(1);
      expect(intrinsicSize).toBeLessThanOrEqual(4096);
    }
    expect(svg.getAttribute("viewBox")?.split(/\s+/).map(Number)).toEqual([
      0, 0, 100000, 0.01,
    ]);
    expect(
      Object.keys(zip.files).some((path) =>
        /^ppt\/media\/.*\.png$/i.test(path),
      ),
    ).toBe(true);
  });

  it("exports video objects as passive presentation frames", async () => {
    const source = deck([
      {
        id: "video-1",
        type: "video",
        name: "Sample evolution",
        assetId: "video-asset",
        alt: "Simulation movie",
        transform: { x: 100, y: 100, width: 640, height: 360, rotation: 0 },
        opacity: 1,
        visible: true,
        locked: false,
        metadata: {},
        autoplay: true,
        loop: true,
        muted: true,
        controls: true,
      },
    ]);
    source.assets = [
      {
        id: "video-asset",
        name: "evolution.mp4",
        mime: "video/mp4",
        dataUrl: "data:video/mp4;base64,AAAA",
        width: 640,
        height: 360,
      },
    ];
    const zip = await exported(source);
    const slide = await xml(zip, "ppt/slides/slide1.xml");
    expect(all(slide, P, "pic")).toHaveLength(1);
    expect(
      Object.keys(zip.files).some((path) => /\.(mp4|webm)$/i.test(path)),
    ).toBe(false);
    const rels = await xml(zip, "ppt/slides/_rels/slide1.xml.rels");
    expect(
      all(rels, R, "Relationship").some((rel) =>
        /\/(video|media)$/.test(rel.getAttribute("Type") ?? ""),
      ),
    ).toBe(false);
    const svgPath = Object.keys(zip.files).find((path) =>
      /^ppt\/media\/.*\.svg$/i.test(path),
    );
    expect(svgPath).toBeDefined();
    expect((await xml(zip, svgPath!)).documentElement.textContent).toContain(
      "Video (presentation only)",
    );
  });

  it("fails with useful object context for missing figure assets and uncompiled equations", async () => {
    const empty = deck();
    empty.slides = [];
    await expect(exportDeckPptx(empty)).rejects.toThrow(/slide/i);
    await expect(
      exportDeckPptx(deck([figure({ name: "Missing plot" })])),
    ).rejects.toThrow(/First result.*Missing plot/);
    await expect(
      exportDeckPptx(
        deck([
          equation({ name: "Uncompiled formula", renderer: "local-latex" }),
        ]),
      ),
    ).rejects.toThrow(/Uncompiled formula/);
  });
});
