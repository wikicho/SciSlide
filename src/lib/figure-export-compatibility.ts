import type { Asset } from "./model";
import { inlineSvgStyles } from "./persistence";
import {
  exportTextFontFamily,
  exportTextFontWeight,
  firstFontFamily,
  isKoreanFontFamily,
  PDF_GENERIC_FONT_FAMILIES,
  TEXT_FONT_WEIGHTS,
} from "./text-fonts";

export interface FigureExportDiagnostic {
  code:
    | "pdf-font-format"
    | "pdf-font-style"
    | "pdf-font-weight"
    | "pdf-font-unavailable"
    | "pdf-svg-feature"
    | "external-resource"
    | "active-content";
  formats: Array<"pdf" | "svg" | "pptx">;
  message: string;
}

export const ACTIVE_SVG_TAGS = [
  "script",
  "foreignobject",
  "iframe",
  "animate",
  "animatetransform",
  "set",
];

export function unsupportedPdfSvgElement(svg: Element): Element | null {
  return svg.querySelector(
    "filter,mask,foreignObject,textPath,switch,animate,animateTransform,set",
  );
}

export function hasUnsupportedPdfSvgEffect(svg: Element): boolean {
  return [svg, ...svg.querySelectorAll("*")].some(
    (node) =>
      node.hasAttribute("filter") ||
      node.hasAttribute("mask") ||
      /(?:filter|mask|mix-blend-mode)\s*:/i.test(
        node.getAttribute("style") ?? "",
      ) ||
      (node.localName === "style" &&
        /(?:filter|mask|mix-blend-mode)\s*:/i.test(node.textContent ?? "")),
  );
}

export function isSelfContainedSvgHref(value: string): boolean {
  return (
    !value ||
    value.startsWith("#") ||
    /^data:image\/(?:png|jpeg|svg\+xml)[;,]/i.test(value)
  );
}

export function verifySvgCssReferences(css: string, label: string): void {
  if (/@import\b|javascript:|expression\s*\(/i.test(css))
    throw new Error(`${label} contains an external or active style.`);
  for (const match of css.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi)) {
    if (
      !match[1].startsWith("#") &&
      !/^data:(?:image\/|font\/)/i.test(match[1])
    )
      throw new Error(
        `${label} uses an external SVG resource. Embed it before exporting.`,
      );
  }
}

export interface EmbeddedSvgFontFace {
  family: string;
  format: "ttf" | "otf" | "woff" | "woff2";
  source: string;
  style: string;
  weights: number[];
}

/** Input comes from the importer-reconstructed, embedded-only font rules. */
export function embeddedSvgFontFaces(svg: Element): EmbeddedSvgFontFace[] {
  const faces: EmbeddedSvgFontFace[] = [];
  for (const style of svg.querySelectorAll("style"))
    for (const match of (style.textContent ?? "").matchAll(
      /@font-face\{([^{}]*)\}/g,
    )) {
      const body = match[1];
      const family = /font-family:"([^"]+)"/.exec(body)?.[1];
      const source =
        /src:url\("data:font\/(ttf|otf|woff|woff2);base64,([a-zA-Z0-9+/=]+)"\)/.exec(
          body,
        );
      if (!family || !source) continue;
      const descriptor = /font-weight:([^;]+)/.exec(body)?.[1] ?? "400";
      const range = descriptor
        .split(/\s+/)
        .map((weight) =>
          weight === "normal" ? 400 : weight === "bold" ? 700 : Number(weight),
        );
      faces.push({
        family,
        format: source[1] as EmbeddedSvgFontFace["format"],
        source: source[2],
        style: /font-style:([^;]+)/.exec(body)?.[1] ?? "normal",
        weights:
          range.length === 2
            ? TEXT_FONT_WEIGHTS.filter(
                (weight) => weight >= range[0] && weight <= range[1],
              )
            : range,
      });
    }
  return faces;
}

export function pdfEmbeddedSvgFontWeights(face: EmbeddedSvgFontFace): number[] {
  return face.format === "ttf" && face.style === "normal" ? face.weights : [];
}

function presentation(
  node: Element,
  property: string,
  fallback: string,
): string {
  for (
    let ancestor: Element | null = node;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const value =
      (ancestor as SVGElement).style?.getPropertyValue(property) ||
      ancestor.getAttribute(property);
    if (value && value !== "inherit") return value;
  }
  return fallback;
}

