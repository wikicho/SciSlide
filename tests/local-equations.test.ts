// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createDemoDeck, validateDeck } from "../src/lib/model";
import type { Deck, EquationObject } from "../src/lib/model";
import {
  localTexInputFingerprint,
  localTexInputs,
  renderObjectEquation,
} from "../src/lib/equation-renderer";
import { sanitizeLocalEquationSvg } from "../src/lib/local-equation-svg";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));

const vector =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="40" viewBox="0 0 120 40"><defs><path id="tex-g0" d="M0 0L20 0L20 30Z"/></defs><g fill="#263449"><use x="10" y="5" xlink:href="#tex-g0"/></g></svg>';

function localDeck(): { deck: Deck; equation: EquationObject } {
  const deck = createDemoDeck();
  const equation = deck.slides[0].objects.find(
    (o) => o.type === "equation",
  ) as EquationObject;
  equation.renderer = "local-latex";
  equation.latex = String.raw`\mathbb{R} \otimes \mathfrak{g}`;
  equation.localTex = {
    engine: "latex",
    preamble: String.raw`\usepackage{amsmath,amssymb}`,
  };
  equation.localTex.render = {
    svg: vector,
    width: 120,
    height: 40,
    inputFingerprint: localTexInputFingerprint(localTexInputs(equation, deck)),
    profile: {
      engine: "latex",
      engineVersion: "pdfTeX 3.141592653-2.6-1.40.27",
      converterVersion: "dvisvgm 3.4.3",
      dependencies: [
        { name: "tex/latex/amsfonts/amssymb.sty", sha256: "a".repeat(64) },
      ],
    },
    warnings: ["This is a cache fixture."],
  };
  return { deck, equation };
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}
async function blob(zip: JSZip): Promise<Blob> {
  return new Blob([await zip.generateAsync({ type: "uint8array" })]);
}

describe("Local LaTeX cached rendering", () => {
  it("views saved vector output without a desktop bridge or TeX installation", async () => {
    const { deck, equation } = localDeck();
    const result = await renderObjectEquation(equation, deck);
    expect(result).toEqual({ svg: vector, width: 120, height: 40 });
  });

  it("detects every changed compile input while allowing position and MathJax font changes", async () => {
    const changes: Array<(o: EquationObject, deck: Deck) => void> = [
      (o) => {
        o.latex += " + 1";
      },
      (o) => {
        o.localTex!.preamble += "\n";
      },
      (o) => {
        o.localTex!.engine = "xelatex";
      },
      (o) => {
        o.displayMode = false;
      },
      (o) => {
        o.style.fontSize = (o.style.fontSize ?? 0) + 1;
      },
      (o) => {
        o.style.color = "#ff0000";
      },
      (_o, d) => {
        d.theme.equation.color = "#0000ff";
      },
    ];
    for (const change of changes) {
      const { deck, equation } = localDeck();
      change(equation, deck);
      await expect(renderObjectEquation(equation, deck)).rejects.toMatchObject({
        name: "LocalTexRenderError",
        code: "stale-render",
      });
    }
    const { deck, equation } = localDeck();
    equation.transform.x += 40;
    equation.style.fontSetId = "mathjax-fira";
    await expect(renderObjectEquation(equation, deck)).resolves.toMatchObject({
      width: 120,
    });
  });

  it("requires an explicit completed render rather than compiling imported source", async () => {
    const { deck, equation } = localDeck();
    delete equation.localTex!.render;
    await expect(renderObjectEquation(equation, deck)).rejects.toMatchObject({
      code: "missing-render",
    });
  });

  it("retains MathJax as the default for legacy equation objects", async () => {
    const { deck, equation } = localDeck();
    delete equation.renderer;
    equation.latex = "x^2";
    const result = await renderObjectEquation(equation, deck);
    expect(result.svg).toContain("<path");
    expect(result.svg).not.toBe(vector);
  });
});

describe("passive Local LaTeX SVG", () => {
  it("keeps glyph outlines, local references and safe paints, removing only XML decoration", () => {
    expect(
      sanitizeLocalEquationSvg(
        `<?xml version='1.0'?>\n<!-- dvisvgm -->${vector}`,
      ),
    ).toBe(vector);
    expect(
      sanitizeLocalEquationSvg(
        vector.replace('fill="#263449"', 'style="fill:#263449;stroke-width:1"'),
      ),
    ).toContain("stroke-width:1");
  });

  it("rejects executable content, external references, font-dependent text and unsupported CSS", () => {
    const unsafe = [
      vector.replace("<defs>", "<script>alert(1)</script><defs>"),
      vector.replace(
        "<defs>",
        '<image href="https://example.org/secret"/><defs>',
      ),
      vector.replace(
        "<defs>",
        '<text x="0" y="0">unembedded font</text><defs>',
      ),
      vector.replace(
        'xlink:href="#tex-g0"',
        'xlink:href="https://example.org/g.svg#x"',
      ),
      vector.replace('fill="#263449"', 'fill="url(https://example.org/paint)"'),
      vector.replace('fill="#263449"', 'onload="alert(1)"'),
      vector.replace('fill="#263449"', 'style="filter:blur(1px)"'),
      vector.replace(
        'fill="#263449"',
        'style="stroke-width:u\\72l(\\68ttps://example.org)"',
      ),
      '<!DOCTYPE svg [<!ENTITY external SYSTEM "file:///etc/passwd">]>' +
        vector,
      vector.replace('xlink:href="#tex-g0"', 'xlink:href="#missing"'),
    ];
    for (const svg of unsafe)
      expect(() => sanitizeLocalEquationSvg(svg)).toThrow(
        "self-contained vector",
      );
    const { deck, equation } = localDeck();
    equation.localTex!.render!.svg = unsafe[0];
    expect(() => validateDeck(deck)).toThrow("self-contained vector");
  });
});

