import { renderEquation } from "./equations";
import type { RenderedEquation } from "./equations";
import type { Deck, TextObject } from "./model";
import { exportTextFontFamily, exportTextFontWeight } from "./text-fonts";

export type InlineMathToken =
  | { type: "text"; text: string }
  | { type: "math"; latex: string; source: string };

export interface InlineTextRun {
  type: "text";
  text: string;
  x: number;
  width: number;
}

export interface InlineEquationRun {
  type: "math";
  latex: string;
  source: string;
  svg: string;
  x: number;
  /** Absolute top edge within the text object's local coordinates. */
  y: number;
  width: number;
  height: number;
}

export interface InlineTextLine {
  width: number;
  baseline: number;
  height: number;
  runs: Array<InlineTextRun | InlineEquationRun>;
}

export interface InlineTextLayout {
  lines: InlineTextLine[];
  fontFamily: string;
  fontWeight: number;
  height: number;
}

export const MAX_INLINE_MATH_SPANS = 128;
const MAX_TEXT_LENGTH = 100_000;

function closingDelimiter(
  source: string,
  start: number,
  parenthesized: boolean,
): number {
  for (let cursor = start; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (!parenthesized && /[\r\n]/.test(character)) return -1;
    if (character === "\\") {
      if (parenthesized && source[cursor + 1] === ")") return cursor;
      cursor++;
    } else if (!parenthesized && character === "$") return cursor;
  }
  return -1;
}

function scan(source: string, firstMathOnly = false): InlineMathToken[] {
  const tokens: InlineMathToken[] = [];
  let literal = "";
  let noMoreParenthesizedClosers = false;
  const flush = () => {
    if (literal) tokens.push({ type: "text", text: literal });
    literal = "";
  };
  for (let cursor = 0; cursor < source.length;) {
    const character = source[cursor];
    if (character === "\\" && source[cursor + 1] === "$") {
      literal += "$";
      cursor += 2;
      continue;
    }
    // An escaped backslash cannot open a parenthesized math span.
    if (character === "\\" && source[cursor + 1] === "\\") {
      literal += "\\\\";
      cursor += 2;
      continue;
    }
    if (character === "$" && source[cursor + 1] === "$") {
      // Display delimiters are intentionally literal in a text box. Skip the
      // whole block so its inner dollars cannot become accidental inline math.
      let end = cursor + 2;
      while (end < source.length) {
        if (source[end] === "\\") end += 2;
        else if (source[end] === "$" && source[end + 1] === "$") break;
        else end++;
      }
      if (end >= source.length) {
        const newline = source.slice(cursor).search(/[\r\n]/);
        end = newline < 0 ? source.length : cursor + newline;
      } else end += 2;
      literal += source.slice(cursor, end);
      cursor = end;
      continue;
    }
    const parenthesized = character === "\\" && source[cursor + 1] === "(";
    if (character === "$" || parenthesized) {
      const delimiterWidth = parenthesized ? 2 : 1;
      const end =
        parenthesized && noMoreParenthesizedClosers
          ? -1
          : closingDelimiter(source, cursor + delimiterWidth, parenthesized);
      if (parenthesized && end < 0) noMoreParenthesizedClosers = true;
      if (end >= 0) {
        const latex = source.slice(cursor + delimiterWidth, end);
        const original = source.slice(cursor, end + delimiterWidth);
        if (latex.trim()) {
          flush();
          tokens.push({ type: "math", latex, source: original });
          if (firstMathOnly) return tokens;
        } else literal += original;
        cursor = end + delimiterWidth;
        continue;
      }
      literal += source.slice(cursor, cursor + delimiterWidth);
      cursor += delimiterWidth;
      continue;
    }
    literal += character;
    cursor++;
  }
  flush();
  return tokens;
}

/** Delimiters and escapes affect display only; document source stays intact. */
export function parseInlineMath(source: string): InlineMathToken[] {
  return scan(source);
}

