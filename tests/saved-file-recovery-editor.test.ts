// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { DesktopApi, DesktopCommand } from "../src/lib/desktop";
import { createBlankSlide, createDemoDeck, type Deck } from "../src/lib/model";
import {
  buildDeckArchive,
  loadRecovery,
  readDeckArchive,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
  type RecoveredEquationDraft,
  type RecoveryContext,
  type WorkspaceRecovery,
} from "../src/lib/workspace-recovery";
import { saveDocumentRecovery } from "../src/lib/recovery-history";

const native = vi.hoisted(() => ({
  api: undefined as DesktopApi | undefined,
  command: undefined as ((command: DesktopCommand) => void) | undefined,
  close: undefined as (() => void) | undefined,
}));
vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  get desktop() {
    return native.api;
  },
}));
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
  readDeckArchive: vi.fn(),
  buildDeckArchive: vi.fn(),
}));
vi.mock("../src/lib/workspace-recovery", async (original) => ({
  ...(await original<typeof import("../src/lib/workspace-recovery")>()),
  loadWorkspaceRecovery: vi.fn(),
  saveWorkspaceRecovery: vi.fn(),
}));
vi.mock("../src/lib/recovery-history", async (original) => ({
  ...(await original<typeof import("../src/lib/recovery-history")>()),
  saveDocumentRecovery: vi.fn(),
}));
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));
vi.mock("../src/components/SlideScene", () => ({
  SlideScene: ({ slide }: { slide: { title: string } }) =>
    createElement(
      "svg",
      { className: "slide-scene", viewBox: "0 0 1600 900" },
      createElement("text", null, slide.title),
    ),
}));

