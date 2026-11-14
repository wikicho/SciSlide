// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { DesktopApi, DesktopCommand } from "../src/lib/desktop";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type { Deck } from "../src/lib/model";
import {
  buildDeckArchive,
  loadRecovery,
  readDeckArchive,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

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
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));

function deck(name: string): Deck {
  return {
    ...createDemoDeck(),
    id: `deck-${name}`,
    title: `Talk ${name}`,
    slides: [
      {
        ...createBlankSlide(),
        id: `slide-${name}`,
        title: `Slide ${name}`,
        objects: [],
        notes: `Original notes ${name}`,
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}
const candidate = (name: string) => ({
  bytes: new Uint8Array([0x50, 0x4b]),
  name: `${name}.scislide`,
  path: `/talks/${name}.scislide`,
});

describe("document replacement safety", () => {
  let host: HTMLDivElement;
  let root: Root;
  let destination: string | null;
  let recovered: Deck | undefined;
  let writes: { path: string; deck: Deck }[];
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
      acceptOpenDocument: vi.fn(async (path: string) => {
        destination = path;
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

  beforeEach(() => {
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
    destination = null;
    recovered = undefined;
    writes = [];
    bridge = makeBridge();
    native.api = bridge as unknown as DesktopApi;
    vi.mocked(loadRecovery).mockReset().mockReturnValue(null);
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (value) => {
        recovered = structuredClone(value);
        return "localStorage";
      });
    vi.mocked(readDeckArchive).mockReset();
    vi.mocked(buildDeckArchive)
      .mockReset()
      .mockImplementation(async (value) => {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        const archive = new Blob([bytes]);
        Object.defineProperty(archive, "arrayBuffer", {
          value: async () => bytes.buffer,
        });
        return archive;
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
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.textContent?.trim() === label ||
        element.getAttribute("aria-label") === label ||
        element.getAttribute("aria-label")?.startsWith(`${label} · `),
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function command(value: DesktopCommand) {
    await act(async () => native.command!(value));
  }
  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return structuredClone(recovered!);
  }
  async function startA() {
    bridge.takeOpenDocument.mockResolvedValueOnce(candidate("A"));
    vi.mocked(readDeckArchive).mockResolvedValueOnce(deck("A"));
    await act(async () => root.render(createElement(App)));
    expect(destination).toBe("/talks/A.scislide");
    expect(await persist()).toEqual(deck("A"));
  }
  async function editA() {
    const field = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Speaker notes"]',
    )!;
    expect(field).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(field, "Unsaved A edits");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.blur();
    });
    expect((await persist()).slides[0].notes).toBe("Unsaved A edits");
  }
  async function openB() {
    bridge.openDocument.mockResolvedValueOnce(candidate("B"));
    vi.mocked(readDeckArchive).mockResolvedValueOnce(deck("B"));
    await command("open");
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(destination).toBe("/talks/A.scislide");
  }
  function expectCurrentA(current: Deck) {
    expect(current.id).toBe("deck-A");
    expect(current.slides[0].notes).toBe("Unsaved A edits");
    expect(destination).toBe("/talks/A.scislide");
    expect(
      host.querySelector('[aria-label="Document save status"]')?.textContent,
    ).toBe("Unsaved changes");
  }

  it("discards A, opens B with a fresh history, and saves only B to B's path after Undo", async () => {
    await startA();
    await editA();
    await openB();
    await click("Discard changes");
    expect(await persist()).toEqual(deck("B"));
    expect(destination).toBe("/talks/B.scislide");
    expect(button("Undo").disabled).toBe(true);
    await command("undo");
    await command("save");
    expect(writes).toEqual([{ path: "/talks/B.scislide", deck: deck("B") }]);
  });

  it("cancel keeps A's edits and Save destination", async () => {
    await startA();
    await editA();
    await openB();
    await click("Cancel");
    expectCurrentA(await persist());
    expect(bridge.acceptOpenDocument).toHaveBeenCalledTimes(1);
    await command("save");
    expect(writes[0].path).toBe("/talks/A.scislide");
    expect(writes[0].deck.slides[0].notes).toBe("Unsaved A edits");
  });

  it("an invalid archive keeps A's content, history and Save destination", async () => {
    await startA();
    await editA();
    bridge.openDocument.mockResolvedValueOnce(candidate("B"));
    vi.mocked(readDeckArchive).mockRejectedValueOnce(
      new Error("Invalid archive"),
    );
    await command("open");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expectCurrentA(await persist());
    expect(button("Undo").disabled).toBe(false);
    expect(bridge.acceptOpenDocument).toHaveBeenCalledTimes(1);
    await command("save");
    expect(writes[0].path).toBe("/talks/A.scislide");
  });

  it.each(["cancel", "failure"] as const)(
    "a %s while saving A aborts opening B",
    async (result) => {
      await startA();
      await editA();
      await openB();
      if (result === "cancel")
        bridge.saveDocument.mockResolvedValueOnce(null as never);
      else bridge.saveDocument.mockRejectedValueOnce(new Error("Disk is full"));
      await click("Save changes");
      expectCurrentA(await persist());
      expect(bridge.acceptOpenDocument).toHaveBeenCalledTimes(1);
      expect(writes).toEqual([]);
      await command("save");
      expect(writes[0].path).toBe("/talks/A.scislide");
      expect(writes[0].deck.slides[0].notes).toBe("Unsaved A edits");
    },
  );

  it("Save changes writes A before accepting B and starts B with a clean history", async () => {
    await startA();
    await editA();
    await openB();
    await click("Save changes");
    expect(writes[0].path).toBe("/talks/A.scislide");
    expect(writes[0].deck.slides[0].notes).toBe("Unsaved A edits");
    expect(await persist()).toEqual(deck("B"));
    expect(destination).toBe("/talks/B.scislide");
    expect(button("Undo").disabled).toBe(true);
  });

  it("creating a new presentation resets the old document's destination and Undo history", async () => {
    await startA();
    await editA();
    await command("new");
    await click("Create presentation");
    await click("Discard changes");
    const created = await persist();
    expect(created.id).not.toBe("deck-A");
    expect(destination).toBeNull();
    expect(button("Undo").disabled).toBe(true);
    await command("undo");
    expect(await persist()).toEqual(created);
    await command("save");
    expect(writes).toEqual([
      { path: "/saved/Untitled presentation.scislide", deck: created },
    ]);
  });

  it("close cancellation keeps editing A and discard confirms the native close", async () => {
    await startA();
    await editA();
    await act(async () => native.close!());
    await click("Cancel");
    expectCurrentA(await persist());
    expect(bridge.confirmCloseDocument).not.toHaveBeenCalled();
    await act(async () => native.close!());
    await click("Discard changes");
    expect(bridge.confirmCloseDocument).toHaveBeenCalledOnce();
  });

  it("leaves clipboard and history shortcuts native in title and modal input fields", async () => {
    await startA();
    const title = host.querySelector<HTMLInputElement>(
      '[aria-label="Presentation title"]',
    )!;
    const check = async (target: HTMLElement) => {
      await act(async () => target.focus());
      for (const [key, shiftKey] of [
        ["c", false],
        ["x", false],
        ["v", false],
        ["a", false],
        ["z", false],
        ["z", true],
      ] as const) {
        const event = new KeyboardEvent("keydown", {
          key,
          shiftKey,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        await act(async () => target.dispatchEvent(event));
        expect(event.defaultPrevented, `${key}, shift=${shiftKey}`).toBe(false);
      }
    };
    await check(title);
    await act(async () =>
      host.querySelector<HTMLElement>('[aria-label="Insert menu"]')!.click(),
    );
    await click("My equations");
    const search = host.querySelector<HTMLInputElement>(
      '[aria-label="Search saved equations"]',
    )!;
    expect(search).toBeTruthy();
    await check(search);
    expect(await persist()).toEqual(deck("A"));
    expect(writes).toEqual([]);
  });
});
