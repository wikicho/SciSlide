import { describe, expect, it } from "vitest";
import {
  assertEquationDocumentLimits,
  moveLeadingPackagesToPreamble,
} from "../src/lib/local-tex-draft";

const ams = String.raw`\usepackage{amsmath,amsfonts,amssymb}`;

describe("MathJax to Local LaTeX package relocation", () => {
  it("moves Physics declarations into the preamble instead of math mode", () => {
    const result = moveLeadingPackagesToPreamble(
      String.raw`\usepackage{physics}
\pdv{f}{x}`,
      ams,
    );
    expect(result.source).toBe(String.raw`
\pdv{f}{x}`);
    expect(result.preamble).toBe(ams + "\n" + String.raw`\usepackage{physics}`);
  });

  it("translates require while keeping declaration comments and expression comments", () => {
    const source = String.raw`% Existing source comment
\require % Package comment
{physics}
% Expression comment
\ket{\psi}`;
    const result = moveLeadingPackagesToPreamble(source, "");
    expect(result.source).toBe(String.raw`% Existing source comment

% Expression comment
\ket{\psi}`);
    expect(result.preamble).toBe(String.raw`\usepackage % Package comment
{physics}`);
  });

  it("preserves options, nested braces, escaped brackets and package lists", () => {
    const declaration = String.raw`\usepackage[foo={a]b},bar=\]]{first,second}`;
    const result = moveLeadingPackagesToPreamble(declaration + "\nx^2", ams);
    expect(result.preamble).toBe(ams + "\n" + declaration);
    expect(result.source).toBe("\nx^2");
  });

  it("avoids identical literal package loads, including default AMS packages", () => {
    const result = moveLeadingPackagesToPreamble(
      String.raw`\usepackage{amsmath,amssymb}
\usepackage{physics}
\require{physics}
x`,
      ams,
    );
    expect(result.source).toBe("\n\n\nx");
    expect(result.preamble).toBe(ams + "\n" + String.raw`\usepackage{physics}`);
  });

  it("preserves declaration comments even when that package is already loaded", () => {
    const declaration = String.raw`\usepackage % Keep this annotation
{amsmath}`;
    expect(
      moveLeadingPackagesToPreamble(declaration + "\nx", ams).preamble,
    ).toBe(ams + "\n" + declaration);
  });

  it("retains distinct options and avoids guessing about macros or deferred loaders", () => {
    const preamble = String.raw`\usepackage[first]{pkg}`;
    expect(
      moveLeadingPackagesToPreamble(
        String.raw`\usepackage[second]{pkg}x`,
        preamble,
      ).preamble,
    ).toBe(preamble + "\n" + String.raw`\usepackage[second]{pkg}`);
    const definitions = String.raw`\newcommand{\example}{\usepackage{physics}}`;
    expect(
      moveLeadingPackagesToPreamble(
        String.raw`\usepackage{physics}x`,
        definitions,
      ).preamble,
    ).toBe(definitions + "\n" + String.raw`\usepackage{physics}`);
    const delimitedMacro = String.raw`\def\example\usepackage#1{#1}`;
    expect(
      moveLeadingPackagesToPreamble(
        String.raw`\usepackage{physics}x`,
        delimitedMacro,
      ).preamble,
    ).toBe(delimitedMacro + "\n" + String.raw`\usepackage{physics}`);
  });

  it("leaves actual expressions, escaped percent signs and non-leading declarations untouched", () => {
    const source = String.raw`\%+x+\usepackage{physics}`;
    expect(moveLeadingPackagesToPreamble(source, ams)).toEqual({
      source,
      preamble: ams,
    });
    const late = String.raw`\usepackage{physics}x+\require{cancel}`;
    expect(moveLeadingPackagesToPreamble(late, "").source).toBe(
      String.raw`x+\require{cancel}`,
    );
  });

  it("reports malformed prefix declarations without altering them", () => {
    expect(() =>
      moveLeadingPackagesToPreamble(
        String.raw`\usepackage[foo={x} physics}x`,
        ams,
      ),
    ).toThrow("괄호");
    expect(() =>
      moveLeadingPackagesToPreamble(String.raw`\require physics x`, ams),
    ).toThrow("중괄호");
  });
});

describe("equation document bounds", () => {
  it("accepts exact model bounds and rejects text a compiled object cannot save", () => {
    expect(() =>
      assertEquationDocumentLimits("x".repeat(32_000), "%".repeat(16_000)),
    ).not.toThrow();
    expect(() => assertEquationDocumentLimits("x".repeat(32_001), "")).toThrow(
      "32,000",
    );
    expect(() => assertEquationDocumentLimits("x", "%".repeat(16_001))).toThrow(
      "16,000",
    );
  });

  it("prevents relocation from silently producing an oversized preamble", () => {
    expect(() =>
      moveLeadingPackagesToPreamble(
        String.raw`\usepackage{physics}x`,
        "%".repeat(16_000),
      ),
    ).toThrow("16,000");
  });
});
