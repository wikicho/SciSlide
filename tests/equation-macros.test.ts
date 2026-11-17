import { describe, expect, it } from "vitest";
import {
  EQUATION_MACROS_KEY,
  applyMacroFavorite,
  loadMacroFavorites,
  parseMacroDefinitions,
  saveMacroFavorites,
  wrapEquationSourceColor,
} from "../src/lib/equation-macros";
import { renderEquation } from "../src/lib/equations";
import { createDemoDeck } from "../src/lib/model";
import type { EquationObject } from "../src/lib/model";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";
import {
  localTexInputFingerprint,
  localTexInputs,
  renderObjectEquation,
} from "../src/lib/equation-renderer";
const favorite = {
  id: "real",
  name: "Real numbers",
  definitions: String.raw`\newcommand{\favoriteReal}{\mathbb{R}}`,
  invocation: String.raw`\favoriteReal`,
};

describe("portable equation command favorites", () => {
  it("parses bounded definitions, arguments, comments and defaults without evaluating", () => {
    const result = parseMacroDefinitions(String.raw`% commands
\newcommand{\favoriteReal}{\mathbb{R}}
\newcommand{\favoriteNorm}[1]{\lVert#1\rVert}
\newcommand{\favoritePair}[2][x]{{#1}+{#2}}`);
    expect(result.map((item) => item.name)).toEqual([
      String.raw`\favoriteReal`,
      String.raw`\favoriteNorm`,
      String.raw`\favoritePair`,
    ]);
  });
  it.each([
    String.raw`\input{secret}`,
    String.raw`\newcommand{\bad}{\write18{touch test}}`,
    String.raw`\newcommand{\bad}{\csname input\endcsname}`,
    String.raw`\newcommand{\bad}{^^5cinput}`,
    String.raw`\newcommand{\bad}{\href{https://example.test}{x}}`,
    String.raw`\newcommand{\bad}{\bad}`,
    String.raw`\newcommand{\first}{\second}\newcommand{\second}{\first}`,
    String.raw`\newcommand{\bad}[1]{#2}`,
    String.raw`\newcommand{\bad}{x`,
    String.raw`\newcommand{\bad}{x}\newcommand{\bad}{y}`,
    String.raw`\newcommand{\bad}{x}y`,
  ])("rejects malformed or external/control definitions: %s", (source) =>
    expect(() => parseMacroDefinitions(source)).toThrow(),
  );
  it("roundtrips local favorites and leaves corrupt/denied storage unchanged", () => {
    let raw: string | null = null;
    const storage = {
      getItem: (key: string) => {
        expect(key).toBe(EQUATION_MACROS_KEY);
        return raw;
      },
      setItem: (_key: string, next: string) => {
        raw = next;
      },
    };
    expect(loadMacroFavorites(storage)).toEqual([]);
    saveMacroFavorites([favorite], storage);
    expect(loadMacroFavorites(storage)).toEqual([favorite]);
    raw = "{broken";
    expect(() => loadMacroFavorites(storage)).toThrow();
    expect(raw).toBe("{broken");
    expect(() =>
      saveMacroFavorites([favorite], {
        setItem() {
          throw new Error("quota");
        },
      }),
    ).toThrow("quota");
    expect(() => saveMacroFavorites([favorite, favorite], storage)).toThrow(
      /duplicate/,
    );
  });
  it("inserts after package declarations and deduplicates repeated uses", async () => {
    const original = String.raw`\usepackage{amsfonts}
x+1`;
    const result = applyMacroFavorite(
      original,
      "",
      "mathjax",
      favorite,
      original.length,
      original.length,
    );
    expect(result.source).toBe(String.raw`\usepackage{amsfonts}
\newcommand{\favoriteReal}{\mathbb{R}}
x+1\favoriteReal`);
    expect(
      result.source.slice(result.selectionStart, result.selectionEnd),
    ).toBe(favorite.invocation);
    const repeated = applyMacroFavorite(
      result.source,
      "",
      "mathjax",
      favorite,
      result.source.length,
      result.source.length,
    );
    expect(repeated.source.split(favorite.definitions)).toHaveLength(2);
    expect(
      (await renderEquation(repeated.source, "mathjax-modern", 32, "#111827"))
        .svg,
    ).toContain("<path");
    await expect(
      renderEquation(favorite.invocation, "mathjax-modern", 32, "#111827"),
    ).rejects.toThrow();
  });
  it("rejects conflicting definitions without replacing source", () => {
    const source = String.raw`\newcommand{\favoriteReal}{x}x`;
    expect(() =>
      applyMacroFavorite(
        source,
        "",
        "mathjax",
        favorite,
        source.length,
        source.length,
      ),
    ).toThrow(/already defines/);
    expect(source).toBe(String.raw`\newcommand{\favoriteReal}{x}x`);
  });
  it("does not mistake a commented definition for an active portable command", async () => {
    const source = "% " + favorite.definitions + "\nx=";
    const result = applyMacroFavorite(
      source,
      "",
      "mathjax",
      favorite,
      source.length,
      source.length,
    );
    expect(result.source.split(favorite.definitions)).toHaveLength(3);
    expect(
      (await renderEquation(result.source, "mathjax-modern", 32, "#111827"))
        .svg,
    ).toContain("<path");
    expect(() =>
      applyMacroFavorite(
        String.raw`\newcommand\favoriteReal{x}x`,
        "",
        "mathjax",
        favorite,
        0,
        0,
      ),
    ).toThrow(/already defines/);
  });
  it("copies Local LaTeX definitions into portable preamble without changing display environments", () => {
    const source = String.raw`\begin{align}x&=1\end{align}`,
      preamble = String.raw`\usepackage{amsmath}`;
    const result = applyMacroFavorite(
      source,
      preamble,
      "local-latex",
      favorite,
      0,
      0,
      false,
    );
    expect(result.source).toBe(source);
    expect(result.preamble).toBe(preamble + "\n" + favorite.definitions + "\n");
    const repeated = applyMacroFavorite(
      result.source,
      result.preamble!,
      "local-latex",
      favorite,
      0,
      0,
      false,
    );
    expect(repeated.preamble).toBe(result.preamble);
  });
  it("keeps definitions/color after save, reopen, and the export renderer", async () => {
    const deck = createDemoDeck();
    const equation = deck.slides
      .flatMap((slide) => slide.objects)
      .find((object) => object.type === "equation") as EquationObject;
    const used = applyMacroFavorite("x=", "", "mathjax", favorite, 2, 2);
    equation.latex = wrapEquationSourceColor(
      used.source,
      used.selectionStart,
      used.selectionEnd,
      "#c62828",
    ).source;
    deck.slides[0].objects = [equation];
    deck.slides = [deck.slides[0]];
    deck.assets = [];
    const reopened = await readDeckArchive(await buildDeckArchive(deck));
    const saved = reopened.slides[0].objects[0] as EquationObject;
    expect(saved.latex).toBe(equation.latex);
    const rendered = await renderObjectEquation(saved, reopened);
    expect(rendered.svg).toContain('fill="#c62828"');
    expect(rendered.svg).toContain("<path");
    expect(rendered.svg).not.toMatch(/<(?:script|image|text)\b/);
  });
  it("changes Local LaTeX fingerprints and still requires explicit compilation", async () => {
    const deck = createDemoDeck();
    const equation = deck.slides
      .flatMap((slide) => slide.objects)
      .find((object) => object.type === "equation") as EquationObject;
    equation.renderer = "local-latex";
    equation.localTex = { engine: "latex", preamble: "" };
    const before = localTexInputFingerprint(localTexInputs(equation, deck));
    const result = applyMacroFavorite(
      equation.latex,
      "",
      "local-latex",
      favorite,
      0,
      0,
      false,
    );
    equation.localTex.preamble = result.preamble!;
    expect(localTexInputFingerprint(localTexInputs(equation, deck))).not.toBe(
      before,
    );
    await expect(renderObjectEquation(equation, deck)).rejects.toThrow(
      /Compile/,
    );
  });
  it("wraps only selected terms in a shared RGB group and retains inner selection", async () => {
    const edit = wrapEquationSourceColor("x+y+z", 2, 3, "#c62828");
    expect(edit.source).toBe(String.raw`x+\textcolor[RGB]{198,40,40}{y}+z`);
    expect(edit.source.slice(edit.selectionStart, edit.selectionEnd)).toBe("y");
    const result = await renderEquation(
      edit.source,
      "mathjax-stix2",
      32,
      "#17263c",
    );
    expect(result.svg).toContain('fill="#c62828"');
    expect(result.svg).toContain('fill="#17263c"');
    expect(() => wrapEquationSourceColor("x", 0, 0, "#c62828")).toThrow(
      /Select/,
    );
    expect(() =>
      wrapEquationSourceColor("x", 0, 1, "url(https://example.test)"),
    ).toThrow(/RGB/);
    expect(() =>
      wrapEquationSourceColor(String.raw`\alpha`, 2, 4, "#112233"),
    ).toThrow(/complete/);
    expect(() =>
      wrapEquationSourceColor(String.raw`\frac{x}{y}`, 6, 8, "#112233"),
    ).toThrow(/balanced/);
  });
});
