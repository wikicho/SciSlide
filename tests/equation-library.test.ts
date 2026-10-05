// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEquationLibraryEntry,
  createLibraryEquationObject,
  EQUATION_LIBRARY_KEY,
  loadEquationLibrary,
  mergeEquationLibraries,
  parseEquationLibrary,
  saveEquationLibrary,
  searchEquationLibrary,
  serializeEquationLibrary,
  validateEquationLibrary,
} from "../src/lib/equation-library";
import type { EquationLibraryEquation } from "../src/lib/equation-library";
import { createDemoDeck } from "../src/lib/model";

function formula(): EquationLibraryEquation {
  return {
    latex: String.raw`H^2 = \frac{8\pi G}{3}\rho`,
    style: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#111827" },
    displayMode: true,
    description: "Expansion of the universe",
    renderer: "mathjax",
  };
}

describe("personal equation library", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round trips names, tags, source and settings across restarts", () => {
    const entry = createEquationLibraryEntry(" Friedmann ", formula(), [
      "cosmology",
      " expansion ",
      "cosmology",
    ]);
    saveEquationLibrary([entry]);
    expect(loadEquationLibrary()).toEqual([
      { ...entry, name: "Friedmann", tags: ["cosmology", "expansion"] },
    ]);
    expect(parseEquationLibrary(serializeEquationLibrary([entry]))).toEqual([
      entry,
    ]);
  });

  it("searches source, description, name and tags together without changing entries", () => {
    const expansion = createEquationLibraryEntry("Friedmann", formula(), [
      "cosmology",
    ]);
    const other = createEquationLibraryEntry(
      "Mass energy",
      { ...formula(), latex: "E=mc^2", description: "Relativity" },
      ["kinematics"],
    );
    expect(
      searchEquationLibrary([expansion, other], " COSMOLOGY  expansion "),
    ).toEqual([expansion]);
    expect(searchEquationLibrary([expansion, other], "mc^2")).toEqual([other]);
    expect(searchEquationLibrary([expansion, other], "unmatched")).toEqual([]);
  });

  it("inserts independent equation objects and discards any imported local render cache", () => {
    const cached = {
      ...formula(),
      renderer: "local-latex" as const,
      localTex: {
        engine: "xelatex" as const,
        preamble: String.raw`\usepackage{unicode-math}`,
        render: { svg: "<script>bad</script>" },
      },
    };
    const entry = createEquationLibraryEntry("Local equation", cached);
    expect(entry.equation.localTex).toEqual({
      engine: "xelatex",
      preamble: String.raw`\usepackage{unicode-math}`,
    });
    const a = createLibraryEquationObject(entry, createDemoDeck());
    const b = createLibraryEquationObject(entry, createDemoDeck());
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(entry.id);
    expect(a.localTex?.render).toBeUndefined();
    a.style.fontSize = 99;
    a.localTex!.preamble = "changed";
    expect(b.style.fontSize).toBe(48);
    expect(entry.equation.localTex?.preamble).toBe(
      String.raw`\usepackage{unicode-math}`,
    );
    expect(a.transform.width).toBeGreaterThan(0);
  });

  it("merges repeated exports without duplicates and preserves distinct colliding IDs", () => {
    const entry = createEquationLibraryEntry("First", formula());
    expect(mergeEquationLibraries([entry], [entry])).toEqual([entry]);
    const changed = {
      ...entry,
      name: "Different",
      equation: { ...entry.equation, latex: "x=1" },
    };
    const result = mergeEquationLibraries([entry], [changed]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(entry);
    expect(result[1].name).toBe("Different");
    expect(result[1].id).not.toBe(entry.id);
    expect(mergeEquationLibraries(result, [changed])).toEqual(result);
  });

  it("rejects unsafe settings and excessive sources before replacing a saved library", () => {
    const entry = createEquationLibraryEntry("Valid", formula());
    saveEquationLibrary([entry]);
    expect(() =>
      saveEquationLibrary([
        {
          ...entry,
          equation: {
            ...entry.equation,
            style: { color: "url(https://bad.test/image)" },
          },
        },
      ]),
    ).toThrow("color");
    expect(() =>
      createEquationLibraryEntry("Huge", {
        ...formula(),
        latex: "x".repeat(32_001),
      }),
    ).toThrow("text limit");
    expect(() => validateEquationLibrary([entry, entry])).toThrow("unique");
    expect(loadEquationLibrary()).toEqual([entry]);
    expect(() =>
      parseEquationLibrary('{"format":"other","version":1,"entries":[]}'),
    ).toThrow("라이브러리");
  });

  it("reports quota failures and preserves the last saved library", () => {
    const entry = createEquationLibraryEntry("Valid", formula());
    saveEquationLibrary([entry]);
    const original = localStorage.getItem(EQUATION_LIBRARY_KEY);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    expect(() => saveEquationLibrary([])).toThrow("Quota exceeded");
    expect(localStorage.getItem(EQUATION_LIBRARY_KEY)).toBe(original);
  });
});