/** This synchronous predicate never rejects an unfinished edit or span budget. */
export function hasInlineMath(source: string): boolean {
  return scan(source, true).some((token) => token.type === "math");
}

/** Decoded prose for ordinary text rendering and mixed-language font choice. */
export function inlinePlainText(source: string): string {
  return parseInlineMath(source)
    .filter((token) => token.type === "text")
    .map((token) => token.text)
    .join("");
}

type PreparedText = { type: "text"; text: string; width: number };
type PreparedMath = Omit<InlineEquationRun, "x" | "y"> & {
  baseline: number;
};
type PreparedRun = PreparedText | PreparedMath;
type Piece =
  | { type: "space" }
  | { type: "newline" }
  | { type: "word"; runs: PreparedRun[] };

function fontCss(family: string): string {
  return family
    .split(",")
    .map((name) => {
      const clean = name.trim().replace(/^['"]|['"]$/g, "");
      if (
        /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(clean)
      )
        return clean;
      return `"${clean.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    })
    .join(", ");
}

function inlineEquationMetrics(
  equation: RenderedEquation,
  proseXHeight: number,
) {
  const mathXHeight = equation.xHeight;
  const scale =
    Number.isFinite(proseXHeight) &&
    proseXHeight > 0 &&
    mathXHeight !== undefined &&
    Number.isFinite(mathXHeight) &&
    mathXHeight > 0
      ? proseXHeight / mathXHeight
      : 1;
  const width = equation.width * scale;
  const height = equation.height * scale;
  // MathJax's paths and viewBox are unchanged. Resizing the outer viewport
  // matches prose optical size while preserving the mathematical baseline.
  const svg =
    scale === 1
      ? equation.svg
      : equation.svg.replace(/^<svg\b[^>]*>/, (root) =>
          root
            .replace(/(\s)width="[^"]*"/, `$1width="${width}"`)
            .replace(/(\s)height="[^"]*"/, `$1height="${height}"`),
        );
  return {
    svg,
    width,
    height,
    baseline: (equation.baseline ?? equation.height * 0.8) * scale,
  };
}

/** Shared editor/export line composition. Math spans stay indivisible and
 * their actual MathJax baseline determines each line's ascent and descent. */
export async function layoutInlineText(
  object: TextObject,
  deck: Deck,
): Promise<InlineTextLayout> {
  if (object.text.length > MAX_TEXT_LENGTH)
    throw new Error("Inline text is too long (maximum 100,000 characters).");
  const tokens = parseInlineMath(object.text);
  const math = tokens.filter((token) => token.type === "math");
  if (math.length > MAX_INLINE_MATH_SPANS)
    throw new Error(
      `A text box can contain at most ${MAX_INLINE_MATH_SPANS} inline equations.`,
    );
  const prose = tokens
    .filter((token) => token.type === "text")
    .map((token) => token.text)
    .join("")
    .normalize("NFC");
  const fontFamily = exportTextFontFamily(prose, object.fontFamily);
  const fontWeight = exportTextFontWeight(
    prose,
    object.fontFamily,
    object.fontWeight,
  );
  const size = object.fontSize;
  const width = Math.max(1, object.transform.width);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(width))
    throw new Error("Inline text needs a finite positive font size and width.");
  const css = `${fontWeight} ${size}px ${fontCss(fontFamily)}`;
  // Do all asynchronous work before setting the measuring font. Parallel
  // thumbnails/exports must never change another layout's font mid-measurement.
  const [, rendered] = await Promise.all([
    document.fonts?.load?.(css, `${prose || "M"}x`),
    Promise.all(
      math.map(async (token): Promise<RenderedEquation> => {
        try {
          return await renderEquation(
            token.latex,
            deck.theme.equation.fontSetId,
            size,
            object.color,
            false,
          );
        } catch (error) {
          throw new Error(
            `Inline equation ${JSON.stringify(token.latex)}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    ),
  ]);
  const context = document.createElement("canvas").getContext("2d");
  if (!context)
    throw new Error("This browser cannot measure text for the slide.");
  context.font = css;
  const measure = (value: string) => context.measureText(value).width;
  const proseXHeight = context.measureText("x").actualBoundingBoxAscent;
  const pieces: Piece[] = [];
  let word: PreparedRun[] = [];
  const flushWord = () => {
    if (word.length) pieces.push({ type: "word", runs: word });
    word = [];
  };
  let mathIndex = 0;
  for (const token of tokens) {
    if (token.type === "math") {
      const equation = rendered[mathIndex++];
      word.push({
        ...token,
        ...inlineEquationMetrics(equation, proseXHeight),
      });
      continue;
    }
    for (const match of token.text
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .matchAll(/\n|[^\S\n]+|[^\s]+/gu)) {
      const value = match[0];
      if (value === "\n") {
        flushWord();
        pieces.push({ type: "newline" });
      } else if (/^\s/u.test(value)) {
        flushWord();
        pieces.push({ type: "space" });
      } else word.push({ type: "text", text: value, width: measure(value) });
    }
  }
  flushWord();
  const lines: InlineTextLine[] = [];
  let line: PreparedRun[] = [];
  let lineWidth = 0;
  let totalHeight = 0;
  let pendingSpace = false;
  const spaceWidth = measure(" ");
  const finishLine = () => {
    while (
      line.at(-1)?.type === "text" &&
      /^\s+$/u.test((line.at(-1) as PreparedText).text)
    ) {
      lineWidth -= line.pop()!.width;
    }
    let ascent = size,
      descent = size * 0.3;
    for (const run of line) {
      if (run.type === "math") {
        ascent = Math.max(ascent, run.baseline);
        descent = Math.max(descent, run.height - run.baseline);
      }
    }
    const height = ascent + descent;
    const baseline = totalHeight + ascent;
    let x =
      object.align === "center"
        ? (width - lineWidth) / 2
        : object.align === "right"
          ? width - lineWidth
          : 0;
    const runs = line.map((run): InlineTextRun | InlineEquationRun => {
      const positioned =
        run.type === "math"
          ? {
              type: "math" as const,
              latex: run.latex,
              source: run.source,
              svg: run.svg,
              x,
              y: baseline - run.baseline,
              width: run.width,
              height: run.height,
            }
          : { ...run, x };
      x += run.width;
      return positioned;
    });
    lines.push({ width: lineWidth, baseline, height, runs });
    totalHeight += height;
    line = [];
    lineWidth = 0;
    pendingSpace = false;
  };
  const add = (run: PreparedRun) => {
    line.push(run);
    lineWidth += run.width;
  };
  for (const piece of pieces) {
    if (piece.type === "newline") {
      finishLine();
      continue;
    }
    if (piece.type === "space") {
      pendingSpace = line.length > 0;
      continue;
    }
    const wordWidth = piece.runs.reduce((sum, run) => sum + run.width, 0);
    if (wordWidth <= width) {
      if (lineWidth + (pendingSpace ? spaceWidth : 0) + wordWidth > width)
        finishLine();
      if (pendingSpace) add({ type: "text", text: " ", width: spaceWidth });
      for (const run of piece.runs) add(run);
    } else {
      if (pendingSpace && lineWidth + spaceWidth < width)
        add({ type: "text", text: " ", width: spaceWidth });
      for (const run of piece.runs) {
        if (run.type === "math") {
          if (line.length && lineWidth + run.width > width) finishLine();
          add(run);
          continue;
        }
        let chunk = "";
        for (const character of run.text) {
          const candidate = chunk + character;
          if (
            lineWidth + measure(candidate) > width &&
            (line.length || chunk)
          ) {
            if (chunk)
              add({ type: "text", text: chunk, width: measure(chunk) });
            finishLine();
            chunk = character;
          } else chunk = candidate;
        }
        if (chunk) add({ type: "text", text: chunk, width: measure(chunk) });
      }
    }
    pendingSpace = false;
  }
  finishLine();
  return { lines, fontFamily, fontWeight, height: totalHeight };
}
