// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDemoDeck, type Deck, type TextObject } from "../src/lib/model";
import {
  containsKorean,
  exportTextFontFamily,
  exportTextFontWeight,
  normalizeRenderedText,
} from "../src/lib/text-fonts";
import {
  exportDeckPdf,
  exportSlideSvg,
  renderSlideSvg,
} from "../src/lib/export";

// Validate the real bundled TTFs and jsPDF glyph maps. The converter's browser
// geometry is covered by the rendered PDF smoke; jsdom has no SVG metrics API.
const converter = vi.hoisted(() => ({ scenes: [] as SVGSVGElement[] }));
vi.mock("svg2pdf.js", () => ({
  svg2pdf: vi.fn(async (svg, pdf) => {
    converter.scenes.push(svg.cloneNode(true));
    for (const node of svg.querySelectorAll("text,tspan")) {
      const text = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? "")
        .join("");
      if (!text.trim()) continue;
      const family = node.getAttribute("font-family");
      const weight = Number(node.getAttribute("font-weight"));
      if (family === "Inter" || family === "Nanum Gothic") {
        const style =
          weight === 700
            ? "bold"
            : weight === 400
              ? "normal"
              : `${weight}normal`;
        pdf.setFont(family, style);
        pdf.text(text, 30, 40);
      }
    }
  }),
}));