function notDisplayed(node: Element): boolean {
  for (
    let ancestor: Element | null = node;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const display =
      (ancestor as SVGElement).style?.getPropertyValue("display") ||
      ancestor.getAttribute("display");
    const opacity =
      (ancestor as SVGElement).style?.getPropertyValue("opacity") ||
      ancestor.getAttribute("opacity");
    if (
      display === "none" ||
      (opacity !== null &&
        opacity !== undefined &&
        opacity !== "" &&
        Number(opacity) === 0)
    )
      return true;
  }
  return false;
}

interface VisibleSvgText {
  text: string;
  family: string;
  weight: string;
  style: string;
}

function visibleTextPaint(node: Element): boolean {
  const visible = (paint: string, opacity: string) =>
    !["none", "transparent"].includes(paint) && Number(opacity) !== 0;
  return (
    visible(
      presentation(node, "fill", "#000000"),
      presentation(node, "fill-opacity", "1"),
    ) ||
    (visible(
      presentation(node, "stroke", "none"),
      presentation(node, "stroke-opacity", "1"),
    ) &&
      Number.parseFloat(presentation(node, "stroke-width", "1")) !== 0)
  );
}

/** Visit rendered text instances, including local <use>, without following URLs. */
function visibleText(svg: Element): VisibleSvgText[] {
  const nodes: VisibleSvgText[] = [];
  const ids = new Map(
    [...svg.querySelectorAll("[id]")].map((node) => [node.id, node]),
  );
  if (svg.id) ids.set(svg.id, svg);
  const skipped = new Set([
    "defs",
    "symbol",
    "clipPath",
    "mask",
    "pattern",
    "marker",
    "filter",
    "style",
    "title",
    "desc",
    "metadata",
  ]);
  const visit = (
    node: Element,
    references: Set<Element>,
    referenced = false,
  ) => {
    if ((!referenced && skipped.has(node.localName)) || notDisplayed(node))
      return;
    if (node.localName === "use") {
      const href =
        node.getAttribute("href") ??
        node.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      const target = href?.startsWith("#") ? ids.get(href.slice(1)) : undefined;
      if (
        target &&
        !references.has(target) &&
        references.size < 64 &&
        (["text", "tspan", "use"].includes(target.localName) ||
          target.querySelector("text,tspan,use"))
      ) {
        const clone = target.cloneNode(true) as Element;
        const wrapper = node.cloneNode(false) as Element;
        wrapper.append(clone);
        node.parentElement?.append(wrapper);
        try {
          visit(clone, new Set([...references, target]), true);
        } finally {
          wrapper.remove();
        }
      }
      return;
    }
    if (
      (node.localName === "text" || node.localName === "tspan") &&
      visibleTextPaint(node) &&
      !["hidden", "collapse"].includes(
        presentation(node, "visibility", "visible"),
      )
    ) {
      const text = [...node.childNodes]
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent ?? "")
        .join("");
      if (text.trim())
        nodes.push({
          text,
          family: presentation(node, "font-family", "serif"),
          weight: presentation(node, "font-weight", "400"),
          style: presentation(node, "font-style", "normal"),
        });
    }
    for (const child of [...node.children]) visit(child, references);
  };
  visit(svg, new Set());
  return nodes;
}

function svgSource(asset: Asset): string {
  const comma = asset.dataUrl.indexOf(",");
  if (comma < 0)
    throw new Error(`Figure “${asset.name}” has an invalid SVG data URL.`);
  try {
    const header = asset.dataUrl.slice(0, comma),
      body = asset.dataUrl.slice(comma + 1);
    return /;base64$/i.test(header)
      ? new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(body), (character) => character.charCodeAt(0)),
        )
      : decodeURIComponent(body);
  } catch {
    throw new Error(`Figure “${asset.name}” cannot be decoded as SVG.`);
  }
}

