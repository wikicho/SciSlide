// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createDemoDeck } from "../src/lib/model";
import type { Slide } from "../src/lib/model";
import { loadRecovery } from "../src/lib/persistence";
import {
  clearWorkspaceRecovery,
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";
import { saveDocumentRecovery } from "../src/lib/recovery-history";

const desktop = vi.hoisted(() => ({
  platform: "linux",
  workspaceId: "window-two",
  detectTex: vi.fn(async () => ({
    available: false,
    engines: [],
    sandbox: { available: false },
  })),
  clearDocument: vi.fn(async () => {}),
  onCommand: vi.fn(() => () => {}),
  onCloseDocument: vi.fn((_listener: () => void) => () => {}),
  confirmCloseDocument: vi.fn(async () => {}),
}));
vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  desktop,
}));
vi.mock("../src/lib/workspace-recovery", () => ({
  clearWorkspaceRecovery: vi.fn(async () => {}),
  loadWorkspaceRecovery: vi.fn(async () => null),
  saveWorkspaceRecovery: vi.fn(async () => "indexeddb"),
}));
vi.mock("../src/lib/recovery-history", async (original) => ({
  ...(await original<typeof import("../src/lib/recovery-history")>()),
  saveDocumentRecovery: vi.fn(async () => "indexeddb"),
}));
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
}));
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));
vi.mock("../src/lib/equations", () => ({
  renderEquation: vi.fn(async () => ({
    svg: '<svg viewBox="0 0 400 80"><path d="M0 40L400 40"/></svg>',
    width: 400,
    height: 80,
  })),
  MATH_PROFILE_REVISION: "test",
  DEFAULT_TEX_PACKAGES: [],
  SUPPORTED_MATH_PACKAGES: [],
  FONT_OPTIONS: [
    { id: "mathjax-stix2", label: "STIX Two", description: "Serif" },
    { id: "mathjax-fira", label: "Fira Math", description: "Sans" },
    { id: "mathjax-modern", label: "Latin Modern", description: "TeX" },
  ],
}));
vi.mock("../src/components/SlideScene", () => ({
  SlideScene: ({ slide }: { slide: Slide }) =>
    createElement("svg", null, createElement("text", null, slide.title)),
}));

