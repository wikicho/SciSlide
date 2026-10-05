// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  exportDeckPdf,
  exportSlideSvg,
  renderSlideSvg,
} from "../src/lib/export";
import { renderEquation } from "../src/lib/equations";
import * as inlineMath from "../src/lib/inline-math";
import { createDemoDeck, type Deck, type TextObject } from "../src/lib/model";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";

// Keep the actual SVG-to-PDF converter and bundled font files. Only browser text
// metrics are simulated because jsdom does not implement canvas/SVG measurement.
vi.mock("svg2pdf.js", () => import("svg2pdf.js/dist/svg2pdf.es.js"));

const SVG_NS = "http://www.w3.org/2000/svg";

function textObject(
  source: string,
  overrides: Partial<TextObject> = {},
): TextObject {
  return {
    id: "inline-paragraph",
    type: "text",
    name: "Mixed inline paragraph",
    text: source,
    fontFamily: "Inter",
    fontSize: 36,
    fontWeight: 400,
    color: "#123456",
    align: "left",
    transform: { x: 80, y: 100, width: 900, height: 300, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    ...overrides,
  };
}

function textDeck(
  source: string,
  overrides: Partial<TextObject> = {},
): { deck: Deck; object: TextObject } {
  const deck = createDemoDeck();
  const object = textObject(source, overrides);
  deck.slides = [
    { ...deck.slides[0], title: "Inline mathematics", objects: [object] },
  ];
  deck.assets = [];
  deck.pageNumbers = undefined;
  return { deck, object };
}

function blobBytes(blob: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function textRuns(svg: SVGSVGElement): SVGTextElement[] {
  return [...svg.querySelectorAll<SVGTextElement>("g > text")];
}

function mathRuns(svg: SVGSVGElement): SVGSVGElement[] {
  return [...svg.querySelectorAll<SVGSVGElement>("svg[data-inline-math]")];
}

function glyphPaths(svg: Element): string[] {
  return [...svg.querySelectorAll("path")].map((path) =>
    path.getAttribute("d")!,
  );
}

function baseline(svg: SVGSVGElement): number {
  const viewBox = svg.getAttribute("viewBox")!.split(/\s+/).map(Number);
  return (
    Number(svg.getAttribute("y")) +
    (-viewBox[1] / viewBox[3]) * Number(svg.getAttribute("height"))
  );
}

function pdfStreams(source: string): string[] {
  return [...source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(
    (match) => {
      const bytes = Buffer.from(match[1], "latin1");
      try {
        return inflateSync(bytes).toString("latin1");
      } catch {
        return bytes.toString("latin1");
      }
    },
  );
}

describe("inline mathematics in SVG and PDF export", () => {
  const previousBBox = Object.getOwnPropertyDescriptor(
    SVGElement.prototype,
    "getBBox",
  );

  beforeAll(() => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve(), add: vi.fn() },
    });
    vi.stubGlobal("crypto", webcrypto);
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
    const context = {
      font: "",
      measureText(text: string) {
        const size = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 16);
        return {
          width: [...text].length * size * 0.5,
          actualBoundingBoxAscent: size * (text === "x" ? 0.5 : 0.8),
          actualBoundingBoxDescent: text === "x" ? 0 : size * 0.2,
        };
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value(this: SVGElement) {
        const size = Number(this.getAttribute("font-size") ?? 16);
        return {
          x: 0,
          y: -size * 0.8,
          width: [...(this.textContent ?? "")].length * size * 0.5,
          height: size,
        };
      },
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (previousBBox)
      Object.defineProperty(SVGElement.prototype, "getBBox", previousBBox);
    else Reflect.deleteProperty(SVGElement.prototype, "getBBox");
  });

  it("exports real AMS vectors between selectable text runs without embedding raw delimiters", async () => {
    const source = "Before $\\chi$ after $m_\\chi \\in \\mathbb{R}$ end";
    const { deck, object } = textDeck(source);
    const svg = await renderSlideSvg(deck, deck.slides[0], 0);
    const maths = mathRuns(svg);
    expect(maths).toHaveLength(2);
    expect(maths.map((math) => math.getAttribute("aria-label"))).toEqual([
      "\\chi",
      "m_\\chi \\in \\mathbb{R}",
    ]);
    expect(
      maths.every((math) => math.querySelectorAll("path").length > 0),
    ).toBe(true);
    expect(
      maths.every(
        (math) => math.querySelector("text,image,foreignObject") === null,
      ),
    ).toBe(true);
    const prose = textRuns(svg)
      .map((run) => run.textContent)
      .join("");
    expect(prose).toContain("Before");
    expect(prose).toContain("after");
    expect(prose).toContain("end");
    expect(prose).not.toMatch(/\$|\\chi|mathbb/);
    const textBaseline = Number(textRuns(svg)[0].getAttribute("y"));
    for (const math of maths)
      expect(baseline(math)).toBeCloseTo(textBaseline, 7);
    expect(svg.querySelector("foreignObject,image")).toBeNull();
    expect(object.text).toBe(source);
  });

  it("inherits the deck math font but uses the text object's size and color", async () => {
    const { deck, object } = textDeck("Value $\\chi$ here", {
      fontSize: 28,
      color: "#934b12",
      fontWeight: 600,
    });
    deck.theme.equation.fontSetId = "mathjax-modern";
    deck.theme.equation.fontSize = 90;
    deck.theme.equation.color = "#00ffff";
    const svg = await renderSlideSvg(deck, deck.slides[0], 0);
    const math = mathRuns(svg)[0];
    const expected = await renderEquation(
      "\\chi",
      "mathjax-modern",
      28,
      "#934b12",
      false,
    );
    const expectedSvg = new DOMParser().parseFromString(
      expected.svg,
      "image/svg+xml",
    ).documentElement;
    const opticalScale = (object.fontSize * 0.5) / expected.xHeight!;
    expect(glyphPaths(math)).toEqual(glyphPaths(expectedSvg));
    expect(Number(math.getAttribute("width"))).toBeCloseTo(
      expected.width * opticalScale,
      7,
    );
    expect(Number(math.getAttribute("height"))).toBeCloseTo(
      expected.height * opticalScale,
      7,
    );
    expect(math.getAttribute("fill")).toBe(object.color);
    expect(
      textRuns(svg).every((run) => run.getAttribute("font-size") === "28"),
    ).toBe(true);
    expect(
      textRuns(svg).every((run) => run.getAttribute("font-weight") === "600"),
    ).toBe(true);
  });

  it("exports optically scaled viewports with the shared run bounds and mathematical baselines", async () => {
    const { deck, object } = textDeck("Left $x$ right $\\frac{1}{2}$ end", {
      fontSize: 36,
      align: "right",
      transform: { x: 80, y: 100, width: 190, height: 300, rotation: 0 },
    });
    deck.theme.equation.fontSetId = "mathjax-modern";
    const layout = await inlineMath.layoutInlineText(object, deck);
    const sharedMathRuns = layout.lines.flatMap((line) =>
      line.runs
        .filter((run) => run.type === "math")
        .map((run) => ({ line, run })),
    );
    const svg = await renderSlideSvg(deck, deck.slides[0], 0);
    const maths = mathRuns(svg);
    expect(maths).toHaveLength(2);
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const [index, { line, run }] of sharedMathRuns.entries()) {
      const original = await renderEquation(
        run.latex,
        "mathjax-modern",
        36,
        object.color,
        false,
      );
      expect(original.xHeight).toBeGreaterThan(0);
      const scale = (36 * 0.5) / original.xHeight!;
      expect(scale).not.toBeCloseTo(1, 2);
      const originalSvg = new DOMParser().parseFromString(
        original.svg,
        "image/svg+xml",
      ).documentElement;
      const sharedSvg = new DOMParser().parseFromString(
        run.svg,
        "image/svg+xml",
      ).documentElement;
      const exported = maths[index];
      expect(Number(exported.getAttribute("width"))).toBeCloseTo(
        original.width * scale,
        7,
      );
      expect(Number(exported.getAttribute("height"))).toBeCloseTo(
        original.height * scale,
        7,
      );
      expect(exported.getAttribute("viewBox")).toBe(
        originalSvg.getAttribute("viewBox"),
      );
      expect(glyphPaths(exported)).toEqual(glyphPaths(originalSvg));
      for (const dimension of ["width", "height"] as const) {
        expect(Number(sharedSvg.getAttribute(dimension))).toBeCloseTo(
          run[dimension],
          7,
        );
        expect(Number(exported.getAttribute(dimension))).toBeCloseTo(
          run[dimension],
          7,
        );
      }
      expect(Number(exported.getAttribute("x"))).toBeCloseTo(run.x, 7);
      expect(Number(exported.getAttribute("y"))).toBeCloseTo(run.y, 7);
      expect(baseline(exported)).toBeCloseTo(line.baseline, 7);
      expect(run.y + original.baseline! * scale).toBeCloseTo(line.baseline, 7);
    }
    for (const line of layout.lines) {
      const end = Math.max(...line.runs.map((run) => run.x + run.width));
      expect(end).toBeCloseTo(object.transform.width, 7);
      for (const run of line.runs) {
        if (run.type !== "text" || !run.text.trim()) continue;
        const prose = textRuns(svg).find(
          (node) =>
            node.textContent === run.text &&
            Number(node.getAttribute("y")) === line.baseline,
        );
        expect(prose).toBeDefined();
        expect(Number(prose!.getAttribute("x"))).toBeCloseTo(run.x, 7);
      }
    }
  });

  it.each(["left", "center", "right"] as const)(
    "wraps intact fractions and aligns each line to the %s text frame",
    async (align) => {
      const { deck, object } = textDeck(
        "Before $\\dfrac{1}{\\chi^2}$ after $\\chi$ again",
        {
          align,
          fontSize: 32,
          transform: { x: 80, y: 100, width: 190, height: 300, rotation: 12 },
        },
      );
      const svg = await renderSlideSvg(deck, deck.slides[0], 0);
      const maths = mathRuns(svg);
      expect(maths).toHaveLength(2);
      const texts = textRuns(svg);
      const baselines = [
        ...new Set(texts.map((run) => Number(run.getAttribute("y")))),
      ];
      expect(baselines.length).toBeGreaterThan(1);
      for (const math of maths)
        expect(
          baselines.some((value) => Math.abs(value - baseline(math)) < 1e-6),
        ).toBe(true);
      const firstMath = maths[0];
      expect(Number(firstMath.getAttribute("height"))).toBeGreaterThan(
        object.fontSize,
      );
      expect(Math.min(...baselines.slice(1))).toBeGreaterThan(
        Number(firstMath.getAttribute("y")) +
          Number(firstMath.getAttribute("height")),
      );
      for (const lineBaseline of baselines) {
        const intervals = [
          ...texts
            .filter((run) => Number(run.getAttribute("y")) === lineBaseline)
            .map((run) => ({
              x: Number(run.getAttribute("x")),
              width:
                [...(run.textContent ?? "")].length * object.fontSize * 0.5,
            })),
          ...maths
            .filter((math) => Math.abs(baseline(math) - lineBaseline) < 1e-6)
            .map((math) => ({
              x: Number(math.getAttribute("x")),
              width: Number(math.getAttribute("width")),
            })),
        ];
        const start = Math.min(...intervals.map((run) => run.x));
        const end = Math.max(...intervals.map((run) => run.x + run.width));
        if (align === "left") expect(start).toBeCloseTo(0, 6);
        if (align === "center")
          expect(start + end).toBeCloseTo(object.transform.width, 6);
        if (align === "right")
          expect(end).toBeCloseTo(object.transform.width, 6);
      }
      expect(svg.querySelector("g")?.getAttribute("transform")).toBe(
        "translate(80 100) rotate(12 95 150)",
      );
    },
  );

  it("retains legacy prose wrapping and renders escaped or unmatched delimiters literally", async () => {
    const { deck } = textDeck("Plain scientific text", {
      fontSize: 20,
      transform: { x: 0, y: 0, width: 200, height: 200, rotation: 0 },
    });
    let svg = await renderSlideSvg(deck, deck.slides[0], 0);
    expect(
      [...svg.querySelectorAll("tspan")].map((span) => span.textContent),
    ).toEqual(["Plain scientific", "text"]);
    expect(
      [...svg.querySelectorAll("tspan")].map((span) => span.getAttribute("y")),
    ).toEqual(["20", "46"]);
    (deck.slides[0].objects[0] as TextObject).text =
      "Price \\$5, display $$x$$, unmatched $tail";
    svg = await renderSlideSvg(deck, deck.slides[0], 0);
    expect(mathRuns(svg)).toHaveLength(0);
    expect(
      [...svg.querySelectorAll("tspan")]
        .map((span) => span.textContent)
        .join(" "),
    ).toBe("Price $5, display $$x$$, unmatched $tail");
  });

  it("names the text object when an invalid inline command aborts both static exports", async () => {
    const { deck } = textDeck("Before $\\notARealMathCommand$ after");
    await expect(renderSlideSvg(deck, deck.slides[0], 0)).rejects.toThrow(
      /Text “Mixed inline paragraph” cannot be exported:.*notARealMathCommand/s,
    );
    await expect(exportSlideSvg(deck, deck.slides[0])).rejects.toThrow(
      "Text “Mixed inline paragraph” cannot be exported",
    );
    await expect(exportDeckPdf(deck)).rejects.toThrow(
      "Text “Mixed inline paragraph” cannot be exported",
    );
  });

  it("namespaces reusable math IDs and references across fragments and objects", async () => {
    const { deck, object } = textDeck("First $\\chi$ then $\\chi$");
    deck.slides[0].objects.push({
      ...object,
      id: "second-inline-paragraph",
      name: "Second paragraph",
      transform: { ...object.transform, y: 500 },
    });
    const original = inlineMath.layoutInlineText;
    const spy = vi
      .spyOn(inlineMath, "layoutInlineText")
      .mockImplementation(async (...args) => {
        const layout = await original(...args);
        for (const line of layout.lines) {
          for (const run of line.runs) {
            if (run.type !== "math") continue;
            const parsed = new DOMParser().parseFromString(
              run.svg,
              "image/svg+xml",
            );
            const root = parsed.documentElement;
            root.querySelector("path")!.setAttribute("id", "reused-glyph");
            const defs = parsed.createElementNS(SVG_NS, "defs");
            const clip = parsed.createElementNS(SVG_NS, "clipPath");
            clip.id = "reused-clip";
            const rectangle = parsed.createElementNS(SVG_NS, "rect");
            rectangle.setAttribute("width", "100");
            rectangle.setAttribute("height", "100");
            clip.append(rectangle);
            defs.append(clip);
            const use = parsed.createElementNS(SVG_NS, "use");
            use.setAttribute("href", "#reused-glyph");
            use.setAttribute("clip-path", "url(#reused-clip)");
            root.append(defs, use);
            run.svg = new XMLSerializer().serializeToString(root);
          }
        }
        return layout;
      });
    try {
      const svg = await renderSlideSvg(deck, deck.slides[0], 0);
      expect(mathRuns(svg)).toHaveLength(4);
      const ids = [...svg.querySelectorAll("[id]")].map((node) => node.id);
      expect(ids).toHaveLength(8);
      expect(new Set(ids).size).toBe(ids.length);
      for (const use of svg.querySelectorAll("use")) {
        const glyph = use.getAttribute("href")!.slice(1);
        const clip = use.getAttribute("clip-path")!.slice(5, -1);
        expect(svg.querySelector('[id="' + glyph + '"]')).not.toBeNull();
        expect(svg.querySelector('[id="' + clip + '"]')?.localName).toBe(
          "clipPath",
        );
        expect(glyph).toMatch(
          /^slide-0-object-[01]-inline-\d+-\d+-reused-glyph$/,
        );
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("produces a genuine PDF with selectable Korean prose and vector mathematics", async () => {
    const { deck } = textDeck("질량 $\\chi$ = $m_\\chi$입니다", {
      fontWeight: 600,
    });
    const svg = await renderSlideSvg(deck, deck.slides[0], 0);
    expect(
      textRuns(svg).every(
        (run) => run.getAttribute("font-family") === "Nanum Gothic",
      ),
    ).toBe(true);
    expect(
      textRuns(svg).every((run) => run.getAttribute("font-weight") === "700"),
    ).toBe(true);
    expect(mathRuns(svg)).toHaveLength(2);
    const source = (await blobBytes(await exportDeckPdf(deck))).toString(
      "latin1",
    );
    expect(source).toMatch(/^%PDF-/);
    expect(source).toContain("/BaseFont /Nanum#20Gothic");
    expect(source).toContain("/ToUnicode");
    expect(source).not.toContain("/Subtype /Image");
    const graphics = pdfStreams(source).join("\n");
    expect(graphics).toMatch(/\bBT\b/);
    expect(graphics).toMatch(/[\d.\- ]+ c\b/);
    expect(graphics).toMatch(/\bf\b/);
  });

  it("round-trips raw inline source without changing native text fields or format", async () => {
    const source = "State \\(\\mathbb{R}^n\\) includes $\\chi$; cost \\$5.";
    const { deck } = textDeck(source);
    const restored = await readDeckArchive(await buildDeckArchive(deck));
    const object = restored.slides[0].objects[0] as TextObject;
    expect(restored.formatVersion).toBe("0.5.0");
    expect(object.type).toBe("text");
    expect(object.text).toBe(source);
    expect(restored.assets).toEqual([]);
    const svg = await renderSlideSvg(restored, restored.slides[0], 0);
    expect(
      mathRuns(svg).map((math) => math.getAttribute("aria-label")),
    ).toEqual(["\\mathbb{R}^n", "\\chi"]);
    expect(
      textRuns(svg)
        .map((run) => run.textContent)
        .join(""),
    ).toContain("cost $5.");
  });
});