/** Static advice only: final PDF preflight still validates real font glyph maps. */
export function getFigureExportDiagnostics(
  asset: Asset,
): FigureExportDiagnostic[] {
  if (asset.mime !== "image/svg+xml") return [];
  const parsed = new DOMParser().parseFromString(
    svgSource(asset),
    "image/svg+xml",
  );
  if (
    parsed.querySelector("parsererror") ||
    parsed.documentElement.localName !== "svg"
  )
    throw new Error(`Figure “${asset.name}” is not valid SVG.`);
  const rules = inlineSvgStyles(parsed);
  const svg = parsed.documentElement;
  if (rules.length) {
    const style = parsed.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = rules.join("\n");
    svg.prepend(style);
  }
  const diagnostics = new Map<
    FigureExportDiagnostic["code"],
    FigureExportDiagnostic
  >();
  const add = (
    code: FigureExportDiagnostic["code"],
    message: string,
    formats: FigureExportDiagnostic["formats"] = ["pdf"],
  ) => diagnostics.set(code, { code, message, formats });
  if (unsupportedPdfSvgElement(svg) || hasUnsupportedPdfSvgEffect(svg))
    add(
      "pdf-svg-feature",
      "PDF cannot preserve an effect in this figure. Simplify the figure, or export SVG/PowerPoint.",
    );
  for (const node of [svg, ...svg.querySelectorAll("*")]) {
    if (
      ACTIVE_SVG_TAGS.includes(node.localName.toLowerCase()) ||
      [...node.attributes].some((attribute) =>
        attribute.name.toLowerCase().startsWith("on"),
      )
    )
      add(
        "active-content",
        "This figure contains content that must be removed before export.",
        ["pdf", "svg", "pptx"],
      );
    for (const attribute of [...node.attributes]) {
      if (
        attribute.localName === "href" &&
        !isSelfContainedSvgHref(attribute.value)
      )
        add(
          "external-resource",
          "This figure links to another file. Embed its resources before exporting.",
          ["pdf", "svg", "pptx"],
        );
      try {
        verifySvgCssReferences(attribute.value, "Figure");
      } catch {
        add(
          "external-resource",
          "This figure links to another file. Embed its resources before exporting.",
          ["pdf", "svg", "pptx"],
        );
      }
    }
  }
  const faces = embeddedSvgFontFaces(svg);
  for (const run of visibleText(svg)) {
    const text = run.text;
    const requested = firstFontFamily(run.family);
    const embedded = faces.filter((face) => face.family === requested);
    const rawWeight = run.weight;
    const weight =
      rawWeight === "bold"
        ? 700
        : rawWeight === "normal"
          ? 400
          : Number(rawWeight) || 400;
    if (run.style !== "normal")
      add(
        "pdf-font-style",
        "PDF cannot preserve this figure's slanted text. Outline its text, or export SVG/PowerPoint.",
      );
    if (embedded.length) {
      if (!embedded.some((face) => face.format === "ttf"))
        add(
          "pdf-font-format",
          "This figure's embedded font is not supported in PDF. Outline its text, or export SVG/PowerPoint.",
        );
      else if (
        !embedded.some(
          (face) => face.format === "ttf" && face.style === "normal",
        )
      )
        add(
          "pdf-font-style",
          "PDF cannot preserve this figure's slanted text. Outline its text, or export SVG/PowerPoint.",
        );
      else if (
        !embedded.some((face) =>
          pdfEmbeddedSvgFontWeights(face).includes(weight),
        )
      )
        add(
          "pdf-font-weight",
          "PDF cannot preserve a text weight in this figure. Outline its text, or export SVG/PowerPoint.",
        );
    } else {
      const family = firstFontFamily(exportTextFontFamily(text, requested));
      const resolvedWeight = exportTextFontWeight(text, family, weight);
      const weights: readonly number[] =
        family === "Inter"
          ? TEXT_FONT_WEIGHTS
          : isKoreanFontFamily(family)
            ? [400, 700]
            : [400, 700];
      if (
        family !== "Inter" &&
        !isKoreanFontFamily(family) &&
        !(PDF_GENERIC_FONT_FAMILIES as readonly string[]).includes(family)
      )
        add(
          "pdf-font-unavailable",
          "PDF needs an embedded font for this figure's text. Outline its text, or export SVG/PowerPoint.",
        );
      else if (!weights.includes(resolvedWeight))
        add(
          "pdf-font-weight",
          "PDF cannot preserve a text weight in this figure. Outline its text, or export SVG/PowerPoint.",
        );
    }
  }
  return [...diagnostics.values()];
}

export function getFigureExportWarnings(asset: Asset): string[] {
  return getFigureExportDiagnostics(asset).map(
    (diagnostic) => diagnostic.message,
  );
}
