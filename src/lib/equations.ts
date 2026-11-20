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

export interface PreparedEquation {
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
  /** Logical pixels from the SVG's top edge to its mathematical baseline. */
  baseline?: number;
  /** The selected math font's lowercase x-height at the requested font size. */
  xHeight?: number;
  /** Unicode code points rendered with bundled STIX paths when the chosen font lacks them. */
  fallbackGlyphs?: number[];
}

export const MAX_SOURCE_LENGTH = 12_000;
const CACHE_ENTRIES = 160;
const CACHE_CHARACTERS = 4_000_000;
export const PLAIN_COLOR =
  /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%\s+-]+\))$/i;
const cache = new Map<string, RenderedEquation>();
// Only active requests live here; failures must remain retryable. Bound this
// map separately from the queue so large decks cannot retain an extra key map.
const pending = new Map<string, Promise<RenderedEquation>>();
let cacheCharacters = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

function errorMessage(error: unknown): string {
  // MathJax TexError is a structured object rather than an Error subclass.
  if (typeof error === "object" && error !== null && "message" in error)
    return String(error.message);
  return String(error);
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
  if (!FONT_OPTIONS.some((font) => font.id === fontId))
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
  const active = pending.get(key);
  if (active) return active.then(copyRendered);
  // Output jax and dynamic font state are mutable. Serializing conversions also
  // ensures edits, thumbnails and exports can safely request equations together.
  const operation = renderQueue.then(async () => {
    const existing = cache.get(key);
    if (existing) return existing;
    try {
      const { convert } = await import("./mathjax-engine");
      const rendered = await convert(
        latex,
        prepared,
        fontSetId,
        fontSize,
        color,
        displayMode,
      );
      remember(key, rendered);
      return rendered;
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  });
  if (pending.size < CACHE_ENTRIES) {
    pending.set(key, operation);
    const forget = () => {
      if (pending.get(key) === operation) pending.delete(key);
    };
    void operation.then(forget, forget);
  }
  renderQueue = operation.catch(() => undefined);
  return operation.then(copyRendered);
}
