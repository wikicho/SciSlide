import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
// @ts-expect-error The installed jsdom runtime does not ship TypeScript declarations.
import { JSDOM } from "jsdom";
import { jsPDF } from "jspdf";
import { exportDeckPdf, exportSlideSvg } from "../lib/export";
import type { Deck } from "../lib/model";
import { firstFontFamily, TEXT_FONT_WEIGHTS } from "../lib/text-fonts";

export interface HeadlessRenderOptions {
  /** Directory containing the six bundled Inter and Nanum Gothic TTF files. */
  fontsDir: string;
}

interface TrueTypeMetrics {
  head: { unitsPerEm: number };
  characterToGlyph: (point: number) => number;
  glyf: {
    glyphFor: (id: number) => {
      xMin: number;
      yMin: number;
      xMax: number;
      yMax: number;
    } | null;
  };
}

type HeadlessWindow = Window & typeof globalThis;
let initialization: Promise<void> | undefined;
let fontDirectory: string | undefined;
let standardAliasesInstalled = false;

function installStandardFontAliases() {
  if (standardAliasesInstalled) return;
  standardAliasesInstalled = true;
  // The converter sets fonts on passive image/shape contexts as well as text.
  // Their inherited numeric weight can reach a standard-family context before
  // any text is drawn. Alias that state to existing base-font IDs; actual text
  // still goes through the shared exporter's supported-family/weight checks.
  jsPDF.API.events.push([
    "addFonts",
    ({
      dictionary,
    }: {
      dictionary: Record<string, Record<string, string>>;
    }) => {
      for (const family of ["times", "helvetica", "courier"]) {
        const styles = dictionary[family];
        styles["500normal"] ??= styles.normal;
        styles["600normal"] ??= styles.bold;
      }
    },
  ]);
}

function fontStyle(weight: number): string {
  return weight === 400
    ? "normal"
    : weight === 700
      ? "bold"
      : `${weight}normal`;
}

function fontRequest(css: string) {
  const match = /([\d.]+)px\s+(.+)$/.exec(css);
  if (!match) throw new Error(`Cannot measure the font declaration: ${css}`);
  const prefix = css.slice(0, match.index);
  const family = firstFontFamily(match[2]);
  const weight = /\bbold\b/.test(prefix)
    ? 700
    : Number(prefix.match(/\b[1-9]00\b/)?.[0] ?? 400);
  return { family, weight, size: Number(match[1]) };
}

function measurementFont(family: string, weight: number) {
  const generic = family.toLowerCase();
  if (generic === "inter" || generic === "nanum gothic")
    return {
      family: generic === "inter" ? "Inter" : "Nanum Gothic",
      style: fontStyle(
        generic === "nanum gothic" ? (weight >= 600 ? 700 : 400) : weight,
      ),
      bundled: true,
    };
  if (["serif", "times", "times new roman"].includes(generic))
    return {
      family: "times",
      style: weight >= 600 ? "bold" : "normal",
      bundled: false,
    };
  if (["monospace", "courier", "courier new"].includes(generic))
    return {
      family: "courier",
      style: weight >= 600 ? "bold" : "normal",
      bundled: false,
    };
  if (["sans-serif", "arial", "helvetica"].includes(generic))
    return {
      family: "helvetica",
      style: weight >= 600 ? "bold" : "normal",
      bundled: false,
    };
  throw new Error(
    `Headless text measurement needs a bundled font (Inter or Nanum Gothic) or a standard serif, sans-serif, or monospace family; “${family}” is unavailable.`,
  );
}

function textMeasurement(pdf: jsPDF, text: string, css: string): TextMetrics {
  const request = fontRequest(css);
  const selected = measurementFont(request.family, request.weight);
  pdf.setFont(selected.family, selected.style);
  pdf.setFontSize(request.size * 0.75);
  const width = pdf.getTextWidth(text);
  let ascent = request.size * 0.7;
  let descent = request.size * 0.2;
  if (selected.bundled) {
    const metadata = pdf.getFont().metadata as TrueTypeMetrics;
    const scale = request.size / metadata.head.unitsPerEm;
    ascent = 0;
    descent = 0;
    for (const character of text) {
      const point = character.codePointAt(0)!;
      const glyph = metadata.characterToGlyph(point);
      if (!glyph && !/\s/u.test(character))
        throw new Error(
          `The bundled ${request.family} font has no glyph for “${character}”. Use an inline equation for mathematical symbols or a supported text font.`,
        );
      const bounds = metadata.glyf.glyphFor(glyph);
      if (bounds) {
        ascent = Math.max(ascent, bounds.yMax * scale);
        descent = Math.max(descent, -bounds.yMin * scale);
      }
    }
  }
  return {
    width,
    actualBoundingBoxAscent: ascent,
    actualBoundingBoxDescent: descent,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: width,
    fontBoundingBoxAscent: ascent,
    fontBoundingBoxDescent: descent,
  } as TextMetrics;
}

