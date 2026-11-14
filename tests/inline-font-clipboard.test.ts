// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAgentOperations, createAgentDeck } from "../src/cli/commands";
import { renderSlideSvg } from "../src/lib/export";
import {
  inlineMathFont,
  inlineTextLayoutKey,
  layoutInlineText,
} from "../src/lib/inline-math";
import {
  createBlankSlide,
  createDemoDeck,
  validateDeck,
  type Deck,
  type TextObject,
} from "../src/lib/model";
import {
  captureObjectClipboard,
  pasteObjectClipboard,
} from "../src/lib/object-clipboard";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";
import {
  captureSlideClipboard,
  pasteSlideClipboard,
} from "../src/lib/slide-clipboard";

vi.mock("svg2pdf.js", () => import("svg2pdf.js/dist/svg2pdf.es.js"));

function sourceDeck(): Deck {
  const deck = createDemoDeck();
  const text = deck.slides[0].objects.find(
    (object): object is TextObject => object.type === "text",
  )!;
  deck.theme.inlineMathFontSetId = "mathjax-fira";
  deck.slides = [
    {
      ...createBlankSlide(),
      objects: [
        {
          ...text,
          id: "copied-text",
          name: "Mixed sentence",
          text: "Prose $x^2$.",
          transform: { x: 100, y: 100, width: 900, height: 100, rotation: 0 },
        },
      ],
    },
  ];
  deck.assets = [];
  deck.pageNumbers = undefined;
  return deck;
}

function targetDeck(): Deck {
  const deck = sourceDeck();
  deck.id = "target-deck";
  deck.slides = [createBlankSlide()];
  deck.theme.inlineMathFontSetId = "mathjax-modern";
  return deck;
}

function paths(source: string | Element) {
  const root =
    typeof source === "string"
      ? new DOMParser().parseFromString(source, "image/svg+xml")
      : source;
  return [...root.querySelectorAll("path")].map((path) =>
    path.getAttribute("d"),
  );
}

