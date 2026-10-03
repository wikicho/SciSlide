import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import type { AnySlideObject, Asset, Deck, Slide } from "./model";
import { renderObjectEquation } from "./equation-renderer";
import { wrapText } from "./layout";
import { resolvePageNumber } from "./model";
import koreanFontLicense from "../../third-party-licenses/nanum-gothic/OFL.txt?raw";
import {
  fontDefinitions,
  loadInterFonts,
  loadKoreanFonts,
  type ExportFontFiles,
  type KoreanFontFiles,
} from "./export-fonts";
import {
  exportTextFontFamily,
  exportTextFontWeight,
  firstFontFamily,
  isKoreanFontFamily,
  KOREAN_FONT_FAMILY,
  nearestKoreanWeight,
  normalizeRenderedText,
  PDF_GENERIC_FONT_FAMILIES,
  TEXT_FONT_WEIGHTS,
  type TextFontWeight,
} from "./text-fonts";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value));
  return element;
}

function fontStyle(weight: TextFontWeight): string {
  return weight === 400
    ? "normal"
    : weight === 700
      ? "bold"
      : `${weight}normal`;
}

function addPdfFonts(pdf: jsPDF, fonts: ExportFontFiles) {
  for (const weight of TEXT_FONT_WEIGHTS) {
    const name = `inter-${weight}.ttf`;
    pdf.addFileToVFS(name, fonts.inter[weight]);
    pdf.addFont(name, "Inter", fontStyle(weight));
  }
  if (fonts.korean) addKoreanPdfFonts(pdf, fonts.korean);
}

function addKoreanPdfFonts(pdf: jsPDF, fonts: KoreanFontFiles) {
  for (const weight of [400, 700] as const) {
    const name = `nanum-gothic-${weight}.ttf`;
    pdf.addFileToVFS(name, fonts[weight]);
    pdf.addFont(name, KOREAN_FONT_FAMILY, fontStyle(weight));
  }
}

function decodeSvg(asset: Asset): string {
  const comma = asset.dataUrl.indexOf(",");
  if (comma < 0)
    throw new Error(`Figure “${asset.name}” has an invalid data URL.`);
  const header = asset.dataUrl.slice(0, comma);
  const body = asset.dataUrl.slice(comma + 1);
  try {
    return /;base64$/i.test(header)
      ? new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(body), (character) => character.charCodeAt(0)),
        )
      : decodeURIComponent(body);
  } catch {
    throw new Error(`Figure “${asset.name}” cannot be decoded as SVG.`);
  }
}

function parseSvg(source: string, label: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    parsed.querySelector("parsererror") ||
    parsed.documentElement.localName !== "svg"
  ) {
    throw new Error(`${label} is not valid SVG.`);
  }
  return document.importNode(
    parsed.documentElement,
    true,
  ) as unknown as SVGSVGElement;
}

/** Exported SVGs never depend on remote files or execute active SVG content. */
function verifySelfContained(svg: SVGSVGElement, label: string) {
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    const tag = node.localName.toLowerCase();
    if (tag === "style") {
      throw new Error(
        `${label} uses a stylesheet. Inline its SVG styles before importing so they stay isolated from the slide.`,
      );
    }
    if (
      [
        "script",
        "foreignobject",
        "iframe",
        "animate",
        "animatetransform",
        "set",
      ].includes(tag)
    ) {
      throw new Error(
        `${label} contains unsupported active SVG content (${node.localName}).`,
      );
    }
    for (const attribute of [...node.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on"))
        throw new Error(`${label} contains an SVG event handler.`);
      if (
        attribute.localName === "href" &&
        attribute.value &&
        !attribute.value.startsWith("#") &&
        !/^data:image\/(?:png|jpeg|svg\+xml)[;,]/i.test(attribute.value)
      ) {
        throw new Error(
          `${label} links to an external resource. Embed its images before exporting.`,
        );
      }
      verifyCssReferences(attribute.value, label);
    }
  }
}

function verifyCssReferences(css: string, label: string) {
  if (/@import\b|javascript:|expression\s*\(/i.test(css))
    throw new Error(`${label} contains an external or active style.`);
  for (const match of css.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi)) {
    if (
      !match[1].startsWith("#") &&
      !/^data:(?:image\/|font\/)/i.test(match[1])
    ) {
      throw new Error(
        `${label} uses an external SVG resource. Embed it before exporting.`,
      );
    }
  }
}

