import { describe, expect, it, vi } from "vitest";
import {
  cloneDeck,
  pruneUnusedAssets,
  sameDocument,
} from "../src/lib/deck-editing";
import { createDemoDeck, DEFAULT_PAGE_NUMBERS, newId } from "../src/lib/model";
import type {
  Deck,
  EquationObject,
  TextObject,
  VideoObject,
} from "../src/lib/model";

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

describe("saved document comparison", () => {
  function document(): Deck {
    const deck = createDemoDeck();
    deck.pageNumbers = { ...DEFAULT_PAGE_NUMBERS, firstSlide: 2 };
    deck.slides[0].objects[0].metadata = {
      provenance: { pages: [1, null, { checked: true, label: "原文" }] },
    };
    const text = deck.slides[0].objects.find(
      (object): object is TextObject => object.type === "text",
    )!;
    text.textStyles = [{ start: 0, end: 1, color: "#123456" }];
    text.build = { step: 1, effect: "appear", durationMs: 300 };
    return deck;
  }
  const text = (deck: Deck) =>
    deck.slides[0].objects.find(
      (object): object is TextObject => object.type === "text",
    )!;
  const equation = (deck: Deck) =>
    deck.slides
      .flatMap((slide) => slide.objects)
      .find((object): object is EquationObject => object.type === "equation")!;

  it("recognizes an independent Undo copy despite key order and omitted undefined options", () => {
    const saved = document();
    const restored = cloneDeck(saved);
    restored.theme = {
      fontFamily: restored.theme.fontFamily,
      inlineMathFontSetId: undefined,
      equation: { ...restored.theme.equation },
    };
    delete saved.theme.inlineMathFontSetId;
    expect(sameDocument(saved, restored)).toBe(true);
    text(restored).text += " edited";
    expect(sameDocument(saved, restored)).toBe(false);
    const undone = cloneDeck(saved);
    expect(sameDocument(undone, saved)).toBe(true);
    expect(sameDocument(cloneDeck(restored), saved)).toBe(false);
  });

  it.each<[string, (deck: Deck) => void]>([
    ["document title", (deck) => (deck.title += " edited")],
    ["document type", (deck) => (deck.documentType = "poster")],
    ["slide dimensions", (deck) => (deck.slideSize.width += 1)],
    ["theme font", (deck) => (deck.theme.fontFamily = "Nanum Gothic")],
    ["equation defaults", (deck) => (deck.theme.equation.color = "#ff0000")],
    ["page numbering", (deck) => (deck.pageNumbers!.firstSlide = 3)],
    ["slide order", (deck) => deck.slides.reverse()],
    ["slide title", (deck) => (deck.slides[0].title += " changed")],
    ["speaker notes", (deck) => (deck.slides[0].notes += " notes")],
    ["slide background", (deck) => (deck.slides[0].background = "#ff0000")],
    ["object name", (deck) => (text(deck).name += " revised")],
    ["text source", (deck) => (text(deck).text += " changed")],
    ["partial color", (deck) => (text(deck).textStyles![0].color = "#ff0000")],
    ["fitting", (deck) => (text(deck).autoFit = "content")],
    ["transform", (deck) => (text(deck).transform.rotation += 5)],
    ["visibility", (deck) => (text(deck).visible = !text(deck).visible)],
    ["lock", (deck) => (text(deck).locked = !text(deck).locked)],
    ["group", (deck) => (text(deck).groupId = "new-group")],
    ["animation", (deck) => (text(deck).build!.step = 2)],
    ["equation source", (deck) => (equation(deck).latex += "+x")],
    ["equation style", (deck) => (equation(deck).style.color = "#ff0000")],
    ["asset name", (deck) => (deck.assets[0].name += " renamed")],
    ["asset source", (deck) => (deck.assets[0].dataUrl += " changed")],
    ["asset dimensions", (deck) => (deck.assets[0].width += 1)],
    ["asset removal", (deck) => deck.assets.pop()],
    [
      "nested metadata",
      (deck) => {
        const metadata = deck.slides[0].objects[0].metadata as {
          provenance: { pages: Array<unknown> };
        };
        metadata.provenance.pages.push({ checked: false });
      },
    ],
  ])("detects a persisted change to %s", (_name, edit) => {
    const saved = document();
    const changed = cloneDeck(saved);
    edit(changed);
    expect(sameDocument(changed, saved)).toBe(false);
    expect(sameDocument(saved, changed)).toBe(false);
  });

  it("compares unchanged large embedded assets without JSON serialization", () => {
    const saved = document();
    saved.assets[0].dataUrl = `data:image/png;base64,${"A".repeat(16 * 1024 * 1024)}`;
    const restored = cloneDeck(saved);
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      expect(sameDocument(saved, restored)).toBe(true);
      restored.slides[0].notes += " edited";
      expect(sameDocument(saved, restored)).toBe(false);
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
  });

  it("handles deeply nested JSON metadata without using the call stack", () => {
    const saved = document();
    const restored = cloneDeck(saved);
    let first: Record<string, unknown> = saved.slides[0].objects[0].metadata;
    let second: Record<string, unknown> =
      restored.slides[0].objects[0].metadata;
    for (let depth = 0; depth < 20_000; depth++) {
      first.next = {};
      second.next = {};
      first = first.next as Record<string, unknown>;
      second = second.next as Record<string, unknown>;
    }
    expect(sameDocument(saved, restored)).toBe(true);
    first.changed = true;
    expect(sameDocument(saved, restored)).toBe(false);
  });
});
