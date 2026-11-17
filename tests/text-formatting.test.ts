import { describe, expect, it } from "vitest";
import {
  colorTextRange,
  continueBulletLine,
  rebaseTextStyles,
  textStyleColor,
  toggleBulletLines,
} from "../src/lib/text-formatting";
import type { TextStyleRange } from "../src/lib/model";

const red = "#ff0000";
const blue = "#0000ff";

describe("selected text colors", () => {
  it("splits, clears and merges ranges without changing caller-owned metadata", () => {
    const original = [{ start: 0, end: 10, color: red }];
    const middle = colorTextRange(original, 3, 7, blue);
    expect(middle).toEqual([
      { start: 0, end: 3, color: red },
      { start: 3, end: 7, color: blue },
      { start: 7, end: 10, color: red },
    ]);
    expect(colorTextRange(middle, 4, 6, null)).toEqual([
      { start: 0, end: 3, color: red },
      { start: 3, end: 4, color: blue },
      { start: 6, end: 7, color: blue },
      { start: 7, end: 10, color: red },
    ]);
    expect(colorTextRange(middle, 0, 3, blue)).toEqual([
      { start: 0, end: 7, color: blue },
      { start: 7, end: 10, color: red },
    ]);
    expect(original).toEqual([{ start: 0, end: 10, color: red }]);
    const unchanged = colorTextRange(original, 4, 4, blue);
    expect(unchanged).toEqual(original);
    expect(unchanged).not.toBe(original);
    expect(unchanged[0]).not.toBe(original[0]);
  });

  it.each([
    [NaN, 2],
    [0, Infinity],
    [-1, 2],
    [2, -1],
    [3, 2],
    [0.5, 2],
    [0, 1.5],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects invalid selection bounds %s..%s", (start, end) => {
    expect(() => colorTextRange([], start, end, red)).toThrow("bounds");
  });

  it.each<{
    name: string;
    before: string;
    after: string;
    ranges: TextStyleRange[];
    expected: TextStyleRange[];
  }>([
    {
      name: "insertion inside a colored word",
      before: "blue",
      after: "blXue",
      ranges: [{ start: 0, end: 4, color: blue }],
      expected: [{ start: 0, end: 5, color: blue }],
    },
    {
      name: "insertion before a colored word",
      before: "abc XYZ",
      after: "abc ++XYZ",
      ranges: [{ start: 4, end: 7, color: red }],
      expected: [{ start: 6, end: 9, color: red }],
    },
    {
      name: "deletion across two colors",
      before: "Red blue",
      after: "Rblue",
      ranges: [
        { start: 0, end: 3, color: red },
        { start: 4, end: 8, color: blue },
      ],
      expected: [
        { start: 0, end: 1, color: red },
        { start: 1, end: 5, color: blue },
      ],
    },
    {
      name: "replacement within a colored word",
      before: "Red blue",
      after: "Rose blue",
      ranges: [
        { start: 0, end: 3, color: red },
        { start: 4, end: 8, color: blue },
      ],
      expected: [
        { start: 0, end: 4, color: red },
        { start: 5, end: 9, color: blue },
      ],
    },
    {
      name: "complete replacement",
      before: "blue",
      after: "green",
      ranges: [{ start: 0, end: 4, color: blue }],
      expected: [{ start: 0, end: 5, color: blue }],
    },
    {
      name: "Korean insertion",
      before: "한글문장",
      after: "한글 새문장",
      ranges: [
        { start: 0, end: 2, color: red },
        { start: 2, end: 4, color: blue },
      ],
      expected: [
        { start: 0, end: 4, color: red },
        { start: 4, end: 6, color: blue },
      ],
    },
    {
      name: "whole emoji deletion",
      before: "A😀B",
      after: "AB",
      ranges: [
        { start: 1, end: 3, color: red },
        { start: 3, end: 4, color: blue },
      ],
      expected: [{ start: 1, end: 2, color: blue }],
    },
    {
      name: "emoji replacement sharing one surrogate",
      before: "A😀B",
      after: "A😃B",
      ranges: [
        { start: 1, end: 3, color: red },
        { start: 3, end: 4, color: blue },
      ],
      expected: [
        { start: 1, end: 3, color: red },
        { start: 3, end: 4, color: blue },
      ],
    },
    {
      name: "emoji insertion in a colored run",
      before: "K😀Y",
      after: "K😀😀Y",
      ranges: [
        { start: 0, end: 1, color: red },
        { start: 1, end: 3, color: blue },
      ],
      expected: [
        { start: 0, end: 1, color: red },
        { start: 1, end: 5, color: blue },
      ],
    },
  ])(
    "rebases $name with UTF-16 positions",
    ({ before, after, ranges, expected }) => {
      const original = structuredClone(ranges);
      expect(rebaseTextStyles(before, after, ranges)).toEqual(expected);
      expect(ranges).toEqual(original);
    },
  );

  it("keeps untouched ranges and safely drops formatting when all text is deleted", () => {
    const ranges = [{ start: 0, end: 2, color: red }];
    expect(rebaseTextStyles("한글", "한글", ranges)).toEqual(ranges);
    expect(rebaseTextStyles("한글", "", ranges)).toEqual([]);
    expect(rebaseTextStyles("plain", "plain plus", undefined)).toEqual([]);
    expect(textStyleColor(ranges, 0)).toBe(red);
    expect(textStyleColor(ranges, 2)).toBeUndefined();
  });
});

