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