/** Different figures may use the same gradient/clip IDs in one exported slide. */
function prefixIds(svg: SVGSVGElement, prefix: string) {
  const ids = new Map<string, string>();
  for (const node of [svg, ...svg.querySelectorAll("[id]")]) {
    const id = node.getAttribute("id");
    if (id) ids.set(id, `${prefix}-${id}`);
  }
  const rewrite = (value: string) => {
    let result = value.replace(
      /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g,
      (original, _quote: string, id: string) =>
        ids.has(id) ? `url(#${ids.get(id)})` : original,
    );
    for (const [id, replacement] of ids) {
      if (result === `#${id}`) result = `#${replacement}`;
    }
    return result;
  };
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    const id = node.getAttribute("id");
    if (id && ids.has(id)) node.setAttribute("id", ids.get(id)!);
    for (const attribute of [...node.attributes]) {
      if (attribute.name !== "id") attribute.value = rewrite(attribute.value);
    }
    if (node.localName === "style") {
      let css = rewrite(node.textContent ?? "");
      for (const [id, replacement] of ids) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        css = css.replace(
          new RegExp(`#${escaped}(?=[\\s>+~.:,\\[\\]{}]|$)`, "g"),
          `#${replacement}`,
        );
      }
      node.textContent = css;
    }
  }
}

async function verifyImage(dataUrl: string, label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      image.naturalWidth && image.naturalHeight
        ? resolve()
        : reject(new Error(`${label} has no visible image content.`));
    image.onerror = () =>
      reject(
        new Error(
          `${label} could not be decoded. Replace the figure before exporting.`,
        ),
      );
    image.src = dataUrl;
  });
}