function installMeasurements(window: HeadlessWindow, pdf: jsPDF) {
  const contexts = new WeakMap<HTMLCanvasElement, object>();
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    value(this: HTMLCanvasElement, kind: string) {
      if (kind !== "2d") return null;
      let context = contexts.get(this);
      if (!context) {
        context = {
          font: "10px sans-serif",
          measureText(this: { font: string }, value: string) {
            return textMeasurement(pdf, value, this.font);
          },
        };
        contexts.set(this, context);
      }
      return context;
    },
  });
  Object.defineProperty(window.SVGElement.prototype, "getBBox", {
    value(this: SVGElement) {
      if (!["text", "tspan"].includes(this.localName))
        throw new Error(
          "Headless SVG geometry measurement supports text only.",
        );
      const computed = window.getComputedStyle(this);
      const family =
        computed.fontFamily || this.getAttribute("font-family") || "Inter";
      const size =
        computed.fontSize || this.getAttribute("font-size") || "16px";
      const weight =
        computed.fontWeight || this.getAttribute("font-weight") || "400";
      const metrics = textMeasurement(
        pdf,
        this.textContent ?? "",
        `${weight} ${Number.parseFloat(size)}px ${family}`,
      );
      return {
        x: 0,
        y: -metrics.actualBoundingBoxAscent,
        width: metrics.width,
        height:
          metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
      };
    },
  });
}

function imageBytes(source: string) {
  const match =
    /^data:(image\/(?:png|jpeg|svg\+xml))(?:;charset=[\w-]+)?(;base64)?,([\s\S]+)$/i.exec(
      source,
    );
  if (!match)
    throw new Error(
      "Headless image rendering only accepts embedded PNG, JPEG, or SVG data URLs.",
    );
  return {
    mime: match[1].toLowerCase(),
    bytes: match[2]
      ? Buffer.from(match[3], "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8"),
  };
}

function imageDimensions(source: string, window: HeadlessWindow, pdf: jsPDF) {
  const { mime, bytes } = imageBytes(source);
  if (mime !== "image/svg+xml") {
    if (
      mime === "image/png" &&
      bytes.length >= 24 &&
      bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 100_000_000
    )
      throw new Error(
        "The embedded PNG exceeds the 100-megapixel image limit.",
      );
    const dimensions = pdf.getImageProperties(new Uint8Array(bytes));
    if (dimensions.fileType !== (mime === "image/png" ? "PNG" : "JPEG"))
      throw new Error("The image format does not match its embedded data URL.");
    return { width: dimensions.width, height: dimensions.height };
  }
  const parsed = new window.DOMParser().parseFromString(
    bytes.toString("utf8"),
    "image/svg+xml",
  );
  const svg = parsed.documentElement;
  if (svg.localName !== "svg" || parsed.querySelector("parsererror"))
    throw new Error("The embedded SVG image is invalid.");
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    if (
      ["script", "foreignobject", "iframe"].includes(
        node.localName.toLowerCase(),
      )
    )
      throw new Error("Embedded SVG images must contain passive graphics.");
    for (const attribute of [...node.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on"))
        throw new Error("Embedded SVG images cannot contain event handlers.");
      if (
        attribute.localName === "href" &&
        attribute.value &&
        !attribute.value.startsWith("#")
      )
        imageBytes(attribute.value);
    }
    const styles =
      [...node.attributes].map((attribute) => attribute.value).join(" ") +
      (node.localName === "style" ? (node.textContent ?? "") : "");
    if (/@import\b|javascript:|expression\s*\(/i.test(styles))
      throw new Error(
        "Embedded SVG images cannot contain external or active styles.",
      );
    for (const match of styles.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi))
      if (!match[1].startsWith("#")) imageBytes(match[1]);
  }
  const viewBox = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  return {
    width:
      Number.parseFloat(svg.getAttribute("width") ?? "") || viewBox?.[2] || 300,
    height:
      Number.parseFloat(svg.getAttribute("height") ?? "") ||
      viewBox?.[3] ||
      150,
  };
}

function installImage(window: HeadlessWindow, pdf: jsPDF) {
  class EmbeddedImage {
    onload: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    width = 0;
    height = 0;
    private source = "";
    get src() {
      return this.source;
    }
    set src(source: string) {
      this.source = source;
      void Promise.resolve()
        .then(() => {
          const dimensions = imageDimensions(source, window, pdf);
          if (
            !Number.isFinite(dimensions.width) ||
            !Number.isFinite(dimensions.height) ||
            dimensions.width <= 0 ||
            dimensions.height <= 0
          )
            throw new Error("The embedded image has no valid dimensions.");
          if (this.source !== source) return;
          this.width = this.naturalWidth = dimensions.width;
          this.height = this.naturalHeight = dimensions.height;
          this.onload?.();
        })
        .catch((failure) => {
          if (this.source === source) this.onerror?.(failure);
        });
    }
  }
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    writable: true,
    value: EmbeddedImage,
  });
  Object.defineProperty(window, "Image", {
    configurable: true,
    writable: true,
    value: EmbeddedImage,
  });
}

