// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import * as equations from "../src/lib/equations";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type { Deck, TextObject } from "../src/lib/model";
import { loadRecovery } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
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

function textObject(text: string): TextObject {
  return {
    id: "inline-equation-text",
    type: "text",
    name: "Equation text",
    text,
    transform: { x: 150, y: 180, width: 800, height: 64, rotation: 12 },
    fontFamily: "Inter",
    fontSize: 40,
    fontWeight: 600,
    color: "#123456",
    align: "left",
    opacity: 0.8,
    visible: true,
    locked: false,
    metadata: { note: "preserve scientific text" },
  };
}

function deckWith(object: TextObject): Deck {
  return {
    ...createDemoDeck(),
    id: "inline-equation-test-deck",
    title: "Inline equation editing",
    slides: [{ ...createBlankSlide(), id: "inline-slide", objects: [object] }],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("inline equation editing through the App", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck;

  beforeEach(() => {
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
      measureText: (value: string) => ({ width: [...value].length * 10 }),
    } as CanvasRenderingContext2D);
    vi.spyOn(equations, "renderEquation").mockResolvedValue({
      width: 60,
      height: 44,
      baseline: 32,
      svg: '<svg width="60" height="44"><path d="M0 0L1 1"/></svg>',
    });
    localStorage.clear();
    vi.mocked(loadRecovery).mockReset();
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        saved = structuredClone(deck);
        return "localStorage";
      });
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
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function settle() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
  }

  async function persist() {
    await settle();
    return saved;
  }

  async function render(deck: Deck) {
    vi.mocked(loadRecovery).mockReturnValue(deck);
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
    await click("Select Equation text");
  }

  function editor() {
    const field = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit text on slide"]',
    );
    if (!field) throw new Error("Missing slide text editor");
    return field;
  }

  function equationSource() {
    const field = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Inline equation source"]',
    );
    if (!field) throw new Error("Missing inline equation source");
    return field;
  }

  async function input(field: HTMLTextAreaElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
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

  async function editAt(start: number, end = start) {
    await key("Enter");
    const field = editor();
    await act(async () => field.setSelectionRange(start, end));
    return field;
  }

  it.each(["linux", "mac"] as const)(
    "inserts at the canvas caret on %s and applies the whole text edit as one undo step",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(
        platform === "mac" ? "MacIntel" : "Linux x86_64",
      );
      const original = textObject("Gauge  symmetry");
      const deck = deckWith(original);
      await render(deck);
      const field = await editAt(6);
      const primary =
        platform === "mac" ? { metaKey: true } : { ctrlKey: true };
      expect(
        (await key("M", { ...primary, shiftKey: true }, field))
          .defaultPrevented,
      ).toBe(true);
      expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe(
        "Insert inline equation",
      );
      expect(document.activeElement).toBe(equationSource());
      await input(equationSource(), "U(1)");
      await settle();
      await click("Insert equation");
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      const resumed = editor();
      expect(resumed.value).toBe("Gauge $U(1)$ symmetry");
      expect(document.activeElement).toBe(resumed);
      expect(resumed.selectionStart).toBe(12);
      expect(resumed.selectionEnd).toBe(12);
      expect(await persist()).toEqual(deck);
      expect(
        button("Undo · " + (platform === "mac" ? "⌘+Z" : "Ctrl+Z")).disabled,
      ).toBe(true);
      await key("Enter", primary, resumed);
      expect((await persist()).slides[0].objects[0]).toEqual({
        ...original,
        text: "Gauge $U(1)$ symmetry",
      });
      await key("z", primary);
      expect(await persist()).toEqual(deck);
      expect(
        button("Undo · " + (platform === "mac" ? "⌘+Z" : "Ctrl+Z")).disabled,
      ).toBe(true);
    },
  );

  it("edits an existing inline span from the caret and preserves the surrounding text and frame", async () => {
    const original = textObject("Gives $x$ today.");
    const deck = deckWith(original);
    await render(deck);
    const field = await editAt(7);
    await key("M", { ctrlKey: true, shiftKey: true }, field);
    expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe(
      "Edit inline equation",
    );
    expect(equationSource().value).toBe("x");
    await input(equationSource(), "y^2");
    await settle();
    await click("Apply equation");
    expect(editor().value).toBe("Gives $y^2$ today.");
    expect(editor().selectionStart).toBe(11);
    expect(await persist()).toEqual(deck);
    await key("Enter", { ctrlKey: true }, editor());
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      text: "Gives $y^2$ today.",
    });
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it("cancels the equation dialog without changing text, selection, or history", async () => {
    const original = textObject("The field stays.");
    const deck = deckWith(original);
    await render(deck);
    const field = await editAt(4, 9);
    await key("M", { ctrlKey: true, shiftKey: true }, field);
    await input(equationSource(), "z");
    await click("Cancel");
    const resumed = editor();
    expect(document.activeElement).toBe(resumed);
    expect(resumed.value).toBe(original.text);
    expect(resumed.selectionStart).toBe(4);
    expect(resumed.selectionEnd).toBe(9);
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    await key("Escape", {}, resumed);
    expect(await persist()).toEqual(deck);
  });

  it.each(["canvas", "inspector"] as const)(
    "accepts typed and pasted inline math as raw %s text without opening the popup",
    async (target) => {
      const original = textObject("Gauge  symmetry");
      const deck = deckWith(original);
      await render(deck);
      const field =
        target === "canvas"
          ? await editAt(6)
          : host.querySelector<HTMLTextAreaElement>("#text-content")!;
      await act(async () => {
        field.focus();
        field.setSelectionRange(6, 6);
      });
      let value = original.text;
      let caret = 6;
      for (const character of "$U(1)$") {
        const event = await key(
          character,
          { shiftKey: character === "$" },
          field,
        );
        if (character === "$") expect(event.defaultPrevented).toBe(false);
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        value = value.slice(0, caret) + character + value.slice(caret);
        await input(field, value);
        caret++;
        await act(async () => field.setSelectionRange(caret, caret));
      }
      expect(field.value).toBe("Gauge $U(1)$ symmetry");
      const pasted = " and $x$";
      value = value.slice(0, caret) + pasted + value.slice(caret);
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(field, value);
        field.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertFromPaste",
            data: pasted,
          }),
        );
      });
      expect(field.value).toBe("Gauge $U(1)$ and $x$ symmetry");
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      if (target === "canvas") {
        expect(await persist()).toEqual(deck);
        expect(button("Undo · Ctrl+Z").disabled).toBe(true);
        await key("Enter", { ctrlKey: true }, field);
      }
      expect((await persist()).slides[0].objects[0]).toEqual({
        ...original,
        text: value,
      });
      await key("z", { ctrlKey: true });
      expect(await persist()).toEqual(deck);
    },
  );

  it("leaves an escaped dollar and IME dollar input available as literal native text", async () => {
    const original = textObject("Cost: " + String.fromCharCode(92));
    const deck = deckWith(original);
    await render(deck);
    const field = await editAt(original.text.length);
    expect((await key("$", { shiftKey: true }, field)).defaultPrevented).toBe(
      false,
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const escaped = original.text + "$";
    await input(field, escaped + " ");
    await act(async () =>
      field.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    for (const isComposing of [true, false]) {
      expect(
        (await key("$", { shiftKey: true, isComposing }, field))
          .defaultPrevented,
      ).toBe(false);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    }
    const literal = escaped + " $";
    await input(field, literal);
    await act(async () =>
      field.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    expect(field.value).toBe(literal);
    expect(await persist()).toEqual(deck);
    await key("Enter", { ctrlKey: true }, field);
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      text: literal,
    });
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it("opens from a selected text object without a double-click and can discard the whole pending insertion", async () => {
    const original = textObject("Text ");
    const deck = deckWith(original);
    await render(deck);
    const canvas = host.querySelector<HTMLElement>(
      '[aria-label="Slide canvas"]',
    )!;
    await act(async () => canvas.focus());
    await key("M", { ctrlKey: true, shiftKey: true }, canvas);
    expect(equationSource().value).toBe("");
    expect(document.activeElement).toBe(equationSource());
    await input(equationSource(), "z");
    await settle();
    await click("Insert equation");
    expect(editor().value).toBe("Text $z$");
    expect(editor().selectionStart).toBe(8);
    expect(await persist()).toEqual(deck);
    await key("Escape", {}, editor());
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("keeps Inspector composition active for dollar and equation shortcuts", async () => {
    const original = textObject("Before  after");
    const deck = deckWith(original);
    await render(deck);
    const field = host.querySelector<HTMLTextAreaElement>("#text-content")!;
    await act(async () => {
      field.focus();
      field.setSelectionRange(7, 7);
    });
    await act(async () =>
      field.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    for (const value of ["$", "M"]) {
      expect(
        (await key(value, { shiftKey: true, ctrlKey: value === "M" }, field))
          .defaultPrevented,
      ).toBe(false);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    }
    await act(async () =>
      field.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    expect((await key("$", { shiftKey: true }, field)).defaultPrevented).toBe(
      false,
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await key("M", { ctrlKey: true, shiftKey: true }, field);
    expect(document.activeElement).toBe(equationSource());
    await click("Cancel");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(7);
    expect(field.selectionEnd).toBe(7);
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("double-clicks the intended rendered equation when the same source occurs twice", async () => {
    const original = textObject("The $x$ and $x$ terms.");
    const deck = deckWith(original);
    await render(deck);
    const fragments = host.querySelectorAll<SVGGElement>(
      '.slide-paper svg [data-inline-math-fragment="x"]',
    );
    expect(fragments).toHaveLength(2);
    await act(async () =>
      fragments[1].dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe(
      "Edit inline equation",
    );
    expect(equationSource().value).toBe("x");
    await input(equationSource(), "z");
    await settle();
    await click("Apply equation");
    expect(editor().value).toBe("The $x$ and $z$ terms.");
    expect(await persist()).toEqual(deck);
    await key("Enter", { ctrlKey: true }, editor());
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      text: "The $x$ and $z$ terms.",
    });
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it("keeps the popup anchored to its text owner when an asynchronous equation insertion changes the selection", async () => {
    const original = textObject("Gauge  symmetry");
    const deck = deckWith(original);
    const rendered = {
      width: 60,
      height: 44,
      baseline: 32,
      svg: '<svg width="60" height="44"><path d="M0 0L1 1"/></svg>',
    };
    let releaseStandalone = () => {};
    const pendingStandalone = new Promise<typeof rendered>((resolve) => {
      releaseStandalone = () => resolve(rendered);
    });
    vi.mocked(equations.renderEquation).mockImplementation((latex) =>
      latex === "E = mc^2" ? pendingStandalone : Promise.resolve(rendered),
    );
    await render(deck);
    const canvas = host.querySelector<HTMLElement>(
      '[aria-label="Slide canvas"]',
    )!;
    await act(async () => canvas.focus());
    await click("Equation");
    const field = await editAt(6);
    await key("M", { ctrlKey: true, shiftKey: true }, field);
    await input(equationSource(), "U(1)");
    await settle();
    expect(equations.renderEquation).toHaveBeenCalledWith(
      "U(1)",
      deck.theme.equation.fontSetId,
      original.fontSize,
      original.color,
      false,
    );
    await act(async () => releaseStandalone());
    expect(button("Select Equation text").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(equationSource().value).toBe("U(1)");
    expect(document.activeElement).toBe(equationSource());
    const afterStandalone = await persist();
    expect(afterStandalone.slides[0].objects).toHaveLength(2);
    expect(afterStandalone.slides[0].objects[0]).toEqual(original);
    expect(afterStandalone.slides[0].objects[1]).toMatchObject({
      type: "equation",
      latex: "E = mc^2",
    });
    await click("Insert equation");
    expect(button("Select Equation text").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(editor());
    expect(editor().value).toBe("Gauge $U(1)$ symmetry");
    expect(editor().selectionStart).toBe(12);
    expect((await persist()).slides[0].objects[0]).toEqual(original);
    await key("Enter", { ctrlKey: true }, editor());
    const committed = await persist();
    expect(committed.slides[0].objects[0]).toEqual({
      ...original,
      text: "Gauge $U(1)$ symmetry",
    });
    expect(committed.slides[0].objects[1]).toEqual(
      afterStandalone.slides[0].objects[1],
    );
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(afterStandalone);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it("keeps IME composition and speaker notes in control of the shortcut", async () => {
    const original = textObject("The field stays.");
    const deck = deckWith(original);
    await render(deck);
    const field = await editAt(4);
    await act(async () =>
      field.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    await key("M", { ctrlKey: true, shiftKey: true, isComposing: true }, field);
    await key("M", { ctrlKey: true, shiftKey: true }, field);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(editor()).toBe(field);
    await act(async () =>
      field.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    await key("Escape", {}, field);
    const notes = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Speaker notes"]',
    )!;
    await act(async () => notes.focus());
    expect(
      (await key("M", { ctrlKey: true, shiftKey: true }, notes))
        .defaultPrevented,
    ).toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("opens from the Inspector text caret and commits only the equation insertion as one undo step", async () => {
    const original = textObject("Before  after");
    const deck = deckWith(original);
    await render(deck);
    const field = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Text content"]',
    )!;
    await act(async () => {
      field.focus();
      field.setSelectionRange(7, 7);
    });
    await key("M", { ctrlKey: true, shiftKey: true }, field);
    expect(document.activeElement).toBe(equationSource());
    await input(equationSource(), String.raw`\alpha`);
    await settle();
    await click("Insert equation");
    const inserted = String.raw`Before $\alpha$ after`;
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...original,
      text: inserted,
    });
    expect(
      host.querySelector('textarea[aria-label="Edit text on slide"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(15);
    expect(field.selectionEnd).toBe(15);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });
});
