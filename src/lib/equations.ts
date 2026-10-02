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

export type EquationFontId =
  "mathjax-stix2" | "mathjax-fira" | "mathjax-modern";

export const FONT_OPTIONS: ReadonlyArray<{
  id: EquationFontId;
  label: string;
  description: string;
}> = [
  {
    id: "mathjax-stix2",
    label: "STIX Two",
    description: "Classic scientific serif",
  },
  {
    id: "mathjax-fira",
    label: "Fira Math",
    description: "Clear contemporary sans serif",
  },
  {
    id: "mathjax-modern",
    label: "Latin Modern",
    description: "Traditional TeX mathematics",
  },
];

/** Local MathJax equation syntax; this is not a general LaTeX package loader. */
export const SUPPORTED_MATH_PACKAGES: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  example: string;
  enabledByDefault: boolean;
}> = [
  {
    id: "amsmath",
    label: "AMS Math",
    description: "Aligned equations, matrices, cases, operators and integrals",
    example: String.raw`\begin{aligned} F(x)&=\int_0^x e^{-t^2}\,dt \\ A&=\begin{pmatrix}1&2\\3&4\end{pmatrix}\end{aligned}`,
    enabledByDefault: true,
  },
  {
    id: "amsfonts",
    label: "AMS Fonts",
    description: "Blackboard bold, Fraktur and calligraphic math alphabets",
    example: String.raw`\mathbb{R}\supset\mathbb{Q}\supset\mathbb{Z}\qquad\mathfrak{g}\qquad\mathcal{L}\qquad\mathscr{F}`,
    enabledByDefault: true,
  },
  {
    id: "amssymb",
    label: "AMS Symbols",
    description: "Extended mathematical symbols and relations",
    example: String.raw`\forall x\in\mathbb{R}\quad x\notin\varnothing\qquad\nexists n\in\mathbb{N}:n^2<0`,
    enabledByDefault: true,
  },
  {
    id: "mathtools",
    label: "mathtools",
    description: "Paired delimiters, advanced cases, brackets and alignment",
    example: String.raw`\DeclarePairedDelimiter{\abs}{\lvert}{\rvert}\qquad f(x)\coloneqq\abs*{\frac{x}{1+x^2}}`,
    enabledByDefault: true,
  },
  {
    id: "boldsymbol",
    label: "Bold symbols",
    description: "Bold Greek letters and other mathematical symbols",
    example: String.raw`\boldsymbol{\alpha}+\boldsymbol{\nabla}\phi=\boldsymbol{0}`,
    enabledByDefault: true,
  },
  {
    id: "newcommand",
    label: "Custom commands",
    description: "Equation-local macros with bounded expansion",
    example: String.raw`\newcommand{\RR}{\mathbb{R}}\newcommand{\norm}[1]{\lVert#1\rVert}x\in\RR,\quad\norm{x}=1`,
    enabledByDefault: true,
  },
  {
    id: "color",
    label: "Color",
    description: "Plain mathematical colors",
    example: String.raw`E=\color{#5675db}{mc^2}`,
    enabledByDefault: true,
  },
  {
    id: "braket",
    label: "Bra–ket notation",
    description: "Quantum states, inner products and sets",
    example: String.raw`\Braket{\psi|\hat H|\psi}\qquad\Set{x\in\mathbb{R}|x>0}`,
    enabledByDefault: true,
  },
  {
    id: "cancel",
    label: "Cancellation",
    description: "Cross out or cancel terms in derivations",
    example: String.raw`\frac{\cancel{x}(x+1)}{\cancel{x}}=x+1\qquad\cancelto{0}{a-b}`,
    enabledByDefault: true,
  },
  {
    id: "amscd",
    label: "AMS commutative diagrams",
    description: "Simple diagrams with horizontal and vertical arrows",
    example: String.raw`\begin{CD}A @>f>> B \\ @VgVV @VVhV \\ C @>>k> D\end{CD}`,
    enabledByDefault: true,
  },
  {
    id: "cases",
    label: "Numbered cases",
    description: "numcases and subnumcases environments",
    example: String.raw`\begin{numcases}{f(x)=}x^2 & $x>0$\\0 & $x\leq0$\end{numcases}`,
    enabledByDefault: true,
  },
  {
    id: "empheq",
    label: "Emphasized equations",
    description: "Group aligned equations with delimiters",
    example: String.raw`\begin{empheq}[left=\empheqlbrace]{align}x+y&=1\\x-y&=0\end{empheq}`,
    enabledByDefault: true,
  },
  {
    id: "extpfeil",
    label: "Extended arrows",
    description: "Labeled two-head arrows, map arrows and equal signs",
    example: String.raw`A\xtwoheadrightarrow{f}B\qquad x\xmapsto{g}g(x)`,
    enabledByDefault: true,
  },
  {
    id: "gensymb",
    label: "Scientific units",
    description: "Degree, Celsius, ohm, micro and per-thousand symbols",
    example: String.raw`\theta=30\degree\qquad R=10\,\ohm`,
    enabledByDefault: true,
  },
  {
    id: "textmacros",
    label: "Text formatting",
    description: "Text-mode formatting inside equations",
    example: String.raw`\text{\textbf{Energy}: } E=mc^2`,
    enabledByDefault: true,
  },
  {
    id: "upgreek",
    label: "Upright Greek",
    description: "Upright Greek letters for constants and units",
    example: String.raw`\uppi\approx3.14159\qquad\upalpha+\upbeta=\upgamma`,
    enabledByDefault: true,
  },
  {
    id: "physics",
    label: "Physics",
    description:
      "Derivatives, vectors and quantum notation; enable per equation",
    example: String.raw`\usepackage{physics}
\pdv{\psi}{t}=-\frac{i}{\hbar}\hat H\ket{\psi}\qquad\expval{H}{\psi}`,
    enabledByDefault: false,
  },
];

