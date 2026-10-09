// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { DesktopApi, DesktopCommand } from "../src/lib/desktop";
import { shapeFromDrag } from "../src/lib/drawing";
import { exportDeckPdf, exportSlideSvg } from "../src/lib/export";
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

// Exercise the real App keyboard routing, selection, history and help dialog.
// Replace only persistence/export boundaries and unavailable canvas APIs.
const nativeBridge = vi.hoisted(() => ({
  api: undefined as DesktopApi | undefined,
  command: undefined as ((command: DesktopCommand) => void) | undefined,
}));
vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  get desktop() {
    return nativeBridge.api;
  },
}));
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

function existingDeck(): Deck {
  const shape = {
    ...shapeFromDrag("rect", { x: 100, y: 150 }, { x: 300, y: 250 }),
    name: "Research panel",
  };
  return {
    ...createDemoDeck(),
    title: "Keyboard integration",
    slides: [
      {
        ...createBlankSlide(),
        title: "First slide",
        objects: [shape],
        notes: "Preserve native text commands",
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("OS-specific keyboard commands in the editor", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck | undefined;
  let deck: Deck;

  beforeEach(() => {
    nativeBridge.api = undefined;
    nativeBridge.command = undefined;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
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
    deck = existingDeck();
    vi.mocked(loadRecovery).mockReset().mockReturnValue(deck);
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (value) => {
        saved = structuredClone(value);
        return "localStorage";
      });
    vi.mocked(buildDeckArchive)
      .mockReset()
      .mockResolvedValue(new Blob(["deck archive"]));
    vi.mocked(downloadBlob).mockReset();
    vi.mocked(exportDeckPdf)
      .mockReset()
      .mockResolvedValue(new Blob(["PDF"], { type: "application/pdf" }));
    vi.mocked(exportSlideSvg)
      .mockReset()
      .mockResolvedValue(new Blob(["SVG"], { type: "image/svg+xml" }));
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

  function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label ||
        element.getAttribute("aria-label")?.startsWith(`${label} · `),
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function render(platform: string, resume = true) {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    await act(async () => root.render(createElement(App)));
    if (resume) {
      await click("Resume previous work");
      await persist();
    }
  }

  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return saved!;
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

  function enableDesktop(platform = "darwin") {
    const bridge = {
      platform,
      setCommandAvailability: vi.fn().mockResolvedValue(undefined),
      detectTex: vi.fn().mockResolvedValue({
        available: false,
        engines: [],
        sandbox: { available: false },
      }),
      openDocument: vi.fn().mockResolvedValue(null),
      saveDocument: vi.fn().mockResolvedValue(null),
      onCommand: (callback: (command: DesktopCommand) => void) => {
        nativeBridge.command = callback;
        return () => {
          nativeBridge.command = undefined;
        };
      },
    };
    nativeBridge.api = bridge as unknown as DesktopApi;
    return bridge;
  }

  async function command(value: DesktopCommand) {
    expect(nativeBridge.command).toBeTypeOf("function");
    await act(async () => nativeBridge.command!(value));
  }

  it("uses Command on macOS and leaves Control commands alone", async () => {
    await render("MacIntel");
    expect(button("Undo").getAttribute("aria-label")).toBe("Undo · ⌘+Z");
    await click("Select Research panel");
    expect((await key("d", { ctrlKey: true })).defaultPrevented).toBe(false);
    expect(await persist()).toEqual(deck);
    expect((await key("d", { metaKey: true })).defaultPrevented).toBe(true);
    expect((await persist()).slides[0].objects).toHaveLength(2);
    expect((await key("z", { ctrlKey: true })).defaultPrevented).toBe(false);
    expect((await persist()).slides[0].objects).toHaveLength(2);
    await key("z", { metaKey: true });
    expect(await persist()).toEqual(deck);
    await key("Z", { metaKey: true, shiftKey: true });
    expect((await persist()).slides[0].objects).toHaveLength(2);
  });

  it.each([
    ["Win32", "y", false, "Ctrl+Y"],
    ["Linux x86_64", "y", false, "Ctrl+Y"],
  ] as const)(
    "uses the %s redo convention through real history",
    async (platform, redoKey, shiftKey, label) => {
      await render(platform);
      expect(button("Redo").getAttribute("aria-label")).toBe(`Redo · ${label}`);
      await click("Select Research panel");
      expect((await key("d", { metaKey: true })).defaultPrevented).toBe(false);
      expect(await persist()).toEqual(deck);
      await key("d", { ctrlKey: true });
      const changed = await persist();
      expect(changed.slides[0].objects).toHaveLength(2);
      await key("z", { ctrlKey: true });
      expect(await persist()).toEqual(deck);
      expect(
        (await key(redoKey, { ctrlKey: true, shiftKey })).defaultPrevented,
      ).toBe(true);
      expect(await persist()).toEqual(changed);
      await key("z", { ctrlKey: true });
      await key("Z", { ctrlKey: true, shiftKey: true });
      expect(await persist()).toEqual(changed);
    },
  );

  it("opens shortcut help at startup and keeps preview tabs separate from active bindings", async () => {
    await render("Linux x86_64", false);
    expect(
      (await key("?", { ctrlKey: true, shiftKey: true, code: "Slash" }))
        .defaultPrevented,
    ).toBe(true);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(
      dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("Ubuntu / Linux");
    await click("macOS");
    expect(
      dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toBe("macOS");
    expect(dialog.textContent).toContain("⌘+S");
    expect(saveWorkspaceRecovery).not.toHaveBeenCalled();
    await click("Close keyboard shortcuts");
    await click("Resume previous work");
    await persist();
    expect(button("Undo").getAttribute("aria-label")).toBe("Undo · Ctrl+Z");
    await click("Select Research panel");
    expect((await key("d", { metaKey: true })).defaultPrevented).toBe(false);
    expect(await persist()).toEqual(deck);
    await key("d", { ctrlKey: true });
    expect((await persist()).slides[0].objects).toHaveLength(2);
  });

  it.each([
    ["MacIntel", "metaKey"],
    ["Win32", "ctrlKey"],
    ["Linux x86_64", "ctrlKey"],
  ] as const)(
    "routes PDF and SVG export on %s without invoking Save",
    async (platform, modifier) => {
      await render(platform);
      expect(
        (
          await key("p", {
            [modifier]: true,
            altKey: true,
            shiftKey: platform === "MacIntel",
            code: "KeyP",
          })
        ).defaultPrevented,
      ).toBe(true);
      expect(exportDeckPdf).toHaveBeenCalledExactlyOnceWith(deck);
      expect(exportSlideSvg).not.toHaveBeenCalled();
      expect(buildDeckArchive).not.toHaveBeenCalled();
      expect(downloadBlob).toHaveBeenLastCalledWith(
        expect.any(Blob),
        "Keyboard integration.pdf",
      );
      expect(
        (
          await key(platform === "MacIntel" ? "ß" : "s", {
            [modifier]: true,
            altKey: true,
            code: "KeyS",
          })
        ).defaultPrevented,
      ).toBe(true);
      expect(exportSlideSvg).toHaveBeenCalledExactlyOnceWith(
        deck,
        deck.slides[0],
      );
      expect(buildDeckArchive).not.toHaveBeenCalled();
      expect(downloadBlob).toHaveBeenLastCalledWith(
        expect.any(Blob),
        "Keyboard integration-1.svg",
      );
      await key("s", { [modifier]: true });
      expect(buildDeckArchive).toHaveBeenCalledExactlyOnceWith(deck);
    },
  );

  it("duplicates the current slide when nothing is selected, with one undo step", async () => {
    await render("Linux x86_64");
    await key("d", { ctrlKey: true });
    const changed = await persist();
    expect(changed.slides).toHaveLength(2);
    expect(changed.slides[1].id).not.toBe(deck.slides[0].id);
    expect(changed.slides[1].objects[0].id).not.toBe(
      deck.slides[0].objects[0].id,
    );
    expect(changed.slides[1].objects[0].transform).toEqual(
      deck.slides[0].objects[0].transform,
    );
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it("keeps canvas commands active from focused layer buttons, checkboxes and color controls", async () => {
    await render("Linux x86_64");
    const layer = button("Select Research panel");
    await click("Select Research panel");
    await act(async () => layer.focus());
    expect(
      (await key("d", { ctrlKey: true }, document.activeElement!))
        .defaultPrevented,
    ).toBe(true);
    expect((await persist()).slides[0].objects).toHaveLength(2);
    const checkbox = host.querySelector<HTMLInputElement>(
      'input[aria-label="No shape fill"]',
    )!;
    await act(async () => checkbox.focus());
    expect(
      (await key("c", { ctrlKey: true }, document.activeElement!))
        .defaultPrevented,
    ).toBe(true);
    expect(
      (await key("v", { ctrlKey: true }, document.activeElement!))
        .defaultPrevented,
    ).toBe(true);
    expect((await persist()).slides[0].objects).toHaveLength(3);
    await key("z", { ctrlKey: true }, document.activeElement!);
    await key("z", { ctrlKey: true }, document.activeElement!);
    expect(await persist()).toEqual(deck);
    const zoom = host.querySelector<HTMLInputElement>(
      'input[aria-label="Canvas zoom"]',
    )!;
    await act(async () => zoom.focus());
    expect(
      (await key("ArrowRight", {}, document.activeElement!)).defaultPrevented,
    ).toBe(false);
    expect(await persist()).toEqual(deck);
    await click("Text");
    const text = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit text on slide"]',
    )!;
    await key("Enter", { ctrlKey: true }, text);
    const color = host.querySelector<HTMLInputElement>(
      'input[aria-label="Text color"]',
    )!;
    await act(async () => color.focus());
    expect(
      (await key("Enter", {}, document.activeElement!)).defaultPrevented,
    ).toBe(false);
    expect(
      host.querySelector('textarea[aria-label="Edit text on slide"]'),
    ).toBeNull();
    await act(async () => color.blur());
    expect(
      (await key("Enter", {}, document.activeElement!)).defaultPrevented,
    ).toBe(true);
    expect(
      host.querySelector('textarea[aria-label="Edit text on slide"]'),
    ).toBe(document.activeElement);
  });

  it("preserves native text editing commands while allowing Save from a focused text field", async () => {
    await render("MacIntel");
    await click("Select Research panel");
    const notes = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Speaker notes"]',
    )!;
    await act(async () => notes.focus());
    for (const value of ["a", "c", "x", "v", "z", "d", "g"]) {
      expect(
        (await key(value, { metaKey: true }, notes)).defaultPrevented,
      ).toBe(false);
    }
    expect(await persist()).toEqual(deck);
    expect((await key("s", { metaKey: true }, notes)).defaultPrevented).toBe(
      true,
    );
    expect(buildDeckArchive).toHaveBeenCalledExactlyOnceWith(deck);
  });

  it("routes native menu commands to focused text or real object history", async () => {
    const executeTextCommand = vi.fn(() => true);
    const previousExecCommand = Object.getOwnPropertyDescriptor(
      document,
      "execCommand",
    );
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: executeTextCommand,
    });
    enableDesktop();
    try {
      // Electron's host platform takes priority over the browser metadata.
      await render("Linux x86_64");
      expect(button("Undo").getAttribute("aria-label")).toBe("Undo · ⌘+Z");
      await click("Select Research panel");
      const notes = host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Speaker notes"]',
      )!;
      await act(async () => notes.focus());
      await command("copy");
      await command("undo");
      await command("duplicate");
      await command("present");
      expect(executeTextCommand.mock.calls).toEqual([["copy"], ["undo"]]);
      expect(await persist()).toEqual(deck);
      expect(host.querySelector(".presentation-view")).toBeNull();
      await act(async () => notes.blur());
      await command("duplicate");
      expect((await persist()).slides[0].objects).toHaveLength(2);
      await command("undo");
      expect(await persist()).toEqual(deck);
      expect(executeTextCommand).toHaveBeenCalledTimes(2);
      await click("Text");
      const text = host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Edit text on slide"]',
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(text, "Native menu applies pending text 한글");
        text.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(document.activeElement).toBe(text);
      await command("present");
      expect(
        host.querySelector('textarea[aria-label="Edit text on slide"]'),
      ).toBeNull();
      expect(host.querySelector(".presentation-view")).toBeNull();
      expect((await persist()).slides[0].objects[1]).toMatchObject({
        type: "text",
        text: "Native menu applies pending text 한글",
      });
    } finally {
      if (previousExecCommand)
        Object.defineProperty(document, "execCommand", previousExecCommand);
      else
        delete (document as Document & { execCommand?: unknown }).execCommand;
    }
  });

  it("routes native New, Open and Save As without replacing a deck on cancellation", async () => {
    const bridge = enableDesktop();
    const archive = new Blob(["native archive"]);
    Object.defineProperty(archive, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.mocked(buildDeckArchive).mockResolvedValue(archive);
    await render("Win32");
    await command("new");
    expect(host.textContent).toContain("Choose your theme.");
    await click("Cancel");
    expect(await persist()).toEqual(deck);
    await command("open");
    expect(bridge.openDocument).toHaveBeenCalledTimes(1);
    expect(await persist()).toEqual(deck);
    await command("saveAs");
    expect(bridge.saveDocument).toHaveBeenCalledExactlyOnceWith({
      bytes: new Uint8Array([1, 2, 3]),
      suggestedName: "Keyboard integration.scislide",
      saveAs: true,
    });
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(await persist()).toEqual(deck);
  });

  it("uses Keynote Play without exporting PDF, keeps the legacy alias and exits with Q", async () => {
    await render("MacIntel");
    await key("π", { metaKey: true, altKey: true, code: "KeyP" });
    expect(host.querySelector(".presentation-view")).toBeTruthy();
    expect(exportDeckPdf).not.toHaveBeenCalled();
    await key("q");
    expect(host.querySelector(".presentation-view")).toBeNull();
    await key("Enter", { metaKey: true });
    expect(host.querySelector(".presentation-view")).toBeTruthy();
    await key("Escape");
    await key("P", { metaKey: true, altKey: true, shiftKey: true });
    expect(exportDeckPdf).toHaveBeenCalledExactlyOnceWith(deck);
  });

  it("opens the slide layout and figure pickers and inserts an equation with Mac shortcuts", async () => {
    const equations = await import("../src/lib/equations");
    vi.spyOn(equations, "renderEquation").mockResolvedValue({
      svg: "<svg></svg>",
      width: 160,
      height: 80,
    });
    await render("MacIntel");
    await key("N", { metaKey: true, shiftKey: true });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Choose a slide layout",
    );
    await key("l", { metaKey: true });
    expect(await persist()).toEqual(deck);
    await click("Close slide templates");
    const figure = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].find((input) => input.accept.includes(".svg"))!;
    expect(figure).toBeTruthy();
    const choose = vi.spyOn(figure, "click");
    await key("V", { metaKey: true, shiftKey: true });
    expect(choose).toHaveBeenCalledOnce();
    await key("´", { metaKey: true, altKey: true, code: "KeyE" });
    expect((await persist()).slides[0].objects.at(-1)).toMatchObject({
      type: "equation",
      latex: "E = mc^2",
      transform: { width: 160, height: 80 },
    });
    await key("z", { metaKey: true });
    expect(await persist()).toEqual(deck);
  });

  it("moves grouped layers by one step or to the ends without splitting their order", async () => {
    const objects = deck.slides[0].objects;
    objects[0].groupId = "research-group";
    for (const name of ["Group mate", "Middle", "Front"])
      objects.push({
        ...shapeFromDrag("rect", { x: 100, y: 150 }, { x: 300, y: 250 }),
        name,
        ...(name === "Group mate" ? { groupId: "research-group" } : {}),
      });
    await render("MacIntel");
    await click("Select Research panel");
    const names = async () =>
      (await persist()).slides[0].objects.map((o) => o.name);
    await key("F", { metaKey: true, altKey: true, shiftKey: true });
    expect(await names()).toEqual([
      "Middle",
      "Research panel",
      "Group mate",
      "Front",
    ]);
    await key("F", { metaKey: true, shiftKey: true });
    expect(await names()).toEqual([
      "Middle",
      "Front",
      "Research panel",
      "Group mate",
    ]);
    await key("B", { metaKey: true, altKey: true, shiftKey: true });
    expect(await names()).toEqual([
      "Middle",
      "Research panel",
      "Group mate",
      "Front",
    ]);
    await key("B", { metaKey: true, shiftKey: true });
    expect(await names()).toEqual([
      "Research panel",
      "Group mate",
      "Middle",
      "Front",
    ]);
    await key("z", { metaKey: true });
    expect(await names()).toEqual([
      "Middle",
      "Research panel",
      "Group mate",
      "Front",
    ]);
  });

  it("locks and unlocks groups with one undo step and ignores repeated no-op locks", async () => {
    deck.slides[0].objects[0].groupId = "g";
    deck.slides[0].objects.push({
      ...shapeFromDrag("ellipse", { x: 300, y: 150 }, { x: 400, y: 250 }),
      name: "Group mate",
      groupId: "g",
    });
    await render("MacIntel");
    await click("Select Research panel");
    await key("l", { metaKey: true });
    await key("l", { metaKey: true });
    expect((await persist()).slides[0].objects.every((o) => o.locked)).toBe(
      true,
    );
    await key("d", { metaKey: true });
    expect((await persist()).slides[0].objects).toHaveLength(2);
    await key("z", { metaKey: true });
    expect(await persist()).toEqual(deck);
    await key("Z", { metaKey: true, shiftKey: true });
    await click("Select Research panel");
    await key("¬", { metaKey: true, altKey: true, code: "KeyL" });
    expect((await persist()).slides[0].objects.every((o) => !o.locked)).toBe(
      true,
    );
    await key("z", { metaKey: true });
    expect((await persist()).slides[0].objects.every((o) => o.locked)).toBe(
      true,
    );
  });

  it("formats whole selected text objects and preserves native editing and locked objects", async () => {
    const text = structuredClone(
      createDemoDeck().slides[0].objects.find((o) => o.type === "text")!,
    );
    if (text.type !== "text") throw new Error("Expected text fixture");
    Object.assign(text, {
      name: "Body",
      text: "Text with $\\chi$",
      fontSize: 40,
      fontWeight: 400,
      align: "left",
    });
    deck.slides[0].objects.push(text);
    await render("MacIntel");
    await click("Select Body");
    await key("b", { metaKey: true });
    await key("+", { metaKey: true, shiftKey: true, code: "Equal" });
    await key("|", { metaKey: true, shiftKey: true, code: "Backslash" });
    expect((await persist()).slides[0].objects[1]).toMatchObject({
      fontWeight: 700,
      fontSize: 41,
      align: "center",
      text: text.text,
    });
    expect((await persist()).slides[0].objects[0]).toEqual(
      deck.slides[0].objects[0],
    );
    await key("}", { metaKey: true, shiftKey: true, code: "BracketRight" });
    await key("-", { metaKey: true, code: "Minus" });
    await key("{", { metaKey: true, shiftKey: true, code: "BracketLeft" });
    await key("b", { metaKey: true });
    expect((await persist()).slides[0].objects[1]).toMatchObject({
      fontWeight: 400,
      fontSize: 40,
      align: "left",
    });
    const content = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Text content"]',
    )!;
    await act(async () => content.focus());
    for (const value of ["b", "+", "-", "{"])
      expect(
        (await key(value, { metaKey: true, shiftKey: value === "{" }, content))
          .defaultPrevented,
      ).toBe(false);
    await act(async () => content.blur());
    await key("l", { metaKey: true });
    await key("b", { metaKey: true });
    expect((await persist()).slides[0].objects[1]).toMatchObject({
      fontWeight: 400,
      locked: true,
    });
  });

  it("zooms and fits without changing document history, preserving range control keys", async () => {
    await render("MacIntel");
    const zoom = host.querySelector<HTMLInputElement>(
      'input[aria-label="Canvas zoom"]',
    )!;
    await key(">", { metaKey: true, shiftKey: true, code: "Period" });
    expect(zoom.value).toBe("110");
    for (let i = 0; i < 8; i++)
      await key(">", { metaKey: true, shiftKey: true, code: "Period" });
    expect(zoom.value).toBe("150");
    await key("<", { metaKey: true, shiftKey: true, code: "Comma" });
    expect(zoom.value).toBe("140");
    await key("º", { metaKey: true, altKey: true, code: "Digit0" });
    expect(zoom.value).toBe("100");
    expect((await key("End", {}, zoom)).defaultPrevented).toBe(false);
    expect(button("Undo").disabled).toBe(true);
    expect(await persist()).toEqual(deck);
  });

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "navigates slides and scopes arrow and delete keys to the focused thumbnail on %s",
    async (platform) => {
      deck.slides.push(
        { ...createBlankSlide(), title: "Second" },
        { ...createBlankSlide(), title: "Third" },
      );
      await render(platform);
      const current = () =>
        host
          .querySelector('.slide-card[aria-current="true"]')
          ?.getAttribute("data-slide-id");
      await key("PageDown");
      expect(current()).toBe(deck.slides[1].id);
      await key("End");
      expect(current()).toBe(deck.slides[2].id);
      await key("Home");
      expect(current()).toBe(deck.slides[0].id);
      await key("PageUp");
      expect(current()).toBe(deck.slides[0].id);
      const notes = host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Speaker notes"]',
      )!;
      expect((await key("End", {}, notes)).defaultPrevented).toBe(false);
      expect(current()).toBe(deck.slides[0].id);
      const third = button("Slide 3: Third");
      await act(async () => third.focus());
      await key("PageUp", {}, third);
      expect(current()).toBe(deck.slides[1].id);
      expect(document.activeElement).toBe(button("Slide 2: Second"));
      await key("Home", {}, document.activeElement!);
      expect(current()).toBe(deck.slides[0].id);
      expect(document.activeElement).toBe(button("Slide 1: First slide"));
      const second = button("Slide 2: Second");
      await act(async () => second.focus());
      await key("ArrowDown", {}, second);
      expect(current()).toBe(deck.slides[2].id);
      expect(document.activeElement).toBe(button("Slide 3: Third"));
      await key("Backspace", {}, document.activeElement!);
      expect((await persist()).slides.map((s) => s.title)).toEqual([
        "First slide",
        "Second",
      ]);
      expect(document.activeElement).toBe(button("Slide 2: Second"));
      await key("z", {
        metaKey: platform === "MacIntel",
        ctrlKey: platform !== "MacIntel",
      });
      expect(await persist()).toEqual(deck);
    },
  );

  it("preserves bare navigation in dialogs and blocks Mac commands during composition", async () => {
    await render("MacIntel", false);
    expect((await key("Home")).defaultPrevented).toBe(false);
    await click("Resume previous work");
    await click("Select Research panel");
    expect(
      (await key("l", { metaKey: true, isComposing: true })).defaultPrevented,
    ).toBe(false);
    expect(
      (await key("l", { metaKey: true, keyCode: 229 })).defaultPrevented,
    ).toBe(false);
    await key("N", { metaKey: true, shiftKey: true });
    const dialog = host.querySelector('[role="dialog"]')!;
    for (const value of ["Home", "End", "PageUp", "PageDown"])
      expect((await key(value, {}, dialog)).defaultPrevented).toBe(false);
    expect(await persist()).toEqual(deck);
  });

  it.each([
    [180, "+"],
    [8, "-"],
  ] as const)(
    "keeps text size at %s without an empty undo step",
    async (fontSize, value) => {
      const text = structuredClone(
        createDemoDeck().slides[0].objects.find((o) => o.type === "text")!,
      );
      if (text.type !== "text") throw new Error("Expected text fixture");
      Object.assign(text, { name: "Body", fontSize });
      deck.slides[0].objects.push(text);
      await render("MacIntel");
      await click("Select Body");
      await key(value, { metaKey: true });
      expect((await persist()).slides[0].objects[1]).toMatchObject({
        fontSize,
      });
      expect(button("Undo").disabled).toBe(true);
    },
  );

  it("deselects on Shift-Command-A without changing document history", async () => {
    await render("MacIntel");
    await click("Select Research panel");
    expect(button("Select Research panel").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await key("A", { metaKey: true, shiftKey: true });
    expect(button("Select Research panel").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(await persist()).toEqual(deck);
    expect(button("Undo").disabled).toBe(true);
  });

  it.each(["Win32", "Linux x86_64"])(
    "starts from the first or current slide on %s without editing the deck",
    async (platform) => {
      deck.slides.push(
        { ...createBlankSlide(), title: "Second" },
        { ...createBlankSlide(), title: "Third" },
      );
      await render(platform);
      await key("End");
      await key("F5", { shiftKey: true });
      const counter = () =>
        host.querySelector(".presentation-controls > span")?.textContent;
      expect(counter()).toBe("3 / 3");
      await key("Escape");
      await key("F5");
      expect(counter()).toBe("1 / 3");
      await key(platform === "Win32" ? "n" : "Enter");
      expect(counter()).toBe("2 / 3");
      await key(platform === "Win32" ? "p" : "Backspace");
      expect(counter()).toBe("1 / 3");
      await key(platform === "Win32" ? "Escape" : "-");
      expect(host.querySelector(".presentation-view")).toBeNull();
      expect(await persist()).toEqual(deck);
    },
  );

  it.each([
    ["Win32", "=", { altKey: true, code: "Equal" }],
    ["Linux x86_64", "E", { altKey: true, shiftKey: true, code: "KeyE" }],
  ] as const)(
    "opens layouts and inserts equations with the %s conventions",
    async (platform, value, options) => {
      const equations = await import("../src/lib/equations");
      vi.spyOn(equations, "renderEquation").mockResolvedValue({
        svg: "<svg></svg>",
        width: 160,
        height: 80,
      });
      await render(platform);
      await key("m", { ctrlKey: true });
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
        "Choose a slide layout",
      );
      await click("Close slide templates");
      await key(value, options);
      expect((await persist()).slides[0].objects.at(-1)).toMatchObject({
        type: "equation",
        latex: "E = mc^2",
      });
      await key("z", { ctrlKey: true });
      expect(await persist()).toEqual(deck);
    },
  );

  it.each(["Win32", "Linux x86_64"])(
    "groups and ungroups using %s keys with one undo step",
    async (platform) => {
      deck.slides[0].objects.push({
        ...shapeFromDrag("ellipse", { x: 400, y: 150 }, { x: 500, y: 250 }),
        name: "Peer",
      });
      await render(platform);
      await key("a", { ctrlKey: true });
      await key("g", { ctrlKey: true, shiftKey: platform !== "Win32" });
      const grouped = (await persist()).slides[0].objects;
      expect(grouped[0].groupId).toBeTruthy();
      expect(grouped[1].groupId).toBe(grouped[0].groupId);
      await key("g", {
        ctrlKey: true,
        shiftKey: true,
        altKey: platform !== "Win32",
      });
      expect((await persist()).slides[0].objects.every((o) => !o.groupId)).toBe(
        true,
      );
      await key("z", { ctrlKey: true });
      expect((await persist()).slides[0].objects).toEqual(grouped);
    },
  );

  it.each(["Win32", "Linux x86_64"])(
    "formats selected text on %s without locking it or stealing native typing",
    async (platform) => {
      const text = structuredClone(
        createDemoDeck().slides[0].objects.find((o) => o.type === "text")!,
      );
      Object.assign(text, {
        name: "Body",
        text: "Text with $\\chi$",
        fontSize: 40,
        fontWeight: 400,
        align: "right",
      });
      deck.slides[0].objects.push(text);
      await render(platform);
      await click("Select Body");
      await key("b", { ctrlKey: true });
      await key(platform === "Win32" ? ">" : "]", {
        ctrlKey: true,
        shiftKey: platform === "Win32",
        code: platform === "Win32" ? "Period" : "BracketRight",
      });
      await key("l", { ctrlKey: true });
      expect((await persist()).slides[0].objects[1]).toMatchObject({
        fontWeight: 700,
        fontSize: 41,
        align: "left",
        locked: false,
      });
      await key("e", { ctrlKey: true });
      expect((await persist()).slides[0].objects[1]).toMatchObject({
        align: "center",
      });
      await key("r", { ctrlKey: true });
      expect((await persist()).slides[0].objects[1]).toMatchObject({
        align: "right",
      });
      const notes = host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Speaker notes"]',
      )!;
      await act(async () => notes.focus());
      const before = await persist();
      expect((await key("l", { ctrlKey: true }, notes)).defaultPrevented).toBe(
        false,
      );
      expect((await key("-", {}, notes)).defaultPrevented).toBe(false);
      expect((await key("F5", {}, notes)).defaultPrevented).toBe(true);
      expect(host.querySelector(".presentation-view")).toBeNull();
      expect(await persist()).toEqual(before);
    },
  );

  it("duplicates the whole slide on PowerPoint Ctrl-Shift-D even with an object selected", async () => {
    await render("Win32");
    await click("Select Research panel");
    await key("d", { ctrlKey: true, shiftKey: true });
    const after = await persist();
    expect(after.slides).toHaveLength(2);
    expect(after.slides[0].objects).toEqual(deck.slides[0].objects);
    expect(after.slides[1].objects).toHaveLength(1);
    expect(after.slides[1].objects[0].id).not.toBe(
      deck.slides[0].objects[0].id,
    );
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it.each(["Win32", "Linux x86_64"])(
    "reorders only focused thumbnails on %s and retains selection, focus and undo",
    async (platform) => {
      deck.slides.push(
        { ...createBlankSlide(), title: "Second" },
        { ...createBlankSlide(), title: "Third" },
      );
      await render(platform);
      const moveKey = platform === "Win32" ? "ArrowUp" : "PageUp";
      const options =
        platform === "Win32"
          ? { ctrlKey: true }
          : { altKey: true, shiftKey: true };
      const notes = host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Speaker notes"]',
      )!;
      expect((await key(moveKey, options, notes)).defaultPrevented).toBe(false);
      expect((await key(moveKey, options)).defaultPrevented).toBe(false);
      expect(await persist()).toEqual(deck);
      const second = button("Slide 2: Second");
      await act(async () => second.focus());
      await key(moveKey, options, second);
      expect((await persist()).slides.map((s) => s.title)).toEqual([
        "Second",
        "First slide",
        "Third",
      ]);
      expect(document.activeElement).toBe(button("Slide 1: Second"));
      const lastKey = platform === "Win32" ? "ArrowDown" : "End";
      await key(
        lastKey,
        platform === "Win32" ? { ctrlKey: true, shiftKey: true } : options,
        document.activeElement!,
      );
      expect((await persist()).slides.map((s) => s.title)).toEqual([
        "First slide",
        "Third",
        "Second",
      ]);
      expect(document.activeElement).toBe(button("Slide 3: Second"));
      await key("z", { ctrlKey: true });
      expect((await persist()).slides.map((s) => s.title)).toEqual([
        "Second",
        "First slide",
        "Third",
      ]);
      await key("z", { ctrlKey: true });
      expect(await persist()).toEqual(deck);
    },
  );

  it("keeps Impress zoom, layering and keypad fit separate and permits plus/minus in dialogs", async () => {
    for (const name of ["Middle", "Front"])
      deck.slides[0].objects.push({
        ...shapeFromDrag("rect", { x: 400, y: 150 }, { x: 500, y: 250 }),
        name,
      });
    await render("Linux x86_64");
    await click("Select Research panel");
    const zoom = host.querySelector<HTMLInputElement>(
      'input[aria-label="Canvas zoom"]',
    )!;
    await key("+", { shiftKey: true });
    expect(zoom.value).toBe("110");
    await key("=", { ctrlKey: true, code: "Equal" });
    expect((await persist()).slides[0].objects.map((o) => o.name)).toEqual([
      "Middle",
      "Research panel",
      "Front",
    ]);
    expect(zoom.value).toBe("110");
    await key("+", { ctrlKey: true, shiftKey: true, code: "NumpadAdd" });
    expect((await persist()).slides[0].objects.map((o) => o.name)).toEqual([
      "Middle",
      "Front",
      "Research panel",
    ]);
    await key("*", { code: "NumpadMultiply" });
    expect(zoom.value).toBe("100");
    await key("*", { code: "Digit8", shiftKey: true });
    expect(zoom.value).toBe("100");
    const video = document.createElement("video");
    host.append(video);
    for (const value of ["+", "-", "Home", "End"])
      expect((await key(value, {}, video)).defaultPrevented).toBe(false);
    await key("m", { ctrlKey: true });
    const dialog = host.querySelector('[role="dialog"]')!;
    expect((await key("+", { shiftKey: true }, dialog)).defaultPrevented).toBe(
      false,
    );
    expect((await key("-", {}, dialog)).defaultPrevented).toBe(false);
  });

  it.each(["win32", "linux"])(
    "routes new native %s slide commands with the same input guards",
    async (platform) => {
      enableDesktop(platform);
      deck.slides.push({ ...createBlankSlide(), title: "Second" });
      await render("MacIntel");
      await key("End");
      await command("present");
      expect(
        host.querySelector(".presentation-controls > span")?.textContent,
      ).toBe("2 / 2");
      await key("Escape");
      await command("presentFromStart");
      expect(
        host.querySelector(".presentation-controls > span")?.textContent,
      ).toBe("1 / 2");
      await key("Escape");
      const notes = host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Speaker notes"]',
      )!;
      await act(async () => notes.focus());
      await command("presentFromStart");
      await command("duplicateSlide");
      expect(host.querySelector(".presentation-view")).toBeNull();
      expect(await persist()).toEqual(deck);
    },
  );

  it("opens the existing presenter display on Windows Alt-F5 and closes it on exit", async () => {
    const close = vi.fn();
    const channel = { postMessage: vi.fn(), close: vi.fn(), onmessage: null };
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          return channel;
        }
      },
    );
    const open = vi.spyOn(window, "open").mockReturnValue({
      closed: false,
      close,
      focus: vi.fn(),
    } as unknown as Window);
    await render("Win32");
    await key("F5", { altKey: true });
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0][0]).toContain("#presenter=");
    expect(host.querySelector(".presentation-view")).toBeTruthy();
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
    expect(channel.close).toHaveBeenCalledOnce();
    expect(await persist()).toEqual(deck);
  });

  it("guards new native object commands in text fields and applies legacy native text editing", async () => {
    enableDesktop();
    await render("MacIntel");
    await click("Select Research panel");
    const notes = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Speaker notes"]',
    )!;
    await act(async () => notes.focus());
    for (const action of [
      "lock",
      "unlock",
      "bold",
      "addSlide",
      "insertEquation",
      "insertFigure",
      "bringToFront",
      "bringForward",
      "fitSlide",
      "deselectAll",
      "finishTextEditing",
    ] as const)
      await command(action);
    expect(await persist()).toEqual(deck);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector(".presentation-view")).toBeNull();
    await act(async () => notes.blur());
    await command("lock");
    expect((await persist()).slides[0].objects[0].locked).toBe(true);
    await command("unlock");
    await click("Text");
    await command("finishTextEditing");
    expect(
      host.querySelector('textarea[aria-label="Edit text on slide"]'),
    ).toBeNull();
    expect(host.querySelector(".presentation-view")).toBeNull();
    await command("finishTextEditing");
    expect(host.querySelector(".presentation-view")).toBeTruthy();
  });

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "duplicates the focused inactive thumbnail on %s despite a lingering canvas selection",
    async (platform) => {
      const second = {
        ...createBlankSlide(),
        title: "Second",
        notes: "The focused slide must be copied",
        objects: [
          {
            ...shapeFromDrag("ellipse", { x: 400, y: 100 }, { x: 550, y: 220 }),
            name: "Second-slide figure",
          },
        ],
      };
      deck.slides.push(second, { ...createBlankSlide(), title: "Third" });
      await render(platform);
      await click("Select Research panel");
      const card = button("Slide 2: Second");
      await act(async () => card.focus());
      expect(
        host
          .querySelector('.slide-card[aria-current="true"]')
          ?.getAttribute("data-slide-id"),
      ).toBe(deck.slides[0].id);
      expect(button("Select Research panel").getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(
        (
          await key(
            "d",
            {
              metaKey: platform === "MacIntel",
              ctrlKey: platform !== "MacIntel",
            },
            card,
          )
        ).defaultPrevented,
      ).toBe(true);
      const changed = await persist();
      expect(changed.slides.map((slide) => slide.title)).toEqual([
        "First slide",
        "Second",
        "Second · copy",
        "Third",
      ]);
      expect(changed.slides[0].objects).toEqual(deck.slides[0].objects);
      expect(changed.slides[2]).toMatchObject({ notes: second.notes });
      expect(changed.slides[2].objects[0]).toMatchObject({
        name: "Second-slide figure",
        transform: second.objects[0].transform,
      });
      expect(changed.slides[2].objects[0].id).not.toBe(second.objects[0].id);
      expect(document.activeElement).toBe(button("Slide 3: Second · copy"));
      await key(
        "z",
        {
          metaKey: platform === "MacIntel",
          ctrlKey: platform !== "MacIntel",
        },
        document.activeElement!,
      );
      expect(await persist()).toEqual(deck);
      expect(document.activeElement?.closest(".slide-list")).toBeTruthy();
      expect(host.contains(document.activeElement)).toBe(true);
      expect(button("Undo").disabled).toBe(true);
    },
  );

  it("reorders Mac thumbnails by one step or to either end without stealing text or canvas keys", async () => {
    deck.slides.push(
      { ...createBlankSlide(), title: "Second" },
      { ...createBlankSlide(), title: "Third" },
    );
    await render("MacIntel");
    await click("Select Research panel");
    const options = { metaKey: true, altKey: true };
    const notes = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Speaker notes"]',
    )!;
    expect((await key("ArrowUp", options, notes)).defaultPrevented).toBe(false);
    expect((await key("ArrowUp", options)).defaultPrevented).toBe(false);
    expect(await persist()).toEqual(deck);
    const second = button("Slide 2: Second");
    await act(async () => second.focus());
    expect((await key("ArrowUp", options, second)).defaultPrevented).toBe(true);
    expect((await persist()).slides.map((slide) => slide.title)).toEqual([
      "Second",
      "First slide",
      "Third",
    ]);
    expect(document.activeElement).toBe(button("Slide 1: Second"));
    await key("ArrowDown", options, document.activeElement!);
    expect(await persist()).toEqual(deck);
    expect(document.activeElement).toBe(button("Slide 2: Second"));
    await key(
      "ArrowDown",
      { ...options, shiftKey: true },
      document.activeElement!,
    );
    expect((await persist()).slides.map((slide) => slide.title)).toEqual([
      "First slide",
      "Third",
      "Second",
    ]);
    expect(document.activeElement).toBe(button("Slide 3: Second"));
    await key(
      "ArrowUp",
      { ...options, shiftKey: true },
      document.activeElement!,
    );
    expect((await persist()).slides.map((slide) => slide.title)).toEqual([
      "Second",
      "First slide",
      "Third",
    ]);
    expect(document.activeElement).toBe(button("Slide 1: Second"));
    const undoCount = 4;
    await key("ArrowUp", options, document.activeElement!);
    await key(
      "ArrowDown",
      { ...options, shiftKey: true, repeat: true },
      document.activeElement!,
    );
    for (let index = 0; index < undoCount; index++)
      await key("z", { metaKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo").disabled).toBe(true);
  });

  it("traverses canvas objects back to front, treats groups as one stop, and lets Tab leave either boundary", async () => {
    const objects = deck.slides[0].objects;
    for (const [name, flags] of [
      ["Hidden", { visible: false }],
      ["Group first", { groupId: "traversal-group" }],
      ["Hidden group member", { groupId: "traversal-group", visible: false }],
      ["Locked", { locked: true }],
      ["Group mate", { groupId: "traversal-group" }],
      ["Group lock", { groupId: "locked-group", locked: true }],
      ["Locked by group", { groupId: "locked-group" }],
      ["Front", {}],
    ] as const)
      objects.push({
        ...shapeFromDrag("rect", { x: 400, y: 150 }, { x: 500, y: 250 }),
        name,
        ...flags,
      });
    await render("MacIntel");
    const canvas = host.querySelector<HTMLElement>(
      '[aria-label="Slide canvas"]',
    )!;
    await act(async () => canvas.focus());
    const selectedNames = () =>
      [
        ...host.querySelectorAll<HTMLButtonElement>(
          '.object-layer-row:not(.hidden) .object-layer-select[aria-pressed="true"]',
        ),
      ]
        .map((element) =>
          element.getAttribute("aria-label")!.replace("Select ", ""),
        )
        .sort();
    const announcement = () =>
      host.querySelector('.canvas-footer [role="status"]')?.textContent;
    expect((await key("Tab", {}, canvas)).defaultPrevented).toBe(true);
    expect(selectedNames()).toEqual(["Research panel"]);
    expect(announcement()).toBe("Selected: Research panel (1 object)");
    expect(document.activeElement).toBe(canvas);
    expect((await key("Tab", { repeat: true }, canvas)).defaultPrevented).toBe(
      true,
    );
    expect(selectedNames()).toEqual(["Research panel"]);
    await key("Tab", {}, canvas);
    expect(selectedNames()).toEqual(["Group first", "Group mate"]);
    expect(announcement()).toBe(
      "Selected: Group first, Group mate (2 objects)",
    );
    expect(announcement()).not.toContain("Hidden");
    await key("Tab", {}, canvas);
    expect(selectedNames()).toEqual(["Front"]);
    expect((await key("Tab", {}, canvas)).defaultPrevented).toBe(false);
    expect(selectedNames()).toEqual(["Front"]);
    await key("Tab", { shiftKey: true }, canvas);
    expect(selectedNames()).toEqual(["Group first", "Group mate"]);
    await key("Tab", { shiftKey: true }, canvas);
    expect(selectedNames()).toEqual(["Research panel"]);
    expect(
      (await key("Tab", { shiftKey: true }, canvas)).defaultPrevented,
    ).toBe(false);
    expect(button("Undo").disabled).toBe(true);
    expect(await persist()).toEqual(deck);
    const notes = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Speaker notes"]',
    )!;
    expect((await key("Tab", {}, notes)).defaultPrevented).toBe(false);
    expect(selectedNames()).toEqual(["Research panel"]);
    await key("N", { metaKey: true, shiftKey: true });
    const dialog = host.querySelector('[role="dialog"]')!;
    expect((await key("Tab", {}, dialog)).defaultPrevented).toBe(false);
    expect(selectedNames()).toEqual(["Research panel"]);
    await click("Close slide templates");
    await key("A", { metaKey: true, shiftKey: true });
    await act(async () => canvas.focus());
    await key("Tab", { shiftKey: true }, canvas);
    expect(selectedNames()).toEqual(["Front"]);
  });

  it("reveals a hidden Inspector and focuses LaTeX source when an equation is double-clicked on the canvas", async () => {
    const equation = structuredClone(
      createDemoDeck().slides[0].objects.find(
        (object) => object.type === "equation",
      )!,
    );
    if (equation.type !== "equation")
      throw new Error("Expected equation fixture");
    const equations = await import("../src/lib/equations");
    vi.spyOn(equations, "renderEquation").mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H20" /></svg>',
      width: equation.transform.width,
      height: equation.transform.height,
    });
    deck.slides[0].objects.push(equation);
    await render("MacIntel");
    await key("i", { metaKey: true, altKey: true });
    const inspector = host.querySelector<HTMLElement>(
      '[aria-label="Inspector panel"]',
    )!;
    expect(inspector.hidden).toBe(true);
    const equationView = [
      ...host.querySelectorAll<SVGGElement>(".slide-paper svg g[aria-label]"),
    ].find(
      (element) => element.getAttribute("aria-label") === equation.description,
    )!;
    expect(equationView).toBeTruthy();
    await act(async () =>
      equationView.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      ),
    );
    expect(inspector.hidden).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    const source = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="LaTeX source"]',
    )!;
    expect(source.value).toBe(equation.latex);
    expect(document.activeElement).toBe(source);
    expect(button(`Select ${equation.name}`).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(button("Undo").disabled).toBe(true);
    expect(await persist()).toEqual(deck);
  });

  it("toggles Inspector and objects independently by keyboard, toolbar and native menu with usable focus", async () => {
    enableDesktop();
    await render("Linux x86_64");
    const inspector = host.querySelector<HTMLElement>(
      '[aria-label="Inspector panel"]',
    )!;
    const objects = host.querySelector<HTMLElement>(
      '[aria-label="Objects and layers panel"]',
    )!;
    const canvas = host.querySelector<HTMLElement>(
      '[aria-label="Slide canvas"]',
    )!;
    expect(inspector.hidden).toBe(false);
    expect(objects.hidden).toBe(false);
    expect(
      (await key("i", { metaKey: true, altKey: true })).defaultPrevented,
    ).toBe(true);
    expect(inspector.hidden).toBe(true);
    expect(objects.hidden).toBe(false);
    expect(document.activeElement).toBe(canvas);
    await key("L", { metaKey: true, shiftKey: true }, canvas);
    expect(objects.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>("aside.inspector")?.hidden).toBe(
      true,
    );
    await click("Toggle Inspector");
    expect(inspector.hidden).toBe(false);
    expect(objects.hidden).toBe(true);
    expect(document.activeElement).toBe(inspector);
    await command("toggleObjectList");
    expect(objects.hidden).toBe(false);
    expect(document.activeElement).toBe(objects);
    await command("toggleInspector");
    expect(inspector.hidden).toBe(true);
    expect(document.activeElement).toBe(canvas);
    await key("i", { metaKey: true, altKey: true }, canvas);
    expect(inspector.hidden).toBe(false);
    expect(document.activeElement).toBe(inspector);
    expect(button("Undo").disabled).toBe(true);
    expect(await persist()).toEqual(deck);
  });

  it("suppresses pane toggles in text, modal and busy contexts", async () => {
    enableDesktop();
    await render("MacIntel");
    const inspector = host.querySelector<HTMLElement>(
      '[aria-label="Inspector panel"]',
    )!;
    const objects = host.querySelector<HTMLElement>(
      '[aria-label="Objects and layers panel"]',
    )!;
    const notes = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Speaker notes"]',
    )!;
    await act(async () => notes.focus());
    expect(
      (await key("i", { metaKey: true, altKey: true }, notes)).defaultPrevented,
    ).toBe(false);
    expect(
      (await key("L", { metaKey: true, shiftKey: true }, notes))
        .defaultPrevented,
    ).toBe(false);
    await command("toggleInspector");
    await command("toggleObjectList");
    expect(inspector.hidden).toBe(false);
    expect(objects.hidden).toBe(false);
    await act(async () => notes.blur());
    await key("N", { metaKey: true, shiftKey: true });
    const dialog = host.querySelector('[role="dialog"]')!;
    await key("i", { metaKey: true, altKey: true }, dialog);
    await key("L", { metaKey: true, shiftKey: true }, dialog);
    await command("toggleInspector");
    expect(inspector.hidden).toBe(false);
    expect(objects.hidden).toBe(false);
    expect(button("Toggle Inspector").disabled).toBe(true);
    expect(button("Toggle objects and layers").disabled).toBe(true);
    await click("Close slide templates");
    let finish!: (value: Blob) => void;
    vi.mocked(buildDeckArchive).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await key("s", { metaKey: true });
    expect(host.querySelector(".app-shell")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(button("Toggle Inspector").disabled).toBe(true);
    expect(button("Toggle objects and layers").disabled).toBe(true);
    await key("i", { metaKey: true, altKey: true });
    await key("L", { metaKey: true, shiftKey: true });
    await command("toggleInspector");
    await command("toggleObjectList");
    expect(inspector.hidden).toBe(false);
    expect(objects.hidden).toBe(false);
    await act(async () => finish(new Blob(["archive"])));
    expect(host.querySelector(".app-shell")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(button("Undo").disabled).toBe(true);
    expect(await persist()).toEqual(deck);
  });

  it("uses the shared playback Escape and repeat policy in the audience window", async () => {
    deck.slides.push({ ...createBlankSlide(), title: "Second" });
    await render("MacIntel");
    await key("p", { metaKey: true, altKey: true });
    const view = host.querySelector<HTMLElement>(".presentation-view")!;
    const counter = () =>
      host.querySelector(".presentation-controls > span")?.textContent;
    expect(counter()).toBe("1 / 2");
    for (const value of ["ArrowRight", "Home", "End", "Escape", "q"])
      expect((await key(value, { repeat: true }, view)).defaultPrevented).toBe(
        true,
      );
    expect(counter()).toBe("1 / 2");
    expect(host.querySelector(".presentation-view")).toBe(view);
    for (const value of ["Escape", "Q", "Home", "PageDown"])
      expect(
        (await key(value, { shiftKey: true }, view)).defaultPrevented,
      ).toBe(false);
    expect(host.querySelector(".presentation-view")).toBe(view);
    const input = document.createElement("input");
    const video = document.createElement("video");
    const audio = document.createElement("audio");
    const media = document.createElement("div");
    media.className = "video-player";
    const mediaButton = document.createElement("button");
    media.append(mediaButton);
    view.append(input, video, audio, media);
    for (const control of [input, video, audio, mediaButton])
      for (const value of ["Escape", "ArrowRight", " ", "Enter"])
        expect((await key(value, {}, control)).defaultPrevented).toBe(false);
    expect(counter()).toBe("1 / 2");
    expect(host.querySelector(".presentation-view")).toBe(view);
    const next = button("Next step or slide");
    expect((await key(" ", {}, next)).defaultPrevented).toBe(false);
    expect((await key("Enter", {}, next)).defaultPrevented).toBe(false);
    await key("ArrowRight", { shiftKey: true }, view);
    expect(counter()).toBe("2 / 2");
    expect((await key("Escape", {}, next)).defaultPrevented).toBe(true);
    expect(host.querySelector(".presentation-view")).toBeNull();
    expect(await persist()).toEqual(deck);
  });

  it("ignores repeated canvas deletion and locked nudges without adding undo entries", async () => {
    await render("MacIntel");
    await click("Select Research panel");
    for (const value of ["Delete", "Backspace"])
      expect((await key(value, { repeat: true })).defaultPrevented).toBe(true);
    expect(await persist()).toEqual(deck);
    expect(button("Undo").disabled).toBe(true);
    await key("l", { metaKey: true });
    const locked = await persist();
    for (const value of ["ArrowRight", "ArrowDown", "Delete", "Backspace"])
      await key(value);
    expect(await persist()).toEqual(locked);
    await key("z", { metaKey: true });
    expect(await persist()).toEqual(deck);
    expect(button("Undo").disabled).toBe(true);
  });

  it("consumes repeated thumbnail navigation and deletion without changing selection, deck or history", async () => {
    deck.slides.push({ ...createBlankSlide(), title: "Second" });
    await render("MacIntel");
    await click("Select Research panel");
    const second = button("Slide 2: Second");
    await act(async () => second.focus());
    for (const value of ["ArrowUp", "ArrowDown", "Delete", "Backspace"])
      expect(
        (await key(value, { repeat: true }, second)).defaultPrevented,
      ).toBe(true);
    expect(document.activeElement).toBe(second);
    expect(
      host
        .querySelector('.slide-card[aria-current="true"]')
        ?.getAttribute("data-slide-id"),
    ).toBe(deck.slides[0].id);
    expect(button("Select Research panel").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(await persist()).toEqual(deck);
    expect(button("Undo").disabled).toBe(true);
  });

  it("keeps native menu availability synchronized with text focus, selection, thumbnail focus, dialogs, busy work and playback", async () => {
    const bridge = enableDesktop();
    deck.slides.push({ ...createBlankSlide(), title: "Second" });
    const states = (): Partial<Record<DesktopCommand, boolean>> =>
      bridge.setCommandAvailability.mock.calls.at(-1)?.[0] ?? {};
    await render("Linux x86_64", false);
    expect(bridge.setCommandAvailability).toHaveBeenCalled();
    expect(states()).toMatchObject({
      new: true,
      open: true,
      showShortcuts: true,
      save: false,
      present: false,
      toggleInspector: false,
      toggleObjectList: false,
    });
    await click("Resume previous work");
    expect(states()).toMatchObject({
      save: true,
      copy: false,
      undo: false,
      lock: false,
      toggleInspector: true,
      toggleObjectList: true,
    });
    await click("Select Research panel");
    expect(states()).toMatchObject({
      copy: true,
      lock: true,
      undo: false,
      bold: false,
    });
    const notes = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Speaker notes"]',
    )!;
    await act(async () => notes.focus());
    expect(states()).toMatchObject({
      copy: true,
      cut: true,
      paste: true,
      undo: true,
      redo: true,
      selectAll: true,
      save: true,
      present: false,
      toggleInspector: false,
      toggleObjectList: false,
    });
    const second = button("Slide 2: Second");
    await act(async () => second.focus());
    expect(states()).toMatchObject({ duplicate: true });
    await key("N", { metaKey: true, shiftKey: true }, second);
    expect(states()).toMatchObject({
      new: false,
      open: false,
      save: false,
      copy: false,
      present: false,
      toggleInspector: false,
    });
    await click("Close slide templates");
    const canvas = host.querySelector<HTMLElement>(
      '[aria-label="Slide canvas"]',
    )!;
    await act(async () => canvas.focus());
    let finish!: (value: Blob) => void;
    vi.mocked(buildDeckArchive).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await key("s", { metaKey: true }, canvas);
    expect(states()).toMatchObject({
      save: false,
      copy: false,
      undo: false,
      present: false,
      toggleInspector: false,
      toggleObjectList: false,
      showShortcuts: true,
    });
    const archive = new Blob(["archive"]);
    Object.defineProperty(archive, "arrayBuffer", {
      value: async () => new Uint8Array([1]).buffer,
    });
    await act(async () => finish(archive));
    await key("p", { metaKey: true, altKey: true }, canvas);
    expect(host.querySelector(".presentation-view")).toBeTruthy();
    expect(states()).toMatchObject({
      save: false,
      copy: false,
      undo: false,
      present: false,
      toggleInspector: false,
      toggleObjectList: false,
    });
    await key("Escape");
    expect(states()).toMatchObject({
      save: true,
      toggleInspector: true,
      toggleObjectList: true,
    });
    expect(await persist()).toEqual(deck);
  });
});
