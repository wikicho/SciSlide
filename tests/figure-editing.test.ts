// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import JSZip from "jszip";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDemoDeck,
  validateDeck,
  validateFigureCrop,
} from "../src/lib/model";
import type { FigureObject } from "../src/lib/model";
import {
  createFigureInset,
  figureViewport,
  hasFigureCrop,
} from "../src/lib/figure-editing";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));

function deckWithCrop() {
  const deck = createDemoDeck();
  const figure = deck.slides[0].objects.find(
    (object) => object.type === "figure",
  ) as FigureObject;
  figure.crop = { x: 0.25, y: 0.1, width: 0.5, height: 0.6 };
  return { deck, figure, asset: deck.assets[0] };
}

function bytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

function sourceText(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  return dataUrl.slice(0, comma).includes(";base64")
    ? Buffer.from(dataUrl.slice(comma + 1), "base64").toString("utf8")
    : decodeURIComponent(dataUrl.slice(comma + 1));
}

describe("reversible scientific figure regions", () => {
  it.each([
    { x: -0.1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: Infinity },
    { x: NaN, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 0.6, height: 1 },
    { x: 0, y: 0.5, width: 1, height: 0.6 },
    { x: "0", y: 0, width: 1, height: 1 },
    null,
  ])("rejects invalid crop %j before document replacement", (crop) => {
    const { deck, figure } = deckWithCrop();
    Object.assign(figure, { crop });
    expect(() => validateDeck(deck)).toThrow("Figure crop");
  });

  it("accepts exact normalized boundaries and derives native source coordinates", () => {
    const crop = { x: 0.58, y: 0.7, width: 0.42, height: 0.3 };
    expect(validateFigureCrop(crop)).toEqual(crop);
    const { figure, asset } = deckWithCrop();
    const geometry = figureViewport(figure, asset);
    expect(geometry.region).toEqual({
      x: asset.width * 0.25,
      y: asset.height * 0.1,
      width: asset.width * 0.5,
      height: asset.height * 0.6,
    });
    expect(geometry.attributes.preserveAspectRatio).toBe("xMidYMid meet");
    delete figure.crop;
    expect(figureViewport(figure, asset).attributes.viewBox).toBe(
      `0 0 ${asset.width} ${asset.height}`,
    );
    expect(hasFigureCrop(figure)).toBe(false);
    figure.crop = { x: 0, y: 0, width: 1, height: 1 };
    expect(hasFigureCrop(figure)).toBe(false);
  });

  it("creates an independent inset within the slide without duplicating source bytes", () => {
    const { deck, figure, asset } = deckWithCrop();
    figure.locked = true;
    figure.groupId = "scientific-figure-group";
    const source = structuredClone(figure);
    const inset = createFigureInset(figure, asset, deck.slideSize);
    expect(inset.id).not.toBe(figure.id);
    expect(inset.assetId).toBe(figure.assetId);
    expect(inset.crop).toEqual(figure.crop);
    expect(inset.crop).not.toBe(figure.crop);
    expect(inset.groupId).toBeUndefined();
    expect(inset.locked).toBe(false);
    expect(inset.transform.x).toBeGreaterThanOrEqual(0);
    expect(inset.transform.y).toBeGreaterThanOrEqual(0);
    expect(inset.transform.x + inset.transform.width).toBeLessThanOrEqual(
      deck.slideSize.width,
    );
    expect(inset.transform.y + inset.transform.height).toBeLessThanOrEqual(
      deck.slideSize.height,
    );
    const { region } = figureViewport(figure, asset);
    expect(inset.transform.width / inset.transform.height).toBeCloseTo(
      region.width / region.height,
    );
    expect(figure).toEqual(source);
    delete inset.crop;
    expect(figure.crop).toEqual(source.crop);
    expect(deck.assets).toHaveLength(1);
    delete figure.crop;
    expect(() => createFigureInset(figure, asset, deck.slideSize)).toThrow(
      "cropped region",
    );
  });

  it("round trips source, crop and an inset in format 0.5.0 with a single original asset", async () => {
    const { deck, figure, asset } = deckWithCrop();
    const inset = createFigureInset(figure, asset, deck.slideSize);
    deck.slides[0].objects.push(inset);
    const archive = await buildDeckArchive(deck);
    const zip = await JSZip.loadAsync(await bytes(archive));
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    const stored = JSON.parse(await zip.file("document.json")!.async("string"));
    expect(manifest.formatVersion).toBe("0.5.0");
    expect(stored.formatVersion).toBe("0.5.0");
    expect(stored.assets).toHaveLength(1);
    const loaded = await readDeckArchive(archive);
    expect(loaded.slides).toEqual(deck.slides);
    expect(sourceText(loaded.assets[0].dataUrl)).toBe(
      sourceText(asset.dataUrl),
    );
    const loadedFigure = loaded.slides[0].objects.find(
      (object) => object.id === figure.id,
    ) as FigureObject;
    delete loadedFigure.crop;
    expect(sourceText(loaded.assets[0].dataUrl)).toBe(
      sourceText(asset.dataUrl),
    );
    expect((loaded.slides[0].objects.at(-1) as FigureObject).crop).toEqual(
      inset.crop,
    );
  });

  it.each(["0.1.0", "0.2.0", "0.3.0", "0.4.0"])(
    "opens %s archives and resaves canonically without changing uncropped layout",
    async (formatVersion) => {
      const deck = createDemoDeck();
      const zip = await JSZip.loadAsync(
        await bytes(await buildDeckArchive(deck)),
      );
      const manifest = JSON.parse(
        await zip.file("manifest.json")!.async("string"),
      );
      const stored = JSON.parse(
        await zip.file("document.json")!.async("string"),
      );
      stored.formatVersion = formatVersion;
      const source = JSON.stringify(stored);
      zip.file("document.json", source);
      manifest.formatVersion = formatVersion;
      const resource = manifest.resources.find(
        (entry: { path: string }) => entry.path === "document.json",
      );
      resource.size = new TextEncoder().encode(source).length;
      resource.sha256 = createHash("sha256").update(source).digest("hex");
      zip.file("manifest.json", JSON.stringify(manifest));
      const loaded = await readDeckArchive(
        new Blob([await zip.generateAsync({ type: "uint8array" })]),
      );
      expect(loaded.formatVersion).toBe("0.5.0");
      expect(loaded.slides).toEqual(deck.slides);
      expect(await readDeckArchive(await buildDeckArchive(loaded))).toEqual(
        loaded,
      );
    },
  );
});
