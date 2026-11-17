// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideList } from "../src/components/SlideList";
import { cloneDeck } from "../src/lib/deck-editing";
import {
  createBlankSlide,
  createDemoDeck,
  DEFAULT_PAGE_NUMBERS,
  type Deck,
  type EquationObject,
  type TextObject,
} from "../src/lib/model";
import { wrapText } from "../src/lib/layout";
import { renderObjectEquation } from "../src/lib/equation-renderer";

vi.mock("../src/lib/layout", async (original) => {
  const real = await original<typeof import("../src/lib/layout")>();
  return { ...real, wrapText: vi.fn(real.wrapText) };
});
vi.mock("../src/lib/equation-renderer", () => ({
  renderObjectEquation: vi.fn(),
}));

function document(slides = 20): Deck {
  const demo = createDemoDeck();
  const objects = demo.slides.flatMap((slide) => slide.objects);
  const text = objects.find(
    (object): object is TextObject => object.type === "text",
  )!;
  const equation = objects.find(
    (object): object is EquationObject => object.type === "equation",
  )!;
  return {
    ...demo,
    id: "performance-deck",
    assets: [],
    pageNumbers: undefined,
    slides: Array.from({ length: slides }, (_, index) => ({
      ...createBlankSlide(),
      id: `slide-${index}`,
      title: `Page ${index}`,
      objects: [
        {
          ...structuredClone(text),
          id: `text-${index}`,
          text: `Page ${index} has scientific text with enough words to measure and wrap`,
          transform: { x: 40, y: 40, width: 900, height: 200, rotation: 0 },
        },
        {
          ...structuredClone(equation),
          id: `equation-${index}`,
          latex: `x_{${index}}=1`,
          style: {},
        },
      ],
    })),
  };
}

