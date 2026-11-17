// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createDemoDeck, validateDeck } from "../src/lib/model";
import { validateWorkspaceRecovery } from "../src/lib/workspace-recovery";
import { jsonMediaByteLength } from "../src/lib/json-media-size";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
afterEach(() => vi.restoreAllMocks());

it("counts the exact JSON UTF-8 size with repeated media, escaping, Unicode and JSON normalization", () => {
  const media = "data:image/svg+xml," + '한글😀"\\\n\t'.repeat(180);
  const data = {
    media: [media, media],
    object: { dataUrl: png, absent: undefined, number: Infinity },
    text: "한글😀",
    array: [undefined, NaN],
  };
  expect(jsonMediaByteLength(data)).toBe(bytes(data));
  expect(jsonMediaByteLength(data)).toBe(bytes(data));
  expect(jsonMediaByteLength(undefined)).toBe(bytes(undefined));
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(() => jsonMediaByteLength(cycle)).toThrow();
  expect(() => jsonMediaByteLength({ invalid: 1n })).toThrow();
});
it("reuses the byte count of unchanged embedded media and counts changed bytes separately", () => {
  const media = "data:image/png;base64," + "abcd".repeat(4096);
  const data = { assets: [{ dataUrl: media }] };
  const expected = bytes(data);
  expect(jsonMediaByteLength(data)).toBe(expected);
  const stringify = vi.spyOn(JSON, "stringify");
  expect(
    jsonMediaByteLength({ assets: [{ dataUrl: media }], renamed: true }),
  ).toBe(expected + ',"renamed":true'.length);
  expect(stringify.mock.calls.some(([value]) => value === media)).toBe(false);
  const changed = media + "efgh";
  expect(jsonMediaByteLength({ assets: [{ dataUrl: changed }] })).toBe(
    expected + 4,
  );
  expect(stringify.mock.calls.some(([value]) => value === changed)).toBe(true);
});
it("normalizes an independent validated document without JSON copying media payloads", () => {
  const deck = createDemoDeck();
  for (const slide of deck.slides)
    slide.objects = slide.objects.filter(
      (object) => object.type !== "figure" && object.type !== "video",
    );
  deck.assets = [
    {
      id: "asset-copy-perf",
      name: "PNG",
      mime: "image/png",
      width: 1,
      height: 1,
      dataUrl: png,
    },
  ];
  deck.slides[0].objects[0].metadata = {
    retained: { value: "한글", absent: undefined },
    numeric: Infinity,
  };
  const stringify = vi.spyOn(JSON, "stringify");
  const checked = validateDeck(deck);
  expect(checked.assets[0].dataUrl).toBe(png);
  expect(checked.assets[0]).not.toBe(deck.assets[0]);
  expect(checked.slides[0].objects[0].metadata).toEqual({
    retained: { value: "한글" },
    numeric: null,
  });
  expect(
    stringify.mock.calls.some(
      ([value]) =>
        typeof value === "object" &&
        value !== null &&
        "assets" in value &&
        (value as { assets: { dataUrl: string }[] }).assets[0]?.dataUrl === "",
    ),
  ).toBe(true);
  checked.assets[0].name = "Independent name";
  checked.slides[0].objects[0].metadata.retained = null;
  expect(deck.assets[0].name).toBe("PNG");
  expect(deck.slides[0].objects[0].metadata.retained).toEqual({
    value: "한글",
    absent: undefined,
  });
});
it("validates unchanged media once across recovery revisions, retaining current metadata and rejecting changed invalid content", () => {
  const deck = createDemoDeck();
  for (const slide of deck.slides)
    slide.objects = slide.objects.filter(
      (object) => object.type !== "figure" && object.type !== "video",
    );
  deck.assets = [
    {
      id: "asset-cache-perf",
      name: "Original",
      mime: "image/png",
      width: 1,
      height: 1,
      dataUrl: png,
    },
  ];
  const recovery = () =>
    validateWorkspaceRecovery({
      deck,
      equationDrafts: [],
      savedAt: "2026-11-17T10:00:00.000Z",
    });
  recovery();
  const decode = vi.spyOn(globalThis, "atob");
  deck.assets[0].name = "Renamed";
  const next = recovery();
  expect(decode).not.toHaveBeenCalled();
  expect(next.deck.assets[0].name).toBe("Renamed");
  expect(next.deck.assets[0]).not.toBe(deck.assets[0]);
  deck.assets[0].dataUrl = "data:image/png;base64,AA!A";
  expect(recovery).toThrow(/base64|media|data URL/i);
  deck.assets[0].dataUrl = png;
  deck.assets[0].mime = "image/jpeg";
  expect(recovery).toThrow(/media|data URL|MIME/i);
});
it("keeps SVG sanitization on a cache hit and validates exact base64 size without allocating raster bytes", () => {
  const deck = createDemoDeck();
  for (const slide of deck.slides)
    slide.objects = slide.objects.filter(
      (object) => object.type !== "figure" && object.type !== "video",
    );
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/><script>alert(1)</script></svg>';
  const dataUrl = "data:image/svg+xml;base64," + btoa(svg);
  deck.assets = [
    {
      id: "asset-svg-cache",
      name: "SVG",
      mime: "image/svg+xml",
      width: 10,
      height: 10,
      dataUrl,
    },
  ];
  const recovery = () =>
    validateWorkspaceRecovery({
      deck,
      equationDrafts: [],
      savedAt: "2026-11-17T10:00:00.000Z",
    });
  const first = recovery();
  expect(atob(first.deck.assets[0].dataUrl.split(",")[1])).not.toContain(
    "<script",
  );
  const second = recovery();
  expect(second.deck.assets[0].dataUrl).toBe(first.deck.assets[0].dataUrl);
  const decode = vi.spyOn(globalThis, "atob");
  for (const body of ["AA==", "AAA=", "AAAA"]) {
    deck.assets = [
      {
        id: "asset-padding",
        name: "PNG",
        mime: "image/png",
        width: 1,
        height: 1,
        dataUrl: "data:image/png;base64," + body,
      },
    ];
    expect(recovery().deck.assets[0].dataUrl).toBe(deck.assets[0].dataUrl);
  }
  expect(decode).not.toHaveBeenCalled();
  for (const body of ["A===", "AAAA=", "=AAA", "AA A", "A"]) {
    deck.assets[0].dataUrl = "data:image/png;base64," + body;
    expect(recovery).toThrow();
  }
});