async function prepareHeadlessDom(fontsDir: string) {
  const files = new Map<string, Buffer>();
  installStandardFontAliases();
  const pdf = new jsPDF({ unit: "px", hotfixes: ["px_scaling"] });
  for (const [family, weights, prefix] of [
    ["Inter", TEXT_FONT_WEIGHTS, "inter"],
    ["Nanum Gothic", [400, 700], "nanum-gothic"],
  ] as const) {
    for (const weight of weights) {
      const filename = `${prefix}-${weight}.ttf`;
      const bytes = await readFile(path.join(fontsDir, filename));
      if (bytes.length < 12 || bytes.readUInt32BE(0) !== 0x00010000)
        throw new Error(`The bundled font ${filename} is not a TrueType font.`);
      files.set(filename, bytes);
      pdf.addFileToVFS(filename, bytes.toString("base64"));
      pdf.addFont(filename, family, fontStyle(weight));
      pdf.setFont(family, fontStyle(weight));
      const metadata = pdf.getFont().metadata as Partial<TrueTypeMetrics>;
      if (
        !metadata.head?.unitsPerEm ||
        typeof metadata.characterToGlyph !== "function"
      )
        throw new Error(
          `The bundled font ${filename} has invalid glyph metrics.`,
        );
    }
  }
  // No scripts, external resources, browser process, DISPLAY, or canvas binary.
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://scislide-headless.invalid/",
  });
  const window = dom.window as HeadlessWindow;
  for (const name of [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLCanvasElement",
    "HTMLImageElement",
    "SVGElement",
    "SVGSVGElement",
    "DOMParser",
    "XMLSerializer",
  ] as const)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "window" ? window : window[name],
    });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    writable: true,
    value: window.getComputedStyle.bind(window),
  });
  installMeasurements(window, pdf);
  installImage(window, pdf);
  class FontFaceAdapter {
    async load() {
      return this;
    }
  }
  Object.defineProperty(globalThis, "FontFace", {
    configurable: true,
    writable: true,
    value: FontFaceAdapter,
  });
  Object.defineProperty(window.document, "fonts", {
    value: {
      ready: Promise.resolve(),
      add() {},
      async load(css: string) {
        const request = fontRequest(css);
        measurementFont(request.family, request.weight);
        return [];
      },
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (
        url.origin !== "https://scislide-headless.invalid" ||
        !/^\/fonts\/[^/]+\.ttf$/.test(url.pathname)
      )
        throw new Error(
          "The headless renderer cannot fetch external resources.",
        );
      const file = files.get(url.pathname.slice("/fonts/".length));
      if (!file)
        throw new Error("The requested font is not bundled with SciSlide.");
      return new Response(new Uint8Array(file), { status: 200 });
    },
  });
}

/** Install a passive in-memory DOM before archive sanitization or static exports. */
export async function initializeHeadlessDom({
  fontsDir,
}: HeadlessRenderOptions): Promise<void> {
  const resolved = await realpath(fontsDir);
  if (initialization) {
    if (fontDirectory !== resolved)
      throw new Error(
        "The headless renderer's bundled font directory cannot change within one process.",
      );
    return initialization;
  }
  fontDirectory = resolved;
  initialization = prepareHeadlessDom(resolved);
  try {
    await initialization;
  } catch (failure) {
    initialization = undefined;
    fontDirectory = undefined;
    throw failure;
  }
}

/** Standalone SVG with the editor's static scene, local fonts, and vector math. */
export async function renderAgentSvg(
  deck: Deck,
  slideIndex: number,
  options: HeadlessRenderOptions,
): Promise<string> {
  if (
    !Number.isInteger(slideIndex) ||
    slideIndex < 0 ||
    slideIndex >= deck.slides.length
  )
    throw new Error("Choose a valid zero-based slide index for SVG export.");
  await initializeHeadlessDom(options);
  const svg = await exportSlideSvg(deck, deck.slides[slideIndex]);
  return svg.text();
}

/** Genuine vector PDF conversion; unsupported figures/fonts fail as in the editor. */
export async function renderAgentPdf(
  deck: Deck,
  options: HeadlessRenderOptions,
): Promise<Uint8Array> {
  await initializeHeadlessDom(options);
  const pdf = await exportDeckPdf(deck);
  return new Uint8Array(await pdf.arrayBuffer());
}