function textObject(
  text: string,
  weight = 400,
  fontFamily = "Inter",
): TextObject {
  return {
    id: "text-korean",
    type: "text",
    name: "Mixed Korean paragraph",
    transform: { x: 96, y: 120, width: 900, height: 300, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    text,
    fontFamily,
    fontSize: 36,
    fontWeight: weight,
    color: "#172033",
    align: "left",
  };
}

function textDeck(text: string, weight = 400, family = "Inter"): Deck {
  const deck = createDemoDeck();
  deck.slides = [
    {
      ...deck.slides[0],
      title: "Korean export",
      objects: [textObject(text, weight, family)],
    },
  ];
  deck.assets = [];
  deck.pageNumbers = undefined;
  return deck;
}

function figureDeck(source: string): Deck {
  const deck = textDeck("");
  deck.assets = [
    {
      id: "korean-figure",
      name: "korean-figure.svg",
      mime: "image/svg+xml",
      dataUrl: `data:image/svg+xml,${encodeURIComponent(source)}`,
      width: 400,
      height: 120,
    },
  ];
  deck.slides[0].objects = [
    {
      id: "figure-object",
      type: "figure",
      name: "Korean SVG figure",
      assetId: "korean-figure",
      alt: "Korean labels",
      transform: { x: 100, y: 100, width: 400, height: 120, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      metadata: {},
    },
  ];
  return deck;
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("Korean PDF and SVG typography", () => {
  const fetched: string[] = [];
  const loaded = new Set<string>();

  beforeAll(() => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve(),
        add: (face: { family: string }) => loaded.add(face.family),
      },
    });
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(public family: string) {}
        async load() {
          return this;
        }
      },
    );
    vi.stubGlobal("fetch", async (url: URL) => {
      const filename = url.pathname.split("/").pop()!;
      fetched.push(filename);
      const bytes = await readFile(resolve("public/fonts", filename));
      return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from(bytes).buffer,
      };
    });
    const measurement = {
      font: "",
      measureText(text: string) {
        if (this.font.includes("Nanum Gothic"))
          expect(loaded.has("Nanum Gothic")).toBe(true);
        return { width: [...text].length * 18 };
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      measurement as unknown as CanvasRenderingContext2D,
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps Latin-only PDF exports on Inter without fetching larger Korean fonts", async () => {
    const pdf = await exportDeckPdf(
      textDeck("Latin-only scientific slide", 600),
    );
    expect(pdf.size).toBeGreaterThan(1000);
    expect(fetched).toEqual([
      "inter-400.ttf",
      "inter-500.ttf",
      "inter-600.ttf",
      "inter-700.ttf",
    ]);
    expect(
      converter.scenes
        .at(-1)
        ?.querySelector("tspan")
        ?.getAttribute("font-family"),
    ).toBe("Inter");
    expect(
      converter.scenes
        .at(-1)
        ?.querySelector("tspan")
        ?.getAttribute("font-weight"),
    ).toBe("600");
  });

  it("embeds real Nanum Gothic glyphs for mixed Korean/Latin and both weight aliases", async () => {
    for (const [weight, resolved] of [
      [500, 400],
      [600, 700],
    ]) {
      const pdf = await exportDeckPdf(
        textDeck("한국어 발표 Scientific presentation", weight),
      );
      const source = await blobText(pdf);
      expect(source.includes("/BaseFont /Nanum#20Gothic")).toBe(true);
      expect(source.includes("/ToUnicode")).toBe(true);
      expect(source.includes("/Subtype /Image")).toBe(false);
      const scene = converter.scenes.at(-1)!;
      expect(scene.querySelector("tspan")?.getAttribute("font-family")).toBe(
        "Nanum Gothic",
      );
      expect(scene.querySelector("tspan")?.getAttribute("font-weight")).toBe(
        String(resolved),
      );
    }
    expect(fetched.filter((name) => name.startsWith("nanum"))).toEqual([
      "nanum-gothic-400.ttf",
      "nanum-gothic-700.ttf",
    ]);
  });

  it("normalizes decomposed modern Hangul for rendering without changing saved source", async () => {
    const original = "\u1100\u1161\u11a8 Scientific";
    const deck = textDeck(original);
    const scene = await renderSlideSvg(deck, deck.slides[0], 0);
    expect(scene.querySelector("tspan")?.textContent).toBe("각 Scientific");
    expect((deck.slides[0].objects[0] as TextObject).text).toBe(original);
    await expect(exportDeckPdf(deck)).resolves.toBeInstanceOf(Blob);
  });

  it("resolves imported SVG runs independently with inherited generic families and inline weights", async () => {
    const deck = figureDeck(
      `<svg xmlns="http://www.w3.org/2000/svg" font-family="Arial" font-size="22"><text y="25" style="font-weight:600">한국어<tspan x="90">Latin label</tspan><tspan x="200" style="font-weight:500">각</tspan></text></svg>`,
    );
    const scene = await renderSlideSvg(deck, deck.slides[0], 0);
    const nodes = [...scene.querySelectorAll("text,tspan")];
    expect(
      nodes.map((node) => [
        node.getAttribute("font-family"),
        node.getAttribute("font-weight"),
        node.textContent,
      ]),
    ).toEqual([
      ["Nanum Gothic", "700", "한국어Latin label각"],
      ["Arial", "600", "Latin label"],
      ["Nanum Gothic", "400", "각"],
    ]);
    // Arial 600 remains unsupported, rather than silently changing that Latin run.
    await expect(exportDeckPdf(deck)).rejects.toThrow(
      "unsupported SVG font weight",
    );
    deck.assets[0].dataUrl = deck.assets[0].dataUrl.replace(
      "font-weight%3A600",
      "font-weight%3A700",
    );
    await expect(exportDeckPdf(deck)).resolves.toBeInstanceOf(Blob);
  });

  it("does not silently substitute arbitrary imported Korean font families", async () => {
    const deck = figureDeck(
      `<svg xmlns="http://www.w3.org/2000/svg"><text y="30" font-family="Unbundled Research Font">한국어</text></svg>`,
    );
    await expect(exportDeckPdf(deck)).rejects.toThrow(
      "unbundled font “Unbundled Research Font”",
    );
  });

  it("rejects unsupported Hanja, isolated ancient Jamo, and emoji with visible glyph names", async () => {
    for (const text of ["한국어 漢", "한국어 \u1100", "한국어 😀"]) {
      await expect(exportDeckPdf(textDeck(text))).rejects.toThrow(
        "unavailable in its embedded PDF font “Nanum Gothic”",
      );
    }
  });

  it("produces a standalone SVG with embedded Korean fonts and the complete redistribution license", async () => {
    const deck = textDeck("한글 발표 · English", 700);
    const svg = await blobText(await exportSlideSvg(deck, deck.slides[0]));
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.querySelector("style")?.textContent).toContain(
      "font-family:'Nanum Gothic'",
    );
    expect(parsed.querySelector("style")?.textContent).toContain(
      "data:font/ttf;base64,",
    );
    expect(
      parsed.querySelector("metadata[data-font-license]")?.textContent,
    ).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(parsed.querySelector("tspan")?.textContent).toBe(
      "한글 발표 · English",
    );
  });
});

describe("text family selection", () => {
  it("covers Hangul blocks, preserves Latin and custom families, and maps only known static weights", () => {
    for (const text of ["한글", "\u1100", "\u3131", "\ua960", "\ud7b0"])
      expect(containsKorean(text)).toBe(true);
    expect(normalizeRenderedText("각")).toBe("각");
    expect(exportTextFontFamily("한국어 + English", "Inter")).toBe(
      "Nanum Gothic",
    );
    expect(exportTextFontFamily("한국어", "Arial, sans-serif")).toBe(
      "Nanum Gothic",
    );
    expect(exportTextFontFamily("English", "Inter")).toBe("Inter");
    expect(exportTextFontFamily("한국어", "Custom Font")).toBe("Custom Font");
    expect(exportTextFontFamily("English", "'Nanum Gothic', sans-serif")).toBe(
      "Nanum Gothic",
    );
    expect(exportTextFontWeight("한국어", "Inter", 500)).toBe(400);
    expect(exportTextFontWeight("한국어", "Inter", 600)).toBe(700);
    expect(exportTextFontWeight("한국어", "Inter", 900)).toBe(900);
    expect(exportTextFontWeight("English", "Inter", 600)).toBe(600);
  });
});
