// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { InlineMathText } from "../src/components/InlineMathText";
import { SlideScene } from "../src/components/SlideScene";
import { createThemeDeck } from "../src/lib/deck-themes";
import { renderEquation, type RenderedEquation } from "../src/lib/equations";
import type { Deck, TextObject } from "../src/lib/model";
import {
  downloadBlob,
  loadRecovery,
  readDeckArchive,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

// Keep actual vector typesetting, layout, editing, history, and native archives.
// Recovery and downloads are host boundaries; the equation spy records the
// effective inline settings and can defer results in the stale-render test.
vi.mock("../src/lib/equations", async (original) => {
  const real = await original<typeof import("../src/lib/equations")>();
  return { ...real, renderEquation: vi.fn(real.renderEquation) };
});
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
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
    id: "inline-math-text",
    type: "text",
    name: "Inline math text",
    text: String.raw`장 The field $\chi$ drives inflation with $E=mc^2$.`,
    transform: { x: 120, y: 150, width: 1300, height: 240, rotation: 8 },
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: 400,
    color: "#123456",
    align: "left",
    opacity: 0.85,
    visible: true,
    locked: false,
    metadata: { annotation: "Retain source and geometry" },
    ...overrides,
  };
}

function textDeck(object: TextObject) {
  const deck = createThemeDeck("scientific");
  deck.slides[0].objects = [object];
  deck.theme.equation.fontSetId = "mathjax-fira";
  deck.theme.equation.fontSize = 99;
  deck.theme.equation.color = "#ff0000";
  deck.pageNumbers = undefined;
  return deck;
}