describe("bullet line edits", () => {
  it("starts a list in an empty editor without adding metadata to the legacy return shape", () => {
    expect(toggleBulletLines("", 0, 0)).toEqual({
      value: "• ",
      start: 0,
      end: 2,
    });
    expect(toggleBulletLines("  ", 0, 2)).toEqual({
      value: "  • ",
      start: 0,
      end: 4,
    });
    expect(toggleBulletLines("", 0, 0, [])).toEqual({
      value: "• ",
      start: 0,
      end: 2,
      styles: [],
    });
  });

  it("toggles the current line and excludes a following line when a selection ends at its start", () => {
    expect(toggleBulletLines("before\nmiddle\nafter", 9, 9)).toEqual({
      value: "before\n• middle\nafter",
      start: 7,
      end: 15,
    });
    expect(toggleBulletLines("first\nsecond\nthird", 0, 6)).toEqual({
      value: "• first\nsecond\nthird",
      start: 0,
      end: 7,
    });
  });

  it("adds only missing prefixes in a mixed selection and removes every prefix together", () => {
    const source = "• first\nsecond\n• third";
    const added = toggleBulletLines(source, 0, source.length);
    expect(added.value).toBe("• first\n• second\n• third");
    expect(toggleBulletLines(added.value, added.start, added.end).value).toBe(
      "first\nsecond\nthird",
    );
  });

  it.each(["\n", "\r\n", "\r"])(
    "preserves %j line endings and blank lines",
    (ending) => {
      const source = `first${ending}${ending}second`;
      const added = toggleBulletLines(source, 0, source.length);
      expect(added.value).toBe(`• first${ending}• ${ending}• second`);
      expect(toggleBulletLines(added.value, added.start, added.end).value).toBe(
        source,
      );
    },
  );

  it.each(["\n", "\r\n"])(
    "keeps the exact colors of two separately edited lines with %j endings",
    (ending) => {
      const source = `Red${ending}Blue`;
      const second = 3 + ending.length;
      const styles = [
        { start: 0, end: 3, color: red },
        { start: second, end: second + 4, color: blue },
      ];
      const original = structuredClone(styles);
      const added = toggleBulletLines(source, 0, source.length, styles);
      expect(added.value).toBe(`• Red${ending}• Blue`);
      for (const [word, color] of [
        ["Red", red],
        ["Blue", blue],
      ]) {
        const start = added.value.indexOf(word);
        for (let index = start; index < start + word.length; index++)
          expect(textStyleColor(added.styles, index)).toBe(color);
      }
      const removed = toggleBulletLines(
        added.value,
        added.start,
        added.end,
        added.styles,
      );
      expect(removed.value).toBe(source);
      expect(removed.styles).toEqual(styles);
      expect(styles).toEqual(original);
    },
  );

  it("continues rather than exits when text remains after the caret", () => {
    expect(continueBulletLine("• abc", 2, 2)).toEqual({
      value: "• \n• abc",
      start: 5,
      end: 5,
    });
    expect(continueBulletLine("  • abc", 6, 6)).toEqual({
      value: "  • ab\n  • c",
      start: 11,
      end: 11,
    });
  });

  it("exits a genuinely empty bullet while preserving the following line and its ending", () => {
    expect(continueBulletLine("• ", 2, 2)).toEqual({
      value: "",
      start: 0,
      end: 0,
    });
    expect(continueBulletLine("  •  \r\nnext", 4, 4)).toEqual({
      value: "\r\nnext",
      start: 0,
      end: 0,
    });
  });

  it("continues with the local line ending and ignores selections or a caret inside its prefix", () => {
    const source = "• first\r\n• last";
    const result = continueBulletLine(source, source.length, source.length)!;
    expect(result.value).toBe(source + "\r\n• ");
    expect(result.start).toBe(result.value.length);
    expect(result.end).toBe(result.start);
    expect(continueBulletLine("• abc", 1, 1)).toBeNull();
    expect(continueBulletLine("• abc", 2, 3)).toBeNull();
    expect(continueBulletLine("plain", 5, 5)).toBeNull();
  });
});
