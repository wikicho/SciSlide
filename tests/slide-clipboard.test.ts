import { describe, expect, it } from "vitest";
import {
  createBlankSlide,
  createDemoDeck,
  validateDeck,
} from "../src/lib/model";
import { shapeFromDrag } from "../src/lib/drawing";
import { pruneUnusedAssets } from "../src/lib/deck-editing";
import {
  captureSlideClipboard,
  pasteSlideClipboard,
} from "../src/lib/slide-clipboard";

describe("slide clipboard", () => {
  it("preserves notes, background, locked and hidden groups with independent IDs on every paste", () => {
    const deck = createDemoDeck();
    const source = deck.slides[0];
    const frame = shapeFromDrag("rect", { x: 100, y: 100 }, { x: 300, y: 200 });
    const decoration = structuredClone(frame);
    decoration.id = "decoration";
    frame.groupId = decoration.groupId = "frame-group";
    decoration.metadata.mediaPlaceholderFor = frame.id;
    decoration.visible = false;
    frame.locked = true;
    source.objects = [frame, decoration];
    source.notes = "Speaker notes";
    source.background = "#123456";
    const before = structuredClone(source);
    const clipboard = captureSlideClipboard(deck, source);
    source.notes = "Edited after copying";
    const first = pasteSlideClipboard(deck, source.id, clipboard);
    const second = pasteSlideClipboard(deck, first.id, clipboard);
    expect(first).toMatchObject({
      title: before.title,
      notes: before.notes,
      background: before.background,
    });
    expect(first.objects.map((object) => object.transform)).toEqual(
      before.objects.map((object) => object.transform),
    );
    expect(first.objects[0].locked).toBe(true);
    expect(first.objects[1].visible).toBe(false);
    expect(first.objects[1].metadata.mediaPlaceholderFor).toBe(
      first.objects[0].id,
    );
    expect(first.objects[0].groupId).toBe(first.objects[1].groupId);
    expect(first.objects[0].groupId).not.toBe(frame.groupId);
    expect(first.objects[0].groupId).not.toBe(second.objects[0].groupId);
    expect(
      new Set(
        deck.slides.flatMap((slide) => [
          slide.id,
          ...slide.objects.map((object) => object.id),
        ]),
      ).size,
    ).toBe(
      deck.slides.reduce((total, slide) => total + 1 + slide.objects.length, 0),
    );
    validateDeck(deck);
  });

  it("retains embedded media and equation appearance after deleting the source or changing presentations", () => {
    const source = createDemoDeck();
    const slide = source.slides.find((candidate) =>
      candidate.objects.some((object) => object.type === "figure"),
    )!;
    const equation = source.slides
      .flatMap((candidate) => candidate.objects)
      .find((object) => object.type === "equation")!;
    equation.style = {};
    slide.objects = [
      ...slide.objects.filter((object) => object.id !== equation.id),
      structuredClone(equation),
    ];
    source.slides = [slide];
    const clipboard = captureSlideClipboard(source, slide);
    const target = createDemoDeck();
    target.slides = [createBlankSlide()];
    target.assets = [];
    target.theme.equation.color = "#ff0000";
    source.slides = [createBlankSlide()];
    pruneUnusedAssets(source);
    expect(source.assets).toEqual([]);
    const first = pasteSlideClipboard(target, target.slides[0].id, clipboard);
    pasteSlideClipboard(target, first.id, clipboard);
    expect(target.assets).toHaveLength(clipboard.content.assets.length);
    expect(
      first.objects.find((object) => object.type === "equation")?.style,
    ).toMatchObject(source.theme.equation);
    expect(
      first.objects.find((object) => object.type === "figure")?.assetId,
    ).toBe(target.assets[0].id);
    validateDeck(target);
  });

  it("copies a blank slide and leaves the destination unchanged when media is unavailable", () => {
    const deck = createDemoDeck();
    const blank = createBlankSlide();
    const pasted = pasteSlideClipboard(
      deck,
      deck.slides[0].id,
      captureSlideClipboard(deck, blank),
    );
    expect(pasted.objects).toEqual([]);
    expect(pasted.id).not.toBe(blank.id);
    const source = deck.slides.find((slide) =>
      slide.objects.some((object) => object.type === "figure"),
    )!;
    const clipboard = captureSlideClipboard(deck, source);
    clipboard.content.assets = [];
    const before = structuredClone(deck);
    expect(() => pasteSlideClipboard(deck, pasted.id, clipboard)).toThrow(
      "media",
    );
    expect(deck).toEqual(before);
  });
});
