import JSZip from "jszip";
import DOMPurify from "dompurify";
import {
  MAX_VIDEO_BYTES,
  newId,
  SUPPORTED_VIDEO_MIMES,
  validateDeck,
} from "./model";
import type {
  Asset,
  Deck,
  EquationObject,
  LocalTexRender,
  Slide,
  SlideObject,
} from "./model";
import { DEFAULT_TEX_PACKAGES, MATH_PROFILE_REVISION } from "./equations";
import {
  MAX_LOCAL_SVG_BYTES,
  sanitizeLocalEquationSvg,
} from "./local-equation-svg";

export const MAX_FIGURE_BYTES = 20 * 1024 * 1024;
export { MAX_VIDEO_BYTES } from "./model";
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const RECOVERY_KEY = "scislide.recovery.v1";

/** Versions match the committed dependency lockfile. SVG glyph paths are produced locally. */
export const RENDER_PROFILES = {
  engine: {
    name: "MathJax",
    package: "@mathjax/src",
    version: "4.1.3",
    input: "TeX",
    output: "SVG",
    revision: MATH_PROFILE_REVISION,
    options: {
      fontCache: "none",
      packages: DEFAULT_TEX_PACKAGES,
      optInPackages: ["physics"],
      packageScope: "equation",
      missingGlyphFallback: "mathjax-stix2",
    },
  },
  fonts: [
    {
      id: "mathjax-stix2",
      package: "@mathjax/mathjax-stix2-font",
      version: "4.1.3",
    },
    {
      id: "mathjax-fira",
      package: "@mathjax/mathjax-fira-font",
      version: "4.1.3",
    },
    {
      id: "mathjax-modern",
      package: "@mathjax/mathjax-modern-font",
      version: "4.1.3",
    },
  ],
  localLatex: {
    output: "SVG",
    cache: "indexed-vector-resource",
    compileOnImport: false,
  },
} as const;

interface Resource {
  path: string;
  mime: string;
  size: number;
  sha256: string;
}

interface Manifest {
  formatVersion: "0.1.0" | "0.2.0" | "0.3.0";
  document: "document.json";
  producer: { name: string; version: string };
  renderingProfiles: typeof RENDER_PROFILES;
  resources: Resource[];
}

type ArchivedAsset = Omit<Asset, "dataUrl"> & { path: string };
type ArchivedRender = Omit<LocalTexRender, "svg"> & { path: string };
type ArchivedEquation = Omit<EquationObject, "localTex"> & {
  localTex?: Omit<NonNullable<EquationObject["localTex"]>, "render"> & {
    render?: ArchivedRender;
  };
};
type ArchivedDeck = Omit<Deck, "assets" | "slides"> & {
  assets: ArchivedAsset[];
  slides: Array<
    Omit<Slide, "objects"> & {
      objects: Array<Exclude<SlideObject, EquationObject> | ArchivedEquation>;
    }
  >;
};

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

function dataUrlToBytes(dataUrl: string, mime: string): Uint8Array {
  const match = /^data:([^;,]+)([^,]*),([\s\S]*)$/.exec(dataUrl);
  if (!match || match[1] !== mime)
    throw new Error("Embedded media has an invalid media type.");
  try {
    if (match[2].split(";").includes("base64")) {
      const binary = atob(match[3]);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    return new TextEncoder().encode(decodeURIComponent(match[3]));
  } catch {
    throw new Error("Embedded media could not be decoded.");
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Secure file checks are unavailable. Open SciSlide on localhost or HTTPS.",
    );
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function")
    return new Uint8Array(await file.arrayBuffer());
  // FileReader also covers browsers or test environments without Blob.arrayBuffer.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsArrayBuffer(file);
  });
}

function safePath(path: unknown): asserts path is string {
  if (
    typeof path !== "string" ||
    path.length > 256 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-zA-Z]:/.test(path) ||
    path.split("/").some((part) => part === ".." || part === "." || part === "")
  ) {
    throw new Error("The file contains an unsafe archive path.");
  }
}