function presentation(): Deck {
  return {
    ...createDemoDeck(),
    id: "saved-recovery-deck",
    title: "Saved talk",
    slides: [
      {
        ...createBlankSlide(),
        id: "saved-recovery-slide",
        title: "Saved slide",
        notes: "Original notes",
        objects: [],
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("saved-file provenance across editor restart", () => {
  let host: HTMLDivElement;
  let root: Root;
  let recovery: WorkspaceRecovery | null;
  let destination: string | null;
  let writes: Array<{ path: string; deck: Deck }>;
  let bridge: ReturnType<typeof makeBridge>;

  function makeBridge() {
    return {
      platform: "linux",
      setCommandAvailability: vi.fn().mockResolvedValue(undefined),
      detectTex: vi.fn().mockResolvedValue({
        available: false,
        engines: [],
        sandbox: { available: false },
      }),
      openDocument: vi.fn().mockResolvedValue(null),
      takeOpenDocument: vi.fn().mockResolvedValue(null),
      acceptOpenDocument: vi.fn(async (filename: string) => {
        destination = filename;
      }),
      clearDocument: vi.fn(async () => {
        destination = null;
      }),
      saveDocument: vi.fn(
        async (request: { bytes: Uint8Array; suggestedName: string }) => {
          destination ??= `/saved/${request.suggestedName}`;
          writes.push({
            path: destination,
            deck: JSON.parse(new TextDecoder().decode(request.bytes)) as Deck,
          });
          return { path: destination, name: destination.split("/").at(-1)! };
        },
      ),
      onCommand: (callback: (command: DesktopCommand) => void) => {
        native.command = callback;
        return () => {
          native.command = undefined;
        };
      },
      onCloseDocument: (callback: () => void) => {
        native.close = callback;
        return () => {
          native.close = undefined;
        };
      },
      confirmCloseDocument: vi.fn().mockResolvedValue(undefined),
    };
  }

  function captureRecovery(
    deck: Deck,
    drafts: RecoveredEquationDraft[] = [],
    context: RecoveryContext = {},
  ) {
    recovery = structuredClone({
      deck,
      equationDrafts: drafts,
      savedAt: new Date().toISOString(),
      ...context,
    });
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", undefined);
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
    recovery = null;
    destination = null;
    writes = [];
    bridge = makeBridge();
    native.api = bridge as unknown as DesktopApi;
    vi.mocked(loadRecovery).mockReset().mockReturnValue(null);
    vi.mocked(loadWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async () => structuredClone(recovery));
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck, drafts = [], context) => {
        captureRecovery(deck, drafts, context);
        return "localStorage";
      });
    vi.mocked(saveDocumentRecovery)
      .mockReset()
      .mockResolvedValue("localStorage");
    vi.mocked(readDeckArchive).mockReset();
    vi.mocked(buildDeckArchive)
      .mockReset()
      .mockImplementation(async (deck) => {
        const bytes = new TextEncoder().encode(JSON.stringify(deck));
        const blob = new Blob([bytes]);
        Object.defineProperty(blob, "arrayBuffer", {
          value: async () => bytes.buffer,
        });
        return blob;
      });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    native.api = undefined;
    native.command = undefined;
    native.close = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function button(label: string) {
    const match = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label,
    );
    if (!match) throw new Error(`Missing button: ${label}`);
    return match;
  }
  const click = async (label: string) => {
    await act(async () => button(label).click());
  };
  const command = async (value: DesktopCommand) => {
    await act(async () => native.command!(value));
  };
  const close = async () => {
    await act(async () => native.close!());
  };
  const tick = async () => {
    await act(async () => vi.advanceTimersByTimeAsync(710));
  };
  const status = () =>
    host.querySelector('[aria-label="Document save status"]')?.textContent;
  const notes = () =>
    host.querySelector<HTMLTextAreaElement>('[aria-label="Speaker notes"]')!
      .value;
  const snapshot = () => structuredClone(recovery!);
  async function editNotes(value: string) {
    const field = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Speaker notes"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.blur();
    });
  }
  async function openNative() {
    bridge.takeOpenDocument.mockResolvedValueOnce({
      path: "/talks/A.scislide",
      name: "A.scislide",
      bytes: new Uint8Array([0x50, 0x4b]),
    });
    vi.mocked(readDeckArchive).mockResolvedValueOnce(presentation());
    await act(async () => root.render(createElement(App)));
    expect(destination).toBe("/talks/A.scislide");
  }
  async function restart() {
    await act(async () => root.unmount());
    // A fresh host has no native write destination. Recovery metadata does not
    // confer authority to overwrite the original path.
    destination = null;
    bridge = makeBridge();
    native.api = bridge as unknown as DesktopApi;
    root = createRoot(host);
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
  }

  it("checkpoints a native Save before the autosave delay and resumes it without a false close warning", async () => {
    await openNative();
    await editNotes("Revision saved to the native file");
    await command("save");

    expect(writes).toEqual([
      {
        path: "/talks/A.scislide",
        deck: expect.objectContaining({
          slides: [expect.objectContaining({ notes: notes() })],
        }),
      },
    ]);
    expect(status()).toBe("Saved to file");
    expect(saveWorkspaceRecovery).toHaveBeenCalled();
    expect(snapshot().file).toEqual({ name: "A.scislide", kind: "saved" });
    expect(snapshot().unsaved).toBeUndefined();
    const sessionId = snapshot().sessionId;
    expect(sessionId).toEqual(expect.any(String));

    await close();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(bridge.confirmCloseDocument).toHaveBeenCalledOnce();

    await restart();
    expect(notes()).toBe("Revision saved to the native file");
    expect(status()).toBe("Recovered saved copy");
    expect(host.querySelector(".document-filename")?.textContent).toBe(
      "A.scislide",
    );
    expect(destination).toBeNull();
    await close();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(bridge.confirmCloseDocument).toHaveBeenCalledOnce();

    await tick();
    expect(snapshot().sessionId).toBe(sessionId);
    expect(vi.mocked(saveDocumentRecovery).mock.calls.at(-1)?.[0]).toBe(
      sessionId,
    );
  });

  it("awaits the saved-file checkpoint and does not close while it is pending", async () => {
    const checkpoint = deferred<"localStorage">();
    await openNative();
    await editNotes("Pending checkpoint");
    vi.mocked(saveWorkspaceRecovery).mockImplementationOnce(
      async (deck, drafts = [], context) => {
        await checkpoint.promise;
        captureRecovery(deck, drafts, context);
        return "localStorage";
      },
    );
    await command("save");
    expect(writes).toHaveLength(1);
    expect(status()).toBe("Saving…");
    await close();
    expect(bridge.confirmCloseDocument).not.toHaveBeenCalled();

    await act(async () => checkpoint.resolve("localStorage"));
    expect(status()).toBe("Saved to file");
    const closeCheckpoint = deferred<"localStorage">();
    vi.mocked(saveWorkspaceRecovery).mockImplementationOnce(
      async (deck, drafts = [], context) => {
        await closeCheckpoint.promise;
        captureRecovery(deck, drafts, context);
        return "localStorage";
      },
    );
    await close();
    expect(bridge.confirmCloseDocument).not.toHaveBeenCalled();
    await act(async () => closeCheckpoint.resolve("localStorage"));
    expect(bridge.confirmCloseDocument).toHaveBeenCalledOnce();
    await restart();
    expect(notes()).toBe("Pending checkpoint");
    expect(status()).toBe("Recovered saved copy");
  });

  it("keeps a later edit unsaved after restarting, without losing its history session", async () => {
    await openNative();
    await command("save");
    const sessionId = snapshot().sessionId;
    await editNotes("Edited after the file save");
    await tick();
    expect(status()).toBe("Unsaved changes");
    expect(snapshot().file).toBeUndefined();
    expect(snapshot().unsaved).toBe(true);

    await restart();
    expect(notes()).toBe("Edited after the file save");
    expect(status()).toBe("Unsaved changes");
    await close();
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(bridge.confirmCloseDocument).not.toHaveBeenCalled();
    await click("Cancel");
    await tick();
    expect(snapshot().sessionId).toBe(sessionId);
    expect(vi.mocked(saveDocumentRecovery).mock.calls.at(-1)?.[0]).toBe(
      sessionId,
    );
  });

  it("does not label edits made during the native Save as part of its acknowledged snapshot", async () => {
    const acknowledgment = deferred<void>();
    await openNative();
    await editNotes("The revision being saved");
    bridge.saveDocument.mockImplementationOnce(async (request) => {
      const saved = JSON.parse(new TextDecoder().decode(request.bytes)) as Deck;
      await acknowledgment.promise;
      writes.push({ path: destination!, deck: saved });
      return { path: destination!, name: "A.scislide" };
    });
    await command("save");
    await editNotes("A later edit while the file save was pending");
    await act(async () => acknowledgment.resolve());

    expect(writes[0].deck.slides[0].notes).toBe("The revision being saved");
    expect(notes()).toBe("A later edit while the file save was pending");
    expect(status()).toBe("Unsaved changes");
    await tick();
    expect(snapshot().file).toBeUndefined();
    expect(snapshot().unsaved).toBe(true);
    expect(snapshot().deck.slides[0].notes).toBe(
      "A later edit while the file save was pending",
    );
    await restart();
    expect(notes()).toBe("A later edit while the file save was pending");
    expect(status()).toBe("Unsaved changes");
    await close();
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(bridge.confirmCloseDocument).not.toHaveBeenCalled();
    await click("Cancel");
  });

  it.each(["cancel", "failure"] as const)(
    "does not mark edited recovery saved when native Save ends in %s",
    async (result) => {
      await openNative();
      await editNotes("Only kept in local recovery");
      if (result === "cancel")
        bridge.saveDocument.mockResolvedValueOnce(null as never);
      else bridge.saveDocument.mockRejectedValueOnce(new Error("Disk is full"));
      await command("save");
      expect(writes).toEqual([]);
      expect(status()).toBe("Unsaved changes");
      await tick();
      expect(snapshot().file).toBeUndefined();
      expect(snapshot().unsaved).toBe(true);

      await restart();
      expect(notes()).toBe("Only kept in local recovery");
      expect(status()).toBe("Unsaved changes");
      await close();
      expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
      expect(bridge.confirmCloseDocument).not.toHaveBeenCalled();
      await click("Cancel");
    },
  );

  it("preserves the acknowledged file save if the immediate local checkpoint fails", async () => {
    await openNative();
    await editNotes("Actually saved on disk");
    vi.mocked(saveWorkspaceRecovery).mockRejectedValueOnce(
      new Error("Recovery storage unavailable"),
    );
    await command("save");
    expect(writes).toHaveLength(1);
    expect(writes[0].deck.slides[0].notes).toBe("Actually saved on disk");
    expect(status()).toBe("Saved to file");
    await close();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(bridge.confirmCloseDocument).toHaveBeenCalledOnce();
  });

  it("keeps recovered equation drafts local and still requires a close choice", async () => {
    const deck = presentation();
    const equation = createDemoDeck()
      .slides.flatMap((slide) => slide.objects)
      .find((object) => object.type === "equation")!;
    deck.slides[0].objects = [
      { ...structuredClone(equation), id: "local-equation" },
    ];
    const draft: RecoveredEquationDraft = {
      deckId: deck.id,
      slideId: deck.slides[0].id,
      equationId: "local-equation",
      updatedAt: "2026-11-18T00:00:00.000Z",
      draft: {
        latex: "x_{not_applied}=42",
        font: "mathjax-modern",
        size: 48,
        color: "#123456",
        renderer: "mathjax",
        engine: "latex",
        preamble: "",
      },
    };
    captureRecovery(deck, [draft], {
      file: { name: "A.scislide", kind: "saved" },
      sessionId: "saved-session-with-draft",
    });
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    expect(status()).toBe("Recovered saved copy");
    expect(button("Review equation drafts").textContent).toContain("1");
    await close();
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(button("Save changes").disabled).toBe(true);
    expect(bridge.confirmCloseDocument).not.toHaveBeenCalled();
    await click("Cancel");

    await command("save");
    expect(writes).toHaveLength(1);
    expect(writes[0].deck.slides[0].objects[0]).toHaveProperty(
      "latex",
      equation.latex,
    );
    expect(snapshot().equationDrafts).toEqual([draft]);
    expect(snapshot().sessionId).toBe("saved-session-with-draft");
  });

  it("retains browser-download wording instead of presenting a recovered download as a native save", async () => {
    captureRecovery(presentation(), [], {
      file: { name: "Downloaded talk.scislide", kind: "downloaded" },
      sessionId: "download-session",
    });
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    expect(status()).toBe("Downloaded .scislide");
    expect(destination).toBeNull();
    expect(host.querySelector(".document-filename")?.textContent).toBe(
      "Downloaded talk.scislide",
    );
  });

  it("keeps legacy recovery without saved-file metadata unsaved", async () => {
    captureRecovery(presentation());
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    expect(status()).toBe("Recovered local copy");
    expect(snapshot().unsaved).toBeUndefined();
    expect(host.querySelector(".document-filename")).toBeNull();
    await close();
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(bridge.confirmCloseDocument).not.toHaveBeenCalled();
    await click("Cancel");
  });
});
