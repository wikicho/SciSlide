// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyInlineEquationEdit,
  getInlineEquationEdit,
} from "../src/lib/inline-math-editing";
import {
  getInlineMathSpans,
  MAX_INLINE_MATH_SPANS,
  parseInlineMath,
} from "../src/lib/inline-math";

describe("inline equation source spans", () => {
  it("reports UTF-16 offsets and distinct locations for repeated equations", () => {
    const source = "😀 e\u0301 \\$5 $x$ and \\(y\\) $x$";
    const first = source.indexOf("$x$");
    const parenthesized = source.indexOf("\\(y\\)");
    const last = source.lastIndexOf("$x$");
    expect(first).toBe(10);
    expect(getInlineMathSpans(source)).toEqual([
      { start: first, end: first + 3, latex: "x", source: "$x$" },
      {
        start: parenthesized,
        end: parenthesized + 5,
        latex: "y",
        source: "\\(y\\)",
      },
      { start: last, end: last + 3, latex: "x", source: "$x$" },
    ]);
    expect(
      getInlineMathSpans(source).map((span) =>
        source.slice(span.start, span.end),
      ),
    ).toEqual(["$x$", "\\(y\\)", "$x$"]);
    expect(parseInlineMath("$x$")).toEqual([
      { type: "math", latex: "x", source: "$x$" },
    ]);
  });

  it("uses the renderer's escape, display and newline rules", () => {
    const source =
      String.raw`\$x\$ \\(literal) $$display $inner$ $$ $a\$b$` +
      "\r\n$broken\r\nspan$ \\(first\r\nsecond\\)";
    const spans = getInlineMathSpans(source);
    expect(spans.map((span) => span.latex)).toEqual([
      String.raw`a\$b`,
      "first\r\nsecond",
    ]);
    for (const span of spans)
      expect(source.slice(span.start, span.end)).toBe(span.source);
    expect(getInlineMathSpans("$$")).toEqual([]);
    expect(getInlineMathSpans("$ $ \\( \\)")).toEqual([]);
  });
});

