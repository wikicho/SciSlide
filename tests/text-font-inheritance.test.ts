import { describe, expect, it } from "vitest";
import {
  createDemoDeck,
  validateDeck,
  type TextObject,
} from "../src/lib/model";
import { createThemeDeck } from "../src/lib/deck-themes";
import {
  effectiveTextFontFamily,
  useDeckTextFont,
} from "../src/lib/text-fonts";
import { inlineTextLayoutKey } from "../src/lib/inline-math";
import {
  captureObjectClipboard,
  pasteObjectClipboard,
} from "../src/lib/object-clipboard";
import { applyAgentOperations, createAgentDeck } from "../src/cli/commands";

function firstText(deck = createDemoDeck()) {
  return deck.slides[0].objects.find(
    (object): object is TextObject => object.type === "text",
  )!;
}

describe("compatible text font inheritance", () => {
  it("retains legacy explicit families and restores continuing inheritance", () => {
    const deck = createDemoDeck();
    const object = firstText(deck);
    delete object.fontFamilySource;
    object.fontFamily = "Legacy serif";
    deck.theme.fontFamily = "Nanum Gothic";
    expect(effectiveTextFontFamily(deck, object)).toBe("Legacy serif");
    useDeckTextFont(object, deck);
    expect(object.fontFamily).toBe("Nanum Gothic");
    expect(object.fontFamilySource).toBe("deck");
    deck.theme.fontFamily = "Inter";
    expect(effectiveTextFontFamily(deck, object)).toBe("Inter");
    expect(object.fontFamily).toBe("Nanum Gothic");
    expect(validateDeck(deck).slides[0].objects).toContainEqual({
      ...object,
      fontFamily: "Inter",
    });
    expect(object.fontFamily).toBe("Nanum Gothic");
    expect(() =>
      validateDeck({
        ...deck,
        slides: [
          {
            ...deck.slides[0],
            objects: [{ ...object, fontFamilySource: "system" }],
          },
        ],
      }),
    ).toThrow("Unsupported text font source");
  });

  it("invalidates inline layout only when its effective font changes", () => {
    const deck = createDemoDeck();
    const inherited = firstText(deck);
    const explicit = { ...inherited, fontFamilySource: undefined };
    const inheritedKey = inlineTextLayoutKey(inherited, deck);
    const explicitKey = inlineTextLayoutKey(explicit, deck);
    deck.theme.fontFamily = "Nanum Gothic";
    expect(inlineTextLayoutKey(inherited, deck)).not.toBe(inheritedKey);
    expect(inlineTextLayoutKey(explicit, deck)).toBe(explicitKey);
    expect(deck.theme.equation.fontSetId).toBe("mathjax-stix2");
  });

  it("copies the effective source font as an explicit value across decks", () => {
    const source = createDemoDeck();
    source.theme.fontFamily = "Nanum Gothic";
    const object = firstText(source);
    const clipboard = captureObjectClipboard(source, source.slides[0], [
      object.id,
    ])!;
    expect(clipboard.objects[0]).toMatchObject({ fontFamily: "Nanum Gothic" });
    expect(
      (clipboard.objects[0] as TextObject).fontFamilySource,
    ).toBeUndefined();
    const target = createDemoDeck();
    const [id] = pasteObjectClipboard(target, target.slides[0].id, clipboard);
    const pasted = target.slides[0].objects.find(
      (candidate) => candidate.id === id,
    ) as TextObject;
    target.theme.fontFamily = "Inter";
    expect(effectiveTextFontFamily(target, pasted)).toBe("Nanum Gothic");
    expect(object.fontFamilySource).toBe("deck");
    expect(object.fontFamily).toBe("Inter");
  });

  it("lets CLI font overrides replace inheritance and explicitly restore it", () => {
    const deck = createAgentDeck({ layout: "blank" });
    const added = applyAgentOperations(deck, [
      {
        op: "object.add",
        slide: 1,
        object: { id: "cli-text", type: "text", text: "Font choice" },
      },
    ]).deck;
    expect((added.slides[0].objects[0] as TextObject).fontFamilySource).toBe(
      "deck",
    );
    const explicit = applyAgentOperations(added, [
      {
        op: "object.update",
        slide: 1,
        id: "cli-text",
        patch: { fontFamily: "Nanum Gothic" },
      },
    ]).deck;
    expect(
      (explicit.slides[0].objects[0] as TextObject).fontFamilySource,
    ).toBeUndefined();
    expect((explicit.slides[0].objects[0] as TextObject).fontFamily).toBe(
      "Nanum Gothic",
    );
    const restored = applyAgentOperations(explicit, [
      {
        op: "object.update",
        slide: 1,
        id: "cli-text",
        patch: { fontFamilySource: "deck" },
      },
    ]).deck;
    expect(
      effectiveTextFontFamily(
        restored,
        restored.slides[0].objects[0] as TextObject,
      ),
    ).toBe(restored.theme.fontFamily);
  });

  it.each(["scientific", "minimal-white", "keynote-white"] as const)(
    "creates %s theme text with deck inheritance",
    (theme) => {
      const deck = createThemeDeck(theme);
      const texts = deck.slides
        .flatMap((slide) => slide.objects)
        .filter((object): object is TextObject => object.type === "text");
      expect(texts.length).toBeGreaterThan(0);
      expect(texts.every((object) => object.fontFamilySource === "deck")).toBe(
        true,
      );
    },
  );
});
