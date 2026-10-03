// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import JSZip from "jszip";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDemoDeck, newId, validateDeck } from "../src/lib/model";
import type { Asset, Deck, VideoObject } from "../src/lib/model";
import {
  buildDeckArchive,
  importVideo,
  MAX_FIGURE_BYTES,
  MAX_VIDEO_BYTES,
  readDeckArchive,
} from "../src/lib/persistence";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.restoreAllMocks());

const mp4 = new Uint8Array([
  0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115,
  111, 109, 109, 112, 52, 50,
]);
const webm = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 119, 101, 98, 109,
]);

function asset(bytes: Uint8Array = mp4, mime = "video/mp4"): Asset {
  return {
    id: newId(),
    name: "experiment.mp4",
    mime,
    dataUrl: `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`,
    width: 640,
    height: 360,
  };
}

function videoDeck(media: Asset = asset()): Deck {
  const deck = createDemoDeck();
  const video: VideoObject = {
    id: newId(),
    type: "video",
    name: "Experiment",
    transform: { x: 100, y: 200, width: 640, height: 360, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    assetId: media.id,
    alt: "A laboratory recording",
    autoplay: false,
    loop: true,
    muted: true,
    controls: true,
    build: { step: 2, effect: "fade", durationMs: 400 },
  };
  deck.assets.push(media);
  deck.slides[0].objects.push(video);
  return deck;
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

async function zipBlob(zip: JSZip): Promise<Blob> {
  return new Blob([await zip.generateAsync({ type: "uint8array" })]);
}

function mockMetadata(success = true): {
  revoke: ReturnType<typeof vi.fn>;
  video: HTMLVideoElement;
} {
  const originalCreate = document.createElement.bind(document);
  const video = originalCreate("video");
  Object.defineProperties(video, {
    videoWidth: { value: 640 },
    videoHeight: { value: 360 },
  });
  vi.spyOn(video, "load").mockImplementation(() => {});
  Object.defineProperty(video, "src", {
    set() {
      queueMicrotask(() =>
        video.dispatchEvent(new Event(success ? "loadedmetadata" : "error")),
      );
    },
  });
  vi.spyOn(document, "createElement").mockImplementation(((
    name: string,
    options?: ElementCreationOptions,
  ) =>
    name === "video"
      ? video
      : originalCreate(name, options)) as typeof document.createElement);
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:local-video"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  return { revoke, video };
}

describe("embedded videos and presentation settings", () => {
  it.each([
    [mp4, "video/mp4", "mp4"],
    [webm, "video/webm", "webm"],
  ] as const)(
    "round-trips %s video bytes, object playback options, builds and page numbering",
    async (content, mime, ext) => {
      const deck = videoDeck(asset(content, mime));
      const archive = await buildDeckArchive(deck);
      const zip = await JSZip.loadAsync(await bytes(archive));
      const source = JSON.parse(
        await zip.file("document.json")!.async("string"),
      );
      const manifest = JSON.parse(
        await zip.file("manifest.json")!.async("string"),
      );
      const media = source.assets[1];
      expect(media.path).toBe(`assets/${deck.assets[1].id}.${ext}`);
      expect(media.dataUrl).toBeUndefined();
      expect(await zip.file(media.path)!.async("uint8array")).toEqual(content);
      expect(manifest.formatVersion).toBe("0.4.0");
      expect(
        manifest.resources.find((r: { path: string }) => r.path === media.path)
          .sha256,
      ).toBe(createHash("sha256").update(content).digest("hex"));
      const loaded = await readDeckArchive(archive);
      expect(loaded.pageNumbers).toEqual(deck.pageNumbers);
      expect(loaded.slides).toEqual(deck.slides);
      expect(loaded.assets[1]).toEqual(deck.assets[1]);
    },
  );

  it("requires videos and figures to reference matching media, with no remote URLs", () => {
    const deck = videoDeck();
    const video = deck.slides[0].objects.at(-1)! as VideoObject;
    video.assetId = deck.assets[0].id;
    expect(() => validateDeck(deck)).toThrow("MP4 or WebM");
    video.assetId = deck.assets[1].id;
    const figure = deck.slides[0].objects.find((o) => o.type === "figure")!;
    if (figure.type === "figure") figure.assetId = deck.assets[1].id;
    expect(() => validateDeck(deck)).toThrow("image asset");
    if (figure.type === "figure") figure.assetId = deck.assets[0].id;
    deck.assets[1].dataUrl = "https://example.org/video.mp4";
    expect(() => validateDeck(deck)).toThrow("media type");
  });

  it("checks video integrity and container signatures even in a checksummed crafted archive", async () => {
    const deck = videoDeck();
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(deck)),
    );
    const path = `assets/${deck.assets[1].id}.mp4`;
    const invalid = new Uint8Array([1, 2, 3, 4]);
    zip.file(path, invalid);
    await expect(readDeckArchive(await zipBlob(zip))).rejects.toThrow(
      "integrity check",
    );
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    const resource = manifest.resources.find(
      (r: { path: string }) => r.path === path,
    );
    resource.size = invalid.length;
    resource.sha256 = createHash("sha256").update(invalid).digest("hex");
    zip.file("manifest.json", JSON.stringify(manifest));
    await expect(readDeckArchive(await zipBlob(zip))).rejects.toThrow(
      "declared file type",
    );
  });

  it("keeps the 20 MB image resource cap separate from the 40 MB video cap", async () => {
    const deck = videoDeck();
    const zip = await JSZip.loadAsync(
      await bytes(await buildDeckArchive(deck)),
    );
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    const videoResource = manifest.resources.find(
      (r: { mime: string }) => r.mime === "video/mp4",
    );
    videoResource.size = MAX_FIGURE_BYTES + 1;
    zip.file("manifest.json", JSON.stringify(manifest));
    await expect(readDeckArchive(await zipBlob(zip))).rejects.toThrow(
      "integrity check",
    );
    videoResource.mime = "image/png";
    zip.file("manifest.json", JSON.stringify(manifest));
    await expect(readDeckArchive(await zipBlob(zip))).rejects.toThrow(
      "oversized resource",
    );
    await expect(
      importVideo({ size: MAX_VIDEO_BYTES + 1 } as File),
    ).rejects.toThrow("40 MB");
  });

  it("imports decoded dimensions from a local video and releases the temporary URL", async () => {
    const { revoke } = mockMetadata();
    const imported = await importVideo(
      new File([mp4], "experiment.mp4", { type: "video/mp4" }),
    );
    expect(imported).toMatchObject({
      name: "experiment.mp4",
      mime: "video/mp4",
      width: 640,
      height: 360,
    });
    expect(imported.dataUrl).toMatch(/^data:video\/mp4;base64,/);
    expect(revoke).toHaveBeenCalledWith("blob:local-video");
  });

  it("reports unsupported codecs and cleans up failed decoder resources", async () => {
    const { revoke } = mockMetadata(false);
    await expect(
      importVideo(new File([webm], "experiment.webm", { type: "video/webm" })),
    ).rejects.toThrow("codec");
    expect(revoke).toHaveBeenCalledWith("blob:local-video");
    await expect(
      importVideo(new File([mp4], "mislabelled.webm", { type: "video/webm" })),
    ).rejects.toThrow("declared media type");
    await expect(
      importVideo(new File(["plain text"], "fake.mp4", { type: "video/mp4" })),
    ).rejects.toThrow("valid MP4 or WebM");
  });
});
