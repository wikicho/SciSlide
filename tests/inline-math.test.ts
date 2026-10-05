// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as equations from "../src/lib/equations";
import { createThemeDeck } from "../src/lib/deck-themes";
import {
  hasInlineMath,
  inlinePlainText,
  layoutInlineText,
  MAX_INLINE_MATH_SPANS,
  parseInlineMath,
} from "../src/lib/inline-math";
import type { InlineEquationRun } from "../src/lib/inline-math";
import type { TextObject } from "../src/lib/model";

const deck = createThemeDeck("keynote-white");

function text(source: string, overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: "inline-text",
    type: "text",
    name: "Inline text",
    text: source,
    transform: { x: 100, y: 200, width: 800, height: 250, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    fontFamily: "Inter",
    fontWeight: 600,
    fontSize: 40,
    color: "#234567",
    align: "left",
    ...overrides,
  };
}

function fakeMath(width = 40, height = 44, baseline = 32) {
  return vi.spyOn(equations, "renderEquation").mockResolvedValue({
    width,
    height,
    baseline,
    svg: `<svg width="${width}" height="${height}"><path d="M0 0L1 1"/></svg>`,
  });
}

function measureXHeight(factor: number) {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => {
    const context = {
      font: "",
      measureText(value: string) {
        const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 40);
        return {
          width: [...value].length * size * 0.5,
          actualBoundingBoxAscent: factor * size,
        };
      },
    };
    return context as unknown as CanvasRenderingContext2D;
  });
}

describe("inline math delimiters", () => {
  it("preserves exact math source while decoding only escaped dollars in prose", () => {
    const source = String.raw`Cost: \$20. Energy $E=mc^2$ and \(\alpha+\beta\).`;
    expect(parseInlineMath(source)).toEqual([
      { type: "text", text: "Cost: $20. Energy " },
      { type: "math", latex: "E=mc^2", source: "$E=mc^2$" },
      { type: "text", text: " and " },
      {
        type: "math",
        latex: String.raw`\alpha+\beta`,
        source: String.raw`\(\alpha+\beta\)`,
      },
      { type: "text", text: "." },
    ]);
    expect(inlinePlainText(source)).toBe("Cost: $20. Energy  and .");
    expect(hasInlineMath(source)).toBe(true);
    expect(source).toContain(String.raw`\$20`);
  });

  it.each([
    "",
    "The price is $20",
    "Math $unfinished",
    String.raw`An unfinished \(equation`,
    "$   $",
    String.raw`\( \)`,
    "$$x^2$$",
    "$$x$y$$",
    "$$unterminated $x$",
    "$first\nsecond$",
  ])(
    "leaves unfinished, empty and display delimiters literal: %s",
    (source) => {
      expect(parseInlineMath(source)).toEqual(
        source ? [{ type: "text", text: source }] : [],
      );
      expect(hasInlineMath(source)).toBe(false);
      expect(inlinePlainText(source)).toBe(source);
    },
  );

  it("handles escaped delimiters and adjacent math without merging the source", () => {
    const source = String.raw`\\(literal) \$x\$ 식$x$\(y\).`;
    expect(parseInlineMath(source)).toEqual([
      { type: "text", text: String.raw`\\(literal) $x$ 식` },
      { type: "math", latex: "x", source: "$x$" },
      { type: "math", latex: "y", source: String.raw`\(y\)` },
      { type: "text", text: "." },
    ]);
    expect(parseInlineMath(String.raw`Price $\$20$`)[1]).toEqual({
      type: "math",
      latex: String.raw`\$20`,
      source: String.raw`$\$20$`,
    });
  });

  it("continues parsing after literal display math and permits parenthesized multiline TeX", () => {
    const source = "$$x$$\nGood $y$ and \\(a\n+b\\).";
    expect(
      parseInlineMath(source).filter((token) => token.type === "math"),
    ).toEqual([
      { type: "math", latex: "y", source: "$y$" },
      { type: "math", latex: "a\n+b", source: "\\(a\n+b\\)" },
    ]);
  });

  it("never rejects a draft at the span budget and scans repeated unfinished openers", () => {
    const source = "$x$ ".repeat(MAX_INLINE_MATH_SPANS + 1);
    expect(
      parseInlineMath(source).filter((token) => token.type === "math"),
    ).toHaveLength(129);
    expect(hasInlineMath(source)).toBe(true);
    const unfinished = String.raw`\(`.repeat(50_000);
    expect(inlinePlainText(unfinished)).toBe(unfinished);
    expect(hasInlineMath(unfinished)).toBe(false);
  });
});