function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("inline mathematics inside editable slide text", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck | undefined;
  let actualMath: typeof import("../src/lib/equations");

  beforeEach(async () => {
    // Keep shortcut labels deterministic across CI operating systems.
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("crypto", webcrypto);
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
      measureText: (text: string) => ({ width: [...text].length * 14 }),
    } as CanvasRenderingContext2D);
    actualMath = await vi.importActual<typeof import("../src/lib/equations")>(
      "../src/lib/equations",
    );
    vi.mocked(renderEquation)
      .mockReset()
      .mockImplementation(actualMath.renderEquation);
    vi.mocked(loadRecovery).mockReset().mockReturnValue(null);
    vi.mocked(downloadBlob).mockReset();
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        saved = structuredClone(deck);
        return "localStorage";
      });
    localStorage.clear();
    saved = undefined;
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

  async function settle(condition: () => boolean) {
    for (let index = 0; index < 100 && !condition(); index++)
      await act(async () => pause(10));
    expect(condition()).toBe(true);
  }

  function mathGroup() {
    return host.querySelector<SVGGElement>("[data-inline-math]");
  }

  function visibleText(container: Element = host) {
    return [...container.querySelectorAll("text")]
      .map((text) => text.textContent)
      .join("");
  }

  async function scene(object: TextObject, deck = textDeck(object)) {
    await act(async () =>
      root.render(
        createElement(SlideScene, {
          deck,
          slide: { ...deck.slides[0], objects: [object] },
        }),
      ),
    );
  }

  async function component(object: TextObject, deck = textDeck(object)) {
    await act(async () =>
      root.render(
        createElement(
          "svg",
          {},
          createElement(InlineMathText, { object, deck }),
        ),
      ),
    );
  }

  function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) =>
        node.getAttribute("aria-label") === label ||
        node.textContent?.trim() === label ||
        node.querySelector("strong")?.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing editor button: ${label}`);
    return found;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  function editor() {
    const found = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit text on slide"]',
    );
    if (!found) throw new Error("Missing canvas text editor");
    return found;
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

  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    if (!saved) throw new Error("Expected a workspace snapshot");
    return structuredClone(saved);
  }

  async function editRenderedText() {
    const target = host.querySelector(".slide-paper [data-inline-math]");
    if (!target) throw new Error("Missing rendered inline mathematics");
    await act(async () =>
      target.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      ),
    );
    return editor();
  }

  it("renders multiple mathematical fragments as real vectors in mixed Korean and English prose", async () => {
    const object = textObject();
    const onEdit = vi.fn();
    const deck = textDeck(object);
    await act(async () =>
      root.render(
        createElement(SlideScene, {
          deck,
          slide: deck.slides[0],
          onEdit,
        }),
      ),
    );
    await settle(
      () =>
        mathGroup()?.getAttribute("aria-busy") === "false" &&
        (mathGroup()?.querySelectorAll("[data-inline-math-fragment] path")
          .length ?? 0) > 1,
    );
    const math = mathGroup()!;
    expect(math.getAttribute("aria-label")).toBe(object.text);
    expect(
      [...math.querySelectorAll("[data-inline-math-fragment]")].map((node) =>
        node.getAttribute("data-inline-math-fragment"),
      ),
    ).toEqual([String.raw`\chi`, "E=mc^2"]);
    expect(visibleText(math)).toContain("장 The field");
    expect(visibleText(math)).toContain("drives inflation with");
    expect(visibleText(math)).not.toMatch(/\$|\\chi|E=mc\^2/);
    expect(renderEquation).toHaveBeenCalledWith(
      String.raw`\chi`,
      "mathjax-fira",
      32,
      "#123456",
      false,
    );
    expect(renderEquation).toHaveBeenCalledWith(
      "E=mc^2",
      "mathjax-fira",
      32,
      "#123456",
      false,
    );
    await act(async () =>
      math.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(onEdit).toHaveBeenCalledWith(object);
    expect(object.text).toBe(
      String.raw`장 The field $\chi$ drives inflation with $E=mc^2$.`,
    );
  });

  it("reflows when the text width changes and retypesets inherited math style changes", async () => {
    const object = textObject({
      text: String.raw`A field $\alpha+\beta$ changes the scale with $x^2$ after inflation.`,
    });
    const deck = textDeck(object);
    await component(object, deck);
    await settle(() => mathGroup()?.getAttribute("aria-busy") === "false");
    const lines = mathGroup()!.querySelectorAll(
      "[data-inline-math-line]",
    ).length;
    const narrowed = {
      ...object,
      transform: { ...object.transform, width: 250 },
    };
    await component(narrowed, deck);
    await settle(
      () =>
        mathGroup()?.getAttribute("aria-busy") === "false" &&
        (mathGroup()?.querySelectorAll("[data-inline-math-line]").length ?? 0) >
          lines,
    );
    const restyled = {
      ...narrowed,
      fontFamily: "Nanum Gothic",
      fontSize: 48,
      color: "#26867a",
    };
    const modern = {
      ...deck,
      theme: {
        ...deck.theme,
        equation: {
          ...deck.theme.equation,
          fontSetId: "mathjax-modern" as const,
        },
      },
    };
    await component(restyled, modern);
    await settle(
      () =>
        mathGroup()?.getAttribute("aria-busy") === "false" &&
        !!mathGroup()?.querySelector("[data-inline-math-fragment] path"),
    );
    expect(renderEquation).toHaveBeenCalledWith(
      String.raw`\alpha+\beta`,
      "mathjax-modern",
      48,
      "#26867a",
      false,
    );
    expect(renderEquation).toHaveBeenCalledWith(
      "x^2",
      "mathjax-modern",
      48,
      "#26867a",
      false,
    );
    expect(
      [...mathGroup()!.querySelectorAll("text")].every((node) =>
        node.getAttribute("font-family")?.includes("Nanum Gothic"),
      ),
    ).toBe(true);
  });

  it("keeps unmatched delimiters readable as literal text", async () => {
    const raw = String.raw`The field $\chi drives inflation.`;
    await scene(textObject({ text: raw }));
    expect(visibleText()).toBe(raw);
    expect(host.querySelector("[data-inline-math-fragment]")).toBeNull();
    expect(renderEquation).not.toHaveBeenCalled();
  });

  it("renders parenthesized inline math while displaying escaped dollar signs as prose", async () => {
    const raw = String.raw`Cost \$20 and field \(\chi\) are inline.`;
    const object = textObject({ text: raw });
    await scene(object);
    await settle(
      () =>
        mathGroup()?.getAttribute("aria-busy") === "false" &&
        !!mathGroup()?.querySelector("[data-inline-math-fragment] path"),
    );
    expect(visibleText()).toContain("Cost $20 and field");
    expect(visibleText()).not.toContain(String.raw`\$20`);
    expect(visibleText()).not.toContain(String.raw`\(\chi\)`);
    expect(
      mathGroup()!
        .querySelector("[data-inline-math-fragment]")
        ?.getAttribute("data-inline-math-fragment"),
    ).toBe(String.raw`\chi`);
    expect(object.text).toBe(raw);
  });

  it("shows readable source on a typesetting error and recovers after correcting the text", async () => {
    const invalid = textObject({
      text: String.raw`The field $\unknownInlineCommand$ drives inflation.`,
    });
    await component(invalid);
    await settle(() => !!mathGroup()?.getAttribute("data-inline-math-error"));
    expect(visibleText()).toContain(String.raw`$\unknownInlineCommand$`);
    expect(mathGroup()!.querySelector("title")?.textContent).toBeTruthy();
    const fixed = {
      ...invalid,
      text: String.raw`The field $\chi$ drives inflation.`,
    };
    await component(fixed);
    await settle(
      () =>
        mathGroup()?.getAttribute("aria-busy") === "false" &&
        !!mathGroup()?.querySelector("[data-inline-math-fragment] path"),
    );
    expect(mathGroup()!.getAttribute("data-inline-math-error")).toBeNull();
    expect(visibleText()).not.toContain(String.raw`$\chi$`);
  });

  it("never replaces a newer edit with a late typesetting result", async () => {
    const oldResult = await actualMath.renderEquation(
      "x",
      "mathjax-stix2",
      32,
      "#123456",
      false,
    );
    const newResult = await actualMath.renderEquation(
      "y",
      "mathjax-stix2",
      32,
      "#123456",
      false,
    );
    const old = deferred<RenderedEquation>();
    const current = deferred<RenderedEquation>();
    vi.mocked(renderEquation).mockImplementation((latex) =>
      latex === "x_{late}" ? old.promise : current.promise,
    );
    const object = textObject({ text: "Old $x_{late}$ source" });
    const deck = textDeck(object);
    await component(object, deck);
    await component({ ...object, text: "New $y_{fresh}$ source" }, deck);
    await act(async () =>
      current.resolve({
        ...newResult,
        svg: newResult.svg.replace("<svg", '<svg data-test-fresh="true"'),
      }),
    );
    await settle(() => !!host.querySelector("[data-test-fresh]"));
    await act(async () =>
      old.resolve({
        ...oldResult,
        svg: oldResult.svg.replace("<svg", '<svg data-test-stale="true"'),
      }),
    );
    expect(host.querySelector("[data-test-stale]")).toBeNull();
    expect(host.querySelector("[data-test-fresh]")).toBeTruthy();
    expect(visibleText()).toContain("New");
    expect(visibleText()).not.toContain("Old");
  });

  it("edits a mathematical sentence directly on the canvas, supports Undo/Redo, and saves its original source", async () => {
    await act(async () => root.render(createElement(App)));
    await click("Scientific");
    await click("Create presentation");
    await click("Text");
    const textarea = editor();
    const raw = String.raw`The field $\chi$ drives inflation.`;
    await input(textarea, raw);
    expect(textarea.value).toBe(raw);
    await key("Enter", { ctrlKey: true }, textarea);
    await settle(
      () =>
        !!host.querySelector(".slide-paper [data-inline-math-fragment] path"),
    );
    const current = await persist();
    const object = current.slides[0].objects.find(
      (candidate) => candidate.type === "text" && candidate.text === raw,
    ) as TextObject;
    expect(object).toBeTruthy();
    expect(
      current.slides[0].objects.some(({ type }) => type === "equation"),
    ).toBe(false);
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Text content"]',
      )?.value,
    ).toBe(raw);
    expect(host.textContent).toContain(String.raw`Inline math: $\chi$`);
    await click("Undo · Ctrl+Z");
    expect(
      (await persist()).slides[0].objects.find(({ id }) => id === object.id),
    ).toMatchObject({ text: "Write your idea here" });
    await click("Redo · Ctrl+Y");
    await settle(
      () =>
        !!host.querySelector(".slide-paper [data-inline-math-fragment] path"),
    );
    expect(await persist()).toEqual(current);
    const edit = await editRenderedText();
    expect(edit.value).toBe(raw);
    await input(edit, String.raw`A changed $\phi$ sentence.`);
    await key("Escape", {}, edit);
    expect(await persist()).toEqual(current);
    await key("s", { ctrlKey: true });
    await settle(() => vi.mocked(downloadBlob).mock.calls.length === 1);
    const [archive, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(filename).toMatch(/\.scislide$/);
    const loaded = await readDeckArchive(archive);
    expect(loaded).toEqual(current);
    expect(loaded.slides[0].objects.find(({ id }) => id === object.id)).toEqual(
      object,
    );
  });

  it("keeps raw delimiters and Korean IME input in the native canvas editor", async () => {
    const object = textObject({
      text: String.raw`장 $\chi$ drives inflation.`,
    });
    const deck = textDeck(object);
    vi.mocked(loadRecovery).mockReturnValue(deck);
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await settle(
      () =>
        !!host.querySelector(".slide-paper [data-inline-math-fragment] path"),
    );
    const textarea = await editRenderedText();
    expect(textarea.value).toBe(object.text);
    await act(async () =>
      textarea.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    const raw = String.raw`한글 조합 $\chi$`;
    await input(textarea, raw);
    await key("Enter", { ctrlKey: true, isComposing: true }, textarea);
    expect(editor()).toBe(textarea);
    expect(textarea.value).toBe(raw);
    await act(async () =>
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "한글 조합",
        }),
      ),
    );
    await key("Enter", { ctrlKey: true }, textarea);
    await settle(
      () =>
        !!host.querySelector(".slide-paper [data-inline-math-fragment] path"),
    );
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...object,
      text: raw,
    });
  });
});
