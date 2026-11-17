// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideScene } from "../src/components/SlideScene";
import {
  createBlankSlide,
  createDemoDeck,
  DEFAULT_PAGE_NUMBERS,
  resolvePageNumber,
  validateDeck,
  type Deck,
  type ShapeObject,
} from "../src/lib/model";
import {
  exportDeckPdf,
  exportSlideSvg,
  getPdfExportPages,
  renderSlideSvg,
} from "../src/lib/export";
import { exportDeckPptx } from "../src/lib/export-pptx";

const converter = vi.hoisted(() => ({ scenes: [] as SVGSVGElement[] }));
// Inspect each scene handed to the converter; jsPDF and bundled TTFs are real.
vi.mock("svg2pdf.js", () => ({
  svg2pdf: vi.fn(async (svg: SVGSVGElement) => {
    converter.scenes.push(svg.cloneNode(true) as SVGSVGElement);
  }),
}));

function shape(id: string, step?: number): ShapeObject {
  return {
    id,
    name: id,
    type: "shape",
    shape: "rect",
    transform: { x: 100, y: 100, width: 100, height: 100, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    fill: "#123456",
    stroke: "none",
    strokeWidth: 0,
    ...(step === undefined
      ? {}
      : { build: { step, effect: "appear" as const, durationMs: 250 } }),
  };
}

function numberedDeck(): Deck {
  const deck = createDemoDeck();
  deck.assets = [];
  deck.slides = [
    {
      ...createBlankSlide(),
      title: "Title",
      objects: [shape("title-initial"), shape("title-late", 4)],
    },
    {
      ...createBlankSlide(),
      title: "First numbered",
      objects: [
        shape("numbered-initial"),
        shape("numbered-late", 7),
        shape("same-step", 7),
        { ...shape("hidden-late", 100), visible: false },
      ],
    },
    { ...createBlankSlide(), title: "Last", objects: [shape("last")] },
  ];
  deck.pageNumbers = {
    ...DEFAULT_PAGE_NUMBERS,
    firstSlide: 2,
    startAt: 7,
    format: "number-total",
    hideFirst: true,
  };
  return deck;
}

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("logical slide numbering and build PDF pages", () => {
  beforeEach(() => {
    converter.scenes = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve(), add() {} },
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
      const filename = url.pathname.split("/").pop()!;
      const bytes = await readFile(
        new NodeURL(`../public/fonts/${filename}`, import.meta.url),
      );
      return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from(bytes).buffer,
      };
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as CanvasRenderingContext2D);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts counting at the chosen slide while preserving absent-field hideFirst behavior", () => {
    const deck = numberedDeck();
    expect(deck.slides.map((_, i) => resolvePageNumber(deck, i)?.text)).toEqual(
      [undefined, "7 / 8", "8 / 8"],
    );
    delete deck.pageNumbers!.firstSlide;
    expect(deck.slides.map((_, i) => resolvePageNumber(deck, i)?.text)).toEqual(
      [undefined, "8 / 9", "9 / 9"],
    );
    deck.pageNumbers!.firstSlide = 1;
    expect(resolvePageNumber(deck, 0)?.text).toBe("7 / 9");
    deck.pageNumbers!.firstSlide = 3;
    deck.slides.pop();
    expect(deck.slides.every((_, i) => !resolvePageNumber(deck, i))).toBe(true);
  });

  it("validates first-slide settings and retains them in an independent snapshot", () => {
    const deck = numberedDeck();
    const snapshot = validateDeck(deck);
    expect(snapshot.pageNumbers?.firstSlide).toBe(2);
    snapshot.pageNumbers!.firstSlide = 3;
    expect(deck.pageNumbers?.firstSlide).toBe(2);
    for (const firstSlide of [0, -1, 1.5, 1001, NaN, Infinity, null, "2"]) {
      expect(() =>
        validateDeck({
          ...deck,
          pageNumbers: { ...deck.pageNumbers, firstSlide },
        }),
      ).toThrow();
    }
  });

  it("keeps live scenes and standalone SVG numbers equal after changing slide order", async () => {
    const deck = numberedDeck();
    deck.slides.reverse();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      for (const [index, slide] of deck.slides.entries()) {
        await act(async () =>
          root.render(createElement(SlideScene, { deck, slide })),
        );
        const document = new DOMParser().parseFromString(
          new TextDecoder().decode(
            await blobBytes(await exportSlideSvg(deck, slide)),
          ),
          "image/svg+xml",
        );
        const expected = [undefined, "7 / 8", "8 / 8"][index];
        expect(host.querySelector(".slide-page-number")?.textContent).toBe(
          expected,
        );
        expect(document.querySelector("[data-page-number]")?.textContent).toBe(
          expected,
        );
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("expands only populated live build steps with original logical numbers and total", async () => {
    const deck = numberedDeck();
    const before = structuredClone(deck);
    const pages = getPdfExportPages(deck, true);
    expect(
      pages.map(({ slideIndex, presentationStep }) => [
        slideIndex,
        presentationStep,
      ]),
    ).toEqual([
      [0, 0],
      [0, 4],
      [1, 0],
      [1, 7],
      [2, 0],
    ]);
    expect(pages[2].slide).toBe(deck.slides[1]);
    const prepared: string[] = [];
    const pdf = await exportDeckPdf(deck, {
      includeBuildSteps: true,
      prepareSvg: (svg) =>
        prepared.push(svg.querySelector("title")!.textContent!),
    });
    const source = new TextDecoder("latin1").decode(await blobBytes(pdf));
    expect(source.startsWith("%PDF-")).toBe(true);
    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(5);
    expect(prepared).toEqual([
      "Title",
      "Title",
      "First numbered",
      "First numbered",
      "Last",
    ]);
    expect(
      converter.scenes.map(
        (svg) => svg.querySelector("[data-page-number]")?.textContent,
      ),
    ).toEqual([undefined, undefined, "7 / 8", "7 / 8", "8 / 8"]);
    const objects = (svg: SVGSVGElement) =>
      [...svg.querySelectorAll("g > title")].map((title) => title.textContent);
    expect(converter.scenes.map(objects)).toEqual([
      ["title-initial"],
      ["title-initial", "title-late"],
      ["numbered-initial"],
      ["numbered-initial", "numbered-late", "same-step"],
      ["last"],
    ]);
    expect(deck).toEqual(before);
  });

  it("keeps one final-state PDF page per slide by default", async () => {
    const deck = numberedDeck();
    await exportDeckPdf(deck);
    expect(converter.scenes).toHaveLength(3);
    expect(converter.scenes[0].textContent).toContain("title-late");
    expect(converter.scenes[1].textContent).toContain("numbered-late");
    expect(
      converter.scenes.map(
        (svg) => svg.querySelector("[data-page-number]")?.textContent,
      ),
    ).toEqual([undefined, "7 / 8", "8 / 8"]);
  });

  it("keeps imported font identities stable when an earlier object appears at a later build", async () => {
    const deck = numberedDeck();
    deck.assets = await Promise.all(
      [400, 700].map(async (weight) => {
        const bytes = await readFile(
          new NodeURL(`../public/fonts/inter-${weight}.ttf`, import.meta.url),
        );
        const face = `<style>@font-face{font-family:FigureFont;src:url(data:font/ttf;base64,${bytes.toString("base64")}) format('truetype');font-weight:400}</style>`;
        return {
          id: `figure-font-${weight}`,
          name: `labels-${weight}.svg`,
          mime: "image/svg+xml",
          dataUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${face}<text y="30" font-family="FigureFont">Label</text></svg>`)}`,
          width: 100,
          height: 100,
        };
      }),
    );
    const figure = (id: string, step?: number) => ({
      ...shape(id, step),
      type: "figure" as const,
      assetId: `figure-font-${step === undefined ? 700 : 400}`,
      alt: id,
    });
    deck.slides[0].objects = [
      figure("late-figure", 4),
      figure("initial-figure"),
    ];
    const initial = await renderSlideSvg(deck, deck.slides[0], 0, undefined, {
      presentationStep: 0,
    });
    const final = await renderSlideSvg(deck, deck.slides[0], 0, undefined, {
      presentationStep: 4,
    });
    const fontFamilies = (svg: SVGSVGElement) =>
      [...svg.querySelectorAll("svg[data-figure-viewport] text")].map((node) =>
        node.getAttribute("font-family"),
      );
    expect(fontFamilies(initial)).toEqual(["slide-0-object-1-font-0"]);
    expect(fontFamilies(final)).toEqual([
      "slide-0-object-0-font-0",
      "slide-0-object-1-font-0",
    ]);
  });

  it("writes the same chosen first-slide numbers into native PowerPoint text", async () => {
    const deck = numberedDeck();
    const zip = await JSZip.loadAsync(
      await blobBytes(await exportDeckPptx(deck)),
    );
    const numbers: Array<string | undefined> = [];
    for (let index = 1; index <= 3; index++) {
      const document = new DOMParser().parseFromString(
        await zip.file(`ppt/slides/slide${index}.xml`)!.async("string"),
        "application/xml",
      );
      const texts = [
        ...document.getElementsByTagNameNS(
          "http://schemas.openxmlformats.org/drawingml/2006/main",
          "t",
        ),
      ].map((node) => node.textContent!);
      numbers.push(texts.find((text) => /^\d+ \/ \d+$/.test(text)));
    }
    expect(numbers).toEqual([undefined, "7 / 8", "8 / 8"]);
  });
});
