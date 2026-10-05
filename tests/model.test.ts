import { describe, expect, it } from "vitest";
import {
  createBlankSlide,
  createDemoDeck,
  DEFAULT_PAGE_NUMBERS,
  resolvePageNumber,
  validateDeck,
} from "../src/lib/model";
import {
  isVisibleAtStep,
  maxBuildStep,
  nextBuildStep,
  previousBuildStep,
} from "../src/lib/presentation";

describe("document model", () => {
  it("validates a scientific demo with a bundled vector plot and editable equations", () => {
    const deck = validateDeck(createDemoDeck());
    expect(deck.slides).toHaveLength(3);
    expect(deck.assets[0].mime).toBe("image/svg+xml");
    expect(
      deck.slides[0].objects.some((object) => object.type === "equation"),
    ).toBe(true);
    expect(deck.slides[0].notes).toContain("synthetic");
  });

  it("creates independent blank slide IDs", () => {
    const a = createBlankSlide();
    const b = createBlankSlide();
    expect(a.id).not.toBe(b.id);
    expect(a.objects).toEqual([]);
  });

  it("rejects invalid geometry rather than accepting non-finite layout values", () => {
    const deck = createDemoDeck();
    deck.slides[0].objects[0].transform.x = NaN;
    expect(() => validateDeck(deck)).toThrow("finite number");
  });

  it("rejects dangling figure references", () => {
    const deck = createDemoDeck();
    deck.assets = [];
    expect(() => validateDeck(deck)).toThrow("Missing figure asset");
  });

  it("rejects duplicate IDs across slides and objects", () => {
    const deck = createDemoDeck();
    deck.slides[0].objects[0].id = deck.slides[1].id;
    expect(() => validateDeck(deck)).toThrow("duplicates");
  });

  it("rejects unsupported formats and fonts", () => {
    const deck = createDemoDeck();
    expect(() => validateDeck({ ...deck, formatVersion: "9.0.0" })).toThrow(
      "Unsupported",
    );
    expect(() =>
      validateDeck({
        ...deck,
        theme: {
          ...deck.theme,
          equation: { ...deck.theme.equation, fontSetId: "system-font" },
        },
      }),
    ).toThrow("unavailable math font");
  });

  it("retains metadata while returning an independent document snapshot", () => {
    const original = createDemoDeck();
    original.slides[0].objects[0].metadata = {
      source: "simulation.py",
      parameters: { alpha: 0.1 },
    };
    const snapshot = validateDeck(original);
    expect(snapshot.slides[0].objects[0].metadata).toEqual(
      original.slides[0].objects[0].metadata,
    );
    snapshot.title = "Edited";
    expect(original.title).not.toBe("Edited");
  });

  it.each(["0.1.0", "0.2.0", "0.3.0", "0.4.0"])(
    "migrates %s without adding page numbers or hiding legacy objects",
    (formatVersion) => {
      const deck = createDemoDeck();
      delete deck.pageNumbers;
      const migrated = validateDeck({ ...deck, formatVersion });
      expect(migrated.formatVersion).toBe("0.5.0");
      expect(migrated.pageNumbers).toBeUndefined();
      expect(resolvePageNumber(migrated, 0)).toBeNull();
      expect(migrated.slides).toEqual(deck.slides);
      expect(isVisibleAtStep(migrated.slides[0].objects[0], 0)).toBe(true);
    },
  );

  it("derives page numbers from slide order, including offsets, total, and title suppression", () => {
    const deck = createDemoDeck();
    expect(deck.pageNumbers).toEqual(DEFAULT_PAGE_NUMBERS);
    expect(
      deck.slides
        .flatMap((s) => s.objects)
        .some((o) => o.name === "Slide number"),
    ).toBe(false);
    expect(resolvePageNumber(deck, 0)).toMatchObject({
      text: "1",
      x: 1568,
      y: 864,
      anchor: "end",
    });
    deck.pageNumbers = {
      ...DEFAULT_PAGE_NUMBERS,
      position: "bottom-center",
      format: "number-total",
      startAt: 5,
      hideFirst: true,
    };
    expect(resolvePageNumber(deck, 0)).toBeNull();
    expect(resolvePageNumber(deck, 1)).toMatchObject({
      text: "6 / 7",
      x: 800,
      anchor: "middle",
    });
    deck.slides.splice(1, 1);
    expect(resolvePageNumber(deck, 1)?.text).toBe("6 / 6");
    deck.pageNumbers.position = "bottom-left";
    expect(resolvePageNumber(deck, 1)).toMatchObject({
      x: 32,
      anchor: "start",
    });
    deck.pageNumbers.enabled = false;
    expect(resolvePageNumber(deck, 1)).toBeNull();
    expect(resolvePageNumber(deck, -1)).toBeNull();
  });

  it("rejects malformed page settings and unbounded build timing", () => {
    const deck = createDemoDeck();
    expect(() =>
      validateDeck({
        ...deck,
        pageNumbers: { ...DEFAULT_PAGE_NUMBERS, startAt: 1.5 },
      }),
    ).toThrow("integer");
    expect(() =>
      validateDeck({
        ...deck,
        pageNumbers: {
          ...DEFAULT_PAGE_NUMBERS,
          color: "url(https://example.org)",
        },
      }),
    ).toThrow("color");
    const object = deck.slides[0].objects[0];
    for (const step of [-1, 101, 0.5, Infinity]) {
      object.build = { step, effect: "appear", durationMs: 250 };
      expect(() => validateDeck(deck)).toThrow();
    }
    for (const durationMs of [99, 3001, NaN]) {
      object.build = { step: 1, effect: "fade", durationMs };
      expect(() => validateDeck(deck)).toThrow();
    }
  });

  it("shows the final static state and visits populated builds only during a presentation", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0];
    const object = slide.objects[0];
    object.build = { step: 100, effect: "fade", durationMs: 300 };
    slide.objects[1].build = { step: 15, effect: "appear", durationMs: 100 };
    slide.objects[1].visible = false;
    expect(maxBuildStep(slide)).toBe(100);
    expect(isVisibleAtStep(object, 0)).toBe(false);
    expect(isVisibleAtStep(object, 100)).toBe(true);
    expect(isVisibleAtStep(object)).toBe(true);
    expect(isVisibleAtStep(slide.objects[1])).toBe(false);
    expect(nextBuildStep(slide, 0)).toBe(100);
    expect(nextBuildStep(slide, 100)).toBeNull();
    expect(previousBuildStep(slide, 100)).toBe(0);
    expect(previousBuildStep(slide, 0)).toBeNull();
  });
});