describe("slide sidebar preview work", () => {
  let host: HTMLDivElement, root: Root;
  const observers: Array<{
    callback: IntersectionObserverCallback;
    targets: Set<Element>;
    options?: IntersectionObserverInit;
  }> = [];
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as CanvasRenderingContext2D);
    vi.mocked(wrapText).mockClear();
    vi.mocked(renderObjectEquation).mockReset().mockResolvedValue({
      svg: '<svg viewBox="0 0 160 60"><path d="M0 30H160"/></svg>',
      width: 160,
      height: 60,
    });
    observers.length = 0;
    host = window.document.createElement("div");
    window.document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(
    deck: Deck,
    activeSlideId = deck.slides[0].id,
    select = vi.fn(),
  ) {
    await act(async () =>
      root.render(
        createElement(SlideList, {
          deck,
          activeSlideId,
          onSelect: select,
          onReorder: vi.fn(),
        }),
      ),
    );
  }
  const scenes = () => host.querySelectorAll("svg.slide-scene");
  function enableVisibility() {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        record: (typeof observers)[number];
        constructor(
          callback: IntersectionObserverCallback,
          options?: IntersectionObserverInit,
        ) {
          this.record = { callback, options, targets: new Set() };
          observers.push(this.record);
        }
        observe(target: Element) {
          this.record.targets.add(target);
        }
        unobserve(target: Element) {
          this.record.targets.delete(target);
        }
        disconnect() {
          this.record.targets.clear();
        }
      },
    );
  }
  async function visible(elements: Element[], intersecting = true) {
    await act(async () => {
      for (const observer of observers) {
        const entries = elements
          .filter((element) => observer.targets.has(element))
          .map((target) => ({
            target,
            isIntersecting: intersecting,
            intersectionRatio: intersecting ? 1 : 0,
          })) as IntersectionObserverEntry[];
        observer.callback(entries, observer as unknown as IntersectionObserver);
      }
    });
  }

  it("keeps thumbnail layout work stable across 30 selection and callback updates", async () => {
    const deck = document();
    await render(deck);
    expect(scenes()).toHaveLength(20);
    const initial = vi.mocked(wrapText).mock.calls.length;
    expect(initial).toBeGreaterThanOrEqual(20);
    for (let index = 0; index < 30; index++)
      await render(deck, deck.slides[index % 20].id);
    const additional = vi.mocked(wrapText).mock.calls.length - initial;
    console.info(
      JSON.stringify({
        metric: "thumbnail-text-layout",
        slides: 20,
        selectionUpdates: 30,
        initialLayouts: initial,
        additionalLayouts: additional,
      }),
    );
    expect(additional).toBe(0);
    const latestSelect = vi.fn();
    await render(deck, deck.slides[0].id, latestSelect);
    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>(".slide-card")[2].click(),
    );
    expect(latestSelect).toHaveBeenCalledExactlyOnceWith(deck.slides[2].id);
  });

  it("does not remeasure unchanged slides after an immutable note edit, and updates only the changed text", async () => {
    let deck = document();
    await render(deck);
    const before = vi.mocked(wrapText).mock.calls.length;
    deck = cloneDeck(deck);
    deck.slides[0].notes = "New notes, same thumbnail";
    await render(deck);
    expect(vi.mocked(wrapText).mock.calls.length).toBe(before);
    deck = cloneDeck(deck);
    (deck.slides[7].objects[0] as TextObject).text = "Changed scientific text";
    await render(deck);
    const measured = vi
      .mocked(wrapText)
      .mock.calls.slice(before)
      .map((call) => call[0]);
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.every((text) => text === "Changed scientific text")).toBe(
      true,
    );
    expect(
      host.querySelector('[data-slide-id="slide-7"]')?.textContent,
    ).toContain("Changed scientific text");
  });

  it("typesets only visible previews and keeps all slide cards selectable before a preview mounts", async () => {
    enableVisibility();
    const deck = document();
    await render(deck);
    expect(host.querySelectorAll(".slide-card")).toHaveLength(20);
    expect(scenes()).toHaveLength(0);
    expect(renderObjectEquation).not.toHaveBeenCalled();
    const targets = observers.flatMap((observer) => [...observer.targets]);
    expect(targets).toHaveLength(20);
    await visible(targets.slice(0, 3));
    expect(scenes()).toHaveLength(3);
    expect(renderObjectEquation).toHaveBeenCalledTimes(3);
    console.info(
      JSON.stringify({
        metric: "initial-thumbnail-typesetting",
        totalSlides: 20,
        typesetBeforeVisibility: 0,
        visibleSlides: 3,
        typesetAfterVisibility:
          vi.mocked(renderObjectEquation).mock.calls.length,
      }),
    );
    await visible(targets.slice(0, 3), false);
    await visible(targets.slice(10, 13));
    expect(scenes()).toHaveLength(3);
    expect(renderObjectEquation).toHaveBeenCalledTimes(6);
  });

  it("refreshes asset bytes, theme, page numbers, reordered indices and poster dimensions", async () => {
    let deck = document(2);
    const demo = createDemoDeck();
    const figure = demo.slides
      .flatMap((slide) => slide.objects)
      .find((object) => object.type === "figure")!;
    deck.assets = structuredClone(demo.assets);
    deck.slides[0].objects.push(structuredClone(figure));
    deck.pageNumbers = {
      ...DEFAULT_PAGE_NUMBERS,
      enabled: true,
      format: "number-total",
      hideFirst: false,
    };
    await render(deck);
    expect(
      host.querySelector('[data-slide-id="slide-0"] .slide-page-number')
        ?.textContent,
    ).toBe("1 / 2");
    deck = cloneDeck(deck);
    deck.assets[0].dataUrl = "data:image/png;base64,QQ==";
    deck.theme.equation.color = "#ff0000";
    deck.pageNumbers!.startAt = 7;
    await render(deck);
    expect(
      host
        .querySelector('[data-slide-id="slide-0"] image')
        ?.getAttribute("href"),
    ).toBe(deck.assets[0].dataUrl);
    expect(
      host.querySelector('[data-slide-id="slide-0"] .slide-page-number')
        ?.textContent,
    ).toBe("7 / 8");
    expect(
      vi.mocked(renderObjectEquation).mock.calls.at(-1)?.[1].theme.equation
        .color,
    ).toBe("#ff0000");
    deck = cloneDeck(deck);
    deck.slides.reverse();
    await render(deck);
    expect(
      host.querySelector('[data-slide-id="slide-0"] .slide-page-number')
        ?.textContent,
    ).toBe("8 / 8");
    deck = cloneDeck(deck);
    deck.slideSize = { width: 1200, height: 1800, unit: "px96" };
    await render(deck);
    expect(scenes()[0].getAttribute("viewBox")).toBe("0 0 1200 1800");
  });

  it("renders previews when visibility observation cannot be constructed", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor() {
          throw new Error("Unsupported observer");
        }
      },
    );
    await render(document(2));
    expect(scenes()).toHaveLength(2);
    expect(renderObjectEquation).toHaveBeenCalledTimes(2);
  });
});
