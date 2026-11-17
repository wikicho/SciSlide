// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDemoDeck,
  validateDeck,
  type Deck,
  type TextObject,
} from "../src/lib/model";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";

function textDeck(): Deck {
  const deck = createDemoDeck();
  const object = deck.slides[0].objects.find(
    (object): object is TextObject => object.type === "text",
  )!;
  deck.assets = [];
  deck.slides = [
    {
      ...deck.slides[0],
      objects: [
        {
          ...object,
          text: "한글😀X",
          fontFamily: "Inter",
          fontSize: 30,
          color: "#123456",
          textStyles: [
            { start: 0, end: 2, color: "#ff0000" },
            { start: 2, end: 4, color: "rgba(0, 0, 255, 0.5)" },
          ],
          autoFit: "content",
          metadata: { source: "results.txt", original: { retained: true } },
        },
      ],
    },
  ];
  return deck;
}

const text = (deck: Deck) => deck.slides[0].objects[0] as TextObject;

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("native text formatting metadata", () => {
  beforeEach(() => vi.stubGlobal("crypto", webcrypto));
  afterEach(() => vi.unstubAllGlobals());

  it("accepts adjacent ordered UTF-16 ranges and returns independent formatting metadata", () => {
    const deck = textDeck();
    const snapshot = validateDeck(deck);
    expect(text(snapshot).textStyles).toEqual(text(deck).textStyles);
    text(snapshot).textStyles![0].color = "#008800";
    expect(text(deck).textStyles![0].color).toBe("#ff0000");
    expect(text(snapshot).fontSize).toBe(30);
  });

  it.each(
    [
      [
        { start: 3, end: 5, color: "red" },
        { start: 0, end: 2, color: "blue" },
      ],
      [
        { start: 0, end: 3, color: "red" },
        { start: 2, end: 5, color: "blue" },
      ],
      [{ start: 2, end: 2, color: "red" }],
      [{ start: 3, end: 2, color: "red" }],
      [{ start: -1, end: 2, color: "red" }],
      [{ start: 0, end: 6, color: "red" }],
      [{ start: 0.5, end: 2, color: "red" }],
      [{ start: 0, end: Infinity, color: "red" }],
      [{ start: NaN, end: 2, color: "red" }],
      [{ start: "0", end: 2, color: "red" }],
      [{ start: 0, end: 2, color: "url(https://example.com/color)" }],
      [{ start: 0, end: 2, color: "#12" }],
    ].map((ranges) => ({ ranges })),
  )("rejects malformed color metadata $ranges", ({ ranges }) => {
    const deck = textDeck();
    const invalid = { ...text(deck), textStyles: ranges };
    expect(() =>
      validateDeck({
        ...deck,
        slides: [{ ...deck.slides[0], objects: [invalid] }],
      }),
    ).toThrow();
  });

  it("rejects oversized/non-array range lists and unsupported fitting modes", () => {
    for (const styles of [
      null,
      {},
      new Array(4097).fill({ start: 0, end: 1, color: "red" }),
    ]) {
      const deck = textDeck();
      expect(() =>
        validateDeck({
          ...deck,
          slides: [
            {
              ...deck.slides[0],
              objects: [{ ...text(deck), textStyles: styles }],
            },
          ],
        }),
      ).toThrow("bounded array");
    }
    for (const autoFit of [null, false, "shrink-font", "frame"]) {
      const deck = textDeck();
      expect(() =>
        validateDeck({
          ...deck,
          slides: [
            { ...deck.slides[0], objects: [{ ...text(deck), autoFit }] },
          ],
        }),
      ).toThrow("fitting mode");
    }
  });

  it("round-trips partial colors and content fitting without changing text, font, geometry or metadata", async () => {
    const deck = textDeck();
    const original = structuredClone(deck);
    const archive = await buildDeckArchive(deck);
    const zip = await JSZip.loadAsync(await bytes(archive));
    const stored = JSON.parse(await zip.file("document.json")!.async("string"));
    expect(stored.slides[0].objects[0]).toMatchObject({
      text: "한글😀X",
      textStyles: text(deck).textStyles,
      autoFit: "content",
      fontSize: 30,
    });
    const loaded = await readDeckArchive(archive);
    expect(text(loaded)).toEqual(text(deck));
    expect(await readDeckArchive(await buildDeckArchive(loaded))).toEqual(
      loaded,
    );
    expect(deck).toEqual(original);
  });

  it.each(["0.1.0", "0.4.0", "0.5.0"])(
    "loads a %s archive without adding color or fitting overrides",
    async (formatVersion) => {
      const deck = textDeck();
      delete text(deck).textStyles;
      delete text(deck).autoFit;
      const original = structuredClone(text(deck));
      const zip = await JSZip.loadAsync(
        await bytes(await buildDeckArchive(deck)),
      );
      const stored = JSON.parse(
        await zip.file("document.json")!.async("string"),
      );
      stored.formatVersion = formatVersion;
      const source = JSON.stringify(stored);
      const manifest = JSON.parse(
        await zip.file("manifest.json")!.async("string"),
      );
      manifest.formatVersion = formatVersion;
      const resource = manifest.resources.find(
        (entry: { path: string }) => entry.path === "document.json",
      );
      resource.size = Buffer.byteLength(source);
      resource.sha256 = createHash("sha256").update(source).digest("hex");
      zip.file("document.json", source);
      zip.file("manifest.json", JSON.stringify(manifest));
      const loaded = await readDeckArchive(
        new Blob([await zip.generateAsync({ type: "uint8array" })]),
      );
      expect(loaded.formatVersion).toBe("0.5.0");
      expect(text(loaded)).toEqual(original);
      expect(text(loaded)).not.toHaveProperty("textStyles");
      expect(text(loaded)).not.toHaveProperty("autoFit");
    },
  );
});