function extension(mime: string): string {
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  throw new Error("Unsupported media type.");
}

function resourceLimit(mime: string): number {
  if (
    SUPPORTED_VIDEO_MIMES.includes(
      mime as (typeof SUPPORTED_VIDEO_MIMES)[number],
    )
  )
    return MAX_VIDEO_BYTES;
  if (mime === "application/json") return MAX_DOCUMENT_BYTES;
  if (["image/svg+xml", "image/png", "image/jpeg"].includes(mime))
    return MAX_FIGURE_BYTES;
  throw new Error("The archive contains an unsupported media type.");
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} contains invalid JSON.`);
  }
}

const SVG_STYLE_PROPERTIES = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "word-spacing",
  "clip-path",
  "clip-rule",
  "visibility",
  "display",
  "vector-effect",
  "paint-order",
]);

function stylesheetError(): Error {
  return new Error(
    "This SVG uses unsupported stylesheet features. Re-export it with inline styles or convert text to paths, then import again.",
  );
}

/** Flatten ordinary scientific-plot CSS before removing style tags from untrusted SVG. */
function inlineSvgStyles(document: Document): void {
  const styles = [...document.querySelectorAll("style")];
  if (!styles.length) return;
  type Winner = { value: string; specificity: number[]; order: number };
  const winners = new Map<Element, Map<string, Winner>>();
  let order = 0;
  const compare = (a: number[], b: number[]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  for (const style of styles) {
    if (
      style.getAttribute("media") ||
      (style.getAttribute("type") && style.getAttribute("type") !== "text/css")
    )
      throw stylesheetError();
    const css = (style.textContent ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (!css) {
      style.remove();
      continue;
    }
    if (
      css.length > 128_000 ||
      /[@\\]|expression\s*\(|javascript\s*:|var\s*\(/i.test(css)
    )
      throw stylesheetError();
    // A deliberately flat CSS subset avoids imports, media queries, font loading, and animation.
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    if (!blocks.length || css.replace(/([^{}]+)\{([^{}]*)\}/g, "").trim())
      throw stylesheetError();
    for (const block of blocks) {
      let rule: CSSStyleRule;
      try {
        const sheet = new CSSStyleSheet();
        sheet.insertRule(block[0], 0);
        rule = sheet.cssRules[0] as CSSStyleRule;
        if (!rule.style || !rule.selectorText) throw stylesheetError();
      } catch {
        throw stylesheetError();
      }
      const declarations: [string, string][] = [];
      for (let i = 0; i < rule.style.length; i++) {
        const property = rule.style[i];
        const value = rule.style.getPropertyValue(property).trim();
        const withoutLocalUrls = value.replace(
          /url\(\s*['"]?#[\w.:-]+['"]?\s*\)/gi,
          "",
        );
        if (
          !SVG_STYLE_PROPERTIES.has(property) ||
          rule.style.getPropertyPriority(property) ||
          /url\s*\(|https?\s*:|\/\//i.test(withoutLocalUrls)
        )
          throw stylesheetError();
        declarations.push([property, value]);
      }
      // A browser may ignore invalid declarations; rejecting them avoids an unnoticed fidelity change.
      for (const declaration of block[2]
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)) {
        const property = declaration
          .slice(0, declaration.indexOf(":"))
          .trim()
          .toLowerCase();
        if (
          !SVG_STYLE_PROPERTIES.has(property) ||
          !declarations.some(([name]) => name === property)
        )
          throw stylesheetError();
      }
      for (const selector of rule.selectorText
        .split(",")
        .map((value) => value.trim())) {
        const tokens = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
        if (
          !tokens.length ||
          tokens.some(
            (token) =>
              !/^(?:\*|[a-zA-Z_][\w-]*)?(?:[.#][a-zA-Z_][\w-]*)*$/.test(token),
          )
        )
          throw stylesheetError();
        const specificity = [
          (selector.match(/#[\w-]+/g) ?? []).length,
          (selector.match(/\.[\w-]+/g) ?? []).length,
          tokens.filter((token) => /^[a-zA-Z_]/.test(token)).length,
        ];
        let matches: NodeListOf<Element>;
        try {
          matches = document.querySelectorAll(selector);
        } catch {
          throw stylesheetError();
        }
        for (const element of matches) {
          if (element.namespaceURI !== "http://www.w3.org/2000/svg") continue;
          const values = winners.get(element) ?? new Map<string, Winner>();
          winners.set(element, values);
          for (const [property, value] of declarations) {
            const previous = values.get(property);
            if (
              !previous ||
              compare(specificity, previous.specificity) > 0 ||
              (compare(specificity, previous.specificity) === 0 &&
                order >= previous.order)
            )
              values.set(property, { value, specificity, order });
          }
        }
      }
      order++;
    }
    style.remove();
  }
  // Presentation attributes preserve normal inline-style precedence and inheritance.
  for (const [element, declarations] of winners)
    for (const [property, declaration] of declarations)
      element.setAttribute(property, declaration.value);
}

/** Removes active content and references that could fetch resources or execute code. */
export function sanitizeSvg(source: string): string {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    parsed.querySelector("parsererror") ||
    parsed.documentElement.localName !== "svg"
  )
    throw new Error("The SVG file is not a valid SVG image.");
  inlineSvgStyles(parsed);
  const clean = DOMPurify.sanitize(
    new XMLSerializer().serializeToString(parsed.documentElement),
    {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ["use"],
      ADD_ATTR: ["href", "xlink:href"],
      FORBID_TAGS: [
        "script",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "audio",
        "video",
        "style",
        "animate",
        "animateTransform",
        "animateMotion",
        "set",
      ],
      FORBID_ATTR: ["onload", "onerror", "onclick"],
      ALLOW_UNKNOWN_PROTOCOLS: false,
    },
  );
  const document = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg")
    throw new Error("The SVG file contains no usable image.");
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const key = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (key === "xmlns" || key.startsWith("xmlns:")) continue;
      if (key.startsWith("on") || key === "xml:base") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (key === "href" || key === "xlink:href" || key === "src") {
        const safeEmbeddedImage =
          element.localName === "image" &&
          /^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=\s]+$/.test(value);
        if (!/^#[a-zA-Z0-9_.:-]+$/.test(value) && !safeEmbeddedImage)
          element.removeAttribute(attribute.name);
        if (safeEmbeddedImage) continue;
      }
      // Escaped CSS URLs are excluded too; local clipping/gradient references are retained.
      if (
        value.includes("\\") ||
        /@import|expression\s*\(|javascript\s*:|https?\s*:|\/\//i.test(value)
      )
        element.removeAttribute(attribute.name);
      if (/url\s*\(/i.test(value)) {
        const rest = value.replace(/url\(\s*['"]?#[\w.:-]+['"]?\s*\)/gi, "");
        if (/url\s*\(/i.test(rest)) element.removeAttribute(attribute.name);
      }
    }
  }
  root.setAttributeNS(
    "http://www.w3.org/2000/xmlns/",
    "xmlns",
    "http://www.w3.org/2000/svg",
  );
  return new XMLSerializer().serializeToString(root);
}

function svgDimensions(source: string): { width: number; height: number } {
  const root = new DOMParser().parseFromString(
    source,
    "image/svg+xml",
  ).documentElement;
  const viewBox = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const widthAttribute = root.getAttribute("width");
  const heightAttribute = root.getAttribute("height");
  const width =
    widthAttribute && /^\d+(\.\d+)?(px)?$/.test(widthAttribute)
      ? Number.parseFloat(widthAttribute)
      : viewBox?.[2];
  const height =
    heightAttribute && /^\d+(\.\d+)?(px)?$/.test(heightAttribute)
      ? Number.parseFloat(heightAttribute)
      : viewBox?.[3];
  if (
    !width ||
    !height ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width > 100_000 ||
    height > 100_000 ||
    width < 0 ||
    height < 0
  )
    throw new Error("SVG needs a valid width and height or a viewBox.");
  return { width, height };
}

function detectedRasterMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  return null;
}

/** Container signatures are checked independently of the filename and declared MIME. */
function detectedVideoMime(
  bytes: Uint8Array,
): "video/mp4" | "video/webm" | null {
  if (
    bytes.length >= 16 &&
    new TextDecoder().decode(bytes.subarray(4, 8)) === "ftyp"
  ) {
    const boxSize = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0);
    const brand = new TextDecoder().decode(bytes.subarray(8, 12));
    if (
      boxSize >= 16 &&
      boxSize <= bytes.length &&
      [
        "isom",
        "iso2",
        "iso3",
        "iso4",
        "iso5",
        "iso6",
        "mp41",
        "mp42",
        "avc1",
        "dash",
        "M4V ",
        "MSNV",
      ].includes(brand)
    )
      return "video/mp4";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3 &&
    new TextDecoder().decode(bytes.subarray(4, 4096)).includes("webm")
  )
    return "video/webm";
  return null;
}

function videoDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      try {
        video.load();
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const timeout = window.setTimeout(
      () =>
        fail(
          "Video metadata timed out. Try an MP4 (H.264) or WebM (VP8/VP9) supported by this app.",
        ),
      15_000,
    );
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < 1 ||
        height < 1 ||
        width > 100_000 ||
        height > 100_000 ||
        width * height > 100_000_000
      ) {
        fail(
          "The video has no usable picture or exceeds the 100-megapixel limit.",
        );
        return;
      }
      cleanup();
      resolve({ width, height });
    };
    video.onerror = () =>
      fail(
        "This video codec cannot be decoded by this app. Try MP4 with H.264 or WebM with VP8/VP9.",
      );
    video.src = url;
  });
}

/** Videos stay inside the portable deck; imports never reference remote media. */
export async function importVideo(file: File): Promise<Asset> {
  if (!file.size || file.size > MAX_VIDEO_BYTES)
    throw new Error("Choose a video smaller than 40 MB.");
  const bytes = await readBytes(file);
  const mime = detectedVideoMime(bytes);
  if (!mime)
    throw new Error(
      "Choose a valid MP4 or WebM video. Other video containers are not supported.",
    );
  if (
    file.type &&
    file.type !== "application/octet-stream" &&
    file.type !== mime
  )
    throw new Error(
      "The video content does not match its declared media type.",
    );
  const dimensions = await videoDimensions(file);
  return {
    id: newId(),
    name: file.name,
    mime,
    dataUrl: bytesToDataUrl(bytes, mime),
    ...dimensions,
  };
}

async function rasterDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (
        image.naturalWidth < 1 ||
        image.naturalHeight < 1 ||
        image.naturalWidth * image.naturalHeight > 100_000_000
      )
        reject(
          new Error("The image is empty or exceeds the 100-megapixel limit."),
        );
      else resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () =>
      reject(
        new Error(
          "The image could not be decoded. Use a valid PNG, JPEG, or SVG.",
        ),
      );
    image.src = dataUrl;
  });
}

export async function importFigure(file: File): Promise<Asset> {
  if (!file.size || file.size > MAX_FIGURE_BYTES)
    throw new Error("Choose a figure smaller than 20 MB.");
  let bytes = await readBytes(file);
  const rasterMime = detectedRasterMime(bytes);
  let mime: string;
  let dimensions: { width: number; height: number };
  if (rasterMime) {
    mime = rasterMime;
    dimensions = await rasterDimensions(bytesToDataUrl(bytes, mime));
  } else {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const sanitized = sanitizeSvg(source);
    bytes = new TextEncoder().encode(sanitized);
    mime = "image/svg+xml";
    dimensions = svgDimensions(sanitized);
  }
  return {
    id: newId(),
    name: file.name,
    mime,
    dataUrl: bytesToDataUrl(bytes, mime),
    ...dimensions,
  };
}

export async function buildDeckArchive(input: Deck): Promise<Blob> {
  const deck = validateDeck(input);
  const zip = new JSZip();
  const resources: Resource[] = [];
  const assets: ArchivedAsset[] = [];
  let totalBytes = 0;
  for (const asset of deck.assets) {
    const bytes = dataUrlToBytes(asset.dataUrl, asset.mime);
    const video = SUPPORTED_VIDEO_MIMES.includes(
      asset.mime as (typeof SUPPORTED_VIDEO_MIMES)[number],
    );
    if (
      !bytes.length ||
      bytes.length > (video ? MAX_VIDEO_BYTES : MAX_FIGURE_BYTES)
    )
      throw new Error(
        video
          ? "A video is empty or exceeds the 40 MB limit."
          : "A figure is empty or exceeds the 20 MB limit.",
      );
    if (video && detectedVideoMime(bytes) !== asset.mime)
      throw new Error("A video does not match its declared file type.");
    totalBytes += bytes.length;
    if (totalBytes > MAX_UNPACKED_BYTES)
      throw new Error("The deck exceeds the 100 MB unpacked limit.");
    const path = `assets/${asset.id}.${extension(asset.mime)}`;
    zip.file(path, bytes);
    resources.push({
      path,
      mime: asset.mime,
      size: bytes.length,
      sha256: await sha256(bytes),
    });
    const { dataUrl: _dataUrl, ...registry } = asset;
    assets.push({ ...registry, path });
  }
  const slides: ArchivedDeck["slides"] = [];
  for (const slide of deck.slides) {
    const objects: ArchivedDeck["slides"][number]["objects"] = [];
    for (const object of slide.objects) {
      if (object.type !== "equation" || !object.localTex?.render) {
        objects.push(
          object as Exclude<SlideObject, EquationObject> | ArchivedEquation,
        );
        continue;
      }
      const { svg, ...render } = object.localTex.render;
      const bytes = new TextEncoder().encode(sanitizeLocalEquationSvg(svg));
      totalBytes += bytes.length;
      if (totalBytes > MAX_UNPACKED_BYTES)
        throw new Error("The deck exceeds the 100 MB unpacked limit.");
      const path = `renders/${object.id}.svg`;
      zip.file(path, bytes);
      resources.push({
        path,
        mime: "image/svg+xml",
        size: bytes.length,
        sha256: await sha256(bytes),
      });
      objects.push({
        ...object,
        localTex: { ...object.localTex, render: { ...render, path } },
      });
    }
    slides.push({ ...slide, objects });
  }
  const document: ArchivedDeck = { ...deck, assets, slides };
  const documentBytes = new TextEncoder().encode(
    JSON.stringify(document, null, 2),
  );
  if (documentBytes.length > MAX_DOCUMENT_BYTES)
    throw new Error("The deck source exceeds the 4 MB limit.");
  totalBytes += documentBytes.length;
  if (totalBytes > MAX_UNPACKED_BYTES)
    throw new Error("The deck exceeds the 100 MB unpacked limit.");
  zip.file("document.json", documentBytes);
  resources.unshift({
    path: "document.json",
    mime: "application/json",
    size: documentBytes.length,
    sha256: await sha256(documentBytes),
  });
  const manifest: Manifest = {
    formatVersion: "0.3.0",
    document: "document.json",
    producer: { name: "SciSlide", version: "0.3.0" },
    renderingProfiles: RENDER_PROFILES,
    resources,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  if (new TextEncoder().encode(manifestText).length > MAX_MANIFEST_BYTES)
    throw new Error("The deck resource index exceeds the 2 MB limit.");
  zip.file("manifest.json", manifestText);
  const archive = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  if (archive.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error("The portable file exceeds the 64 MB limit.");
  return new Blob([new Uint8Array(archive).buffer], {
    type: "application/vnd.scislide+zip",
  });
}

export async function readDeckArchive(file: Blob): Promise<Deck> {
  if (!file.size || file.size > MAX_ARCHIVE_BYTES)
    throw new Error("Choose a .scislide file smaller than 64 MB.");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readBytes(file));
  } catch {
    throw new Error("This is not a readable .scislide ZIP file.");
  }
  const entries = Object.values(zip.files);
  if (entries.length > 12_000)
    throw new Error("The archive contains too many files.");
  let unpackedSize = 0;
  for (const entry of entries) {
    safePath(entry.dir ? entry.name.replace(/\/$/, "") : entry.name);
    const originalName = (entry as unknown as { unsafeOriginalName?: string })
      .unsafeOriginalName;
    if (originalName)
      safePath(entry.dir ? originalName.replace(/\/$/, "") : originalName);
    const size =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    const entryLimit =
      entry.name === "manifest.json"
        ? MAX_MANIFEST_BYTES
        : entry.name === "document.json"
          ? MAX_DOCUMENT_BYTES
          : MAX_VIDEO_BYTES;
    if (size > entryLimit || size < 0 || !Number.isFinite(size))
      throw new Error("The archive contains an oversized resource.");
    unpackedSize += size;
    if (unpackedSize > MAX_UNPACKED_BYTES)
      throw new Error("The archive exceeds the 100 MB unpacked limit.");
  }
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) throw new Error("The SciSlide manifest is missing.");
  const manifestText = await manifestEntry.async("string");
  if (new TextEncoder().encode(manifestText).length > MAX_MANIFEST_BYTES)
    throw new Error("The SciSlide manifest is too large.");
  const candidate = parseJson(manifestText, "The manifest");
  if (!candidate || typeof candidate !== "object")
    throw new Error("The SciSlide manifest is invalid.");
  const manifest = candidate as Partial<Manifest>;
  if (
    !["0.1.0", "0.2.0", "0.3.0"].includes(manifest.formatVersion as string) ||
    manifest.document !== "document.json" ||
    !Array.isArray(manifest.resources) ||
    manifest.resources.length > 10_501
  )
    throw new Error("Unsupported or incomplete SciSlide manifest.");
  const resources = new Map<
    string,
    { resource: Resource; bytes: Uint8Array }
  >();
  for (const resource of manifest.resources) {
    if (!resource || typeof resource !== "object")
      throw new Error("The resource index is invalid.");
    safePath(resource.path);
    if (
      resources.has(resource.path) ||
      !Number.isInteger(resource.size) ||
      resource.size < 1 ||
      resource.size > MAX_VIDEO_BYTES ||
      !/^[a-f0-9]{64}$/.test(resource.sha256) ||
      typeof resource.mime !== "string"
    )
      throw new Error("The resource index is invalid.");
    if (resource.size > resourceLimit(resource.mime))
      throw new Error(
        "The archive contains an oversized resource for its media type.",
      );
    const entry = zip.file(resource.path);
    if (!entry)
      throw new Error(`A packaged resource is missing: ${resource.path}.`);
    const bytes = await entry.async("uint8array");
    if (
      bytes.length !== resource.size ||
      (await sha256(bytes)) !== resource.sha256
    )
      throw new Error(
        `A resource failed its integrity check: ${resource.path}.`,
      );
    resources.set(resource.path, { resource, bytes });
  }
  if (
    entries.some(
      (entry) =>
        !entry.dir &&
        entry.name !== "manifest.json" &&
        !resources.has(entry.name),
    )
  )
    throw new Error(
      "The archive contains files missing from its resource index.",
    );
  const source = resources.get("document.json");
  if (
    !source ||
    source.resource.mime !== "application/json" ||
    source.bytes.length > MAX_DOCUMENT_BYTES
  )
    throw new Error("The deck source is missing or too large.");
  const document = parseJson(
    new TextDecoder().decode(source.bytes),
    "The deck source",
  ) as Partial<ArchivedDeck>;
  if (
    !document ||
    typeof document !== "object" ||
    !Array.isArray(document.assets)
  )
    throw new Error("The deck source has no asset registry.");
  const usedPaths = new Set<string>(["document.json"]);
  const assets = document.assets.map((asset) => {
    if (!asset || typeof asset !== "object")
      throw new Error("The asset registry is invalid.");
    safePath(asset.path);
    if (!asset.path.startsWith("assets/") || usedPaths.has(asset.path))
      throw new Error(
        "The asset registry has invalid or duplicate resource paths.",
      );
    usedPaths.add(asset.path);
    const packaged = resources.get(asset.path);
    if (!packaged || packaged.resource.mime !== asset.mime)
      throw new Error(`Missing or mismatched media asset: ${asset.name}.`);
    let bytes = packaged.bytes;
    if (asset.mime === "image/svg+xml") {
      const safe = sanitizeSvg(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      // The untrusted original is checksum-verified before sanitizing its renderable copy.
      bytes = new TextEncoder().encode(safe);
    } else if (
      SUPPORTED_VIDEO_MIMES.includes(
        asset.mime as (typeof SUPPORTED_VIDEO_MIMES)[number],
      )
    ) {
      if (detectedVideoMime(bytes) !== asset.mime)
        throw new Error("A video does not match its declared file type.");
    } else if (detectedRasterMime(bytes) !== asset.mime) {
      throw new Error("A figure does not match its declared file type.");
    }
    const { path: _path, ...registry } = asset;
    return { ...registry, dataUrl: bytesToDataUrl(bytes, asset.mime) };
  });
  if (manifest.formatVersion !== document.formatVersion)
    throw new Error("The manifest and document format versions do not match.");
  if (!Array.isArray(document.slides))
    throw new Error("The deck source has no slides.");
  const slides = document.slides.map((slide) => {
    if (!slide || !Array.isArray(slide.objects))
      throw new Error("A slide has no objects.");
    return {
      ...slide,
      objects: slide.objects.map((object) => {
        if (object.type !== "equation" || !object.localTex?.render)
          return object;
        const { path, ...render } = object.localTex.render;
        safePath(path);
        if (!path.startsWith("renders/") || usedPaths.has(path))
          throw new Error(
            "The equation render registry has invalid or duplicate resource paths.",
          );
        usedPaths.add(path);
        const packaged = resources.get(path);
        if (
          !packaged ||
          packaged.resource.mime !== "image/svg+xml" ||
          packaged.bytes.length > MAX_LOCAL_SVG_BYTES
        )
          throw new Error(
            "A Local LaTeX render resource is missing, mismatched, or too large.",
          );
        const svg = sanitizeLocalEquationSvg(
          new TextDecoder("utf-8", { fatal: true }).decode(packaged.bytes),
        );
        return {
          ...object,
          localTex: { ...object.localTex, render: { ...render, svg } },
        };
      }),
    };
  });
  return validateDeck({ ...document, assets, slides });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Recovery is browser-local and separate from a user-initiated portable-file save. */
export function saveRecovery(deck: Deck): void {
  localStorage.setItem(
    RECOVERY_KEY,
    JSON.stringify({
      savedAt: new Date().toISOString(),
      deck: validateDeck(deck),
    }),
  );
}

export function loadRecovery(): Deck | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const recovery = JSON.parse(raw) as { deck?: unknown };
    const deck = validateDeck(recovery.deck);
    // Recovery is untrusted too (for example, another app on the same origin).
    deck.assets = deck.assets.map((asset) =>
      asset.mime === "image/svg+xml"
        ? {
            ...asset,
            dataUrl: bytesToDataUrl(
              new TextEncoder().encode(
                sanitizeSvg(
                  new TextDecoder().decode(
                    dataUrlToBytes(asset.dataUrl, asset.mime),
                  ),
                ),
              ),
              asset.mime,
            ),
          }
        : asset,
    );
    return deck;
  } catch {
    return null;
  }
}
