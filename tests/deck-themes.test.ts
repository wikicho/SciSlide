// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeChooser } from "../src/components/ThemeChooser";
import {
  createThemeDeck,
  createThemedSlide,
  DECK_THEMES,
  getDeckTheme,
  getDeckThemeId,
} from "../src/lib/deck-themes";
import type { DeckThemeId } from "../src/lib/deck-themes";
import { createDemoDeck, validateDeck } from "../src/lib/model";
import { SLIDE_TEMPLATES } from "../src/lib/slide-templates";

vi.mock("../src/lib/equation-renderer", () => ({
  renderObjectEquation: vi.fn(),
}));

describe("presentation starter themes", () => {
  it("offers five themes including separate white layout families", () => {
    expect(DECK_THEMES.map((theme) => theme.id)).toEqual([
      "scientific",
      "minimal-white",
      "minimal-black",
      "navy",
      "keynote-white",
    ]);
    expect(
      new Set(DECK_THEMES.map((theme) => theme.palette.background)).size,
    ).toBe(4);
  });

  it.each(DECK_THEMES)(
    "creates a valid, fresh $name deck without demo content",
    (theme) => {
      const deck = validateDeck(createThemeDeck(theme.id));
      expect(deck.title).toBe("Untitled presentation");
      expect(deck.slideSize).toEqual({
        width: 1600,
        height: 900,
        unit: "px96",
      });
      expect(deck.slides).toHaveLength(1);
      expect(deck.slides[0].background).toBe(theme.palette.background);
      expect(deck.assets).toEqual([]);
      expect(
        deck.slides[0].objects.every(
          (object) => object.type === "text" || object.type === "shape",
        ),
      ).toBe(true);
      expect(
        deck.slides[0].objects.some((object) => object.type === "text"),
      ).toBe(true);
      expect(
        deck.slides[0].objects.every(
          (object) => object.visible && !object.locked,
        ),
      ).toBe(true);
      expect(deck.theme.equation.color).toBe(theme.palette.ink);
      expect(deck.pageNumbers?.hideFirst).toBe(true);
      expect(deck.pageNumbers?.color).toBe(theme.palette.muted);
      expect(getDeckThemeId(deck)).toBe(theme.id);
    },
  );

  it("keeps themes independent when creating the same starter repeatedly", () => {
    const first = createThemeDeck("minimal-black");
    const second = createThemeDeck("minimal-black");
    expect(first.id).not.toBe(second.id);
    expect(first.slides[0].id).not.toBe(second.slides[0].id);
    const ids = [...first.slides[0].objects, ...second.slides[0].objects].map(
      (object) => object.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    first.theme.equation.color = "#abcdef";
    first.slides[0].objects[0].metadata.changed = true;
    expect(second.theme.equation.color).toBe("#f5f5f7");
    expect(second.slides[0].objects[0].metadata.changed).toBeUndefined();
    expect(
      DECK_THEMES.find((theme) => theme.id === "minimal-black")?.palette.ink,
    ).toBe("#f5f5f7");
  });

  it.each(DECK_THEMES)(
    "preserves $name when saved and applies its palette to every future layout",
    (theme) => {
      const deck = validateDeck(
        JSON.parse(JSON.stringify(createThemeDeck(theme.id))),
      );
      const before = JSON.stringify(deck);
      const slides = SLIDE_TEMPLATES.map(({ id }) =>
        createThemedSlide(id, deck),
      );
      expect(
        slides.every((slide) => slide.background === theme.palette.background),
      ).toBe(true);
      expect(slides[0].objects).toEqual([]);
      expect(JSON.stringify(deck)).toBe(before);
      const roundTrip = validateDeck({
        ...deck,
        slides: [...deck.slides, ...slides],
      });
      expect(roundTrip.slides).toHaveLength(16);
      expect(getDeckTheme(roundTrip)?.id).toBe(theme.id);
    },
  );

  it("keeps equation and font inheritance in dark layouts", () => {
    const deck = createThemeDeck("minimal-black");
    deck.theme.fontFamily = "Nanum Gothic";
    deck.theme.equation.fontSetId = "mathjax-fira";
    const slide = createThemedSlide("equation", deck);
    const equation = slide.objects.find((object) => object.type === "equation");
    expect(equation?.type).toBe("equation");
    if (equation?.type !== "equation") throw new Error("Missing equation");
    expect(equation.style.color).toBeUndefined();
    expect(equation.style.fontSetId).toBeUndefined();
    expect(equation.style.color ?? deck.theme.equation.color).toBe("#f5f5f7");
    expect(equation.style.fontSetId ?? deck.theme.equation.fontSetId).toBe(
      "mathjax-fira",
    );
    expect(
      slide.objects
        .filter((object) => object.type === "text")
        .every((object) => object.fontFamily === "Nanum Gothic"),
    ).toBe(true);
    const panel = slide.objects.find(
      (object) => object.name === "Equation panel",
    );
    expect(panel?.type === "shape" && panel.fill).toBe("#202023");
  });

  it("retains readable dark-theme text across all starter layouts", () => {
    const deck = createThemeDeck("minimal-black");
    for (const { id } of SLIDE_TEMPLATES) {
      const slide = createThemedSlide(id, deck);
      for (const object of slide.objects) {
        if (object.type !== "text") continue;
        // Original light-layout text colors must not leak onto a black slide.
        expect([
          "#f5f5f7",
          "#b8b8be",
          "#95cfc2",
          "#111111",
          "#ffffff",
        ]).toContain(object.color);
        if (object.color === "#111111") {
          const t = object.transform;
          expect(
            slide.objects.some(
              (candidate) =>
                candidate.type === "shape" &&
                candidate.fill === "#95cfc2" &&
                candidate.transform.x <= t.x &&
                candidate.transform.y <= t.y &&
                candidate.transform.x + candidate.transform.width >=
                  t.x + t.width &&
                candidate.transform.y + candidate.transform.height >=
                  t.y + t.height,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it("preserves imported and existing demo layout behavior without a chosen theme", () => {
    const deck = createDemoDeck();
    expect(getDeckTheme(deck)).toBeUndefined();
    expect(getDeckThemeId(deck)).toBeUndefined();
    expect(createThemedSlide("blank", deck).background).toBe("#ffffff");
    expect(createThemedSlide("minimal-black", deck).background).toBe("#080808");
    expect(createThemedSlide("methods", deck).background).toBe("#fbf8f1");
    Object.assign(deck.theme, { starterThemeId: "unrecognized" });
    expect(getDeckTheme(deck)).toBeUndefined();
    expect(createThemedSlide("content", deck).background).toBe("#ffffff");
  });

  it("rejects an unknown new theme rather than silently creating a different presentation", () => {
    expect(() => createThemeDeck("unknown" as DeckThemeId)).toThrow(
      "Unknown presentation theme",
    );
  });
});

describe("full-screen theme chooser", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onChoose: ReturnType<typeof vi.fn<(id: DeckThemeId) => void>>;
  let onOpen: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D);
    onChoose = vi.fn();
    onOpen = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(
    extra: Partial<Parameters<typeof ThemeChooser>[0]> = {},
  ) {
    await act(async () =>
      root.render(createElement(ThemeChooser, { onChoose, onOpen, ...extra })),
    );
  }

  function button(name: string): HTMLButtonElement {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === name ||
        candidate.textContent?.trim() === name,
    );
    if (!result) throw new Error(`Missing chooser button: ${name}`);
    return result;
  }

  async function click(element: Element) {
    await act(async () =>
      element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  }

  it("shows five editable slide previews and creates only after an explicit choice", async () => {
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("Choose your theme.");
    expect(host.querySelectorAll("[role=radio]")).toHaveLength(5);
    expect(
      host.querySelectorAll(".theme-chooser-preview .slide-scene"),
    ).toHaveLength(5);
    expect(button("Scientific").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(button("Scientific"));
    await click(button("Minimal Black"));
    expect(button("Minimal Black").getAttribute("aria-checked")).toBe("true");
    expect(button("Scientific").getAttribute("aria-checked")).toBe("false");
    expect(onChoose).not.toHaveBeenCalled();
    await click(button("Create presentation"));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith("minimal-black");
  });

  it("selects themes with arrow keys, Home and End while keeping keyboard focus visible", async () => {
    await render();
    for (const [name, key, next] of [
      ["Scientific", "ArrowRight", "Minimal White"],
      ["Minimal White", "End", "Keynote White"],
      ["Keynote White", "ArrowRight", "Scientific"],
      ["Scientific", "ArrowLeft", "Keynote White"],
      ["Keynote White", "Home", "Scientific"],
    ]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => button(name).dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(button(next).getAttribute("aria-checked")).toBe("true");
      expect(button(next).tabIndex).toBe(0);
      expect(document.activeElement).toBe(button(next));
    }
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("offers opening, recovery, demo and cancellation without silently creating a deck", async () => {
    const onResume = vi.fn(),
      onDemo = vi.fn(),
      onCancel = vi.fn();
    await render({ onResume, onDemo, onCancel });
    await click(button("Open presentation"));
    await click(button("Resume previous work"));
    await click(button("Explore demo"));
    await click(button("Cancel"));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledOnce();
    expect(onDemo).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("disables actions while loading a recovered or opened presentation", async () => {
    await render({
      busy: true,
      onResume: vi.fn(),
      onDemo: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(
      host.querySelector(".theme-chooser")?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(
      [...host.querySelectorAll<HTMLButtonElement>("button")].every(
        (candidate) => candidate.disabled,
      ),
    ).toBe(true);
    await click(button("Minimal Black"));
    await click(button("Opening presentation…"));
    expect(button("Scientific").getAttribute("aria-checked")).toBe("true");
    expect(onChoose).not.toHaveBeenCalled();
  });
});