describe("preparing and applying an inline equation edit", () => {
  it.each([3, 4, 5])(
    "edits an existing dollar equation when the caret is inside at %s",
    (caret) => {
      const source = "A $xy$ B";
      expect(getInlineEquationEdit(source, caret, caret)).toEqual({
        start: 2,
        end: 6,
        latex: "xy",
        opening: "$",
        closing: "$",
      });
    },
  );

  it("inserts outside an equation when the caret is before or after its delimiters", () => {
    const source = "A $xy$ B";
    for (const caret of [2, 6])
      expect(getInlineEquationEdit(source, caret, caret)).toEqual({
        start: caret,
        end: caret,
        latex: "",
        opening: "$",
        closing: "$",
      });
  });

  it("expands a partial or full equation selection to the exact source span", () => {
    const source = "A \\(xy\\) B";
    const expected = {
      start: 2,
      end: 8,
      latex: "xy",
      opening: "\\(",
      closing: "\\)",
    };
    for (const [start, end] of [
      [4, 4],
      [6, 6],
      [4, 5],
      [2, 8],
    ])
      expect(getInlineEquationEdit(source, start, end)).toEqual(expected);
  });

  it("wraps selected ordinary source and keeps a selection spanning multiple equations intact", () => {
    const source = "A xy B $x$ and $y$";
    expect(getInlineEquationEdit(source, 2, 4)).toEqual({
      start: 2,
      end: 4,
      latex: "xy",
      opening: "$",
      closing: "$",
    });
    const start = source.indexOf("$x$");
    expect(getInlineEquationEdit(source, start, source.length)).toEqual({
      start,
      end: source.length,
      latex: "$x$ and $y$",
      opening: "$",
      closing: "$",
    });
  });

  it("supports an empty dollar placeholder while the renderer leaves it literal", () => {
    const source = "A $$ B";
    const edit = getInlineEquationEdit(source, 3, 3);
    expect(edit).toEqual({
      start: 2,
      end: 4,
      latex: "",
      opening: "$",
      closing: "$",
    });
    expect(parseInlineMath(source)).toEqual([{ type: "text", text: source }]);
    expect(applyInlineEquationEdit(source, edit, "x")).toEqual({
      value: "A $x$ B",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("does not treat escaped dollars, matched display blocks or inner display dollars as placeholders", () => {
    for (const [source, caret] of [
      [String.raw`A \$$ B`, 4],
      ["A $$x$$ B", 3],
      ["A $$ $$ B", 6],
      ["A $$$$ B", 3],
      ["A $$x $y$ z$$ B", 9],
    ] as const) {
      const edit = getInlineEquationEdit(source, caret, caret);
      expect(edit.start).toBe(caret);
      expect(edit.end).toBe(caret);
      expect(edit.latex).toBe("");
    }
  });

  it("updates only the chosen duplicate equation and returns a native source caret", () => {
    const source = "😀 $x$\r\n$x$ τέλος";
    const start = source.lastIndexOf("$x$");
    const edit = getInlineEquationEdit(source, start + 1, start + 2);
    const result = applyInlineEquationEdit(source, edit, "x^2");
    expect(result).toEqual({
      value: "😀 $x$\r\n$x^2$ τέλος",
      selectionStart: start + 5,
      selectionEnd: start + 5,
    });
    expect(source).toBe("😀 $x$\r\n$x$ τέλος");
    expect(edit.latex).toBe("x");
  });

  it("retains parenthesized delimiters and exact CRLF in and around multiline LaTeX", () => {
    const source = "Before\r\n\\(x\r\n+ y\\)\r\nAfter";
    const start = source.indexOf("\\(");
    const edit = getInlineEquationEdit(source, start + 2, start + 2);
    const result = applyInlineEquationEdit(source, edit, "a\r\n+ b");
    expect(result.value).toBe("Before\r\n\\(a\r\n+ b\\)\r\nAfter");
    expect(result.selectionStart).toBe(result.value.indexOf("\r\nAfter"));
    expect(result.selectionEnd).toBe(result.selectionStart);
  });

  it("prepares a new equation from selected prose without mutating source on cancellation", () => {
    const source = "Energy xy remains.";
    const edit = getInlineEquationEdit(source, 7, 9);
    expect(source).toBe("Energy xy remains.");
    expect(edit.latex).toBe("xy");
    expect(applyInlineEquationEdit(source, edit, "E=mc^2")).toEqual({
      value: "Energy $E=mc^2$ remains.",
      selectionStart: 15,
      selectionEnd: 15,
    });
    expect(edit).toEqual({
      start: 7,
      end: 9,
      latex: "xy",
      opening: "$",
      closing: "$",
    });
  });

  it("allows escaped dollars in LaTeX and rejects delimiters that would break the edited span", () => {
    const source = "A $x$ B";
    const edit = getInlineEquationEdit(source, 3, 3);
    expect(applyInlineEquationEdit(source, edit, String.raw`a\$b`).value).toBe(
      String.raw`A $a\$b$ B`,
    );
    for (const latex of ["a$b", "a\nb", "a\r\nb"])
      expect(() => applyInlineEquationEdit(source, edit, latex)).toThrow(
        /one line.*dollar/,
      );
    const parent = "A \\(x\\) B";
    const parentEdit = getInlineEquationEdit(parent, 4, 4);
    expect(() =>
      applyInlineEquationEdit(parent, parentEdit, String.raw`a\)b`),
    ).toThrow(/closing delimiter/);
  });

  it("rejects invalid or stale source offsets", () => {
    for (const [start, end] of [
      [-1, 0],
      [2, 1],
      [0, 10],
      [0.5, 1],
      [0, Infinity],
    ])
      expect(() => getInlineEquationEdit("text", start, end)).toThrow(
        /selection.*text box/,
      );
    const edit = getInlineEquationEdit("$x$", 1, 1);
    expect(() => applyInlineEquationEdit("x", edit, "y")).toThrow(
      /selection.*text box/,
    );
  });

  it("enforces text limits before and after an edit", () => {
    expect(() => getInlineEquationEdit("a".repeat(100_001), 0, 0)).toThrow(
      /100,000/,
    );
    const source = "a".repeat(99_998);
    const edit = getInlineEquationEdit(source, source.length, source.length);
    expect(applyInlineEquationEdit(source, edit, "").value.length).toBe(
      100_000,
    );
    expect(() => applyInlineEquationEdit(source, edit, "x")).toThrow(/100,000/);
  });

  it("permits replacing an equation at the span limit and rejects adding a 129th", () => {
    const source = "$x$ ".repeat(MAX_INLINE_MATH_SPANS);
    const existing = getInlineEquationEdit(source, 1, 1);
    expect(
      getInlineMathSpans(applyInlineEquationEdit(source, existing, "y").value),
    ).toHaveLength(128);
    const insertion = getInlineEquationEdit(
      source,
      source.length,
      source.length,
    );
    expect(() => applyInlineEquationEdit(source, insertion, "z")).toThrow(
      /128 inline/,
    );
    expect(() => getInlineEquationEdit(source + "$z$", 1, 1)).toThrow(
      /128 inline/,
    );
  });
});
