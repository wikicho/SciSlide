import { describe, expect, it, vi } from "vitest";
import { cloneDeck, pruneUnusedAssets } from "../src/lib/deck-editing";
import { createDemoDeck, newId } from "../src/lib/model";
import type { VideoObject } from "../src/lib/model";

describe("media-aware deck editing", () => {
  it("copies editable state and registry records while excluding immutable media from the deep clone", () => {
    const deck = createDemoDeck();
    const deepClone = vi.spyOn(globalThis, "structuredClone");
    try {
      const copy = cloneDeck(deck);
      expect(deepClone).toHaveBeenCalledOnce();
      expect(deepClone.mock.calls[0][0]).not.toHaveProperty("assets");
      expect(copy).toEqual(deck);
      expect(copy.slides).not.toBe(deck.slides);
      expect(copy.slides[0].objects[0]).not.toBe(deck.slides[0].objects[0]);
      expect(copy.assets).not.toBe(deck.assets);
      expect(copy.assets[0]).not.toBe(deck.assets[0]);
      expect(copy.assets[0].dataUrl).toBe(deck.assets[0].dataUrl);
      copy.theme.equation.color = "#ff0000";
      copy.slides[0].objects[0].transform.x += 100;
      copy.assets[0].name = "renamed.svg";
      expect(deck.theme.equation.color).not.toBe(copy.theme.equation.color);
      expect(deck.slides[0].objects[0].transform.x).not.toBe(
        copy.slides[0].objects[0].transform.x,
      );
      expect(deck.assets[0].name).not.toBe(copy.assets[0].name);
    } finally {
      deepClone.mockRestore();
    }
  });

  it("keeps shared figure/video assets on any slide, including hidden objects", () => {
    const deck = createDemoDeck();
    const media = {
      ...deck.assets[0],
      id: newId(),
      mime: "video/webm",
      name: "clip.webm",
    };
    const orphan = { ...deck.assets[0], id: newId(), name: "unused.svg" };
    deck.assets.push(media, orphan);
    const video: VideoObject = {
      ...deck.slides[0].objects[0],
      id: newId(),
      type: "video",
      assetId: media.id,
      alt: "Hidden recording",
      autoplay: false,
      loop: false,
      muted: true,
      controls: true,
      visible: false,
    };
    deck.slides[1].objects.push(video);
    // A second object shares a registry entry; removing one must not drop it.
    deck.slides[2].objects.push({ ...video, id: newId() });
    const history = cloneDeck(deck);
    pruneUnusedAssets(deck);
    expect(deck.assets.map((asset) => asset.id)).toEqual([
      deck.assets[0].id,
      media.id,
    ]);
    deck.slides[1].objects.pop();
    pruneUnusedAssets(deck);
    expect(deck.assets.some((asset) => asset.id === media.id)).toBe(true);
    deck.slides[2].objects.pop();
    pruneUnusedAssets(deck);
    expect(deck.assets.some((asset) => asset.id === media.id)).toBe(false);
    expect(history.assets).toHaveLength(3);
    expect(history.slides[1].objects.at(-1)?.id).toBe(video.id);
  });

  it("reclaims all assets when their last referencing slide is deleted, without changing slide state", () => {
    const deck = createDemoDeck();
    const history = cloneDeck(deck);
    deck.slides.shift();
    const slides = deck.slides;
    const remaining = structuredClone(slides);
    pruneUnusedAssets(deck);
    expect(deck.assets).toEqual([]);
    expect(deck.slides).toBe(slides);
    expect(deck.slides).toEqual(remaining);
    expect(history.assets).toHaveLength(1);
    expect(history.slides).toHaveLength(3);
  });
});
