import { describe, expect, it } from "vitest";
import { FONT_OPTIONS, renderEquation } from "../src/lib/equations";

const amsCases = {
  alphabets: String.raw`\mathbb{C R N Q Z H} \mathfrak{g h sl} \mathcal{ABC} \mathscr{ABC}`,
  amssymb: String.raw`\nexists \varnothing \hbar \beth \aleph \Bbbk \mho \lesssim \gtrsim \npreceq \therefore \because`,
  boldsymbol: String.raw`\boldsymbol{\alpha \beta \Gamma \nabla} + \boldsymbol{A}`,
  amsmath_substack: String.raw`\sum_{\substack{i,j=1 \\ i<j}}^n a_{ij}`,
  amsmath_arrows: String.raw`A \xrightarrow[\alpha]{\beta} B \xleftarrow{\gamma} C`,
  amsmath_operator: String.raw`\DeclareMathOperator{\Hom}{Hom}\DeclareMathOperator*{\argmax}{arg\,max}\Hom(V,W)+\argmax_{x\in\mathbb R}f(x)`,
  amsmath_cases: String.raw`f(x)=\begin{cases}x^2 & \text{if }x>0 \\ 0 & \text{otherwise}\end{cases}`,
  amsmath_align: String.raw`\begin{align} a&=b+c \\ d&=e+f \end{align}`,
  amsmath_matrix: String.raw`\begin{bmatrix}1&0\\0&1\end{bmatrix}+\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
  amsmath_split: String.raw`\begin{split}a&=b+c\\&=d+e\end{split}`,
  amsmath_gather: String.raw`\begin{gather}a=b\\c=d\end{gather}`,
  amsmath_misc: String.raw`\boxed{\dfrac{\tbinom{n}{k}}{\genfrac{[}{]}{0pt}{}{n}{k}}}\qquad\iint_\Omega f\,d\Omega\qquad\sideset{_a^b}{_c^d}\sum`,
  mathtools: String.raw`a\coloneqq b\qquad\mathclap{ABC}\qquad\underbracket{x+y}\qquad\begin{dcases}\frac{1}{x} & x>0\\0&x=0\end{dcases}`,
  mathtools_paired: String.raw`\DeclarePairedDelimiter{\abs}{\lvert}{\rvert}\abs*{\frac{a}{b}}`,
  mathtools_matrix: String.raw`\begin{pmatrix*}[r]1&-2\\30&4\end{pmatrix*}`,
};

describe("AMS compatibility audit", () => {
  it("renders rare AMS symbols and expanded blackboard/fraktur alphabets with STIX", async () => {
    const sources = [
      String.raw`\digamma\Finv\Game\nleqslant`,
      String.raw`\mathbb{abcdefghijklmnopqrstuvwxyz0123456789}`,
      String.raw`\mathfrak{0123456789}`,
    ];
    for (const source of sources) {
      const result = await renderEquation(
        source,
        "mathjax-stix2",
        32,
        "#111111",
      );
      expect(result.svg).toContain("<path");
      expect(result.svg).not.toMatch(/<(?:text|image|use)\b/);
      expect(result.fallbackGlyphs).toBeUndefined();
    }
  });

  it("fills rare Fira and Modern glyph gaps with disclosed vector fallback", async () => {
    for (const source of [
      String.raw`\Finv`,
      String.raw`\Game`,
      String.raw`\nleqslant`,
      String.raw`\mathbb{0123456789}`,
    ]) {
      const result = await renderEquation(
        source,
        "mathjax-fira",
        32,
        "#111111",
      );
      expect(result.svg).toContain("<path");
      expect(result.svg).not.toMatch(/<(?:text|image|use)\b/);
      expect(result.fallbackGlyphs?.length).toBeGreaterThan(0);
      expect(result.width).toBeGreaterThan(0);
    }
    const modern = await renderEquation(
      String.raw`\digamma`,
      "mathjax-modern",
      32,
      "#111111",
    );
    expect(modern.svg).toContain("<path");
    expect(modern.svg).not.toMatch(/<(?:text|image|use)\b/);
    expect(modern.fallbackGlyphs?.length).toBeGreaterThan(0);
  });

  it("still reports unsupported characters when no bundled vector font covers them", async () => {
    await expect(
      renderEquation("😀", "mathjax-fira", 32, "#111111"),
    ).rejects.toThrow(/vector glyph/);
  });

  it("audits common AMS and mathtools expressions in every bundled font", async () => {
    for (const font of FONT_OPTIONS) {
      for (const [name, source] of Object.entries(amsCases)) {
        const result = await renderEquation(source, font.id, 32, "#111111");
        expect(result.svg, `${font.id}: ${name}`).toContain("<path");
        expect(result.svg, `${font.id}: ${name}`).not.toMatch(
          /<(?:text|image|use)\b/,
        );
        expect(result.width).toBeGreaterThan(0);
      }
    }
  });
});
