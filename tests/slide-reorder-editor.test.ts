// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type { Deck } from "../src/lib/model";
import {
  buildDeckArchive,
  downloadBlob,
  loadRecovery,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

// Keep the real sidebar, scene, history and document state. Replace storage and
// download boundaries so a drag can be checked against the deck that is saved.
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
  buildDeckArchive: vi.fn(),
  downloadBlob: vi.fn(),
}));
vi.mock("../src/lib/workspace-recovery", async (original) => ({
  ...(await original<typeof import("../src/lib/workspace-recovery")>()),
  loadWorkspaceRecovery: vi.fn(),
  saveWorkspaceRecovery: vi.fn(),
}));
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));

function orderedDeck(): Deck {
  return {
    ...createDemoDeck(),
    id: "reordering-deck",
    title: "Slide order",
    slides: ["Alpha", "Beta", "Gamma", "Delta"].map((title) => ({
      ...createBlankSlide(),
      id: `slide-${title.toLowerCase()}`,
      title,
      notes: `${title} speaker notes`,
      objects: [],
    })),
    assets: [],
  };
}

function dataTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    dropEffect: "none",
    get types() {
      return [...values.keys()];
    },
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
    clearData: (type?: string) => (type ? values.delete(type) : values.clear()),
    setDragImage: vi.fn(),
    files: [],
    items: [],
  } as unknown as DataTransfer;
}

