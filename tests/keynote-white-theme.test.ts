// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createThemeDeck,
  createThemedSlide,
  DECK_THEMES,
  getDeckLayouts,
  getDeckThemeId,
} from "../src/lib/deck-themes";
import {
  createKeynoteWhiteSlide,
  KEYNOTE_WHITE_LAYOUTS,
} from "../src/lib/keynote-white-layouts";
import { createDemoDeck, validateDeck } from "../src/lib/model";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";
import { SLIDE_TEMPLATES } from "../src/lib/slide-templates";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

describe("Keynote White layout family", () => {
  it("offers the fifteen reference layouts in a dedicated theme catalog", () => {
    expect(KEYNOTE_WHITE_LAYOUTS.map(({ id }) => id)).toEqual(
      [
        "title",
        "title-photo",
        "title-photo-alternate",
        "title-bullets",
        "bullets",
        "title-bullets-photo",
        "small-video",
        "large-video",
        "section",
        "title-only",
        "agenda",
        "statement",
        "fact",
        "quote",
        "three-photos",
      ].map((id) => `keynote-white-${id}`),
    );
    expect(new Set(KEYNOTE_WHITE_LAYOUTS.map(({ id }) => id)).size).toBe(15);
    expect(
      KEYNOTE_WHITE_LAYOUTS.every(({ category }) => category === "keynote"),
    ).toBe(true);
    expect(
      KEYNOTE_WHITE_LAYOUTS.every(
        ({ name, description }) => name && description,
      ),
    ).toBe(true);
    const catalog = getDeckLayouts(createThemeDeck("keynote-white"));
    expect(catalog.map(({ id }) => id)).toEqual([
      "blank",
      ...KEYNOTE_WHITE_LAYOUTS.map(({ id }) => id),
    ]);
  });

  it.each(KEYNOTE_WHITE_LAYOUTS)(
    "creates a valid, editable $name slide within the 16:9 canvas",
    ({ id, name }) => {
      const deck = createThemeDeck("keynote-white");
      deck.theme.fontFamily = "Nanum Gothic";
      const slide = createKeynoteWhiteSlide(id, deck.theme);
      expect(slide.title).toBe(name);
      expect(slide.background).toBe("#ffffff");
      expect(slide.objects.length).toBeGreaterThan(0);
      expect(new Set(slide.objects.map((object) => object.id)).size).toBe(
        slide.objects.length,
      );
      for (const object of slide.objects) {
        const frame = object.transform;
        expect(object.visible).toBe(true);
        expect(object.locked).toBe(false);
        expect(["text", "shape"]).toContain(object.type);
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.y).toBeGreaterThanOrEqual(0);
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
        expect(frame.x + frame.width).toBeLessThanOrEqual(deck.slideSize.width);
        expect(frame.y + frame.height).toBeLessThanOrEqual(
          deck.slideSize.height,
        );
        if (object.type === "text") {
          expect(object.fontFamily).toBe("Nanum Gothic");
          expect(object.color).not.toBe(slide.background);
          expect(object.text.trim()).not.toBe("");
        }
      }
      const valid = validateDeck({ ...deck, slides: [slide] });
      expect(valid.slides[0]).toEqual(slide);
      expect(valid.assets).toEqual([]);
    },
  );

  it("creates independent slide and object IDs and leaves the deck unchanged", () => {
    const deck = createThemeDeck("keynote-white");
    const before = JSON.stringify(deck);
    const first = KEYNOTE_WHITE_LAYOUTS.map(({ id }) =>
      createThemedSlide(id, deck),
    );
    const second = KEYNOTE_WHITE_LAYOUTS.map(({ id }) =>
      createThemedSlide(id, deck),
    );
    const slides = [...first, ...second];
    expect(new Set(slides.map(({ id }) => id)).size).toBe(slides.length);
    const objects = slides.flatMap(({ objects }) => objects);
    expect(new Set(objects.map(({ id }) => id)).size).toBe(objects.length);
    const originalText = second[0].objects.find(
      (object) => object.type === "text",
    )!;
    first[0].objects.find(
      (object) => object.type === "text",
    )!.metadata.changed = true;
    expect(originalText.metadata.changed).toBeUndefined();
    expect(JSON.stringify(deck)).toBe(before);
  });

  it("provides editable, asset-free media placeholders with distinct photo and video layouts", () => {
    const deck = createThemeDeck("keynote-white");
    for (const [id, media, count] of [
      ["keynote-white-title-photo", "photo", 1],
      ["keynote-white-title-photo-alternate", "photo", 1],
      ["keynote-white-title-bullets-photo", "photo", 1],
      ["keynote-white-small-video", "video", 1],
      ["keynote-white-large-video", "video", 1],
      ["keynote-white-three-photos", "photo", 3],
    ] as const) {
      const slide = createThemedSlide(id, deck);
      const frames = slide.objects.filter(
        ({ metadata }) => metadata.mediaPlaceholder === media,
      );
      expect(frames, id).toHaveLength(count);
      expect(
        frames.every((object) => object.type === "shape" && !object.locked),
      ).toBe(true);
      const frameIds = frames.map(({ id }) => id);
      for (const object of slide.objects) {
        if (object.metadata.mediaPlaceholderFor) {
          expect(frameIds).toContain(object.metadata.mediaPlaceholderFor);
        }
      }
    }
    const small = createThemedSlide(
      "keynote-white-small-video",
      deck,
    ).objects.find(({ metadata }) => metadata.mediaPlaceholder === "video")!;
    const large = createThemedSlide(
      "keynote-white-large-video",
      deck,
    ).objects.find(({ metadata }) => metadata.mediaPlaceholder === "video")!;
    expect(large.transform.width * large.transform.height).toBeGreaterThan(
      small.transform.width * small.transform.height,
    );
    const photos = createThemedSlide("keynote-white-three-photos", deck)
      .objects.filter(({ metadata }) => metadata.mediaPlaceholder === "photo")
      .sort((first, second) => first.transform.x - second.transform.x);
    expect(photos[0].transform.x).toBeLessThan(photos[1].transform.x);
    expect(photos[1].transform.x).toBe(photos[2].transform.x);
    expect(photos[1].transform.y).not.toBe(photos[2].transform.y);
    expect(deck.assets).toEqual([]);
  });

  it("preserves the theme, every layout, and user edits through the native archive", async () => {
    const deck = createThemeDeck("keynote-white");
    deck.slides = KEYNOTE_WHITE_LAYOUTS.map(({ id }) =>
      createThemedSlide(id, deck),
    );
    deck.slides[0].notes = "Speaker notes survive export and recovery.";
    const title = deck.slides[0].objects.find(
      (object) => object.type === "text",
    )!;
    if (title.type !== "text") throw new Error("Missing editable title");
    title.text = "A research result\n한글 제목";
    title.metadata.customAnnotation = "Keep user metadata";
    const loaded = await readDeckArchive(await buildDeckArchive(deck));
    expect(loaded).toEqual(deck);
    expect(getDeckThemeId(loaded)).toBe("keynote-white");
    expect(getDeckLayouts(loaded).map(({ id }) => id)).toEqual([
      "blank",
      ...KEYNOTE_WHITE_LAYOUTS.map(({ id }) => id),
    ]);
    expect(await readDeckArchive(await buildDeckArchive(loaded))).toEqual(
      loaded,
    );
  });

  it("keeps existing theme and imported-deck layout catalogs compatible", () => {
    for (const theme of DECK_THEMES.filter(
      ({ id }) => id !== "keynote-white",
    )) {
      expect(getDeckLayouts(createThemeDeck(theme.id))).toEqual(
        SLIDE_TEMPLATES,
      );
    }
    const imported = createDemoDeck();
    expect(getDeckLayouts(imported)).toEqual(SLIDE_TEMPLATES);
    Object.assign(imported.theme, { starterThemeId: "unknown" });
    expect(getDeckLayouts(imported)).toEqual(SLIDE_TEMPLATES);
    const newDeck = createThemeDeck("keynote-white");
    for (const { id } of SLIDE_TEMPLATES) {
      expect(() =>
        validateDeck({
          ...newDeck,
          slides: [createThemedSlide(id, newDeck)],
        }),
      ).not.toThrow();
    }
  });
});
