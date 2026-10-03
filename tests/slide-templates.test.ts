import { describe, expect, it } from "vitest";
import { createDemoDeck, FONT_SET_IDS, validateDeck } from "../src/lib/model";
import { renderObjectEquation } from "../src/lib/equation-renderer";
import { lineWorldEndpoints, objectBounds } from "../src/lib/drawing";
import { TEXT_FONT_WEIGHTS } from "../src/lib/text-fonts";
import {
  createTemplateSlide,
  SLIDE_TEMPLATES,
} from "../src/lib/slide-templates";

describe("slide starter templates", () => {
  it("preserves the scientific layout IDs and adds six Keynote-inspired layouts", () => {
    expect(SLIDE_TEMPLATES.map(({ id }) => id)).toEqual([
      "blank",
      "title",
      "content",
      "equation",
      "comparison",
      "section",
      "methods",
      "results",
      "closing",
      "minimal-white",
      "minimal-black",
      "minimal-white-content",
      "minimal-black-content",
      "color-statement",
      "figure-showcase",
    ]);
    expect(new Set(SLIDE_TEMPLATES.map(({ name }) => name)).size).toBe(15);
    expect(
      SLIDE_TEMPLATES.filter(({ category }) => category === "scientific"),
    ).toHaveLength(9);
    expect(
      SLIDE_TEMPLATES.filter(({ category }) => category === "keynote").map(
        ({ id }) => id,
      ),
    ).toEqual([
      "minimal-white",
      "minimal-black",
      "minimal-white-content",
      "minimal-black-content",
      "color-statement",
      "figure-showcase",
    ]);
  });

  it("produces valid, editable layouts without imported assets", () => {
    const deck = createDemoDeck();
    deck.assets = [];
    deck.slides = SLIDE_TEMPLATES.map(({ id }) =>
      createTemplateSlide(id, deck.theme),
    );
    expect(validateDeck(deck).slides).toHaveLength(15);
    expect(deck.slides[0].objects).toEqual([]);
    for (const slide of deck.slides)
      for (const object of slide.objects) {
        expect(object.type).not.toBe("figure");
        expect(object.type).not.toBe("video");
        expect(object.locked).toBe(false);
        expect(object.visible).toBe(true);
        expect(object.transform.x).toBeGreaterThanOrEqual(0);
        expect(object.transform.y).toBeGreaterThanOrEqual(0);
        expect(object.transform.width).toBeGreaterThan(0);
        expect(object.transform.height).toBeGreaterThan(0);
        expect(Object.values(object.transform).every(Number.isFinite)).toBe(
          true,
        );
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
    const ids = deck.slides.flatMap((slide) => [
      slide.id,
      ...slide.objects.map((object) => object.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
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

  it("uses bundled Inter font weights so every starter can export to PDF", () => {
    const { theme } = createDemoDeck();
    theme.fontFamily = "Inter";
    for (const { id } of SLIDE_TEMPLATES) {
      const slide = createTemplateSlide(id, theme);
      for (const object of slide.objects) {
        if (object.type !== "text") continue;
        expect(
          TEXT_FONT_WEIGHTS,
          `${slide.title}: ${object.name} must use an exportable Inter weight`,
        ).toContain(object.fontWeight);
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
    for (const { id } of SLIDE_TEMPLATES) {
      const layout = createTemplateSlide(id, deck.theme);
      expect(
        layout.objects
          .filter((object) => object.type === "text")
          .every((object) => object.fontFamily === deck.theme.fontFamily),
      ).toBe(true);
    }
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

  it("keeps each new layout visually distinct and its text boxes separate", () => {
    const { theme } = createDemoDeck();
    const ids = ["section", "methods", "results", "closing"] as const;
    const layouts = ids.map((id) => createTemplateSlide(id, theme));
    expect(new Set(layouts.map((slide) => slide.background)).size).toBe(4);
    for (const slide of layouts) {
      const texts = slide.objects.filter((object) => object.type === "text");
      for (let first = 0; first < texts.length; first++) {
        for (let second = first + 1; second < texts.length; second++) {
          const a = texts[first].transform;
          const b = texts[second].transform;
          const overlapX =
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY =
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(
            overlapX <= 0 || overlapY <= 0,
            `${slide.title}: ${texts[first].name} overlaps ${texts[second].name}`,
          ).toBe(true);
        }
      }
    }
  });

  it("connects the three method cards with editable horizontal arrows pointing right", () => {
    const { theme } = createDemoDeck();
    const slide = createTemplateSlide("methods", theme);
    const cards = slide.objects.filter((object) =>
      /^Step \d card$/.test(object.name),
    );
    const arrows = slide.objects.filter(
      (object) => object.type === "shape" && object.shape === "arrow",
    );
    expect(cards).toHaveLength(3);
    expect(arrows).toHaveLength(2);
    expect(
      slide.objects
        .filter(
          (object) => object.type === "text" && / label$/.test(object.name),
        )
        .map((object) => object.type === "text" && object.text),
    ).toEqual(["METHODS / WORKFLOW", "Inputs", "Analysis", "Validation"]);
    for (const [index, arrow] of arrows.entries()) {
      if (arrow.type !== "shape") throw new Error("Missing pipeline arrow");
      expect(arrow.startArrow).toBe(false);
      expect(arrow.endArrow).toBe(true);
      expect(arrow.groupId).toBeUndefined();
      for (const endpoint of [arrow.line?.start, arrow.line?.end]) {
        expect(endpoint).toBeDefined();
        expect(endpoint?.x).toBeGreaterThanOrEqual(0);
        expect(endpoint?.x).toBeLessThanOrEqual(1);
        expect(endpoint?.y).toBeGreaterThanOrEqual(0);
        expect(endpoint?.y).toBeLessThanOrEqual(1);
      }
      const { start, end } = lineWorldEndpoints(arrow);
      expect(start.y).toBe(end.y);
      expect(end.x).toBeGreaterThan(start.x);
      const left = cards[index].transform;
      const right = cards[index + 1].transform;
      expect(start.x).toBeGreaterThan(left.x + left.width);
      expect(end.x).toBeLessThan(right.x);
      expect(start.y).toBeGreaterThan(left.y);
      expect(start.y).toBeLessThan(left.y + left.height);
    }
  });

  it("leaves generous open space on the monochrome title slides and keeps new text boxes separate", () => {
    const { theme } = createDemoDeck();
    const white = createTemplateSlide("minimal-white", theme);
    const black = createTemplateSlide("minimal-black", theme);
    for (const slide of [white, black]) {
      expect(slide.objects).toHaveLength(4);
      expect(slide.objects.every((object) => object.type === "text")).toBe(
        true,
      );
      const title = slide.objects[0];
      expect(title.type).toBe("text");
      if (title.type !== "text") throw new Error("Missing minimal title");
      expect(title.fontSize).toBeGreaterThanOrEqual(80);
      expect(title.fontWeight).toBeGreaterThanOrEqual(600);
      expect(title.transform.y).toBeGreaterThan(300);
      expect(title.transform.y + title.transform.height).toBeLessThan(450);
      expect(title.align).toBe(slide === white ? "left" : "center");
    }
    for (const { id, category } of SLIDE_TEMPLATES) {
      if (category !== "keynote") continue;
      const slide = createTemplateSlide(id, theme);
      const texts = slide.objects.filter((object) => object.type === "text");
      for (let first = 0; first < texts.length; first++) {
        for (let second = first + 1; second < texts.length; second++) {
          const a = texts[first].transform;
          const b = texts[second].transform;
          const overlapX =
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY =
            Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(
            overlapX <= 0 || overlapY <= 0,
            `${slide.title}: ${texts[first].name} overlaps ${texts[second].name}`,
          ).toBe(true);
        }
      }
    }
  });

  it("pairs the white and black findings layouts with three equally spaced editable columns", () => {
    const { theme } = createDemoDeck();
    for (const id of [
      "minimal-white-content",
      "minimal-black-content",
    ] as const) {
      const slide = createTemplateSlide(id, theme);
      const headings = slide.objects.filter((object) =>
        /^Idea \d heading$/.test(object.name),
      );
      const details = slide.objects.filter((object) =>
        /^Idea \d detail$/.test(object.name),
      );
      expect(headings).toHaveLength(3);
      expect(details).toHaveLength(3);
      const widths = headings.map((object) => object.transform.width);
      expect(new Set(widths).size).toBe(1);
      expect(headings[1].transform.x - headings[0].transform.x).toBe(
        headings[2].transform.x - headings[1].transform.x,
      );
      for (const [index, heading] of headings.entries()) {
        expect(details[index].transform.x).toBe(heading.transform.x);
        expect(details[index].transform.width).toBe(heading.transform.width);
        expect(details[index].transform.y).toBeGreaterThan(
          heading.transform.y + heading.transform.height,
        );
      }
    }
  });

  it("keeps text on the dark themes readable with high foreground contrast", () => {
    const luminance = (color: string): number => {
      const channels = [1, 3, 5].map((offset) => {
        const value =
          Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const { theme } = createDemoDeck();
    for (const id of [
      "minimal-black",
      "minimal-black-content",
      "color-statement",
    ] as const) {
      const slide = createTemplateSlide(id, theme);
      const background = luminance(slide.background);
      for (const object of slide.objects) {
        if (object.type !== "text") continue;
        const foreground = luminance(object.color);
        const ratio =
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05);
        expect(ratio, `${slide.title}: ${object.name}`).toBeGreaterThan(7);
      }
    }
  });

  it("builds the showcase as editable illustration shapes above a light uppercase title", () => {
    const { theme } = createDemoDeck();
    const slide = createTemplateSlide("figure-showcase", theme);
    const illustration = slide.objects.filter(
      (object) => object.type === "shape",
    );
    expect(illustration).toHaveLength(8);
    expect(
      illustration.every(
        (object) => object.type === "shape" && object.shape === "ellipse",
      ),
    ).toBe(true);
    const title = slide.objects.find(
      (object) => object.name === "Showcase title",
    );
    expect(title?.type).toBe("text");
    if (title?.type !== "text") throw new Error("Missing showcase title");
    expect(title.text).toBe(title.text.toUpperCase());
    expect(title.fontWeight).toBe(400);
    expect(title.align).toBe("center");
    for (const shape of illustration) {
      const bounds = objectBounds(shape);
      expect(bounds.x).toBeGreaterThan(0);
      expect(bounds.y).toBeGreaterThan(0);
      expect(bounds.x + bounds.width).toBeLessThan(1600);
      expect(bounds.y + bounds.height).toBeLessThan(title.transform.y);
      expect(shape.groupId).toBeUndefined();
    }
    const content = slide.objects
      .flatMap((object) => (object.type === "text" ? [object.text] : []))
      .join("\n");
    expect(content).toContain("ILLUSTRATION PLACEHOLDER");
    expect(content).toContain(
      "Replace this editable sketch with your own figure.",
    );
    expect(slide.notes).toContain("not a scientific model or data figure");
    expect(slide.notes).toContain("Use Figure");
  });

  it("supplies replacement prompts rather than invented result values or imported figures", () => {
    const { theme } = createDemoDeck();
    const slide = createTemplateSlide("results", theme);
    const value = slide.objects.find(
      (object) => object.name === "Key result value",
    );
    expect(value?.type === "text" && value.text).toBe("[Insert value]");
    const content = slide.objects
      .flatMap((object) => (object.type === "text" ? [object.text] : []))
      .join("\n");
    expect(content).toContain("[Units / uncertainty]");
    expect(content).toContain("Add your own evidence here");
    expect(content).not.toMatch(/\d|[≈±%]|p\s*[<=>]/);
    expect(slide.notes).toContain("Use Figure");
    expect(slide.notes).toContain("remove the placeholder shape and labels");
    for (const id of ["section", "methods", "results", "closing"] as const) {
      expect(
        createTemplateSlide(id, theme).objects.every(
          (object) => object.type === "text" || object.type === "shape",
        ),
      ).toBe(true);
    }
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
