// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type { Deck, ShapeObject } from "../src/lib/model";
import { lineWorldEndpoints, shapeFromDrag } from "../src/lib/drawing";
import { loadRecovery, saveRecovery } from "../src/lib/persistence";

// Exercise real App state, history, pointer dispatch, SlideScene and ShapeView.
// Recovery and unrelated export entrypoints are mocked; blank decks need no typesetting.
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
  saveRecovery: vi.fn(),
}));
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType = "mouse";
  readonly isPrimary = true;

  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options);
    this.pointerId = options.pointerId ?? 7;
  }
}

function rectangle(x: number, y: number, width = 100, height = 80) {
  return shapeFromDrag("rect", { x, y }, { x: x + width, y: y + height });
}

function blankDeck(objects: ShapeObject[] = []): Deck {
  const demo = createDemoDeck();
  return {
    ...demo,
    title: "Gesture test",
    slides: [{ ...createBlankSlide(), title: "Gesture slide", objects }],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("drawing editor gestures and history", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck;
  let captures: WeakMap<Element, number>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1600,
      bottom: 900,
      width: 1600,
      height: 900,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "0",
      paddingRight: "0",
      paddingTop: "0",
      paddingBottom: "0",
    } as CSSStyleDeclaration);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1600);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(900);
    captures = new WeakMap();
    Object.defineProperties(SVGElement.prototype, {
      setPointerCapture: {
        configurable: true,
        value(this: Element, id: number) {
          captures.set(this, id);
        },
      },
      hasPointerCapture: {
        configurable: true,
        value(this: Element, id: number) {
          return captures.get(this) === id;
        },
      },
      releasePointerCapture: {
        configurable: true,
        value(this: Element) {
          captures.delete(this);
        },
      },
    });
    vi.mocked(loadRecovery).mockReset();
    vi.mocked(saveRecovery).mockReset();
    vi.mocked(saveRecovery).mockImplementation((deck) => {
      saved = structuredClone(deck);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete (SVGElement.prototype as unknown as Record<string, unknown>)
      .setPointerCapture;
    delete (SVGElement.prototype as unknown as Record<string, unknown>)
      .hasPointerCapture;
    delete (SVGElement.prototype as unknown as Record<string, unknown>)
      .releasePointerCapture;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function button(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing editor button: ${label}`);
    return found;
  }

  function canvas(): SVGSVGElement {
    return host.querySelector<SVGSVGElement>(".slide-paper > .slide-scene")!;
  }

  function objectElement(index: number): SVGGElement {
    const found = canvas().querySelectorAll<SVGGElement>(
      ":scope > .canvas-object",
    )[index];
    if (!found) throw new Error(`Missing canvas object at ${index}`);
    return found;
  }

  async function persist() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(710);
    });
    return saved.slides[0].objects as ShapeObject[];
  }

  async function render(deck: Deck) {
    vi.mocked(loadRecovery).mockReturnValue(deck);
    await act(async () => root.render(createElement(App)));
    await persist();
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function pointer(
    target: EventTarget,
    type: string,
    x: number,
    y: number,
    options: PointerEventInit = {},
  ) {
    await act(async () => {
      target.dispatchEvent(
        new TestPointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: x,
          clientY: y,
          ...options,
        }),
      );
    });
  }

  async function key(value: string, options: KeyboardEventInit = {}) {
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      ),
    );
  }

  async function drag(
    index: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options: PointerEventInit = {},
  ) {
    await pointer(objectElement(index), "pointerdown", from.x, from.y, options);
    await pointer(window, "pointermove", to.x, to.y, options);
    await pointer(window, "pointerup", to.x, to.y, options);
  }

  it("draws a directed reverse arrow starting over an existing shape and commits one undoable edit", async () => {
    const rect = rectangle(300, 200, 500, 300);
    await render(blankDeck([rect]));
    await click("Draw arrow");
    await pointer(
      objectElement(0).querySelector("rect")!,
      "pointerdown",
      700,
      450,
    );
    expect(captures.get(canvas())).toBe(7);
    await pointer(window, "pointermove", 200, 150);
    expect(canvas().querySelector("[data-drawing-preview]")).not.toBeNull();
    expect(await persist()).toHaveLength(1);
    await pointer(window, "pointerup", 200, 150);
    const objects = await persist();
    expect(objects).toHaveLength(2);
    expect(objects[0]).toEqual(rect);
    expect(objects[1].shape).toBe("arrow");
    expect(lineWorldEndpoints(objects[1])).toEqual({
      start: { x: 700, y: 450 },
      end: { x: 200, y: 150 },
    });
    expect(canvas().querySelector("[data-drawing-preview]")).toBeNull();
    expect(captures.get(canvas())).toBeUndefined();
    expect(button("Select objects · Escape").classList.contains("active")).toBe(
      true,
    );
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual([rect]);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    await click("Redo · Ctrl+Shift+Z");
    expect(await persist()).toHaveLength(2);
  });

  it.each(["pointercancel", "Escape"])(
    "discards a %s draft without recording history or recovery content",
    async (cancel) => {
      await render(blankDeck());
      await click("Draw line");
      await pointer(canvas(), "pointerdown", 100, 100);
      await pointer(window, "pointermove", 500, 220);
      expect(canvas().querySelector("[data-drawing-preview]")).not.toBeNull();
      if (cancel === "Escape") await key("Escape");
      else await pointer(window, "pointercancel", 500, 220);
      expect(canvas().querySelector("[data-drawing-preview]")).toBeNull();
      await pointer(window, "pointerup", 500, 220);
      expect(await persist()).toEqual([]);
      expect(button("Undo · Ctrl+Z").disabled).toBe(true);
      expect(captures.get(canvas())).toBeUndefined();
    },
  );

  it("edits a rotated line endpoint while the opposite endpoint stays fixed and undo restores rotation", async () => {
    const arrow = shapeFromDrag(
      "arrow",
      { x: 300, y: 200 },
      { x: 600, y: 380 },
    );
    arrow.transform.rotation = 35;
    const before = lineWorldEndpoints(arrow);
    await render(blankDeck([arrow]));
    await pointer(
      objectElement(0),
      "pointerdown",
      before.start.x,
      before.start.y,
    );
    await pointer(window, "pointerup", before.start.x, before.start.y);
    const endpoint = canvas().querySelector<SVGCircleElement>(
      '[aria-label="Move start endpoint"]',
    )!;
    expect(endpoint).not.toBeNull();
    await pointer(endpoint, "pointerdown", before.start.x, before.start.y);
    await pointer(window, "pointermove", 750, 220);
    await pointer(window, "pointerup", 750, 220);
    const moved = (await persist())[0];
    const after = lineWorldEndpoints(moved);
    expect(after.start.x).toBeCloseTo(750, 8);
    expect(after.start.y).toBeCloseTo(220, 8);
    expect(after.end.x).toBeCloseTo(before.end.x, 8);
    expect(after.end.y).toBeCloseTo(before.end.y, 8);
    expect(moved.transform.rotation).toBe(0);
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual([arrow]);
  });

  it("cancels a live draft when presentation starts and cannot commit it from a later pointerup", async () => {
    const rect = rectangle(100, 100);
    await render(blankDeck([rect]));
    await click("Draw ellipse");
    await pointer(canvas(), "pointerdown", 300, 150);
    await pointer(window, "pointermove", 600, 350);
    const editingCanvas = canvas();
    expect(
      editingCanvas.querySelector("[data-drawing-preview]"),
    ).not.toBeNull();
    await click("Present");
    expect(host.querySelector(".presentation-view")).not.toBeNull();
    expect(host.querySelector("[data-drawing-preview]")).toBeNull();
    expect(captures.get(editingCanvas)).toBeUndefined();
    await pointer(window, "pointerup", 600, 350);
    await click("Exit");
    expect(await persist()).toEqual([rect]);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("groups Shift-selected objects, moves the group as one unit, duplicates independent groups and undoes deletion", async () => {
    const first = rectangle(100, 100);
    const second = rectangle(360, 250);
    await render(blankDeck([first, second]));
    await click("Smart alignment guides · Alt to bypass");
    await pointer(objectElement(0), "pointerdown", 110, 110, {
      shiftKey: true,
    });
    await pointer(objectElement(1), "pointerdown", 370, 260, {
      shiftKey: true,
    });
    expect(canvas().querySelectorAll(".selection")).toHaveLength(2);
    await click("Group objects · Ctrl+G");
    const grouped = await persist();
    const groupId = grouped[0].groupId;
    expect(groupId).toBeTruthy();
    expect(grouped[1].groupId).toBe(groupId);
    await drag(0, { x: 110, y: 110 }, { x: 185, y: 165 });
    const moved = await persist();
    expect(
      moved.map((object) => ({ x: object.transform.x, y: object.transform.y })),
    ).toEqual([
      { x: 175, y: 155 },
      { x: 435, y: 305 },
    ]);
    await key("d", { ctrlKey: true });
    const duplicated = await persist();
    expect(duplicated).toHaveLength(4);
    expect(duplicated[2].groupId).toBe(duplicated[3].groupId);
    expect(duplicated[2].groupId).not.toBe(groupId);
    expect(duplicated[2].id).not.toBe(first.id);
    expect(duplicated[2].transform.x).toBe(207);
    expect(duplicated[3].transform.x).toBe(467);
    await key("Delete");
    expect(await persist()).toEqual(moved);
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(duplicated);
  });

  it("shows and applies an alignment guide, while Alt preserves the unsnapped position", async () => {
    const first = rectangle(100, 100, 100, 80);
    const target = rectangle(400, 400, 100, 80);
    await render(blankDeck([first, target]));
    await pointer(objectElement(0), "pointerdown", 110, 110);
    await pointer(window, "pointermove", 307, 141);
    expect(
      canvas().querySelector('[data-alignment-guides] path[d="M 400 0 V 900"]'),
    ).not.toBeNull();
    await pointer(window, "pointerup", 307, 141);
    const snapped = await persist();
    expect(snapped[0].transform.x).toBe(300);
    expect(snapped[0].transform.y).toBe(131);
    await click("Undo · Ctrl+Z");
    await drag(0, { x: 110, y: 110 }, { x: 307, y: 141 }, { altKey: true });
    const bypassed = await persist();
    expect(bypassed[0].transform.x).toBe(297);
    expect(bypassed[0].transform.y).toBe(131);
    expect(canvas().querySelector("[data-alignment-guides]")).toBeNull();
  });

  it("keeps a partly locked group atomic across pointer dragging, keyboard movement, duplication and deletion", async () => {
    const first = rectangle(100, 100);
    const second = rectangle(360, 250);
    first.groupId = second.groupId = "locked-group";
    second.locked = true;
    await render(blankDeck([first, second]));
    await drag(0, { x: 110, y: 110 }, { x: 250, y: 300 });
    expect(canvas().querySelectorAll(".selection")).toHaveLength(2);
    await key("ArrowRight");
    await key("d", { ctrlKey: true });
    await key("Delete");
    expect(await persist()).toEqual([first, second]);
    expect(button("Group objects · Ctrl+G").disabled).toBe(true);
    expect(button("Ungroup objects · Ctrl+Shift+G").disabled).toBe(true);
  });
});