export const MATH_PROFILE_REVISION = "scientific-v2";

export const DEFAULT_TEX_PACKAGES = [
  "base",
  "ams",
  "newcommand",
  "boldsymbol",
  "mathtools",
  "color",
  "amscd",
  "braket",
  "cancel",
  "cases",
  "empheq",
  "extpfeil",
  "gensymb",
  "textmacros",
  "upgreek",
];
const PACKAGE_ALIASES: Readonly<Record<string, string>> = {
  amsmath: "ams",
  amsfonts: "ams",
  amssymb: "ams",
  ams: "ams",
  mathtools: "mathtools",
  boldsymbol: "boldsymbol",
  newcommand: "newcommand",
  color: "color",
  amscd: "amscd",
  braket: "braket",
  cancel: "cancel",
  cases: "cases",
  empheq: "empheq",
  extpfeil: "extpfeil",
  gensymb: "gensymb",
  textmacros: "textmacros",
  upgreek: "upgreek",
  physics: "physics",
};

interface PreparedEquation {
  source: string;
  packages: string[];
}

function skipPrefixTrivia(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor++;
    } else if (source[cursor] === "%") {
      const end = source.indexOf("\n", cursor);
      cursor = end < 0 ? source.length : end + 1;
    } else {
      break;
    }
  }
  return cursor;
}

/** Strip only explicit, allowlisted declarations before the equation body. */
function prepareEquation(latex: string): PreparedEquation {
  const packages = new Set(DEFAULT_TEX_PACKAGES);
  let cursor = 0;
  let hasDeclaration = false;
  while (cursor < latex.length) {
    const start = skipPrefixTrivia(latex, cursor);
    const declaration = latex.slice(start).match(/^\\(usepackage|require)\b/);
    if (!declaration) {
      cursor = start;
      break;
    }
    const command = declaration[0];
    cursor = skipPrefixTrivia(latex, start + command.length);
    if (latex[cursor] === "[") {
      throw new Error(
        "Package options are not supported in equation objects. Remove the option brackets.",
      );
    }
    const argument = latex.slice(cursor).match(/^\{([^{}]*)\}/);
    if (!argument) {
      throw new Error(
        `Malformed ${command} declaration. Use ${command}{amsfonts}.`,
      );
    }
    const names = argument[1].split(",").map((name) => name.trim());
    for (const name of names) {
      if (!name || !Object.hasOwn(PACKAGE_ALIASES, name)) {
        throw new Error(
          `Package "${name || "(empty)"}" is not supported in equation objects. Choose a package from the supported list.`,
        );
      }
      packages.add(PACKAGE_ALIASES[name]);
    }
    hasDeclaration = true;
    cursor += argument[0].length;
  }
  const source = hasDeclaration ? latex.slice(cursor) : latex;
  if (!source.slice(skipPrefixTrivia(source, 0)).trim()) {
    throw new Error("Enter a LaTeX equation after the package declarations.");
  }
  return { source, packages: [...packages] };
}