describe("dragging slides in the sidebar", () => {
  let host: HTMLDivElement, root: Root;
  let saved: Deck, packaged: Deck | undefined;

  beforeEach(() => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1600);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const isCard = this.classList.contains("slide-card");
        const isList = this.classList.contains("slide-list");
        const index = isCard
          ? [...this.parentElement!.querySelectorAll(".slide-card")].indexOf(
              this,
            )
          : 0;
        const top = isCard
          ? 100 + index * 160 - this.parentElement!.scrollTop
          : isList
            ? 80
            : 0;
        const width = isCard ? 220 : isList ? 240 : 1600;
        const height = isCard ? 140 : isList ? 700 : 900;
        return {
          top,
          bottom: top + height,
          left: 0,
          right: width,
          width,
          height,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "0",
      paddingRight: "0",
      paddingTop: "0",
      paddingBottom: "0",
    } as CSSStyleDeclaration);
    localStorage.clear();
    vi.mocked(loadRecovery).mockReset();
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        saved = structuredClone(deck);
        return "localStorage";
      });
    vi.mocked(buildDeckArchive)
      .mockReset()
      .mockImplementation(async (deck) => {
        packaged = structuredClone(deck);
        return new Blob(["test archive"]);
      });
    vi.mocked(downloadBlob).mockReset();
    packaged = undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing editor button: ${label}`);
    return found;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return saved;
  }

  async function render(deck = orderedDeck()) {
    vi.mocked(loadRecovery).mockReturnValue(deck);
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
    return deck;
  }

  function cards() {
    return [...host.querySelectorAll<HTMLButtonElement>(".slide-card")];
  }

  function card(title: string) {
    const found = cards().find(
      (element) =>
        element.querySelector(".thumbnail-title")?.textContent === title,
    );
    if (!found) throw new Error(`Missing slide card: ${title}`);
    return found;
  }

  function order() {
    return cards().map(
      (element) => element.querySelector(".thumbnail-title")?.textContent,
    );
  }

  function selected() {
    return host.querySelector(".slide-card.selected .thumbnail-title")
      ?.textContent;
  }

  async function dragEvent(
    element: HTMLElement,
    type: "dragstart" | "dragover" | "drop" | "dragend",
    transfer: DataTransfer,
    clientY = 0,
  ) {
    // jsdom does not implement DragEvent/DataTransfer. MouseEvent carries the
    // same coordinates and bubbles through React's actual drag handlers.
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientY,
    });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    await act(async () => {
      element.dispatchEvent(event);
    });
    return event;
  }

  async function pointer(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    clientY: number,
    target: EventTarget = window,
    clientX = 110,
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      isPrimary: { value: true },
      pointerType: { value: "mouse" },
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event;
  }

  async function startDrag(title: string) {
    const source = card(title);
    expect(source.draggable).toBe(false);
    expect(source.dataset.reorderable).toBe("true");
    await pointer(
      "pointerdown",
      source.getBoundingClientRect().top + 70,
      source,
    );
    return source;
  }

  async function drag(
    source: string,
    target: string,
    side: "before" | "after",
  ) {
    await startDrag(source);
    const targetCard = card(target);
    const rect = targetCard.getBoundingClientRect();
    const clientY = rect.top + (side === "before" ? 20 : 120);
    expect((await pointer("pointermove", clientY)).defaultPrevented).toBe(true);
    await pointer("pointerup", clientY);
  }

  it("moves the first slide after the last and retains the active slide and its notes", async () => {
    const original = await render();
    await drag("Alpha", "Delta", "after");
    expect(order()).toEqual(["Beta", "Gamma", "Delta", "Alpha"]);
    expect(selected()).toBe("Alpha");
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Speaker notes"]',
      )?.value,
    ).toBe("Alpha speaker notes");
    const current = await persist();
    expect(current.slides.map((slide) => slide.id)).toEqual([
      "slide-beta",
      "slide-gamma",
      "slide-delta",
      "slide-alpha",
    ]);
    expect(current.slides[3]).toEqual(original.slides[0]);
  });

  it("moves a later slide before an earlier slide without changing the active slide or selected objects", async () => {
    const deck = orderedDeck();
    const template = createDemoDeck()
      .slides.flatMap((slide) => slide.objects)
      .find((object) => object.type === "text")!;
    deck.slides[1].objects = [
      {
        ...structuredClone(template),
        id: "selected-note",
        name: "Selected note",
      },
    ];
    await render(deck);
    await act(async () => card("Beta").click());
    await click("Select Selected note");
    expect(button("Select Selected note").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await drag("Delta", "Alpha", "before");
    // Browsers may emit click after pointerup; completing a drag must suppress
    // that click rather than switching the active slide to the dragged card.
    await act(async () => {
      card("Delta").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      );
    });
    expect(order()).toEqual(["Delta", "Alpha", "Beta", "Gamma"]);
    expect(selected()).toBe("Beta");
    expect(button("Select Selected note").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect((await persist()).slides.map((slide) => slide.title)).toEqual(
      order(),
    );
  });

  it("commits one undoable change regardless of how many cards a drag passes over", async () => {
    const original = await render();
    await startDrag("Alpha");
    for (const title of ["Beta", "Gamma", "Delta"]) {
      const target = card(title);
      await pointer("pointermove", target.getBoundingClientRect().bottom - 10);
      expect(order()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
      expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    }
    const target = card("Delta");
    await pointer("pointerup", target.getBoundingClientRect().bottom - 10);
    expect(order()).toEqual(["Beta", "Gamma", "Delta", "Alpha"]);
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(original);
    expect(selected()).toBe("Alpha");
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    await click("Redo · Ctrl+Shift+Z");
    expect(order()).toEqual(["Beta", "Gamma", "Delta", "Alpha"]);
    expect(selected()).toBe("Alpha");
    expect(button("Redo · Ctrl+Shift+Z").disabled).toBe(true);
  });

  it("renumbers thumbnails and the active scene, and saves the reordered native deck", async () => {
    await render();
    await drag("Alpha", "Gamma", "after");
    expect(order()).toEqual(["Beta", "Gamma", "Alpha", "Delta"]);
    expect(
      cards().map(
        (element) => element.querySelector(".slide-number")?.textContent,
      ),
    ).toEqual(["01", "02", "03", "04"]);
    expect(
      host.querySelector('.slide-paper [aria-label="Slide 3"]'),
    ).not.toBeNull();
    await click("Save .scislide · Ctrl+S");
    expect(buildDeckArchive).toHaveBeenCalledTimes(1);
    expect(packaged?.slides.map((slide) => slide.title)).toEqual(order());
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("scrolls a long list while the pointer stays near its edge and drops at the newly revealed position", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const deck = orderedDeck();
    deck.slides.push(
      ...["Epsilon", "Zeta", "Eta", "Theta"].map((title) => ({
        ...createBlankSlide(),
        id: `slide-${title.toLowerCase()}`,
        title,
        objects: [],
      })),
    );
    await render(deck);
    const list = host.querySelector<HTMLDivElement>(".slide-list")!;
    let scrollTop = 0;
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(600, value));
      },
    });
    await startDrag("Alpha");
    const clientY = list.getBoundingClientRect().bottom - 10;
    await pointer("pointermove", clientY);
    expect(card("Epsilon").classList.contains("drop-before")).toBe(true);
    expect(scrollTop).toBe(0);
    // Advance animation frames without dispatching another pointermove. This
    // models holding the pointer still as lower slides scroll into view.
    for (let index = 0; index < 12; index++) {
      const next = frames.entries().next().value as
        [number, FrameRequestCallback] | undefined;
      expect(next).toBeDefined();
      frames.delete(next![0]);
      await act(async () => next![1](index * 16));
    }
    expect(scrollTop).toBeGreaterThan(0);
    expect(card("Zeta").classList.contains("drop-before")).toBe(true);
    expect(order()).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Epsilon",
      "Zeta",
      "Eta",
      "Theta",
    ]);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    await pointer("pointerup", clientY);
    expect(order()).toEqual([
      "Beta",
      "Gamma",
      "Delta",
      "Epsilon",
      "Alpha",
      "Zeta",
      "Eta",
      "Theta",
    ]);
    expect(selected()).toBe("Alpha");
    expect(frames.size).toBe(0);
    expect((await persist()).slides.map((slide) => slide.title)).toEqual(
      order(),
    );
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it.each(["pointercancel", "Escape"] as const)(
    "does not change the document or history when a drag is cancelled with %s",
    async (cancel) => {
      const original = await render();
      await startDrag("Alpha");
      const clientY = card("Delta").getBoundingClientRect().bottom - 10;
      await pointer("pointermove", clientY);
      if (cancel === "pointercancel") await pointer("pointercancel", clientY);
      else
        await act(async () => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        });
      expect(await persist()).toEqual(original);
      expect(selected()).toBe("Alpha");
      expect(button("Undo · Ctrl+Z").disabled).toBe(true);
      expect(host.querySelector(".slide-card.dragging")).toBeNull();
      // A stale pointerup must not complete the cancelled move.
      await pointer("pointerup", clientY);
      expect(await persist()).toEqual(original);
    },
  );

  it("selects a clicked card without recording a reorder below the movement threshold", async () => {
    const original = await render();
    const source = await startDrag("Beta");
    const clientY = source.getBoundingClientRect().top + 70;
    await pointer("pointermove", clientY + 2);
    expect(host.querySelector(".slide-card.dragging")).toBeNull();
    await pointer("pointerup", clientY + 2);
    await act(async () => source.click());
    expect(selected()).toBe("Beta");
    expect(order()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(await persist()).toEqual(original);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("does not reorder when the pointer is released outside the slide list", async () => {
    const original = await render();
    await startDrag("Alpha");
    await pointer(
      "pointermove",
      card("Delta").getBoundingClientRect().bottom - 10,
    );
    await pointer("pointermove", 600, window, 500);
    await pointer("pointerup", 600, window, 500);
    expect(await persist()).toEqual(original);
    expect(selected()).toBe("Alpha");
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    expect(host.querySelector(".slide-card.dragging")).toBeNull();
  });

  it.each<[string, "before" | "after"]>([
    ["Alpha", "before"],
    ["Alpha", "after"],
    ["Beta", "before"],
  ])(
    "does not record a no-op when Alpha is dropped %s %s",
    async (target, side) => {
      const original = await render();
      await drag("Alpha", target, side);
      expect(await persist()).toEqual(original);
      expect(button("Undo · Ctrl+Z").disabled).toBe(true);
      expect(button("Redo · Ctrl+Shift+Z").disabled).toBe(true);
    },
  );

  it("ignores external drag data and retains the existing up/down controls", async () => {
    const original = await render();
    const transfer = dataTransfer();
    transfer.setData("text/plain", "slide-delta");
    const target = card("Alpha");
    await dragEvent(
      target,
      "dragover",
      transfer,
      target.getBoundingClientRect().top + 10,
    );
    await dragEvent(
      target,
      "drop",
      transfer,
      target.getBoundingClientRect().top + 10,
    );
    expect(await persist()).toEqual(original);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    expect(button("Move slide up").disabled).toBe(true);
    await click("Move slide down");
    expect(order()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]);
    expect(selected()).toBe("Alpha");
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(original);
  });
});