describe("native Local LaTeX portability", () => {
  it("indexes cached SVG separately, retaining exact source, profile, checksums and browser rendering", async () => {
    const { deck, equation } = localDeck();
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(deck)),
    );
    const document = JSON.parse(
      await zip.file("document.json")!.async("string"),
    );
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    const stored = document.slides[0].objects.find(
      (o: EquationObject) => o.id === equation.id,
    );
    expect(manifest.formatVersion).toBe("0.3.0");
    expect(document.formatVersion).toBe("0.3.0");
    expect(stored.localTex.render.svg).toBeUndefined();
    expect(stored.localTex.render.path).toBe(`renders/${equation.id}.svg`);
    const resource = manifest.resources.find(
      (r: { path: string }) => r.path === stored.localTex.render.path,
    );
    expect(resource.sha256).toBe(
      createHash("sha256").update(vector).digest("hex"),
    );
    const loaded = await readDeckArchive(await blob(zip));
    expect(loaded.slides).toEqual(deck.slides);
    expect(loaded.theme).toEqual(deck.theme);
    const loadedEquation = loaded.slides[0].objects.find(
      (o) => o.id === equation.id,
    ) as EquationObject;
    await expect(
      renderObjectEquation(loadedEquation, loaded),
    ).resolves.toMatchObject({ svg: vector });
    await expect(
      readDeckArchive(await buildDeckArchive(loaded)),
    ).resolves.toEqual(loaded);
  });

  it("checks modified and missing SVG bytes before exposing loaded output", async () => {
    const { deck, equation } = localDeck();
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(deck)),
    );
    zip.file(`renders/${equation.id}.svg`, vector.replace("M0", "M1"));
    await expect(readDeckArchive(await blob(zip))).rejects.toThrow(
      "integrity check",
    );
    zip.remove(`renders/${equation.id}.svg`);
    await expect(readDeckArchive(await blob(zip))).rejects.toThrow("missing");
  });

  it("rejects active SVG even when a crafted archive has matching checksums", async () => {
    const { deck, equation } = localDeck();
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(deck)),
    );
    const path = `renders/${equation.id}.svg`;
    const unsafe = vector.replace("<defs>", "<script>alert(1)</script><defs>");
    zip.file(path, unsafe);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    const resource = manifest.resources.find(
      (entry: { path: string }) => entry.path === path,
    );
    resource.size = new TextEncoder().encode(unsafe).length;
    resource.sha256 = createHash("sha256").update(unsafe).digest("hex");
    zip.file("manifest.json", JSON.stringify(manifest));
    await expect(readDeckArchive(await blob(zip))).rejects.toThrow(
      "self-contained vector",
    );
  });

  it("migrates 0.1.0 documents without changing their MathJax source", async () => {
    const deck = createDemoDeck();
    const originalSource = (
      deck.slides[0].objects.find(
        (o) => o.type === "equation",
      ) as EquationObject
    ).latex;
    expect(
      validateDeck({ ...deck, formatVersion: "0.1.0" }).formatVersion,
    ).toBe("0.3.0");
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(deck)),
    );
    const document = JSON.parse(
      await zip.file("document.json")!.async("string"),
    );
    document.formatVersion = "0.1.0";
    const source = JSON.stringify(document);
    zip.file("document.json", source);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    manifest.formatVersion = "0.1.0";
    const sourceResource = manifest.resources.find(
      (r: { path: string }) => r.path === "document.json",
    );
    sourceResource.size = new TextEncoder().encode(source).length;
    sourceResource.sha256 = createHash("sha256").update(source).digest("hex");
    zip.file("manifest.json", JSON.stringify(manifest));
    const loaded = await readDeckArchive(await blob(zip));
    expect(loaded.formatVersion).toBe("0.3.0");
    expect(
      (
        loaded.slides[0].objects.find(
          (o) => o.type === "equation",
        ) as EquationObject
      ).latex,
    ).toBe(originalSource);
  });
});
