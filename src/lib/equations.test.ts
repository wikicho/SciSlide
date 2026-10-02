import { describe, expect, it } from "vitest";
import {
  FONT_OPTIONS,
  SUPPORTED_MATH_PACKAGES,
  renderEquation,
} from "./equations";

const ratio = String.raw`\alpha = \frac{\rho_{\mathrm{vac}}}{\rho_{\mathrm{rad}}}`;

describe("local equation renderer", () => {
  it("renders genuinely different, self-contained vector glyphs for the three font profiles", async () => {
    const equations = await Promise.all(
      FONT_OPTIONS.map((font) => renderEquation(ratio, font.id, 44, "#234567")),
    );
    const glyphPaths = equations.map(({ svg }) =>
      [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)]
        .map((match) => match[1])
        .join("|"),
    );
    expect(new Set(glyphPaths).size).toBe(3);
    for (const equation of equations) {
      expect(equation.width).toBeGreaterThan(100);
      expect(equation.height).toBeGreaterThan(44);
      expect(equation.svg).toContain("<path");
      expect(equation.svg).toContain('fill="#234567"');
      expect(equation.svg).not.toMatch(
        /<(?:use|text|image|script)|currentColor|href=/,
      );
      expect(equation.svg).toContain(`width="${equation.width}"`);
    }
  });

  it("renders AMS alignment, matrices, integrals and less common locally bundled glyph ranges", async () => {
    const formulas = [
      String.raw`\begin{aligned} F(x) &= \int_0^x e^{-t^2}\,dt \\ A &= \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix} \end{aligned}`,
      String.raw`\mathbb{R} \nexists \hbar \varnothing \oiint_{\partial\Omega} \boldsymbol{\alpha}`,
      String.raw`\text{Energy}\quad E = mc^2`,
    ];
    for (const font of FONT_OPTIONS) {
      for (const formula of formulas) {
        const result = await renderEquation(formula, font.id, 32, "#222222");
        expect(result.svg).toContain("<path");
        expect(result.svg).not.toContain("<text");
        expect(result.width).toBeGreaterThan(10);
      }
    }
  });

  it("uses intrinsic viewBox metrics that scale with font size", async () => {
    const small = await renderEquation(
      "x^2 + y^2 = 1",
      "mathjax-stix2",
      24,
      "#000000",
    );
    const large = await renderEquation(
      "x^2 + y^2 = 1",
      "mathjax-stix2",
      48,
      "#000000",
    );
    expect(large.width).toBeCloseTo(small.width * 2);
    expect(large.height).toBeCloseTo(small.height * 2);
  });

  it("uses STIX only for missing glyphs and keeps fallback metadata isolated in the queue and cache", async () => {
    const source = String.raw`x+\Finv+\Game+\nleqslant+\mathbb{01}+\digamma`;
    const [stix, fira, modern] = await Promise.all(
      FONT_OPTIONS.map((font) =>
        renderEquation(source, font.id, 29, "#345678"),
      ),
    );
    expect(stix.fallbackGlyphs).toBeUndefined();
    expect(fira.fallbackGlyphs?.length).toBeGreaterThan(0);
    expect(modern.fallbackGlyphs?.length).toBeGreaterThan(0);
    for (const result of [stix, fira, modern]) {
      expect(result.svg).not.toMatch(/<(?:text|image|use|script)\b|href=/);
      expect(result.svg).toContain("<path");
    }
    const paths = (svg: string) =>
      [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map((match) => match[1]);
    const firaX = await renderEquation("x", "mathjax-fira", 29, "#345678");
    // The same native x outline is present in the mixed equation; fallback does
    // not replace the whole equation with STIX.
    expect(paths(fira.svg)).toContain(paths(firaX.svg)[0]);
    const used = [...fira.fallbackGlyphs!];
    fira.fallbackGlyphs!.push(0x123456);
    const cached = await renderEquation(source, "mathjax-fira", 29, "#345678");
    expect(cached.fallbackGlyphs).toEqual(used);
    const [native, fallback] = await Promise.all([
      renderEquation("y", "mathjax-fira", 29, "#456789"),
      renderEquation(String.raw`\Finv`, "mathjax-fira", 29, "#456789"),
    ]);
    expect(native.fallbackGlyphs).toBeUndefined();
    expect(fallback.fallbackGlyphs?.length).toBeGreaterThan(0);
    await expect(
      renderEquation("😀", "mathjax-fira", 29, "#456789"),
    ).rejects.toThrow(/unavailable as a vector glyph/);
    expect(
      (await renderEquation("z", "mathjax-fira", 29, "#456789")).fallbackGlyphs,
    ).toBeUndefined();
  });

  it("rejects invalid or unsupported TeX and remains usable after an error", async () => {
    await expect(
      renderEquation(String.raw`\frac{1}{`, "mathjax-stix2", 32, "#000000"),
    ).rejects.toThrow();
    await expect(
      renderEquation(
        String.raw`\notARealCommand`,
        "mathjax-stix2",
        32,
        "#000000",
      ),
    ).rejects.toThrow(/Undefined control sequence/i);
    await expect(
      renderEquation(
        String.raw`\require{html}`,
        "mathjax-stix2",
        32,
        "#000000",
      ),
    ).rejects.toThrow(/not supported/);
    await expect(
      renderEquation("x", "mathjax-stix2", 32, "url(https://example.com)"),
    ).rejects.toThrow(/plain color/);
    await expect(
      renderEquation(
        String.raw`\color{url(https://example.com)}x`,
        "mathjax-stix2",
        32,
        "#000000",
      ),
    ).rejects.toThrow(/plain colors/);
    expect(
      (await renderEquation("x", "mathjax-stix2", 32, "#000000")).svg,
    ).toContain("<path");
  });

  it("isolates custom commands between equation objects", async () => {
    await renderEquation(
      String.raw`\newcommand{\sciLocalMacro}{x^2}\sciLocalMacro`,
      "mathjax-modern",
      32,
      "#000000",
    );
    await expect(
      renderEquation(
        String.raw`\sciLocalMacro`,
        "mathjax-modern",
        32,
        "#000000",
      ),
    ).rejects.toThrow();
  });

  it("renders every advertised local package example as vectors in every font", async () => {
    for (const font of FONT_OPTIONS) {
      for (const mathPackage of SUPPORTED_MATH_PACKAGES) {
        const result = await renderEquation(
          mathPackage.example,
          font.id,
          28,
          "#234567",
        );
        expect(result.svg, `${font.id}: ${mathPackage.id}`).toContain("<path");
        expect(result.svg, `${font.id}: ${mathPackage.id}`).not.toMatch(
          /<(?:text|image|use|script)\b|href=/,
        );
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
      }
    }
  });

  it("accepts leading AMS aliases and comments while preserving the original equation source", async () => {
    const body = String.raw`\mathbb{R}+\mathfrak{g}+\boldsymbol{\alpha}\coloneqq\begin{pmatrix}1&0\\0&1\end{pmatrix}`;
    const declared =
      String.raw`% Paste an equation from a scientific document
\usepackage{amsmath, amsfonts, amssymb, mathtools}
% Examples such as \require{html} remain comments, not package requests.
\require{boldsymbol}
% Neither is \usepackage{not-supported} inside this leading comment.
` + body;
    for (const font of FONT_OPTIONS) {
      const raw = await renderEquation(body, font.id, 28, "#123456");
      const withPackages = await renderEquation(
        declared,
        font.id,
        28,
        "#123456",
      );
      expect(withPackages.width).toBeCloseTo(raw.width);
      expect(withPackages.height).toBeCloseTo(raw.height);
      expect(
        [...withPackages.svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      ).toEqual(
        [...raw.svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      );
      expect(withPackages.svg).toContain(
        String.raw`\usepackage{amsmath, amsfonts, amssymb, mathtools}`,
      );
      expect(raw.svg).not.toContain(String.raw`\usepackage`);
    }
  });

  it("enables physics per equation without replacing the default division symbol", async () => {
    for (const font of FONT_OPTIONS) {
      const before = await renderEquation(
        String.raw`a\div b`,
        font.id,
        30,
        "#111111",
      );
      await expect(
        renderEquation(String.raw`\pdv{f}{x}`, font.id, 30, "#111111"),
      ).rejects.toThrow(/Undefined control sequence/);
      for (const command of ["usepackage", "require"]) {
        const result = await renderEquation(
          `\\${command}{physics}\n` + String.raw`\pdv{f}{x}+\div\vb{F}`,
          font.id,
          30,
          "#111111",
        );
        expect(result.svg).toContain("<path");
      }
      // A different color prevents a cache hit, so this checks parser isolation.
      const after = await renderEquation(
        String.raw`a\div b`,
        font.id,
        30,
        "#222222",
      );
      expect(after.width).toBeCloseTo(before.width);
      expect(after.height).toBeCloseTo(before.height);
      expect(
        [...after.svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      ).toEqual(
        [...before.svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      );
      await expect(
        renderEquation(String.raw`\pdv{g}{y}`, font.id, 30, "#111111"),
      ).rejects.toThrow(/Undefined control sequence/);
    }
  });

  it("rejects unsupported, malformed or late declarations with actionable errors", async () => {
    const failures: Array<[string, RegExp]> = [
      [String.raw`\usepackage{tikz}x`, /Package "tikz" is not supported/],
      [String.raw`\require{html}x`, /Package "html" is not supported/],
      [
        String.raw`\usepackage{amsmath,not-a-package}x`,
        /Package "not-a-package" is not supported/,
      ],
      [
        String.raw`\usepackage[italicdiff]{physics}x`,
        /Package options are not supported/,
      ],
      [
        String.raw`\require[options]{physics}x`,
        /Package options are not supported/,
      ],
      [String.raw`\usepackage amsmath`, /Malformed \\usepackage declaration/],
      [String.raw`\require{physics`, /Malformed \\require declaration/],
      [
        String.raw`\usepackage{{amsmath}}x`,
        /Malformed \\usepackage declaration/,
      ],
      [String.raw`\usepackage{}x`, /Package "\(empty\)" is not supported/],
      [
        String.raw`\usepackage{amsmath,}x`,
        /Package "\(empty\)" is not supported/,
      ],
      [
        String.raw`\usepackage{amsmath}% There is no equation`,
        /Enter a LaTeX equation after/,
      ],
      [String.raw`x+\usepackage{amsmath}`, /\\usepackage is not supported/],
      [String.raw`x+\require{physics}\pdv{f}{x}`, /\\require is not supported/],
      [
        String.raw`\require{physics}\href{https://example.com}{x}`,
        /\\href is not supported/,
      ],
      [
        String.raw`\usepackage{color}\color{url(https://example.com)}x`,
        /plain colors/,
      ],
      [
        String.raw`\usepackage{amsmath}\input{secret}`,
        /\\input is not supported/,
      ],
      [
        String.raw`\require{physics}\autoload{html}`,
        /\\autoload is not supported/,
      ],
    ];
    for (const [source, error] of failures) {
      await expect(
        renderEquation(source, "mathjax-stix2", 30, "#111111"),
      ).rejects.toThrow(error);
    }
    await expect(
      renderEquation(
        "%" + "a".repeat(12_000) + "\n" + String.raw`\require{physics}x`,
        "mathjax-stix2",
        30,
        "#111111",
      ),
    ).rejects.toThrow(/maximum 12,000 characters/);
    expect(
      (await renderEquation("x", "mathjax-stix2", 30, "#111111")).svg,
    ).toContain("<path");
  });
});
