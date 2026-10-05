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

  function enableDesktop() {
    const bridge = {
      platform: "darwin",
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
    ["Linux x86_64", "Z", true, "Ctrl+Shift+Z"],
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
      if (platform.startsWith("Linux")) {
        expect((await key("y", { ctrlKey: true })).defaultPrevented).toBe(
          false,
        );
        expect(await persist()).toEqual(deck);
      }
      expect(
        (await key(redoKey, { ctrlKey: true, shiftKey })).defaultPrevented,
      ).toBe(true);
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
        (await key("p", { [modifier]: true, altKey: true, code: "KeyP" }))
          .defaultPrevented,
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
});
