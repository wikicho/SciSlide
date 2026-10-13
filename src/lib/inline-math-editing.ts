import {
  getInlineMathSpans,
  MAX_INLINE_MATH_SPANS,
  MAX_INLINE_TEXT_LENGTH,
} from "./inline-math";
import type { InlineMathSpan } from "./inline-math";

export interface InlineEquationEdit {
  start: number;
  end: number;
  latex: string;
  opening: "$" | "\\(";
  closing: "$" | "\\)";
}

function checkedSpans(source: string): InlineMathSpan[] {
  if (source.length > MAX_INLINE_TEXT_LENGTH)
    throw new Error("Inline text is too long (maximum 100,000 characters).");
  const spans = getInlineMathSpans(source);
  if (spans.length > MAX_INLINE_MATH_SPANS)
    throw new Error(
      `A text box can contain at most ${MAX_INLINE_MATH_SPANS} inline equations.`,
    );
  return spans;
}

function checkRange(source: string, start: number, end: number) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.length
  )
    throw new Error("The inline equation selection is outside this text box.");
}

function delimiters(span: InlineMathSpan) {
  return span.source.startsWith("\\(")
    ? { opening: "\\(" as const, closing: "\\)" as const }
    : { opening: "$" as const, closing: "$" as const };
}

/** A matched display block must not become an empty inline edit placeholder. */
function hasDisplayCloser(source: string, start: number): boolean {
  for (let cursor = start; cursor < source.length; cursor++) {
    if (source[cursor] === "\\") cursor++;
    else if (source[cursor] === "$" && source[cursor + 1] === "$") return true;
  }
  return false;
}

function emptyDollarPlaceholder(source: string, caret: number) {
  const start = caret - 1;
  if (
    source.slice(start, caret + 1) !== "$$" ||
    source[start - 1] === "$" ||
    source[caret + 1] === "$" ||
    hasDisplayCloser(source, caret + 1)
  )
    return undefined;
  // Let the renderer's scanner decide whether this location is escaped or
  // inside another span/display block instead of duplicating its escape rules.
  const probe = source.slice(0, start) + "$x$" + source.slice(caret + 1);
  return getInlineMathSpans(probe).some(
    (span) => span.start === start && span.source === "$x$",
  )
    ? {
        start,
        end: caret + 1,
        latex: "",
        opening: "$" as const,
        closing: "$" as const,
      }
    : undefined;
}

/** Locate an existing equation, or prepare an insertion around selected text. */
export function getInlineEquationEdit(
  source: string,
  start: number,
  end: number,
): InlineEquationEdit {
  checkRange(source, start, end);
  const spans = checkedSpans(source);
  const containing = spans.filter((span) =>
    start === end
      ? start > span.start && start < span.end
      : start >= span.start && end <= span.end,
  );
  if (containing.length === 1) {
    const span = containing[0];
    return {
      start: span.start,
      end: span.end,
      latex: span.latex,
      ...delimiters(span),
    };
  }
  if (start === end) {
    const placeholder = emptyDollarPlaceholder(source, start);
    if (placeholder) return placeholder;
  }
  return {
    start,
    end,
    latex: source.slice(start, end),
    opening: "$",
    closing: "$",
  };
}

/** Apply a confirmed edit without changing any source outside its saved range. */
export function applyInlineEquationEdit(
  source: string,
  range: InlineEquationEdit,
  latex: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  checkRange(source, range.start, range.end);
  checkedSpans(source);
  if (!(
    (range.opening === "$" && range.closing === "$") ||
    (range.opening === "\\(" && range.closing === "\\)")
  ))
    throw new Error("The inline equation has incompatible delimiters.");
  const replacement = range.opening + latex + range.closing;
  const value =
    source.slice(0, range.start) + replacement + source.slice(range.end);
  const spans = checkedSpans(value);
  if (
    latex.trim() &&
    !spans.some(
      (span) =>
        span.start === range.start &&
        span.end === range.start + replacement.length &&
        span.latex === latex,
    )
  )
    throw new Error(
      range.opening === "$"
        ? "An inline equation between $ delimiters must stay on one line and escape literal dollar signs."
        : "The inline equation contains an unescaped closing delimiter.",
    );
  const selectionStart = range.start + replacement.length;
  return { value, selectionStart, selectionEnd: selectionStart };
}