describe("independent desktop workspace recovery", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
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
    localStorage.clear();
    desktop.workspaceId = "window-two";
    vi.mocked(loadRecovery).mockReset().mockReturnValue(createDemoDeck());
    vi.mocked(loadWorkspaceRecovery).mockClear();
    vi.mocked(saveWorkspaceRecovery).mockClear();
    vi.mocked(clearWorkspaceRecovery).mockReset().mockResolvedValue(undefined);
    vi.mocked(saveDocumentRecovery).mockReset().mockResolvedValue("indexeddb");
    desktop.onCloseDocument.mockClear();
    desktop.confirmCloseDocument.mockReset().mockResolvedValue(undefined);
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

  async function render() {
    await act(async () => root.render(createElement(App)));
  }
  async function click(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
      (item) =>
        item.textContent?.trim() === label ||
        item.getAttribute("aria-label") === label,
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => button.click());
  }
  async function closeEditor() {
    const listener = desktop.onCloseDocument.mock.calls.at(-1)?.[0];
    if (!listener) throw new Error("Missing close-document subscription");
    await act(async () => listener());
  }

  it("does not inherit another window's recovery and scopes autosave and unload writes", async () => {
    await render();
    expect(loadRecovery).not.toHaveBeenCalled();
    expect(loadWorkspaceRecovery).toHaveBeenCalledWith("window-two");
    expect(host.textContent).not.toContain("Resume previous work");
    await click("Explore demo");
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(saveWorkspaceRecovery).toHaveBeenCalled();
    expect(
      vi
        .mocked(saveWorkspaceRecovery)
        .mock.calls.every((call) => call[2] === "window-two"),
    ).toBe(true);
    await act(async () => window.dispatchEvent(new Event("beforeunload")));
    expect(vi.mocked(saveWorkspaceRecovery).mock.calls.at(-1)?.[2]).toBe(
      "window-two",
    );
  });

  it("preserves history before clearing a closed window and suppresses later unload autosave", async () => {
    await render();
    await click("Explore demo");
    await closeEditor();
    await click("Keep recovery and continue");
    expect(saveDocumentRecovery).toHaveBeenCalled();
    expect(clearWorkspaceRecovery).toHaveBeenCalledWith("window-two");
    expect(desktop.confirmCloseDocument).toHaveBeenCalled();
    const saves = vi.mocked(saveWorkspaceRecovery).mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saveWorkspaceRecovery).toHaveBeenCalledTimes(saves);
    expect(
      vi.mocked(saveDocumentRecovery).mock.invocationCallOrder.at(-1),
    ).toBeLessThan(
      vi.mocked(clearWorkspaceRecovery).mock.invocationCallOrder.at(-1)!,
    );
  });

  it("allows an approved close while retaining the workspace when history preservation fails", async () => {
    await render();
    await click("Explore demo");
    await act(async () => vi.advanceTimersByTimeAsync(750));
    vi.mocked(saveDocumentRecovery).mockRejectedValue(
      new Error("Recovery storage is full"),
    );
    await closeEditor();
    await click("Discard changes");
    expect(clearWorkspaceRecovery).not.toHaveBeenCalled();
    expect(desktop.confirmCloseDocument).toHaveBeenCalled();
    const saves = vi.mocked(saveWorkspaceRecovery).mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("beforeunload")));
    expect(saveWorkspaceRecovery).toHaveBeenCalledTimes(saves + 1);
  });

  it("allows an approved close when clearing the workspace fails", async () => {
    await render();
    await click("Explore demo");
    vi.mocked(clearWorkspaceRecovery).mockRejectedValueOnce(
      new Error("Recovery cleanup failed"),
    );
    await closeEditor();
    await click("Discard changes");
    expect(clearWorkspaceRecovery).toHaveBeenCalledWith("window-two");
    expect(desktop.confirmCloseDocument).toHaveBeenCalled();
    const saves = vi.mocked(saveWorkspaceRecovery).mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("beforeunload")));
    expect(saveWorkspaceRecovery).toHaveBeenCalledTimes(saves + 1);
  });

  it("restores recovery writes if native close confirmation fails after cleanup", async () => {
    await render();
    await click("Explore demo");
    desktop.confirmCloseDocument.mockRejectedValueOnce(
      new Error("Native close failed"),
    );
    await closeEditor();
    await click("Discard changes");
    expect(clearWorkspaceRecovery).toHaveBeenCalledWith("window-two");
    expect(host.textContent).toContain("Native close failed");
    expect(vi.mocked(saveWorkspaceRecovery).mock.calls.at(-1)?.[2]).toBe(
      "window-two",
    );
    const saves = vi.mocked(saveWorkspaceRecovery).mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("beforeunload")));
    expect(saveWorkspaceRecovery).toHaveBeenCalledTimes(saves + 1);
  });

  it("keeps the existing resume workspace available in the main chooser window", async () => {
    desktop.workspaceId = "main";
    await render();
    expect(loadRecovery).toHaveBeenCalled();
    expect(loadWorkspaceRecovery).toHaveBeenCalledWith("main");
    expect(host.textContent).toContain("Resume previous work");
    expect(saveWorkspaceRecovery).not.toHaveBeenCalled();
  });
  async function editNotes(value: string) {
    const input = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Speaker notes"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("keeps a secondary window open if editing continues during history preservation", async () => {
    let finishHistory!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishHistory = resolve;
    });
    await render();
    await click("Explore demo");
    vi.mocked(saveDocumentRecovery).mockImplementationOnce(async () => {
      await pending;
      return "indexeddb";
    });
    await closeEditor();
    await click("Discard changes");
    await editNotes("Newer notes during history preservation");
    await act(async () => finishHistory());
    expect(clearWorkspaceRecovery).not.toHaveBeenCalled();
    expect(desktop.confirmCloseDocument).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(vi.mocked(saveWorkspaceRecovery).mock.calls.at(-1)).toEqual([
      expect.objectContaining({
        slides: expect.arrayContaining([
          expect.objectContaining({
            notes: "Newer notes during history preservation",
          }),
        ]),
      }),
      expect.any(Array),
      "window-two",
      expect.objectContaining({ unsaved: true, sessionId: expect.any(String) }),
    ]);
  });

  it("restores a cleared secondary slot and aborts closing when a new edit arrives during cleanup", async () => {
    let finishCleanup!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    await render();
    await click("Explore demo");
    vi.mocked(clearWorkspaceRecovery).mockImplementationOnce(async () => {
      await pending;
    });
    await closeEditor();
    await click("Discard changes");
    expect(clearWorkspaceRecovery).toHaveBeenCalledWith("window-two");
    await editNotes("Newer notes during cleanup");
    await act(async () => finishCleanup());
    expect(desktop.confirmCloseDocument).not.toHaveBeenCalled();
    expect(vi.mocked(saveWorkspaceRecovery).mock.calls.at(-1)).toEqual([
      expect.objectContaining({
        slides: expect.arrayContaining([
          expect.objectContaining({ notes: "Newer notes during cleanup" }),
        ]),
      }),
      expect.any(Array),
      "window-two",
      expect.objectContaining({ unsaved: true, sessionId: expect.any(String) }),
    ]);
    const saves = vi.mocked(saveWorkspaceRecovery).mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("beforeunload")));
    expect(saveWorkspaceRecovery).toHaveBeenCalledTimes(saves + 1);
  });
});
