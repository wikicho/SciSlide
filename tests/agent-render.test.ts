// @vitest-environment node
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  initializeHeadlessDom,
  renderAgentPdf,
  renderAgentSvg,
} from "../src/cli/render";
import {
  createBlankSlide,
  createDemoDeck,
  DEFAULT_PAGE_NUMBERS,
} from "../src/lib/model";
import type {
  Deck,
  EquationObject,
  FigureObject,
  TextObject,
} from "../src/lib/model";
import { shapeFromDrag } from "../src/lib/drawing";
import {
  importFigure,
  buildDeckArchive,
  readDeckArchive,
} from "../src/lib/persistence";

// Use the genuine ESM converter rather than the package's browser-global UMD entry.
vi.mock("svg2pdf.js", () => import("svg2pdf.js/dist/svg2pdf.es.js"));

const options = { fontsDir: resolve("public/fonts") };

function text(source: string, overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: "headless-text",
    name: "Scientific text",
    type: "text",
    text: source,
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: 500,
    color: "#17263c",
    align: "left",
    transform: { x: 80, y: 100, width: 700, height: 200, rotation: 12 },
    opacity: 0.8,
    visible: true,
    locked: false,
    metadata: {},
    ...overrides,
  };
}

function deckWith(source: string): Deck {
  const deck = createDemoDeck();
  deck.title = "Headless scientific export";
  deck.assets = [];
  deck.pageNumbers = undefined;
  deck.slides = [
    {
      ...createBlankSlide(),
      title: "Scientific slide",
      objects: [text(source)],
    },
  ];
  return deck;
}

function svg(source: string) {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  expect(document.querySelector("parsererror")).toBeNull();
  return document.documentElement;
}