describe("inline font preservation across documents", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve(), load: async () => [] },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({
        width: text.length * 12,
        actualBoundingBoxAscent: 15,
        actualBoundingBoxDescent: 4,
      }),
    } as CanvasRenderingContext2D);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
  });

  it("preserves actual Fira glyphs in pasted layout and saved SVG export on a Modern deck", async () => {
    const source = sourceDeck();
    const original = source.slides[0].objects[0] as TextObject;
    const untouched = structuredClone(source);
    const sourceLayout = await layoutInlineText(original, source);
    const originalMath = sourceLayout.lines
      .flatMap((line) => line.runs)
      .find((run) => run.type === "math")!;
    if (originalMath.type !== "math")
      throw new Error("Missing source equation");
    const clipboard = captureObjectClipboard(source, source.slides[0], [
      original.id,
    ])!;
    expect((clipboard.objects[0] as TextObject).inlineMathFontSetId).toBe(
      "mathjax-fira",
    );
    const target = targetDeck();
    const [id] = pasteObjectClipboard(target, target.slides[0].id, clipboard);
    const pasted = target.slides[0].objects.find(
      (object) => object.id === id,
    ) as TextObject;
    const pastedLayout = await layoutInlineText(pasted, target);
    const pastedMath = pastedLayout.lines
      .flatMap((line) => line.runs)
      .find((run) => run.type === "math")!;
    if (pastedMath.type !== "math") throw new Error("Missing pasted equation");
    expect(paths(pastedMath.svg)).toEqual(paths(originalMath.svg));
    const modernLayout = await layoutInlineText(
      { ...pasted, inlineMathFontSetId: undefined },
      target,
    );
    const modernMath = modernLayout.lines
      .flatMap((line) => line.runs)
      .find((run) => run.type === "math")!;
    if (modernMath.type !== "math")
      throw new Error("Missing comparison equation");
    expect(paths(modernMath.svg)).not.toEqual(paths(originalMath.svg));
    const restored = await readDeckArchive(await buildDeckArchive(target));
    expect(
      (restored.slides[0].objects[0] as TextObject).inlineMathFontSetId,
    ).toBe("mathjax-fira");
    const scene = await renderSlideSvg(restored, restored.slides[0], 0);
    expect(paths(scene.querySelector("[data-inline-math]")!)).toEqual(
      paths(originalMath.svg),
    );
    expect(source).toEqual(untouched);
    expect(target.theme.inlineMathFontSetId).toBe("mathjax-modern");
  });

  it("keeps overrides independent of deck changes and restores inheritance when removed", () => {
    const deck = sourceDeck();
    const inherited = deck.slides[0].objects[0] as TextObject;
    const explicit = {
      ...inherited,
      inlineMathFontSetId: "mathjax-stix2" as const,
    };
    const inheritedKey = inlineTextLayoutKey(inherited, deck);
    const explicitKey = inlineTextLayoutKey(explicit, deck);
    expect(inlineMathFont(deck)).toBe("mathjax-fira");
    expect(inlineMathFont(deck, explicit)).toBe("mathjax-stix2");
    deck.theme.inlineMathFontSetId = "mathjax-modern";
    expect(inlineTextLayoutKey(inherited, deck)).not.toBe(inheritedKey);
    expect(inlineTextLayoutKey(explicit, deck)).toBe(explicitKey);
    expect(
      inlineMathFont(deck, { ...explicit, inlineMathFontSetId: undefined }),
    ).toBe("mathjax-modern");
    expect(
      validateDeck({
        ...deck,
        slides: [{ ...deck.slides[0], objects: [explicit] }],
      }).slides[0].objects[0],
    ).toMatchObject({ inlineMathFontSetId: "mathjax-stix2" });
    expect(() =>
      validateDeck({
        ...deck,
        slides: [
          {
            ...deck.slides[0],
            objects: [{ ...explicit, inlineMathFontSetId: "system-font" }],
          },
        ],
      }),
    ).toThrow("Text inline math font");
  });

  it("materializes the source font for slide copies and preserves explicit inline choices", () => {
    const source = sourceDeck();
    const original = source.slides[0].objects[0] as TextObject;
    original.inlineMathFontSetId = "mathjax-stix2";
    const clipboard = captureSlideClipboard(source, source.slides[0]);
    const target = targetDeck();
    const pasted = pasteSlideClipboard(target, target.slides[0].id, clipboard);
    expect((pasted.objects[0] as TextObject).inlineMathFontSetId).toBe(
      "mathjax-stix2",
    );
    expect(inlineMathFont(target, pasted.objects[0] as TextObject)).toBe(
      "mathjax-stix2",
    );
  });

  it("does not add an inline font override to copied plain prose", () => {
    const source = sourceDeck();
    const original = source.slides[0].objects[0] as TextObject;
    original.text = "Plain prose";
    const clipboard = captureObjectClipboard(source, source.slides[0], [
      original.id,
    ])!;
    expect(
      (clipboard.objects[0] as TextObject).inlineMathFontSetId,
    ).toBeUndefined();
  });

  it("supports inline font overrides and null restoration through the CLI", () => {
    const initial = applyAgentOperations(createAgentDeck({ layout: "blank" }), [
      {
        op: "object.add",
        slide: 1,
        object: {
          type: "text",
          id: "inline-text",
          text: "$x$",
          inlineMathFontSetId: "mathjax-fira",
        },
      },
    ]).deck;
    expect(
      (initial.slides[0].objects[0] as TextObject).inlineMathFontSetId,
    ).toBe("mathjax-fira");
    const restored = applyAgentOperations(initial, [
      {
        op: "object.update",
        slide: 1,
        id: "inline-text",
        patch: { inlineMathFontSetId: null },
      },
    ]).deck;
    expect(
      (restored.slides[0].objects[0] as TextObject).inlineMathFontSetId,
    ).toBeUndefined();
    expect(
      inlineMathFont(restored, restored.slides[0].objects[0] as TextObject),
    ).toBe(inlineMathFont(restored));
  });
});