export interface RenderedEquation {
  svg: string;
  width: number;
  height: number;
  /** Unicode code points rendered with bundled STIX paths when the chosen font lacks them. */
  fallbackGlyphs?: number[];
}

const FONT_CLASSES = {
  "mathjax-stix2": MathJaxStix2Font,
  "mathjax-fira": MathJaxFiraFont,
  "mathjax-modern": MathJaxModernFont,
};

const MAX_SOURCE_LENGTH = 12_000;
const CACHE_ENTRIES = 160;
const CACHE_CHARACTERS = 4_000_000;
const PLAIN_COLOR =
  /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%\s+-]+\))$/i;
const cache = new Map<string, RenderedEquation>();
let cacheCharacters = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

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

function errorMessage(error: unknown): string {
  // MathJax TexError is a structured object rather than an Error subclass.
  if (typeof error === "object" && error !== null && "message" in error)
    return String(error.message);
  return String(error);
}

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

function validateInputs(
  latex: string,
  fontId: EquationFontId,
  fontSize: number,
  color: string,
) {
  if (!latex.trim()) throw new Error("Enter a LaTeX equation.");
  if (latex.length > MAX_SOURCE_LENGTH)
    throw new Error("This equation is too long (maximum 12,000 characters).");
  if (!Object.hasOwn(FONT_CLASSES, fontId))
    throw new Error("Choose a supported math font.");
  if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 512) {
    throw new Error("Equation size must be between 0 and 512 pixels.");
  }
  // Colors remain literal SVG paint values. Disallow URLs and CSS expressions.
  if (!PLAIN_COLOR.test(color)) {
    throw new Error("Use a plain color for the equation.");
  }
  const prepared = prepareEquation(latex);
  const externalCommand = prepared.source.match(
    /\\(?:usepackage|require|autoload|href|url|style|class|cssId|htmlClass|htmlId|htmlStyle|htmlData|includegraphics|input|include|write|openout|read|catcode|special)\b/,
  );
  if (externalCommand)
    throw new Error(
      `${externalCommand[0]} is not supported in equation objects.`,
    );
  return prepared;
}

function remember(key: string, rendered: RenderedEquation) {
  cache.set(key, rendered);
  cacheCharacters += rendered.svg.length;
  while (cache.size > CACHE_ENTRIES || cacheCharacters > CACHE_CHARACTERS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = cache.get(oldestKey)!;
    cacheCharacters -= oldest.svg.length;
    cache.delete(oldestKey);
  }
}

function copyRendered(rendered: RenderedEquation): RenderedEquation {
  return {
    ...rendered,
    ...(rendered.fallbackGlyphs
      ? { fallbackGlyphs: [...rendered.fallbackGlyphs] }
      : {}),
  };
}

async function convert(
  latex: string,
  prepared: PreparedEquation,
  fontId: EquationFontId,
  fontSize: number,
  color: string,
  displayMode: boolean,
) {
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
    ...(fallbackGlyphs?.size
      ? { fallbackGlyphs: [...fallbackGlyphs].sort((a, b) => a - b) }
      : {}),
  };
}

/** Render locally bundled vector mathematics with intrinsic logical-pixel bounds. */
export function renderEquation(
  latex: string,
  fontSetId: EquationFontId,
  fontSize: number,
  color: string,
  displayMode = true,
): Promise<RenderedEquation> {
  let prepared: PreparedEquation;
  try {
    prepared = validateInputs(latex, fontSetId, fontSize, color);
  } catch (error) {
    return Promise.reject(error);
  }
  const key = JSON.stringify([latex, fontSetId, fontSize, color, displayMode]);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(copyRendered(hit));
  }
  // Output jax and dynamic font state are mutable. Serializing conversions also
  // ensures edits, thumbnails and exports can safely request equations together.
  const operation = renderQueue.then(async () => {
    const existing = cache.get(key);
    if (existing) return copyRendered(existing);
    try {
      const rendered = await convert(
        latex,
        prepared,
        fontSetId,
        fontSize,
        color,
        displayMode,
      );
      remember(key, rendered);
      return copyRendered(rendered);
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  });
  renderQueue = operation.catch(() => undefined);
  return operation;
}
