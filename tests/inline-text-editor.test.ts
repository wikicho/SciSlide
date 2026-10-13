// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type { Deck, SlideObject, TextObject } from "../src/lib/model";
import {
  buildDeckArchive,
  downloadBlob,
  loadRecovery,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

// Exercise the real canvas, App history and keyboard handling. Replace only
// storage and the file download boundary, which cannot run in jsdom.
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

function textObject(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: "canvas-title",
    type: "text",
    name: "Canvas title",
    text: "Original title",
    transform: { x: 150, y: 180, width: 800, height: 240, rotation: 12 },
    fontFamily: "Inter",
    fontSize: 48,
    fontWeight: 600,
    color: "#123456",
    align: "left",
    opacity: 0.8,
    visible: true,
    locked: false,
    metadata: { note: "keep metadata" },
    ...overrides,
  };
}

function deckWith(objects: SlideObject[]): Deck {
  return {
    ...createDemoDeck(),
    id: "inline-test-deck",
    title: "Canvas editing",
    slides: [{ ...createBlankSlide(), id: "inline-slide", objects }],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("editing text directly on the slide", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck;
  let packaged: Deck | undefined;

  beforeEach(() => {
    // Keep shortcut labels deterministic across CI operating systems.
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1600);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "0",
      paddingRight: "0",
      paddingTop: "0",
      paddingBottom: "0",
    } as CSSStyleDeclaration);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D);
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
        element.textContent?.trim() === label ||
        element.querySelector("strong")?.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return saved;
  }

  async function render(deck: Deck) {
    vi.mocked(loadRecovery).mockReturnValue(deck);
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
  }

  function canvasText(value: string) {
    const text = [
      ...host.querySelectorAll<SVGTextElement>(".slide-paper svg text"),
    ].find((element) => element.textContent === value);
    if (!text) throw new Error(`Missing slide text: ${value}`);
    return text;
  }

  function editor() {
    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit text on slide"]',
    );
    if (!textarea) throw new Error("Missing inline text editor");
    return textarea;
  }

  async function edit(value = "Original title") {
    await act(async () =>
      canvasText(value).dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      ),
    );
    return editor();
  }

  async function input(target: HTMLTextAreaElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function textSizeField() {
    const field = host.querySelector<HTMLInputElement>(
      'input[aria-label="Text size"]',
    );
    if (!field) throw new Error("Missing text size field");
    return field;
  }

  async function inputNumber(target: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function key(
    value: string,
    options: KeyboardEventInit = {},
    target: EventTarget = window,
  ) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  function selectionHeight() {
    const rectangle = host.querySelector<SVGRectElement>(
      ".slide-paper svg .selection > rect",
    );
    if (!rectangle) throw new Error("Missing text selection frame");
    return Number(rectangle.getAttribute("height"));
  }

  function editorHeight() {
    const viewport = editor().closest("foreignObject");
    if (!viewport) throw new Error("Missing inline editor viewport");
    return Number(viewport.getAttribute("height"));
  }

  function hitHeight() {
    const rectangle = host.querySelector<SVGRectElement>(
      '.slide-paper svg .canvas-object > rect[fill="transparent"]',
    );
    if (!rectangle) throw new Error("Missing text hit frame");
    return Number(rectangle.getAttribute("height"));
  }

  function inspectorHeight() {
    const field = host.querySelector<HTMLInputElement>(
      'input[aria-label="Object height"]',
    );
    if (!field) throw new Error("Missing object height field");
    return Number(field.value);
  }

  function textWorldOrigin() {
    const group = host.querySelector(".slide-paper svg .canvas-object");
    const values = group
      ?.getAttribute("transform")
      ?.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)
      ?.map(Number);
    if (!values || values.length !== 5)
      throw new Error("Missing translated and rotated text frame");
    const [x, y, rotation, centerX, centerY] = values;
    const angle = (rotation * Math.PI) / 180;
    return {
      x: x + centerX * (1 - Math.cos(angle)) + centerY * Math.sin(angle),
      y: y + centerY * (1 - Math.cos(angle)) - centerX * Math.sin(angle),
    };
  }

  it("includes a pending inspector text size when saving and creates one undo step", async () => {
    const original = textObject({ fontSize: 8 });
    const deck = deckWith([original]);
    await render(deck);
    await click("Select Canvas title");
    const field = textSizeField();
    await act(async () => field.focus());
    await inputNumber(field, "16");
    expect(canvasText(original.text).getAttribute("font-size")).toBe("8");
    expect((await key("s", { ctrlKey: true }, field)).defaultPrevented).toBe(
      true,
    );
    expect(buildDeckArchive).toHaveBeenCalledTimes(1);
    expect(packaged?.slides[0].objects[0]).toEqual({
      ...original,
      fontSize: 16,
    });
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("keeps partial automatic-height input local and restores the effective height after committing a smaller manual frame", async () => {
    const original = textObject({
      text: "First\nSecond\nThird",
      transform: { x: 150, y: 180, width: 800, height: 64, rotation: 12 },
    });
    const deck = deckWith([original]);
    await render(deck);
    await click("Select Canvas title");
    const field = host.querySelector<HTMLInputElement>(
      'input[aria-label="Object height"]',
    )!;
    expect(field.value).toBe("187.2");
    await act(async () => field.focus());
    for (const draft of ["", "1", "120"]) {
      await inputNumber(field, draft);
      expect(field.value).toBe(draft);
      expect(selectionHeight()).toBeCloseTo(187.2);
      expect(await persist()).toEqual(deck);
      expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    }
    await key("Enter", {}, field);
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      transform: { ...original.transform, height: 120 },
    });
    expect(field.value).toBe("187.2");
    expect(selectionHeight()).toBeCloseTo(187.2);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("keeps a partially typed text size local and commits its final value once", async () => {
    const original = textObject({ fontSize: 8 });
    const deck = deckWith([original]);
    await render(deck);
    await click("Select Canvas title");
    const field = textSizeField();
    await act(async () => field.focus());
    for (const draft of ["", "1", "16"]) {
      await inputNumber(field, draft);
      expect(field.value).toBe(draft);
      expect(canvasText(original.text).getAttribute("font-size")).toBe("8");
      expect(await persist()).toEqual(deck);
      expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    }
    await key("Enter", {}, field);
    expect(canvasText(original.text).getAttribute("font-size")).toBe("16");
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      fontSize: 16,
    });
    // Let the first edit pass the history grouping interval before blurring,
    // so a duplicate commit would create an observable extra undo step.
    await act(async () => field.blur());
    await persist();
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("restores canceled size drafts and resets the field when selecting another text object", async () => {
    const first = textObject({ fontSize: 8 });
    const second = textObject({
      id: "second-title",
      name: "Second title",
      text: "Second title",
      fontSize: 8,
    });
    const deck = deckWith([first, second]);
    await render(deck);
    await click("Select Canvas title");
    const firstField = textSizeField();
    await act(async () => firstField.focus());
    await inputNumber(firstField, "");
    await act(async () => firstField.blur());
    expect(firstField.value).toBe("8");
    await act(async () => firstField.focus());
    await inputNumber(firstField, "16");
    await key("Escape", {}, firstField);
    expect(firstField.value).toBe("8");
    await act(async () => firstField.blur());
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    await inputNumber(firstField, "32");
    await click("Select Second title");
    const secondField = textSizeField();
    expect(secondField).not.toBe(firstField);
    expect(secondField.value).toBe("8");
    expect(await persist()).toEqual(deck);
    await act(async () => secondField.focus());
    await inputNumber(secondField, "1");
    await inputNumber(secondField, "24");
    expect(canvasText(first.text).getAttribute("font-size")).toBe("8");
    expect(canvasText(second.text).getAttribute("font-size")).toBe("8");
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    await key("Enter", {}, secondField);
    expect((await persist()).slides[0].objects).toEqual([
      first,
      { ...second, fontSize: 24 },
    ]);
    expect(canvasText(second.text).getAttribute("font-size")).toBe("24");
    await act(async () => secondField.blur());
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("uses alignment buttons to align text within its frame and undo without changing its geometry", async () => {
    const original = textObject();
    const deck = deckWith([original]);
    await render(deck);
    await click("Select Canvas title");
    expect(
      host.querySelector('select[aria-label="Text alignment"]'),
    ).toBeNull();
    expect(button("Align text left").getAttribute("aria-pressed")).toBe("true");
    await click("Align text center");
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      align: "center",
    });
    expect(canvasText(original.text).getAttribute("text-anchor")).toBe(
      "middle",
    );
    expect(
      canvasText(original.text).querySelector("tspan")?.getAttribute("x"),
    ).toBe("400");
    expect(button("Align text center").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(button("Align text left").getAttribute("aria-pressed")).toBe(
      "false",
    );
    await click("Align text right");
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      align: "right",
    });
    expect(canvasText(original.text).getAttribute("text-anchor")).toBe("end");
    expect(
      canvasText(original.text).querySelector("tspan")?.getAttribute("x"),
    ).toBe("800");
    expect(button("Align text right").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(button("Align text center").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(selectionHeight()).toBe(original.transform.height);
    await key("z", { ctrlKey: true });
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      align: "center",
    });
    await click("Select Canvas title");
    expect(button("Align text center").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("grows both the live editor and selection for new lines, then keeps the stored frame through commit and undo", async () => {
    const original = textObject({
      transform: { x: 150, y: 180, width: 800, height: 64, rotation: 12 },
    });
    const deck = deckWith([original]);
    await render(deck);
    const textarea = await edit();
    expect(editorHeight()).toBeCloseTo(76.8);
    expect(selectionHeight()).toBeCloseTo(76.8);
    await key("Enter", {}, textarea);
    await input(textarea, "First line\nSecond line");
    expect(editor()).toBe(textarea);
    expect(editorHeight()).toBe(125);
    expect(selectionHeight()).toBe(125);
    await key("Enter", {}, textarea);
    const multiline = "First line\nSecond line\nThird line";
    await input(textarea, multiline);
    expect(editorHeight()).toBe(188);
    expect(selectionHeight()).toBe(188);
    expect(
      textarea.closest("[data-inline-text-editor]")?.getAttribute("transform"),
    ).toBe("translate(150 180) rotate(12 400 32)");
    await key("Enter", { ctrlKey: true }, textarea);
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      text: multiline,
    });
    expect(selectionHeight()).toBeCloseTo(187.2);
    expect(hitHeight()).toBeCloseTo(187.2);
    expect(inspectorHeight()).toBe(187.2);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    await click("Select Canvas title");
    expect(selectionHeight()).toBe(64);
    expect(hitHeight()).toBe(64);
    expect(inspectorHeight()).toBe(64);
  });

  it("shrinks the live editor after deleting added lines and restores the original frame on Escape without history", async () => {
    const original = textObject({
      transform: { x: 150, y: 180, width: 800, height: 64, rotation: 12 },
    });
    const deck = deckWith([original]);
    await render(deck);
    const textarea = await edit();
    await input(textarea, "First\nSecond\nThird\nFourth");
    expect(editorHeight()).toBe(250);
    expect(selectionHeight()).toBe(250);
    await input(textarea, "Short");
    expect(editorHeight()).toBeCloseTo(76.8);
    expect(selectionHeight()).toBeCloseTo(76.8);
    await input(textarea, "First\nSecond\nThird");
    expect(editorHeight()).toBe(188);
    await key("Escape", {}, textarea);
    expect(host.querySelector("[data-inline-text-editor]")).toBeNull();
    expect(await persist()).toEqual(deck);
    expect(selectionHeight()).toBe(64);
    expect(hitHeight()).toBe(64);
    expect(inspectorHeight()).toBe(64);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("moves an expanded text box without persisting its automatic height", async () => {
    const original = textObject({
      text: "First\nSecond\nThird",
      transform: { x: 150, y: 180, width: 800, height: 64, rotation: 12 },
    });
    const deck = deckWith([original]);
    await render(deck);
    await click("Select Canvas title");
    expect(selectionHeight()).toBeCloseTo(187.2);
    const hit = host.querySelector<SVGRectElement>(
      '.slide-paper svg .canvas-object > rect[fill="transparent"]',
    )!;
    const svg = hit.ownerSVGElement!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
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
    const captured = new Set<number>();
    Object.defineProperties(svg, {
      setPointerCapture: {
        configurable: true,
        value: (id: number) => captured.add(id),
      },
      hasPointerCapture: {
        configurable: true,
        value: (id: number) => captured.has(id),
      },
      releasePointerCapture: {
        configurable: true,
        value: (id: number) => captured.delete(id),
      },
    });
    async function pointer(
      target: EventTarget,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        altKey: true,
        clientX,
        clientY,
      });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: "mouse" },
        isPrimary: { value: true },
      });
      await act(async () => target.dispatchEvent(event));
    }
    await pointer(hit, "pointerdown", 220, 230);
    await pointer(window, "pointermove", 255, 257);
    await pointer(window, "pointerup", 255, 257);
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      transform: { ...original.transform, x: 185, y: 207 },
    });
    expect(selectionHeight()).toBeCloseTo(187.2);
    expect(hitHeight()).toBeCloseTo(187.2);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it.each<[number, number, number]>([
    [0, 20, 10],
    [12, 1, 0],
  ])(
    "resizes expanded text rotated %d° from its initial frame without accumulated growth or an automatic-height jump",
    async (rotation, dx, dy) => {
      const original = textObject({
        text: "First\nSecond\nThird",
        transform: { x: 150, y: 180, width: 800, height: 64, rotation },
      });
      const deck = deckWith([original]);
      await render(deck);
      await click("Select Canvas title");
      expect(selectionHeight()).toBeCloseTo(187.2);
      const initialHeight = selectionHeight();
      const initialOrigin = textWorldOrigin();
      const handle = host.querySelector<SVGRectElement>(
        ".slide-paper svg .selection > rect.resize-handle",
      );
      if (!handle) throw new Error("Missing bottom-right resize handle");
      const svg = handle.ownerSVGElement!;
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
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
      const captured = new Set<number>();
      Object.defineProperties(svg, {
        setPointerCapture: {
          configurable: true,
          value: (id: number) => captured.add(id),
        },
        hasPointerCapture: {
          configurable: true,
          value: (id: number) => captured.has(id),
        },
        releasePointerCapture: {
          configurable: true,
          value: (id: number) => captured.delete(id),
        },
      });
      async function pointer(
        target: EventTarget,
        type: string,
        clientX: number,
        clientY: number,
      ) {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          altKey: true,
          clientX,
          clientY,
        });
        Object.defineProperties(event, {
          pointerId: { value: 7 },
          pointerType: { value: "mouse" },
          isPrimary: { value: true },
        });
        await act(async () => target.dispatchEvent(event));
      }
      await pointer(handle, "pointerdown", 950, 367.2);
      // Each event lets the scene publish its new preview metrics before the next
      // move. Reusing those metrics as the resize origin would add 10 repeatedly.
      for (let move = 0; move < 3; move++) {
        await pointer(window, "pointermove", 950 + dx, 367.2 + dy);
        expect(selectionHeight()).toBeCloseTo(initialHeight + dy);
        expect(hitHeight()).toBeCloseTo(initialHeight + dy);
      }
      await pointer(window, "pointerup", 950 + dx, 367.2 + dy);
      const resized = (await persist()).slides[0].objects[0];
      expect(resized).toEqual({
        ...original,
        transform: {
          ...original.transform,
          width: 800 + dx,
          height: resized.transform.height,
          x: resized.transform.x,
          y: resized.transform.y,
        },
      });
      expect(resized.transform.height).toBeCloseTo(initialHeight + dy);
      expect(inspectorHeight()).toBeCloseTo(initialHeight + dy);
      const angle = (rotation * Math.PI) / 180;
      const actualOrigin = textWorldOrigin();
      // Resizing changes the pivot by half the width/height delta. Materializing
      // an already visible automatic height must add no further displacement.
      expect(actualOrigin.x - initialOrigin.x).toBeCloseTo(
        ((1 - Math.cos(angle)) * dx + Math.sin(angle) * dy) / 2,
      );
      expect(actualOrigin.y - initialOrigin.y).toBeCloseTo(
        ((1 - Math.cos(angle)) * dy - Math.sin(angle) * dx) / 2,
      );
      await key("z", { ctrlKey: true });
      expect(await persist()).toEqual(deck);
      expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    },
  );

  it.each(["serif", "Missing Custom Face, serif"])(
    "retains the SVG font family and generic fallback %s during canvas editing",
    async (fontFamily) => {
      const original = textObject({ fontFamily });
      await render(deckWith([original]));
      const displayedFamily = canvasText(original.text).getAttribute(
        "font-family",
      );
      expect(displayedFamily).toBe(fontFamily);
      const textarea = await edit();
      // Quotes around the whole value turn a generic family or fallback list
      // into one named font, causing the editor to use a different typeface.
      expect(textarea.style.fontFamily.replace(/,\s*sans-serif$/, "")).toBe(
        displayedFamily,
      );
      expect(
        textarea.style.fontFamily.split(",").map((family) => family.trim()),
      ).toContain("serif");
      await input(textarea, "Edited serif title");
      await key("Enter", { ctrlKey: true }, textarea);
      expect(canvasText("Edited serif title").getAttribute("font-family")).toBe(
        displayedFamily,
      );
      expect((await persist()).slides[0].objects[0]).toEqual({
        ...original,
        text: "Edited serif title",
      });
    },
  );

  it("keeps a slightly jittering double-click on the text target without capturing or moving the slide object", async () => {
    const original = textObject();
    const deck = deckWith([original]);
    await render(deck);
    const text = canvasText(original.text);
    const svg = text.ownerSVGElement!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
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
    const capture = vi.fn();
    Object.defineProperties(svg, {
      setPointerCapture: { configurable: true, value: capture },
      hasPointerCapture: { configurable: true, value: () => false },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    async function pointer(
      target: EventTarget,
      type: string,
      clientX: number,
      clientY: number,
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX,
        clientY,
      });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: "mouse" },
        isPrimary: { value: true },
      });
      await act(async () => target.dispatchEvent(event));
    }
    // Native double-clicks first deliver two pointer-down/up pairs. Tiny mouse
    // movement between these events must not turn a click into a canvas drag.
    for (let click = 0; click < 2; click++) {
      await pointer(text, "pointerdown", 220, 230);
      await pointer(window, "pointermove", 221, 231);
      await pointer(text, "pointerup", 221, 231);
    }
    expect(capture).not.toHaveBeenCalled();
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    expect(
      host.querySelector('textarea[aria-label="Edit text on slide"]'),
    ).toBeNull();
    const textarea = await edit();
    expect(document.activeElement).toBe(textarea);
    expect(await persist()).toEqual(deck);
    await input(textarea, "Clicked title");
    await key("Enter", { ctrlKey: true }, textarea);
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      text: "Clicked title",
    });
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("selects with one click and edits on double-click, preserving layout and committing multiline Korean text as one undo step", async () => {
    const original = textObject();
    const deck = deckWith([original]);
    await render(deck);
    await click("Select Canvas title");
    expect(
      host.querySelector('textarea[aria-label="Edit text on slide"]'),
    ).toBeNull();
    const textarea = await edit();
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe(original.text);
    await input(textarea, "한글 제목");
    await input(textarea, "한글 제목\nSecond line");
    await input(textarea, "한글 제목\nSecond line\n마지막 줄");
    await act(async () => textarea.blur());
    expect(
      host.querySelector('textarea[aria-label="Edit text on slide"]'),
    ).toBeNull();
    const current = await persist();
    expect(current.slides[0].objects[0]).toEqual({
      ...original,
      text: "한글 제목\nSecond line\n마지막 줄",
    });
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it.each(["ctrlKey", "metaKey"] as const)(
    "commits with %s+Enter while ordinary Enter keeps editing",
    async (modifier) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(
        modifier === "metaKey" ? "MacIntel" : "Linux x86_64",
      );
      await render(deckWith([textObject()]));
      const textarea = await edit();
      await input(textarea, "New title\nLine two");
      expect((await key("Enter", {}, textarea)).defaultPrevented).toBe(false);
      expect(editor()).toBe(textarea);
      expect(
        (await key("Enter", { [modifier]: true }, textarea)).defaultPrevented,
      ).toBe(true);
      expect(
        host.querySelector('textarea[aria-label="Edit text on slide"]'),
      ).toBeNull();
      expect((await persist()).slides[0].objects[0]).toMatchObject({
        text: "New title\nLine two",
      });
    },
  );

  it("cancels with Escape without changing the deck or creating an undo step", async () => {
    const deck = deckWith([textObject()]);
    await render(deck);
    const textarea = await edit();
    await input(textarea, "Do not apply this");
    await key("Escape", {}, textarea);
    expect(
      host.querySelector('textarea[aria-label="Edit text on slide"]'),
    ).toBeNull();
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("keeps IME composition active when Escape or Ctrl+Enter arrives", async () => {
    await render(deckWith([textObject()]));
    const textarea = await edit();
    await act(async () =>
      textarea.dispatchEvent(
        new CompositionEvent("compositionstart", {
          bubbles: true,
        }),
      ),
    );
    await input(textarea, "한글 조합");
    await key("Escape", { isComposing: true }, textarea);
    await key("Enter", { ctrlKey: true, isComposing: true }, textarea);
    expect(editor()).toBe(textarea);
    // Some IMEs omit isComposing from keydown until compositionend arrives.
    await key("Escape", {}, textarea);
    expect(editor()).toBe(textarea);
    await act(async () =>
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "한글 조합",
        }),
      ),
    );
    await key("Enter", { ctrlKey: true }, textarea);
    expect((await persist()).slides[0].objects[0]).toMatchObject({
      text: "한글 조합",
    });
  });

  it("preserves native clipboard shortcuts and stores pasted markup as plain text", async () => {
    await render(deckWith([textObject()]));
    const textarea = await edit();
    for (const shortcut of ["a", "c", "x", "v"]) {
      expect(
        (await key(shortcut, { ctrlKey: true }, textarea)).defaultPrevented,
      ).toBe(false);
    }
    const plain = '<b>Plain text</b>\n<img src="x" onerror="alert(1)">';
    await input(textarea, plain);
    await key("Enter", { ctrlKey: true }, textarea);
    expect((await persist()).slides[0].objects[0]).toMatchObject({
      text: plain,
    });
    expect(host.querySelector(".slide-paper img")).toBeNull();
  });

  it.each([false, true])(
    "prevents editing text locked %s through its group",
    async (grouped) => {
      const original = textObject({
        locked: !grouped,
        ...(grouped ? { groupId: "locked-group" } : {}),
      });
      const objects = grouped
        ? [
            original,
            textObject({
              id: "locked-peer",
              text: "Locked peer",
              locked: true,
              groupId: "locked-group",
            }),
          ]
        : [original];
      const deck = deckWith(objects);
      await render(deck);
      await act(async () =>
        canvasText(original.text).dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true }),
        ),
      );
      expect(
        host.querySelector('textarea[aria-label="Edit text on slide"]'),
      ).toBeNull();
      expect(await persist()).toEqual(deck);
    },
  );

  it("includes pending inline text when Save is invoked while the editor has focus", async () => {
    const deck = deckWith([textObject()]);
    await render(deck);
    const textarea = await edit();
    await input(textarea, "Unsaved canvas text\n저장");
    expect((await key("s", { ctrlKey: true }, textarea)).defaultPrevented).toBe(
      true,
    );
    expect(buildDeckArchive).toHaveBeenCalledTimes(1);
    expect(packaged?.slides[0].objects[0]).toMatchObject({
      text: "Unsaved canvas text\n저장",
    });
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });
});
