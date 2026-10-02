import { describe, expect, it } from "vitest";
import {
  createBlankSlide,
  createDemoDeck,
  validateDeck,
} from "../src/lib/model";

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
});
