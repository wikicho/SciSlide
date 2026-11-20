import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import type { LiteElement } from "@mathjax/src/js/adaptors/lite/Element.js";
import type { LiteText } from "@mathjax/src/js/adaptors/lite/Text.js";
import type { LiteDocument } from "@mathjax/src/js/adaptors/lite/Document.js";
import { MathJaxStix2Font } from "@mathjax/mathjax-stix2-font/js/svg.js";
import { MathJaxFiraFont } from "@mathjax/mathjax-fira-font/js/svg.js";
import { MathJaxModernFont } from "@mathjax/mathjax-modern-font/js/svg.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/js/input/tex/color/ColorConfiguration.js";
import "@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js";
import "@mathjax/src/js/input/tex/braket/BraketConfiguration.js";
import "@mathjax/src/js/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/js/input/tex/cases/CasesConfiguration.js";
import "@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js";
import "@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js";
import "@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js";
import "@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js";
import "@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js";
import "@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js";
import { BUNDLED_FONT_FILES } from "./equation-font-data";
import { installVectorGlyphFallback } from "./vector-font-fallback";
import {
  MAX_SOURCE_LENGTH,
  PLAIN_COLOR,
  type EquationFontId,
  type PreparedEquation,
  type RenderedEquation,
} from "./equations";

const FONT_CLASSES = {
  "mathjax-stix2": MathJaxStix2Font,
  "mathjax-fira": MathJaxFiraFont,
  "mathjax-modern": MathJaxModernFont,
};

const adaptor = liteAdaptor({ fontSize: 16 });
RegisterHTMLHandler(adaptor);

// MathJax still calls its loader to install pre-imported font ranges. This loader
// only acknowledges files in the local manifest; it cannot issue a network call.
mathjax.asyncLoad = async (name: string) => {
  if (!BUNDLED_FONT_FILES.has(name)) {
    throw new Error(`The requested MathJax module is not bundled: ${name}`);
  }
};

const outputs = new Map<
  EquationFontId,
  Promise<SVG<LiteElement, LiteText, LiteDocument>>
>();
const fallbackGlyphsByFont = new Map<EquationFontId, Set<number>>();

function getOutput(fontId: EquationFontId) {
  let output = outputs.get(fontId);
  if (!output) {
    output = (async () => {
      const svg = new SVG<LiteElement, LiteText, LiteDocument>({
        fontData: FONT_CLASSES[fontId],
        fontCache: "none",
        mtextInheritFont: false,
        displayOverflow: "overflow",
        linebreaks: { inline: false },
      });
      await svg.font.loadDynamicFiles();
      if (fontId !== "mathjax-stix2") {
        const stix = await getOutput("mathjax-stix2");
        fallbackGlyphsByFont.set(
          fontId,
          installVectorGlyphFallback(svg.font, stix.font),
        );
      }
      return svg;
    })();
    outputs.set(fontId, output);
  }
  return output;
}

export async function convert(
  latex: string,
  prepared: PreparedEquation,
  fontId: EquationFontId,
  fontSize: number,
  color: string,
  displayMode: boolean,
): Promise<RenderedEquation> {
  const output = await getOutput(fontId);
  // Each object receives an isolated TeX parser, so definitions in one equation
  // cannot affect another equation or make later edits behave differently.
  const input = new TeX<LiteElement, LiteText, LiteDocument>({
    packages: prepared.packages,
    tags: "none",
    maxBuffer: MAX_SOURCE_LENGTH,
    maxMacros: 1000,
    maxTemplateSubtitutions: 1000,
    formatError: (_jax: unknown, error: Error) => {
      throw error;
    },
  });
  const document = mathjax.document("", {
    InputJax: input,
    OutputJax: output,
    compileError: (_document: unknown, _math: unknown, error: Error) => {
      throw error;
    },
    typesetError: (_document: unknown, _math: unknown, error: Error) => {
      throw error;
    },
  });
  // Font calls happen inside the serialized conversion. Reset the per-font
  // tracker so thumbnails, errors and later equations cannot inherit metadata.
  const fallbackGlyphs = fallbackGlyphsByFont.get(fontId);
  fallbackGlyphs?.clear();
  const node = await document.convertPromise(prepared.source, {
    display: displayMode,
    em: fontSize,
    ex: fontSize / 2,
    containerWidth: 100_000,
  });
  const svg = adaptor.tags(node, "svg")[0];
  if (!svg) throw new Error("MathJax did not produce an SVG equation.");
  if (adaptor.tags(svg, "text").length) {
    throw new Error(
      "This equation contains a character unavailable as a vector glyph in the bundled math fonts.",
    );
  }
  const viewBox = String(adaptor.getAttribute(svg, "viewBox"))
    .trim()
    .split(/\s+/)
    .map(Number);
  const width = (viewBox[2] * fontSize) / 1000;
  const height = (viewBox[3] * fontSize) / 1000;
  if (
    viewBox.length !== 4 ||
    !viewBox.every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("This equation has no visible content.");
  }
  adaptor.setAttribute(svg, "width", width);
  adaptor.setAttribute(svg, "height", height);
  adaptor.setAttribute(svg, "fill", color);
  adaptor.setAttribute(svg, "color", color);
  adaptor.setAttribute(svg, "aria-label", latex);
  adaptor.removeAttribute(svg, "style");
  const elements: LiteElement[] = [svg];
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    for (const child of adaptor.childNodes(element)) {
      if (!adaptor.kind(child).startsWith("#"))
        elements.push(child as LiteElement);
    }
    for (const attribute of ["fill", "stroke"]) {
      if (adaptor.getAttribute(element, attribute) === "currentColor")
        adaptor.setAttribute(element, attribute, color);
      const paint = adaptor.getAttribute(element, attribute);
      if (
        paint !== undefined &&
        paint !== null &&
        !PLAIN_COLOR.test(String(paint))
      ) {
        throw new Error(
          "Equation colors must be plain colors; external SVG paints are not supported.",
        );
      }
    }
    // Source lives in the document model; keep the export SVG compact.
    adaptor.removeAttribute(element, "data-latex");
    adaptor.removeAttribute(element, "data-latex-item");
  }
  return {
    svg: adaptor.serializeXML(svg),
    width,
    height,
    baseline: (-viewBox[1] * fontSize) / 1000,
    xHeight: output.font.params.x_height * fontSize,
    ...(fallbackGlyphs?.size
      ? { fallbackGlyphs: [...fallbackGlyphs].sort((a, b) => a - b) }
      : {}),
  };
}