describe("shared inline text layout", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        const context = {
          font: "",
          measureText(value: string) {
            const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 40);
            const units = [...value].reduce(
              (sum, character) =>
                sum + (/[\uac00-\ud7af]/u.test(character) ? 1 : 0.5),
              0,
            );
            return { width: units * size };
          },
        };
        return context as unknown as CanvasRenderingContext2D;
      },
    );
  });

  it("closes an active inline span before opening adjacent inline spans", () => {
    expect(parseInlineMath("$x$$y$$z$")).toEqual([
      { type: "math", latex: "x", source: "$x$" },
      { type: "math", latex: "y", source: "$y$" },
      { type: "math", latex: "z", source: "$z$" },
    ]);
    expect(parseInlineMath("$$x$$")).toEqual([{ type: "text", text: "$$x$$" }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["left", "center", "right"] as const)(
    "aligns the whole mixed line %s with one baseline",
    async (align) => {
      const renderer = fakeMath();
      const object = text("E=$x$.", {
        align,
        transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
      });
      const layout = await layoutInlineText(object, deck);
      const line = layout.lines[0];
      expect(renderer).toHaveBeenCalledWith(
        "x",
        "mathjax-stix2",
        40,
        "#234567",
        false,
      );
      expect(line.width).toBe(100);
      const offset = align === "center" ? 50 : align === "right" ? 100 : 0;
      expect(line.runs.map((run) => run.x)).toEqual([
        offset,
        offset + 40,
        offset + 80,
      ]);
      expect(line.baseline).toBe(40);
      expect(line.height).toBe(52);
      expect((line.runs[1] as InlineEquationRun).y).toBe(8);
    },
  );

  it("matches math optical size and preserves the vector baseline and viewBox", async () => {
    measureXHeight(0.75);
    const equation = {
      width: 40,
      height: 44,
      baseline: 32,
      xHeight: 20,
      svg: '<svg width="40" height="44" viewBox="0 -800 1000 1100"><path d="M0 0L1 1"/></svg>',
    };
    vi.spyOn(equations, "renderEquation").mockResolvedValue(equation);
    const layout = await layoutInlineText(
      text("E=$x$.", {
        align: "center",
        transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
      }),
      deck,
    );
    const line = layout.lines[0];
    const run = line.runs[1] as InlineEquationRun;
    expect(line.width).toBe(120);
    expect(line.runs.map((part) => part.x)).toEqual([40, 80, 140]);
    expect(run.width).toBe(60);
    expect(run.height).toBe(66);
    expect(line.baseline).toBe(48);
    expect(run.y + equation.baseline * 1.5).toBe(line.baseline);
    expect(run.svg).toContain('width="60" height="66"');
    expect(run.svg).toContain('viewBox="0 -800 1000 1100"');
    expect(run.svg).toContain('<path d="M0 0L1 1"/>');
    expect(equation.width).toBe(40);
    expect(equation.svg).toContain('width="40" height="44"');
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    "keeps intrinsic math dimensions when the canvas x-height is unavailable (%s)",
    async (metric) => {
      measureXHeight(metric);
      vi.spyOn(equations, "renderEquation").mockResolvedValue({
        width: 40,
        height: 44,
        baseline: 32,
        xHeight: 20,
        svg: '<svg width="40" height="44"><path d="M0 0L1 1"/></svg>',
      });
      const layout = await layoutInlineText(text("A $x$"), deck);
      const run = layout.lines[0].runs[2] as InlineEquationRun;
      expect(run.width).toBe(40);
      expect(run.height).toBe(44);
      expect(run.y + 32).toBe(layout.lines[0].baseline);
      expect(run.svg).toContain('width="40" height="44"');
    },
  );

  it("uses scaled widths when wrapping and preserves an indivisible equation", async () => {
    measureXHeight(0.75);
    vi.spyOn(equations, "renderEquation").mockResolvedValue({
      width: 60,
      height: 24,
      baseline: 20,
      xHeight: 20,
      svg: '<svg width="60" height="24"><path d="M0 0L1 1"/></svg>',
    });
    const layout = await layoutInlineText(
      text("A $x$", {
        transform: { x: 0, y: 0, width: 110, height: 200, rotation: 0 },
      }),
      deck,
    );
    expect(layout.lines.map((line) => line.width)).toEqual([20, 90]);
    expect(layout.lines[1].runs).toHaveLength(1);
    expect(layout.lines[1].runs[0].type).toBe("math");
  });

  it("expands tall math line spacing and retains explicit empty paragraphs", async () => {
    fakeMath(40, 130, 95);
    const layout = await layoutInlineText(text("A $x$\n\nB"), deck);
    expect(layout.lines.map((line) => line.baseline)).toEqual([95, 170, 222]);
    expect(layout.lines.map((line) => line.height)).toEqual([130, 52, 52]);
    expect(layout.lines[1].runs).toEqual([]);
    expect(layout.height).toBe(234);
    const math = layout.lines[0].runs.find(
      (run) => run.type === "math",
    ) as InlineEquationRun;
    expect(math.y).toBe(0);
  });

  it.each([-20, 80])(
    "retains a shifted glyph's out-of-box baseline (%s)",
    async (baseline) => {
      fakeMath(40, 10, baseline);
      const layout = await layoutInlineText(text("A $x$\nB"), deck);
      const line = layout.lines[0];
      const math = line.runs.find(
        (run) => run.type === "math",
      ) as InlineEquationRun;
      expect(math.y + baseline).toBe(line.baseline);
      expect(math.y).toBeGreaterThanOrEqual(0);
      expect(math.y + math.height).toBeLessThanOrEqual(line.height);
      expect(layout.lines[1].baseline).toBe(line.height + 40);
    },
  );

  it("keeps math and attached punctuation together, and never splits oversized math", async () => {
    fakeMath(80, 44, 32);
    const layout = await layoutInlineText(
      text("A $x$.", {
        transform: { x: 0, y: 0, width: 100, height: 500, rotation: 0 },
      }),
      deck,
    );
    expect(layout.lines.map((line) => line.width)).toEqual([20, 100]);
    expect(layout.lines[1].runs.map((run) => run.type)).toEqual([
      "math",
      "text",
    ]);
    vi.restoreAllMocks();
    fakeMath(200, 44, 32);
    // Reuse the existing spy-created measuring context through a fresh setup.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (value: string) => ({ width: [...value].length * 20 }),
    } as unknown as CanvasRenderingContext2D);
    const oversized = await layoutInlineText(
      text("A $x$ B", {
        transform: { x: 0, y: 0, width: 100, height: 500, rotation: 0 },
      }),
      deck,
    );
    expect(oversized.lines.map((line) => line.width)).toEqual([20, 200, 20]);
    expect(
      oversized.lines
        .flatMap((line) => line.runs)
        .filter((run) => run.type === "math"),
    ).toHaveLength(1);
  });

  it("normalizes Korean prose and wraps long words by code point", async () => {
    fakeMath();
    const object = text("에너지$x$ 값\n😀abc", {
      transform: { x: 0, y: 0, width: 100, height: 500, rotation: 0 },
    });
    const layout = await layoutInlineText(object, deck);
    expect(layout.fontFamily).toBe("Nanum Gothic");
    expect(layout.fontWeight).toBe(700);
    const rendered = layout.lines
      .flatMap((line) => line.runs)
      .filter((run) => run.type === "text")
      .map((run) => run.text)
      .join("");
    expect(rendered).toContain("에너지");
    expect(rendered).toContain("😀abc");
    expect(layout.lines.every((line) => line.width <= 100)).toBe(true);
    expect(object.text).toContain("에너지");
  });

  it("awaits prose fonts and keeps simultaneous layout measurements independent", async () => {
    const pending: Array<() => void> = [];
    const load = vi.fn(
      () =>
        new Promise<FontFace[]>((resolve) => pending.push(() => resolve([]))),
    );
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load },
    });
    fakeMath();
    try {
      const small = layoutInlineText(text("a $x$", { fontSize: 20 }), deck);
      const large = layoutInlineText(text("한 $x$", { fontSize: 60 }), deck);
      expect(load).toHaveBeenCalledWith('600 20px "Inter"', "a x");
      expect(load).toHaveBeenCalledWith('700 60px "Nanum Gothic"', "한 x");
      pending[1]();
      const big = await large;
      pending[0]();
      const little = await small;
      expect(big.lines[0].width).toBe(130);
      expect(little.lines[0].width).toBe(60);
    } finally {
      Reflect.deleteProperty(document, "fonts");
    }
  });

  it("measures x-height after font loading independently for concurrent font families", async () => {
    const pending: Array<() => void> = [];
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        load: vi.fn(
          () =>
            new Promise<FontFace[]>((resolve) =>
              pending.push(() => resolve([])),
            ),
        ),
      },
    });
    const measure = vi.fn(function (this: { font: string }, value: string) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1]);
      const units = [...value].reduce(
        (sum, character) =>
          sum + (/[\uac00-\ud7af]/u.test(character) ? 1 : 0.5),
        0,
      );
      return {
        width: units * size,
        actualBoundingBoxAscent:
          (this.font.includes("Nanum Gothic") ? 0.75 : 0.5) * size,
      };
    });
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
      () =>
        ({
          font: "",
          measureText: measure,
        }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(equations, "renderEquation").mockImplementation(
      async (_latex, _font, size) => ({
        width: size,
        height: size * 0.5,
        baseline: size * 0.5,
        xHeight: size * 0.4,
        svg: `<svg width="${size}" height="${size * 0.5}"><path d="M0 0L1 1"/></svg>`,
      }),
    );
    try {
      const small = layoutInlineText(text("a $x$", { fontSize: 20 }), deck);
      const large = layoutInlineText(text("한 $x$", { fontSize: 60 }), deck);
      expect(measure).not.toHaveBeenCalled();
      pending[1]();
      const big = await large;
      pending[0]();
      const little = await small;
      const bigMath = big.lines[0].runs.find(
        (run) => run.type === "math",
      ) as InlineEquationRun;
      const littleMath = little.lines[0].runs.find(
        (run) => run.type === "math",
      ) as InlineEquationRun;
      expect(bigMath.width).toBe(112.5);
      expect(littleMath.width).toBe(25);
      expect(big.lines[0].width).toBe(202.5);
      expect(little.lines[0].width).toBe(45);
      expect(bigMath.y + 56.25).toBe(big.lines[0].baseline);
      expect(littleMath.y + 12.5).toBe(little.lines[0].baseline);
    } finally {
      Reflect.deleteProperty(document, "fonts");
    }
  });

  it("enforces layout work budgets without executing any renderer", async () => {
    const renderer = fakeMath();
    await expect(
      layoutInlineText(text("$x$ ".repeat(129)), deck),
    ).rejects.toThrow(/128 inline/);
    await expect(
      layoutInlineText(text("a".repeat(100_001)), deck),
    ).rejects.toThrow(/100,000/);
    expect(renderer).not.toHaveBeenCalled();
  });

  it("uses real vector math in every bundled font with unclamped baseline and stable cache copies", async () => {
    const source = String.raw`\frac{1}{1+x^2}`;
    const results = [];
    for (const fontSetId of [
      "mathjax-stix2",
      "mathjax-fira",
      "mathjax-modern",
    ] as const) {
      const current = structuredClone(deck);
      current.theme.equation.fontSetId = fontSetId;
      const layout = await layoutInlineText(
        text(`Energy $${source}$ remains.`),
        current,
      );
      const run = layout.lines[0].runs.find(
        (candidate) => candidate.type === "math",
      ) as InlineEquationRun;
      expect(run.svg).toContain("<path");
      expect(run.svg).not.toMatch(/<(?:text|image|script|use)\b/);
      expect(run.svg).toContain('fill="#234567"');
      const equation = await equations.renderEquation(
        source,
        fontSetId,
        40,
        "#234567",
        false,
      );
      const viewBox = equation.svg
        .match(/viewBox="([^"]+)"/)![1]
        .split(/\s+/)
        .map(Number);
      expect(equation.baseline).toBeCloseTo((-viewBox[1] * 40) / 1000);
      expect(run.y + equation.baseline!).toBeCloseTo(layout.lines[0].baseline);
      const expected = equation.baseline;
      const expectedXHeight = equation.xHeight;
      expect(expectedXHeight).toBeGreaterThan(0);
      equation.baseline = -999;
      equation.xHeight = -999;
      const cached = await equations.renderEquation(
        source,
        fontSetId,
        40,
        "#234567",
        false,
      );
      expect(cached.baseline).toBe(expected);
      expect(cached.xHeight).toBe(expectedXHeight);
      results.push(run.svg);
    }
    expect(new Set(results).size).toBe(3);
  });

  it("matches measured prose x-height in every bundled math font with real paths", async () => {
    measureXHeight(0.6);
    for (const fontSetId of [
      "mathjax-stix2",
      "mathjax-fira",
      "mathjax-modern",
    ] as const) {
      const current = structuredClone(deck);
      current.theme.equation.fontSetId = fontSetId;
      const equation = await equations.renderEquation(
        "x",
        fontSetId,
        40,
        "#234567",
        false,
      );
      const layout = await layoutInlineText(text("x $x$"), current);
      const run = layout.lines[0].runs.find(
        (candidate) => candidate.type === "math",
      ) as InlineEquationRun;
      const scale = 24 / equation.xHeight!;
      expect(run.width).toBeCloseTo(equation.width * scale);
      // Glyph ink may overshoot the font's nominal x-height slightly.
      expect(equation.xHeight! * scale).toBeCloseTo(24);
      expect(run.height).toBeCloseTo(equation.height * scale);
      expect(run.y + equation.baseline! * scale).toBeCloseTo(
        layout.lines[0].baseline,
      );
      const svg = new DOMParser().parseFromString(
        run.svg,
        "image/svg+xml",
      ).documentElement;
      expect(Number(svg.getAttribute("width"))).toBe(run.width);
      expect(Number(svg.getAttribute("height"))).toBe(run.height);
      expect(svg.querySelector("path")).not.toBeNull();
      expect(svg.getAttribute("viewBox")).toBe(
        new DOMParser()
          .parseFromString(equation.svg, "image/svg+xml")
          .documentElement.getAttribute("viewBox"),
      );
    }
  });

  it("reports the failed TeX fragment and remains usable after invalid math", async () => {
    await expect(
      layoutInlineText(
        text(String.raw`Text $\unknownInlineCommand$ here`),
        deck,
      ),
    ).rejects.toThrow(/unknownInlineCommand/);
    expect(
      (await layoutInlineText(text("Text $x$"), deck)).lines[0].runs.some(
        (run) => run.type === "math",
      ),
    ).toBe(true);
  });
});