async function objectSvg(
  deck: Deck,
  object: AnySlideObject,
  prefix: string,
): Promise<SVGGElement> {
  const t = object.transform;
  let width = t.width;
  let height = t.height;
  const group = svgElement("g", { opacity: object.opacity });
  const title = svgElement("title");
  title.textContent = object.name;
  group.append(title);
  if (object.type === "text") {
    const renderedText = normalizeRenderedText(object.text);
    const family = exportTextFontFamily(renderedText, object.fontFamily);
    const weight = exportTextFontWeight(
      renderedText,
      object.fontFamily,
      object.fontWeight,
    );
    if (isKoreanFontFamily(family)) await loadKoreanFonts();
    const x =
      object.align === "center"
        ? width / 2
        : object.align === "right"
          ? width
          : 0;
    const text = svgElement("text", {
      fill: object.color,
      "font-family": family,
      "font-size": object.fontSize,
      "font-weight": weight,
      "font-style": "normal",
      "text-anchor":
        object.align === "center"
          ? "middle"
          : object.align === "right"
            ? "end"
            : "start",
    });
    wrapText(renderedText, width, object.fontSize, family, weight).forEach(
      (line, index) => {
        const span = svgElement("tspan", {
          x,
          y: object.fontSize + index * object.fontSize * 1.3,
        });
        span.textContent = line || " ";
        text.append(span);
      },
    );
    group.append(text);
  } else if (object.type === "shape") {
    const attributes = {
      fill: object.fill,
      stroke: object.stroke,
      "stroke-width": object.strokeWidth,
    };
    group.append(
      object.shape === "ellipse"
        ? svgElement("ellipse", {
            ...attributes,
            cx: width / 2,
            cy: height / 2,
            rx: width / 2,
            ry: height / 2,
          })
        : svgElement("rect", { ...attributes, width, height, rx: 12 }),
    );
  } else if (object.type === "equation") {
    let equation;
    try {
      equation = await renderObjectEquation(object, deck);
    } catch (error) {
      throw new Error(
        `Equation “${object.name}” cannot be exported: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    width = equation.width;
    height = equation.height;
    const nested = parseSvg(equation.svg, `Equation “${object.name}”`);
    prefixIds(nested, prefix);
    group.append(nested);
  } else if (object.type === "video") {
    const asset = deck.assets.find(
      (candidate) => candidate.id === object.assetId,
    );
    if (!asset || !["video/mp4", "video/webm"].includes(asset.mime))
      throw new Error(
        `Video “${object.name}” is missing its supported media asset.`,
      );
    // Static exports intentionally carry a passive frame, never playable media.
    const size = Math.max(4, Math.min(width, height) * 0.18);
    group.append(
      svgElement("rect", { width, height, rx: 12, fill: "#172033" }),
    );
    group.append(
      svgElement("path", {
        d: `M ${width / 2 - size / 3} ${height / 2 - size / 2} L ${width / 2 + size / 2} ${height / 2} L ${width / 2 - size / 3} ${height / 2 + size / 2} Z`,
        fill: "#e2e8f0",
      }),
    );
    const caption = svgElement("text", {
      x: width / 2,
      y: height * 0.82,
      "text-anchor": "middle",
      fill: "#cbd5e1",
      "font-family": "Inter",
      "font-size": Math.min(22, width / 18, height / 10),
    });
    caption.textContent = "Video (presentation only)";
    group.append(caption);
  } else {
    const asset = deck.assets.find(
      (candidate) => candidate.id === object.assetId,
    );
    if (!asset)
      throw new Error(`Figure “${object.name}” is missing its asset.`);
    const label = `Figure “${asset.name}”`;
    if (asset.mime === "image/svg+xml") {
      const nested = parseSvg(decodeSvg(asset), label);
      verifySelfContained(nested, label);
      prefixIds(nested, prefix);
      // An SVG used as an image has its own default styles. Keep those defaults
      // when inlining it, rather than inheriting the slide's typography/paint.
      if (!nested.hasAttribute("font-family") && !nested.style.fontFamily)
        nested.setAttribute("font-family", "serif");
      if (!nested.hasAttribute("fill") && !nested.style.fill)
        nested.setAttribute("fill", "#000000");
      nested.setAttribute("x", "0");
      nested.setAttribute("y", "0");
      if (!nested.hasAttribute("viewBox"))
        nested.setAttribute("viewBox", `0 0 ${asset.width} ${asset.height}`);
      nested.setAttribute("width", String(width));
      nested.setAttribute("height", String(height));
      nested.setAttribute("preserveAspectRatio", "xMidYMid meet");
      for (const image of nested.querySelectorAll("image")) {
        const href =
          image.getAttribute("href") ??
          image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (href && !href.startsWith("#")) await verifyImage(href, label);
      }
      group.append(nested);
    } else if (asset.mime === "image/png" || asset.mime === "image/jpeg") {
      await verifyImage(asset.dataUrl, label);
      const image = svgElement("image", {
        href: asset.dataUrl,
        width,
        height,
        preserveAspectRatio: "xMidYMid meet",
      });
      const description = svgElement("title");
      description.textContent = object.alt;
      image.append(description);
      group.append(image);
    } else {
      throw new Error(`${label} has an unsupported format.`);
    }
  }
  group.setAttribute(
    "transform",
    `translate(${t.x} ${t.y}) rotate(${t.rotation} ${width / 2} ${height / 2})`,
  );
  return group;
}

function directSvgText(node: Element): string {
  return [...node.childNodes]
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.textContent ?? "")
    .join("");
}

function svgFontProperty(
  node: Element,
  property: string,
  fallback: string,
): string {
  const computed = getComputedStyle(node).getPropertyValue(property);
  if (computed && computed !== "inherit") return computed;
  // Presentation attributes are not inherited by jsdom's computed-style
  // implementation; this also makes inherited inline SVG defaults explicit.
  for (
    let ancestor: Element | null = node;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const inline = (ancestor as SVGElement).style?.getPropertyValue(property);
    const value = inline || ancestor.getAttribute(property);
    if (value && value !== "inherit") return value;
  }
  return fallback;
}

function svgFontWeight(node: Element): number {
  const value = svgFontProperty(node, "font-weight", "400");
  return value === "bold"
    ? 700
    : value === "normal"
      ? 400
      : Number(value) || 400;
}

/** Snapshot styles first so selecting a parent run does not alter its children. */
async function normalizeSvgTextFonts(svg: SVGSVGElement): Promise<boolean> {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none;opacity:0";
  document.body.append(host);
  host.append(svg);
  try {
    const runs = [...svg.querySelectorAll("text,tspan")]
      .map((node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent)
            child.textContent = normalizeRenderedText(child.textContent);
        }
        const text = directSvgText(node);
        const requestedFamily = firstFontFamily(
          svgFontProperty(node, "font-family", "serif"),
        );
        const family = firstFontFamily(
          exportTextFontFamily(text, requestedFamily),
        );
        const weight = svgFontWeight(node);
        return { node: node as SVGElement, text, family, weight };
      })
      .filter((run) => run.text.trim());
    const needsKorean = runs.some((run) => isKoreanFontFamily(run.family));
    if (needsKorean) await loadKoreanFonts();
    for (const { node, family, weight } of runs) {
      const resolvedWeight = isKoreanFontFamily(family)
        ? nearestKoreanWeight(weight)
        : weight;
      // Inline styles take precedence over imported presentation attributes.
      // Keep Latin child runs in their original family if a Korean parent was
      // changed, and give svg2pdf exactly the same static master as the browser.
      node.style.setProperty("font-family", family);
      node.style.setProperty("font-weight", String(resolvedWeight));
      node.setAttribute("font-family", family);
      node.setAttribute("font-weight", String(resolvedWeight));
    }
    return needsKorean;
  } finally {
    svg.remove();
    host.remove();
  }
}

/** Shared static export scene: all build steps, page numbering, passive media frames. */
export async function renderSlideSvg(
  deck: Deck,
  slide: Slide,
  index: number,
  fonts?: ExportFontFiles,
): Promise<SVGSVGElement> {
  await document.fonts.ready;
  const { width, height } = deck.slideSize;
  const svg = svgElement("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    overflow: "hidden",
    "font-family": deck.theme.fontFamily,
    "font-size": 16,
    "font-weight": 400,
  });
  const title = svgElement("title");
  title.textContent = slide.title;
  svg.append(title);
  svg.append(svgElement("rect", { width, height, fill: slide.background }));
  const objects = await Promise.all(
    slide.objects
      .filter((object) => object.visible && object.opacity > 0)
      .map((object, i) =>
        objectSvg(deck, object, `slide-${index}-object-${i}`),
      ),
  );
  svg.append(...objects);
  const pageNumber = resolvePageNumber(deck, index);
  if (pageNumber) {
    const number = svgElement("text", {
      x: pageNumber.x,
      y: pageNumber.y,
      "text-anchor": pageNumber.anchor,
      fill: pageNumber.color,
      "font-family": deck.theme.fontFamily,
      "font-size": pageNumber.fontSize,
      "font-weight": 400,
      "data-page-number": "true",
    });
    number.textContent = pageNumber.text;
    svg.append(number);
  }
  const needsKorean = await normalizeSvgTextFonts(svg);
  if (fonts) {
    const embeddedFonts: ExportFontFiles = {
      ...fonts,
      korean: needsKorean ? await loadKoreanFonts() : undefined,
    };
    const style = svgElement("style");
    style.textContent = fontDefinitions(embeddedFonts);
    svg.insertBefore(style, svg.children[1]);
    if (embeddedFonts.korean) {
      const license = svgElement("metadata", {
        "data-font-license": KOREAN_FONT_FAMILY,
      });
      license.textContent = koreanFontLicense;
      svg.insertBefore(license, style);
    }
  }
  return svg;
}

function verifyPdfContent(svg: SVGSVGElement, pdf: jsPDF, slide: Slide) {
  const unsupported = svg.querySelector(
    "filter,mask,foreignObject,textPath,switch,animate,animateTransform,set",
  );
  if (unsupported)
    throw new Error(
      `Slide “${slide.title}” uses SVG ${unsupported.localName}, which this PDF exporter cannot preserve. Export SVG or simplify that figure.`,
    );
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    if (
      node.hasAttribute("filter") ||
      node.hasAttribute("mask") ||
      /(?:filter|mask|mix-blend-mode)\s*:/i.test(
        node.getAttribute("style") ?? "",
      ) ||
      (node.localName === "style" &&
        /(?:filter|mask|mix-blend-mode)\s*:/i.test(node.textContent ?? ""))
    ) {
      throw new Error(
        `Slide “${slide.title}” uses an SVG effect this PDF exporter cannot preserve. Export SVG or simplify that figure.`,
      );
    }
  }
  // Computed styles include styles embedded in imported figures. The hidden
  // SVG is attached only during validation/rendering and is always removed.
  for (const node of svg.querySelectorAll("text,tspan")) {
    const text = directSvgText(node);
    if (!text.trim()) continue;
    const family = firstFontFamily(
      svgFontProperty(node, "font-family", "serif"),
    );
    const weight = svgFontWeight(node);
    if (svgFontProperty(node, "font-style", "normal") !== "normal")
      throw new Error(
        `Slide “${slide.title}” contains italic SVG text. Outline that figure's text or export SVG.`,
      );
    let characterMap: Record<number, number> | undefined;
    if (family === "Inter" || isKoreanFontFamily(family)) {
      const korean = isKoreanFontFamily(family);
      const availableWeights = korean ? [400, 700] : TEXT_FONT_WEIGHTS;
      if (!(availableWeights as readonly number[]).includes(weight))
        throw new Error(
          `Slide “${slide.title}” uses text weight ${weight}. PDF export supports Inter 400, 500, 600, and 700, and Nanum Gothic 400 and 700 (500 maps to 400; 600 maps to 700).`,
        );
      pdf.setFont(
        korean ? KOREAN_FONT_FAMILY : "Inter",
        fontStyle(weight as TextFontWeight),
      );
      characterMap = pdf.getFont().metadata?.cmap?.unicode?.codeMap as
        Record<number, number> | undefined;
      if (!characterMap)
        throw new Error(
          `The ${family} font could not be embedded into the PDF.`,
        );
    } else if (
      !(PDF_GENERIC_FONT_FAMILIES as readonly string[]).includes(family)
    ) {
      throw new Error(
        `Slide “${slide.title}” needs the unbundled font “${family}”. Use Inter or Nanum Gothic for slide text, outline the figure's text, or export SVG.`,
      );
    } else if (![400, 700].includes(weight)) {
      throw new Error(
        `Slide “${slide.title}” uses an unsupported SVG font weight. Outline the figure's text or export SVG.`,
      );
    }
    const unsupportedCharacters = new Set<string>();
    for (const character of text) {
      const code = character.codePointAt(0)!;
      if (
        characterMap
          ? !characterMap[code]
          : !(
              (code >= 32 && code <= 255) ||
              "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".includes(character)
            )
      ) {
        if (!/\s/.test(character)) unsupportedCharacters.add(character);
      }
    }
    if (unsupportedCharacters.size) {
      const characters = [...unsupportedCharacters].slice(0, 8).join(" ");
      throw new Error(
        `Slide “${slide.title}” contains text glyphs unavailable in its embedded PDF font “${family}” (${characters}). Nanum Gothic covers modern Korean syllables, but not every Jamo, Hanja, or other script. Use a native equation for mathematical symbols, outline figure text, or export SVG.`,
      );
    }
  }
}

/** Editable Unicode text, embedded Inter/Nanum Gothic fonts and vector equations. */
export async function exportSlideSvg(deck: Deck, slide: Slide): Promise<Blob> {
  const fonts: ExportFontFiles = { inter: await loadInterFonts() };
  const svg = await renderSlideSvg(
    deck,
    slide,
    Math.max(
      0,
      deck.slides.findIndex((candidate) => candidate.id === slide.id),
    ),
    fonts,
  );
  return new Blob([new XMLSerializer().serializeToString(svg)], {
    type: "image/svg+xml;charset=utf-8",
  });
}

/** Render genuine PDF vectors; raster figures remain embedded raster images. */
export async function exportDeckPdf(deck: Deck): Promise<Blob> {
  const fonts: ExportFontFiles = { inter: await loadInterFonts() };
  const { width, height } = deck.slideSize;
  const pdf = new jsPDF({
    unit: "px",
    format: [width, height],
    orientation: width >= height ? "landscape" : "portrait",
    hotfixes: ["px_scaling"],
    compress: true,
  });
  addPdfFonts(pdf, fonts);
  pdf.setProperties({
    title: deck.title,
    creator: "SciSlide",
    subject: "Scientific presentation",
  });
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none;opacity:0";
  document.body.append(host);
  try {
    // Prepare every slide before producing a downloadable document. An invalid
    // equation or missing figure aborts the export with its object/slide name.
    const slides = await Promise.all(
      deck.slides.map((slide, index) => renderSlideSvg(deck, slide, index)),
    );
    if (
      slides.some((svg) =>
        [...svg.querySelectorAll("text,tspan")].some((node) =>
          isKoreanFontFamily(node.getAttribute("font-family") ?? ""),
        ),
      )
    ) {
      addKoreanPdfFonts(pdf, await loadKoreanFonts());
    }
    for (let index = 0; index < slides.length; index++) {
      const svg = slides[index];
      host.append(svg);
      verifyPdfContent(svg, pdf, deck.slides[index]);
      svg.remove();
    }
    for (let index = 0; index < slides.length; index++) {
      if (index)
        pdf.addPage(
          [width, height],
          width >= height ? "landscape" : "portrait",
        );
      const svg = slides[index];
      host.append(svg);
      await svg2pdf(svg, pdf, {
        width,
        height,
        loadExternalStyleSheets: false,
        loadImages: /^data:image\//i,
      });
      svg.remove();
    }
    return pdf.output("blob");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  } finally {
    host.remove();
  }
}
