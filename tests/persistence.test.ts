// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createDemoDeck } from "../src/lib/model";
import {
  buildDeckArchive,
  importFigure,
  loadRecovery,
  MAX_ARCHIVE_BYTES,
  MAX_FIGURE_BYTES,
  readDeckArchive,
  sanitizeSvg,
  saveRecovery,
} from "../src/lib/persistence";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

async function archiveBlob(zip: JSZip): Promise<Blob> {
  return new Blob([await zip.generateAsync({ type: "uint8array" })]);
}

describe("portable native files", () => {
  it("packages figure bytes, source, checksums, and exact rendering profiles", async () => {
    const deck = createDemoDeck();
    const equation = deck.slides[0].objects.find((o) => o.type === "equation")!;
    if (equation.type === "equation")
      equation.latex = String.raw`\usepackage{amsmath,amsfonts,amssymb}\mathbb{R}+\mathfrak{g}`;
    const archive = await buildDeckArchive(deck);
    const zip = await JSZip.loadAsync(await bytes(archive));
    const document = JSON.parse(
      await zip.file("document.json")!.async("string"),
    );
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    expect(document.assets[0].dataUrl).toBeUndefined();
    expect(await zip.file(document.assets[0].path)!.async("string")).toContain(
      "<svg",
    );
    expect(manifest.resources).toHaveLength(2);
    expect(
      manifest.resources.every((resource: { sha256: string }) =>
        /^[a-f0-9]{64}$/.test(resource.sha256),
      ),
    ).toBe(true);
    expect(manifest.renderingProfiles.engine.version).toBe("4.1.3");
    expect(manifest.renderingProfiles.engine.revision).toBe("scientific-v2");
    expect(manifest.renderingProfiles.engine.options.fontCache).toBe("none");
    expect(manifest.renderingProfiles.engine.options.optInPackages).toEqual([
      "physics",
    ]);
    expect(manifest.renderingProfiles.engine.options.missingGlyphFallback).toBe(
      "mathjax-stix2",
    );
    const loaded = await readDeckArchive(archive);
    expect(loaded.slides).toEqual(deck.slides);
    expect(loaded.theme).toEqual(deck.theme);
    expect(loaded.assets[0].id).toBe(deck.assets[0].id);
    expect(loaded.assets[0].dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    // Repackaging a loaded native deck keeps source and its figure references intact.
    const reloaded = await readDeckArchive(await buildDeckArchive(loaded));
    expect(reloaded).toEqual(loaded);
  });

  it("detects a modified document before returning a replacement deck", async () => {
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(createDemoDeck())),
    );
    zip.file("document.json", "{}");
    await expect(readDeckArchive(await archiveBlob(zip))).rejects.toThrow(
      "integrity check",
    );
  });

  it("detects damaged or missing figure bytes", async () => {
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(createDemoDeck())),
    );
    const document = JSON.parse(
      await zip.file("document.json")!.async("string"),
    );
    zip.remove(document.assets[0].path);
    await expect(readDeckArchive(await archiveBlob(zip))).rejects.toThrow(
      "missing",
    );
  });

  it("rejects unsafe original paths even when the ZIP parser normalizes them", async () => {
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(createDemoDeck())),
    );
    zip.file("../outside.svg", "<svg/>");
    await expect(readDeckArchive(await archiveBlob(zip))).rejects.toThrow(
      "unsafe archive path",
    );
  });

  it("rejects unindexed extra files and corrupt ZIP data", async () => {
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(createDemoDeck())),
    );
    zip.file("untracked.html", "<script>alert(1)</script>");
    await expect(readDeckArchive(await archiveBlob(zip))).rejects.toThrow(
      "resource index",
    );
    await expect(readDeckArchive(new Blob(["not a zip"]))).rejects.toThrow(
      "not a readable",
    );
  });

  it("checks file bounds before attempting to read oversized input", async () => {
    const oversized = { size: MAX_ARCHIVE_BYTES + 1 } as Blob;
    await expect(readDeckArchive(oversized)).rejects.toThrow("64 MB");
    await expect(
      importFigure({ size: MAX_FIGURE_BYTES + 1 } as File),
    ).rejects.toThrow("20 MB");
  });
});

describe("safe SVG figures and browser recovery", () => {
  it("preserves class-styled plot appearance, specificity, and inline overrides", () => {
    const clean = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>* {stroke-linejoin:round;stroke-linecap:butt}.curve {fill:none;stroke:#26867a;stroke-width:2} path {stroke:#cccccc}.curve.highlight {stroke:#6d78c4}</style><path class="curve highlight" d="M0 0L100 100"/><path class="curve" style="stroke:#ff0000" d="M0 100L100 0"/></svg>',
    );
    const document = new DOMParser().parseFromString(clean, "image/svg+xml");
    const [first, second] = [...document.querySelectorAll("path")];
    expect(first.getAttribute("fill")).toBe("none");
    expect(first.getAttribute("stroke")).toBe("#6d78c4");
    expect(first.getAttribute("stroke-width")).toBe("2");
    expect(first.getAttribute("stroke-linejoin")).toBe("round");
    expect(second.getAttribute("stroke")).toBe("#26867a");
    expect(second.getAttribute("style")).toContain("#ff0000");
    expect(document.querySelector("style")).toBeNull();
    expect(() =>
      sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://example.com/style.css);</style></svg>',
      ),
    ).toThrow("inline styles");
    expect(() =>
      sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>path {stroke: url(https://example.com/paint)}</style></svg>',
      ),
    ).toThrow("inline styles");
  });

  it("retains plot paths and local glyph references while removing active/external content", () => {
    const clean = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" onload="alert(1)"><defs><path id="glyph" d="M0 0L20 20"/></defs><use href="#glyph"/><use href="https://example.com/glyph.svg#x"/><path style="fill:url(https://example.com/paint)" d="M1 1L2 2"/><script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject></svg>',
    );
    expect(clean).toContain('href="#glyph"');
    expect(clean).toContain("M0 0L20 20");
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("example.com");
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("foreignObject");
  });

  it("imports safe SVG dimensions from viewBox and keeps the filename", async () => {
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><path d="M0 0L800 400"/></svg>',
      ],
      "plot.svg",
      { type: "image/svg+xml" },
    );
    const asset = await importFigure(file);
    expect(asset.name).toBe("plot.svg");
    expect(asset.width).toBe(800);
    expect(asset.height).toBe(400);
    expect(asset.mime).toBe("image/svg+xml");
  });

  it("rejects fake SVG files and images without usable dimensions", async () => {
    await expect(
      importFigure(new File(["<html>hi</html>"], "fake.svg")),
    ).rejects.toThrow("valid SVG");
    await expect(
      importFigure(
        new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "empty.svg"),
      ),
    ).rejects.toThrow("width and height");
  });

  it("recovers a valid completed revision and ignores corrupt recovery data", () => {
    const deck = createDemoDeck();
    saveRecovery(deck);
    expect(loadRecovery()?.slides).toEqual(deck.slides);
    localStorage.setItem("scislide.recovery.v1", "{broken");
    expect(loadRecovery()).toBeNull();
  });

  it("surfaces recovery storage failures so the editor can report them", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
    expect(() => saveRecovery(createDemoDeck())).toThrow("Quota exceeded");
    spy.mockRestore();
  });
});
