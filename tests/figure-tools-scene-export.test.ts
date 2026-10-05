// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FigureTools } from "../src/components/FigureTools";
import { SlideScene } from "../src/components/SlideScene";
import { exportDeckPdf, renderSlideSvg } from "../src/lib/export";
import {
  createDemoDeck,
  type Asset,
  type FigureObject,
} from "../src/lib/model";

vi.mock("svg2pdf.js", () => import("svg2pdf.js/dist/svg2pdf.es.js"));

const sourceSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="10 20 200 100"><rect x="10" y="20" width="100" height="100" fill="#ff0000"/><path d="M110 20H210V120H110Z" fill="#0000ff"/></svg>';

function croppedDeck() {
  const deck = createDemoDeck();
  const asset: Asset = {
    id: "crop-test-source",
    name: "Two scientific panels.svg",
    mime: "image/svg+xml",
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sourceSvg)}`,
    width: 200,
    height: 100,
  };
  const figure: FigureObject = {
    id: "crop-test-figure",
    name: "Panel B",
    type: "figure",
    assetId: asset.id,
    alt: "Selected region of the results",
    crop: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 },
    transform: { x: 100, y: 80, width: 400, height: 100, rotation: 20 },
    opacity: 0.75,
    visible: true,
    locked: false,
    metadata: {},
  };
  deck.slides = [{ ...deck.slides[0], objects: [figure] }];
  deck.assets = [asset];
  deck.pageNumbers = undefined;
  return { deck, asset, figure };
}

function pdfBytes(blob: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("figure crop tools and consistent scenes", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve(), add: vi.fn() },
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

  async function edit(label: string, value: string) {
    const input = host.querySelector<HTMLInputElement>(
      `input[aria-label="Crop ${label} (%)"]`,
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function button(text: string) {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === text,
    )!;
  }

  it("creates an inset from a preview without applying the source crop, then commits only on Apply", async () => {
    const { figure, asset } = croppedDeck();
    const onCropChange = vi.fn();
    const onCreateInset = vi.fn();
    await act(async () =>
      root.render(
        createElement(FigureTools, {
          object: figure,
          asset,
          onCropChange,
          onCreateInset,
        }),
      ),
    );
    expect(button("Apply crop").disabled).toBe(true);
    await edit("left", "25");
    expect(onCropChange).not.toHaveBeenCalled();
    expect(
      host.querySelector("[data-figure-viewport]")?.getAttribute("viewBox"),
    ).toBe("50 25 100 50");
    expect(button("Create enlarged inset").disabled).toBe(false);
    await act(async () => button("Create enlarged inset").click());
    expect(onCreateInset).toHaveBeenCalledExactlyOnceWith({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
    expect(onCropChange).not.toHaveBeenCalled();
    expect(figure.crop?.x).toBe(0.5);
    await act(async () => button("Apply crop").click());
    expect(onCropChange).toHaveBeenCalledExactlyOnceWith({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
    expect(figure.crop?.x).toBe(0.5);
    await edit("width", "90");
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "inside the original image",
    );
    expect(button("Apply crop").disabled).toBe(true);
    expect(button("Create enlarged inset").disabled).toBe(true);
    await act(async () => button("Reset crop").click());
    expect(onCropChange).toHaveBeenLastCalledWith(undefined);
    await edit("width", "");
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "all four",
    );
  });

  it("uses valid draft regions on uncropped figures and protects locked/grouped controls", async () => {
    const { figure, asset } = croppedDeck();
    const onCropChange = vi.fn();
    const onCreateInset = vi.fn();
    const props = { object: figure, asset, onCropChange, onCreateInset };
    await act(async () => root.render(createElement(FigureTools, props)));
    await act(async () => button("Create enlarged inset").click());
    expect(onCreateInset).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(createElement(FigureTools, { ...props, disabled: true })),
    );
    expect(
      [
        ...host.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
          "input,button",
        ),
      ].every((control) => control.disabled),
    ).toBe(true);
    await act(async () =>
      root.render(
        createElement(FigureTools, {
          ...props,
          object: { ...figure, crop: undefined },
        }),
      ),
    );
    expect(button("Create enlarged inset").disabled).toBe(true);
    expect(button("Reset crop").disabled).toBe(true);
    await edit("width", "50");
    await edit("left", "25");
    expect(button("Create enlarged inset").disabled).toBe(false);
    await act(async () => button("Create enlarged inset").click());
    expect(onCreateInset).toHaveBeenLastCalledWith({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(onCropChange).not.toHaveBeenCalled();
  });

  it("uses the same crop, source-space clipping, rotation and opacity for editor, playback and export", async () => {
    const { deck, figure } = croppedDeck();
    for (const playback of [false, true]) {
      await act(async () =>
        root.render(
          createElement(SlideScene, { deck, slide: deck.slides[0], playback }),
        ),
      );
      const viewport = host.querySelector("[data-figure-viewport]")!;
      const exported = await renderSlideSvg(deck, deck.slides[0], 0);
      const exportViewport = exported.querySelector("[data-figure-viewport]")!;
      for (const attribute of [
        "width",
        "height",
        "viewBox",
        "preserveAspectRatio",
        "overflow",
      ])
        expect(exportViewport.getAttribute(attribute)).toBe(
          viewport.getAttribute(attribute),
        );
      expect(viewport.getAttribute("viewBox")).toBe("100 25 100 50");
      for (const scene of [viewport, exportViewport]) {
        const clip = scene.querySelector("clipPath")!;
        expect(clip.getAttribute("clipPathUnits")).toBe("userSpaceOnUse");
        expect(clip.querySelector("rect")?.getAttribute("width")).toBe("100");
        expect(clip.querySelector("rect")?.getAttribute("x")).toBe("100");
        expect(scene.querySelector("g")?.getAttribute("clip-path")).toBe(
          `url(#${clip.id})`,
        );
      }
      expect(exported.querySelector("g")?.getAttribute("transform")).toBe(
        "translate(100 80) rotate(20 200 50)",
      );
      expect(exported.querySelector("g")?.getAttribute("opacity")).toBe(
        String(figure.opacity),
      );
      // Preserve the source's offset viewBox inside normalized asset coordinates.
      expect(
        exportViewport.querySelector("g > svg")?.getAttribute("viewBox"),
      ).toBe("10 20 200 100");
      expect(exportViewport.querySelector("path")?.getAttribute("d")).toBe(
        "M110 20H210V120H110Z",
      );
      expect(exported.querySelector("image")).toBeNull();
    }
  });

  it.each(["image/png", "image/jpeg"])(
    "retains raster %s sources beneath the same clipped viewport",
    async (mime) => {
      const { deck, asset } = croppedDeck();
      asset.mime = mime;
      asset.dataUrl = `data:${mime};base64,ZmFrZS1yYXN0ZXItZGVjb2RlZA==`;
      vi.stubGlobal(
        "Image",
        class {
          naturalWidth = 200;
          naturalHeight = 100;
          onload?: () => void;
          set src(_source: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
      const exported = await renderSlideSvg(deck, deck.slides[0], 0);
      const image = exported.querySelector("[data-figure-viewport] image")!;
      expect(image.getAttribute("href")).toBe(asset.dataUrl);
      expect(image.getAttribute("width")).toBe("200");
      expect(image.getAttribute("height")).toBe("100");
      expect(exported.querySelector("clipPath rect")?.getAttribute("x")).toBe(
        "100",
      );
    },
  );

  it.each(["none", "xMinYMin slice", "xMaxYMax meet"])(
    "retains the imported SVG's %s mapping inside the crop viewport",
    async (preserveAspectRatio) => {
      const { deck, asset } = croppedDeck();
      const source = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="10 20 100 100" preserveAspectRatio="${preserveAspectRatio}"><rect x="10" y="20" width="100" height="100" fill="#123456"/></svg>`;
      asset.dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      const exported = await renderSlideSvg(deck, deck.slides[0], 0);
      const viewport = exported.querySelector("[data-figure-viewport]")!;
      expect(viewport.getAttribute("preserveAspectRatio")).toBe(
        "xMidYMid meet",
      );
      const nestedSource = viewport.querySelector("g > svg")!;
      expect(nestedSource.getAttribute("preserveAspectRatio")).toBe(
        preserveAspectRatio,
      );
      expect(nestedSource.getAttribute("viewBox")).toBe("10 20 100 100");
      expect(nestedSource.getAttribute("width")).toBe("200");
      expect(nestedSource.getAttribute("height")).toBe("100");
    },
  );

  it("shows passive media placeholders when presenter previews follow click builds", async () => {
    const { deck, figure, asset } = croppedDeck();
    deck.slides[0].objects = [
      {
        ...figure,
        type: "video",
        build: { step: 1, effect: "appear", durationMs: 300 },
        autoplay: true,
        loop: false,
        muted: false,
        controls: true,
      },
    ];
    asset.mime = "video/mp4";
    await act(async () =>
      root.render(
        createElement(SlideScene, {
          deck,
          slide: deck.slides[0],
          playback: true,
          playMedia: false,
          presentationStep: 0,
        }),
      ),
    );
    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector(".video-placeholder")).toBeNull();
    await act(async () =>
      root.render(
        createElement(SlideScene, {
          deck,
          slide: deck.slides[0],
          playback: true,
          playMedia: false,
          presentationStep: 1,
        }),
      ),
    );
    expect(host.querySelector("video,foreignObject")).toBeNull();
    expect(host.textContent).toContain("Video");
  });

  it("converts cropped SVG panels to real clipped PDF paths without rasterization", async () => {
    const { deck } = croppedDeck();
    const source = (await pdfBytes(await exportDeckPdf(deck))).toString(
      "latin1",
    );
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
    const graphics = streams.find((stream) => /\nW\*?\n/.test(stream));
    expect(graphics).toBeDefined();
    expect(graphics).toMatch(/\n[\d.\- ]+ l\n/);
    expect(graphics).toMatch(/\nf\n/);
    expect(graphics).toContain("/GS1 gs");
  });
});