function pdfStreams(bytes: Uint8Array) {
  const source = Buffer.from(bytes).toString("latin1");
  return [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(
    (match) => {
      const raw = Buffer.from(match[1], "latin1");
      try {
        return inflateSync(raw).toString("latin1");
      } catch {
        return raw.toString("latin1");
      }
    },
  );
}

describe("genuine Node-only scientific exports", () => {
  beforeAll(async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    await initializeHeadlessDom(options);
  });

  it("exports shared MathJax inline paths, styled text, rotation, and embedded bundled fonts", async () => {
    const deck = deckWith(String.raw`A $\frac{1}{2}$ transition\n`);
    deck.slides[0].objects[0] = text(
      "A $\\frac{1}{2}$ transition\nSecond line",
    );
    const original = structuredClone(deck);
    const rendered = svg(await renderAgentSvg(deck, 0, options));
    expect(rendered.getAttribute("viewBox")).toBe("0 0 1600 900");
    expect(rendered.querySelector("svg[data-inline-math] path")).not.toBeNull();
    expect(
      rendered.querySelector("g > text")?.getAttribute("font-family"),
    ).toBe("Inter");
    expect(
      rendered.querySelector("g > text")?.getAttribute("font-weight"),
    ).toBe("500");
    expect(rendered.querySelector("g")?.getAttribute("transform")).toBe(
      "translate(80 100) rotate(12 350 100)",
    );
    expect(rendered.querySelector("g")?.getAttribute("opacity")).toBe("0.8");
    expect(rendered.querySelector("style")?.textContent).toContain(
      "data:font/ttf;base64,",
    );
    expect(
      rendered.querySelector("use, foreignObject, script, iframe"),
    ).toBeNull();
    expect(deck).toEqual(original);
  });

  it("measures actual glyph widths and embeds Korean fallback fonts and their license", async () => {
    const deck = deckWith("WWWW");
    const object = text("WWWW", {
      fontSize: 20,
      fontWeight: 400,
      transform: { x: 0, y: 0, width: 70, height: 26, rotation: 0 },
    });
    deck.slides[0].objects = [object];
    const wide = svg(await renderAgentSvg(deck, 0, options));
    expect(wide.querySelectorAll("g > text > tspan")).toHaveLength(2);
    object.text = "iiii";
    const narrow = svg(await renderAgentSvg(deck, 0, options));
    expect(narrow.querySelectorAll("g > text > tspan")).toHaveLength(1);
    object.text = "한글 우주론 $U(1)$";
    object.transform.width = 700;
    object.fontWeight = 600;
    const korean = svg(await renderAgentSvg(deck, 0, options));
    expect(korean.querySelector("g > text")?.getAttribute("font-family")).toBe(
      "Nanum Gothic",
    );
    expect(korean.querySelector("g > text")?.getAttribute("font-weight")).toBe(
      "700",
    );
    expect(korean.querySelector("style")?.textContent).toContain(
      "font-family:'Nanum Gothic'",
    );
    expect(
      korean.querySelector("metadata[data-font-license]")?.textContent,
    ).toContain("SIL OPEN FONT LICENSE");
    expect(korean.querySelector("svg[data-inline-math] path")).not.toBeNull();
  });

  it("preserves shared arrows, cropped vector figures, isolated IDs, and page numbers", async () => {
    const deck = deckWith("A scientific slide");
    const arrow = shapeFromDrag(
      "arrow",
      { x: 100, y: 450 },
      { x: 350, y: 500 },
    );
    arrow.opacity = 0.5;
    const figure: FigureObject = {
      id: "figure-one",
      type: "figure",
      name: "Vector figure",
      assetId: "vector",
      alt: "Gradient diagram",
      transform: { x: 500, y: 300, width: 200, height: 150, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      metadata: {},
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
    };
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs><linearGradient id="shade"><stop stop-color="#fff"/><stop offset="1" stop-color="#123456"/></linearGradient></defs><rect width="200" height="100" fill="url(#shade)"/></svg>';
    deck.assets = [
      {
        id: "vector",
        name: "diagram.svg",
        mime: "image/svg+xml",
        dataUrl: `data:image/svg+xml,${encodeURIComponent(source)}`,
        width: 200,
        height: 100,
      },
    ];
    deck.slides[0].objects.push(arrow, figure, {
      ...figure,
      id: "figure-two",
      transform: { ...figure.transform, x: 800 },
    });
    deck.pageNumbers = {
      ...DEFAULT_PAGE_NUMBERS,
      startAt: 3,
      format: "number-total",
    };
    const rendered = svg(await renderAgentSvg(deck, 0, options));
    expect(rendered.querySelectorAll("polygon").length).toBeGreaterThan(0);
    expect(
      rendered
        .querySelector("svg[data-figure-viewport]")
        ?.getAttribute("viewBox"),
    ).toBe("50 0 100 100");
    const ids = [...rendered.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rendered.querySelector("[data-page-number]")?.textContent).toBe(
      "3 / 3",
    );
  });

  it("verifies and embeds PNG figures without browser image decoding or network access", async () => {
    const deck = deckWith("Raster figure");
    deck.assets = [
      {
        id: "pixel",
        name: "pixel.png",
        mime: "image/png",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
        width: 1,
        height: 1,
      },
    ];
    deck.slides[0].objects.push({
      id: "pixel-object",
      type: "figure",
      name: "Pixel",
      assetId: "pixel",
      alt: "Red pixel",
      transform: { x: 900, y: 100, width: 100, height: 100, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      metadata: {},
    });
    const rendered = svg(await renderAgentSvg(deck, 0, options));
    expect(rendered.querySelector("image")?.getAttribute("href")).toBe(
      deck.assets[0].dataUrl,
    );
    const imported = await importFigure(
      new File(
        [Buffer.from(deck.assets[0].dataUrl.split(",")[1], "base64")],
        "pixel.png",
      ),
    );
    expect(imported.width).toBe(1);
    expect(imported.height).toBe(1);
    expect(imported.mime).toBe("image/png");
    const archive = await buildDeckArchive(deck);
    expect(archive.arrayBuffer).toBeTypeOf("function");
    const recovered = await readDeckArchive(archive);
    expect(recovered.assets[0].dataUrl).toBe(deck.assets[0].dataUrl);
    const warning = vi.spyOn(console, "warn");
    const pdf = Buffer.from(await renderAgentPdf(deck, options)).toString(
      "latin1",
    );
    expect(pdf).toContain("/Subtype /Image");
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
    const fetch = vi.spyOn(globalThis, "fetch");
    const remote = new Image();
    const failed = new Promise((_, reject) => {
      remote.onerror = reject;
    });
    remote.src = "https://example.com/remote.png";
    await expect(failed).rejects.toThrow("only accepts embedded");
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("rejects active/external SVG figures and missing Local LaTeX caches without executing TeX", async () => {
    const deck = deckWith("Unsafe figure");
    deck.assets = [
      {
        id: "unsafe",
        name: "unsafe.svg",
        mime: "image/svg+xml",
        dataUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')}`,
        width: 10,
        height: 10,
      },
    ];
    deck.slides[0].objects.push({
      id: "unsafe-object",
      type: "figure",
      name: "Unsafe",
      assetId: "unsafe",
      alt: "",
      transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      metadata: {},
    });
    await expect(renderAgentSvg(deck, 0, options)).rejects.toThrow(
      "unsupported active SVG content",
    );
    deck.slides[0].objects.pop();
    const equation: EquationObject = {
      id: "local",
      type: "equation",
      name: "Local equation",
      latex: "x",
      renderer: "local-latex",
      displayMode: false,
      description: "",
      style: {},
      transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      metadata: {},
    };
    deck.slides[0].objects.push(equation);
    await expect(renderAgentSvg(deck, 0, options)).rejects.toThrow(
      "Compile this Local LaTeX equation",
    );
    await expect(renderAgentSvg(deck, 1, options)).rejects.toThrow(
      "valid zero-based slide index",
    );
  });

  it("produces genuine vector PDF paths, embedded text glyphs, and Korean ToUnicode maps", async () => {
    const deck = deckWith("한글 Scientific $U(1)$");
    deck.slides[0].objects.push(
      shapeFromDrag("arrow", { x: 100, y: 450 }, { x: 350, y: 500 }),
    );
    const bytes = await renderAgentPdf(deck, options);
    const source = Buffer.from(bytes).toString("latin1");
    expect(source.startsWith("%PDF-")).toBe(true);
    expect(source).toContain("/FontFile2");
    expect(source).toContain("/ToUnicode");
    const streams = pdfStreams(bytes);
    expect(streams.some((stream) => /\bBT\b/.test(stream))).toBe(true);
    expect(
      streams.some(
        (stream) =>
          /\n[\d.\- ]+ m\n/.test(stream) && /\n[\d.\- ]+ [lc]\n/.test(stream),
      ),
    ).toBe(true);
    expect(
      streams.some(
        (stream) => stream.includes("D55C") || stream.includes("d55c"),
      ),
    ).toBe(true);
    expect(source).not.toContain("/Subtype /Image");
  });

  it("keeps unsupported actual text weights rejected despite passive context font aliases", async () => {
    const deck = deckWith("Unsupported standard text weight");
    deck.slides[0].objects = [
      text("Standard serif", { fontFamily: "serif", fontWeight: 500 }),
    ];
    await expect(renderAgentPdf(deck, options)).rejects.toThrow(
      "unsupported SVG font weight",
    );
  });
});
