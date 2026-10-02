import { describe, expect, it } from "vitest";
import { createDemoDeck, FONT_SET_IDS, validateDeck } from "../src/lib/model";
import { renderObjectEquation } from "../src/lib/equation-renderer";
import {
  createTemplateSlide,
  SLIDE_TEMPLATES,
} from "../src/lib/slide-templates";

describe("scientific starter templates", () => {
  it("produces valid, editable layouts without imported assets", () => {
    const deck = createDemoDeck();
    deck.assets = [];
    deck.slides = SLIDE_TEMPLATES.map(({ id }) =>
      createTemplateSlide(id, deck.theme),
    );
    expect(validateDeck(deck).slides).toHaveLength(5);
    expect(deck.slides[0].objects).toEqual([]);
    for (const slide of deck.slides)
      for (const object of slide.objects) {
        expect(object.type).not.toBe("figure");
        expect(object.locked).toBe(false);
        expect(object.visible).toBe(true);
        expect(object.transform.x).toBeGreaterThanOrEqual(0);
        expect(object.transform.y).toBeGreaterThanOrEqual(0);
        expect(object.transform.x + object.transform.width).toBeLessThanOrEqual(
          1600,
        );
        expect(
          object.transform.y + object.transform.height,
        ).toBeLessThanOrEqual(900);
      }
  });

  it("allows the same layout to be inserted repeatedly without ID collisions or shared data", () => {
    const deck = createDemoDeck();
    const pairs = SLIDE_TEMPLATES.map(({ id }) => [
      createTemplateSlide(id, deck.theme),
      createTemplateSlide(id, deck.theme),
    ]);
    deck.slides = pairs.flat();
    expect(() => validateDeck(deck)).not.toThrow();
    for (const [first, second] of pairs) {
      first.title = "Edited";
      expect(second.title).not.toBe("Edited");
      if (first.objects.length) {
        first.objects[0].transform.x = 777;
        first.objects[0].metadata.changed = true;
        expect(second.objects[0].transform.x).not.toBe(777);
        expect(second.objects[0].metadata.changed).toBeUndefined();
      }
    }
  });

  it("uses the current deck text font and lets equation font and color continue to inherit", () => {
    const deck = createDemoDeck();
    deck.theme.fontFamily = "Inter";
    deck.theme.equation = {
      fontSetId: "mathjax-fira",
      fontSize: 42,
      color: "#a34f72",
    };
    const before = structuredClone(deck.theme);
    const slide = createTemplateSlide("equation", deck.theme);
    const equation = slide.objects.find((object) => object.type === "equation");
    expect(equation?.type).toBe("equation");
    if (equation?.type !== "equation") throw new Error("Missing equation");
    expect(equation.renderer).toBe("mathjax");
    expect(equation.style.fontSetId ?? deck.theme.equation.fontSetId).toBe(
      "mathjax-fira",
    );
    expect(equation.style.color ?? deck.theme.equation.color).toBe("#a34f72");
    expect(equation.style.fontSize).toBe(64);
    expect(equation.localTex).toBeUndefined();
    expect(
      slide.objects
        .filter((object) => object.type === "text")
        .every((object) => object.fontFamily === deck.theme.fontFamily),
    ).toBe(true);
    expect(deck.theme).toEqual(before);
  });

  it("renders the starter equation as self-contained vectors inside its panel in every math font", async () => {
    const deck = createDemoDeck();
    for (const fontSetId of FONT_SET_IDS) {
      deck.theme.equation.fontSetId = fontSetId;
      const slide = createTemplateSlide("equation", deck.theme);
      const equation = slide.objects.find(
        (object) => object.type === "equation",
      );
      if (equation?.type !== "equation") throw new Error("Missing equation");
      const result = await renderObjectEquation(equation, deck);
      expect(result.svg).toContain("<path");
      expect(result.svg).not.toMatch(/<(?:text|image|use|script)\b|href=/);
      expect(equation.transform.x + result.width).toBeLessThan(1470);
      expect(equation.transform.y + result.height).toBeLessThan(566);
    }
  });
});
