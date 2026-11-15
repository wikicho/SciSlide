// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createBlankSlide, createDemoDeck, type Deck } from "../src/lib/model";
import { loadRecovery, readDeckArchive } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";
import {
  deleteDocumentRecovery,
  listDocumentRecoveries,
  loadDocumentRecovery,
  saveDocumentRecovery,
} from "../src/lib/recovery-history";

vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  desktop: undefined,
}));
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
  readDeckArchive: vi.fn(),
}));
vi.mock("../src/lib/workspace-recovery", async (original) => ({
  ...(await original<typeof import("../src/lib/workspace-recovery")>()),
  loadWorkspaceRecovery: vi.fn(),
  saveWorkspaceRecovery: vi.fn(),
}));
vi.mock("../src/lib/recovery-history", async (original) => ({
  ...(await original<typeof import("../src/lib/recovery-history")>()),
  saveDocumentRecovery: vi.fn(),
  listDocumentRecoveries: vi.fn(),
  loadDocumentRecovery: vi.fn(),
  deleteDocumentRecovery: vi.fn(),
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

type Storage = "indexeddb" | "localStorage";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function presentation(title: string, id = "deck-A"): Deck {
  return {
    ...createDemoDeck(),
    id,
    title,
    slides: [
      {
        ...createBlankSlide(),
        id: "slide-A",
        title: `${title} slide`,
        objects: [],
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("workspace and document-history status in the editor", () => {
  let host: HTMLDivElement, root: Root;
  const initial = presentation("Talk A");
  const failure = "History quota reached. Review older recovery copies.";

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
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
    vi.mocked(loadRecovery)
      .mockReset()
      .mockReturnValue(structuredClone(initial));
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery).mockReset().mockResolvedValue("indexeddb");
    vi.mocked(saveDocumentRecovery).mockReset().mockResolvedValue("indexeddb");
    vi.mocked(listDocumentRecoveries)
      .mockReset()
      .mockResolvedValue({ entries: [], unavailableCount: 0 });
    vi.mocked(loadDocumentRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(deleteDocumentRecovery).mockReset().mockResolvedValue(undefined);
    vi.mocked(readDeckArchive).mockReset();
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

  function findButton(label: string) {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label,
    );
  }
  async function click(label: string) {
    const target = findButton(label);
    if (!target) throw new Error(`Missing button: ${label}`);
    await act(async () => target.click());
  }
  async function start() {
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
  }
  async function tick(milliseconds = 710) {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
  }
  const status = () => host.querySelector(".recovery-state")?.textContent ?? "";
  const title = () =>
    host.querySelector<HTMLInputElement>('[aria-label="Presentation title"]')!
      .value;
  async function editTitle(value: string) {
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Presentation title"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function upload(next: Deck) {
    vi.mocked(readDeckArchive).mockResolvedValueOnce(next);
    const input = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].find((element) => element.accept.includes(".scislide"))!;
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["archive"], "reopened.scislide")],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("keeps a history failure visible after the toast expires while the current workspace is saved", async () => {
    vi.mocked(saveDocumentRecovery).mockRejectedValueOnce(new Error(failure));
    await start();
    await tick();

    expect(saveWorkspaceRecovery).toHaveBeenCalledWith(initial, []);
    expect(saveDocumentRecovery).toHaveBeenCalledWith(
      expect.any(String),
      initial,
      [],
    );
    expect(status()).toMatch(/saved.*history needs attention/i);
    expect(findButton("Review recovered documents")).toBeTruthy();

    await tick(5000);
    expect(host.querySelector(".toast")).toBeNull();
    expect(host.textContent).toContain(failure);
    expect(status()).toMatch(/history needs attention/i);
    expect(findButton("Review recovered documents")?.disabled).toBe(false);
  });

  it("opens the existing recovery list from the persistent warning without changing the open presentation", async () => {
    vi.mocked(saveDocumentRecovery).mockRejectedValue(new Error(failure));
    vi.mocked(listDocumentRecoveries).mockResolvedValue({
      entries: [
        {
          id: "older-session",
          deckId: "older-deck",
          title: "Older conference talk",
          savedAt: "2026-11-14T00:00:00.000Z",
          slideCount: 2,
          draftCount: 0,
          bytes: 2048,
        },
      ],
      unavailableCount: 0,
    });
    await start();
    await tick();
    await click("Review recovered documents");

    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Recovered documents");
    expect(dialog?.textContent).toContain("Older conference talk");
    expect(listDocumentRecoveries).toHaveBeenCalledOnce();
    expect(title()).toBe(initial.title);
    expect(loadDocumentRecovery).not.toHaveBeenCalled();
    expect(deleteDocumentRecovery).not.toHaveBeenCalled();

    await click("Close recovered documents");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain(failure);
    expect(findButton("Review recovered documents")).toBeTruthy();
    expect(title()).toBe(initial.title);
  });

  it("clears the warning after a successful history retry for the same editing session", async () => {
    vi.mocked(saveDocumentRecovery).mockRejectedValueOnce(new Error(failure));
    await start();
    await tick();
    await tick(5000);
    const sessionId = vi.mocked(saveDocumentRecovery).mock.calls[0][0];
    expect(findButton("Review recovered documents")).toBeTruthy();

    await editTitle("Talk A revised");
    await tick();
    const latest = vi.mocked(saveDocumentRecovery).mock.calls.at(-1)!;
    expect(latest[0]).toBe(sessionId);
    expect(latest[1].title).toBe("Talk A revised");
    expect(status()).toMatch(/saved/i);
    expect(status()).not.toMatch(/history needs attention/i);
    expect(host.textContent).not.toContain(failure);
    expect(findButton("Review recovered documents")).toBeUndefined();
  });

  it("keeps the latest warning when a closed recovery-list request finishes saving an older snapshot", async () => {
    const previousPreservation = deferred<Storage>();
    const latestFailure = "The latest revision could not be added to history.";
    vi.mocked(saveDocumentRecovery)
      .mockRejectedValueOnce(new Error(failure))
      .mockReturnValueOnce(previousPreservation.promise)
      .mockRejectedValueOnce(new Error(latestFailure));
    await start();
    await tick();
    await click("Review recovered documents");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Loading recovered documents",
    );
    expect(saveDocumentRecovery).toHaveBeenCalledTimes(2);

    await click("Close recovered documents");
    await editTitle("Talk A latest revision");
    await tick();
    expect(saveDocumentRecovery).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(saveDocumentRecovery).mock.calls;
    expect(calls[1][0]).toBe(calls[2][0]);
    expect(calls[1][1].title).toBe(initial.title);
    expect(calls[2][1].title).toBe("Talk A latest revision");
    await tick(5000);
    expect(host.querySelector(".toast")).toBeNull();
    expect(host.textContent).toContain(latestFailure);

    await act(async () => previousPreservation.resolve("indexeddb"));
    expect(title()).toBe("Talk A latest revision");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain(latestFailure);
    expect(status()).toMatch(/history needs attention/i);
    expect(findButton("Review recovered documents")?.disabled).toBe(false);
  });

  it("ignores late history failure and workspace completion after reopening the same document ID in a new session", async () => {
    const oldHistory = deferred<Storage>();
    const oldWorkspace = deferred<Storage>();
    vi.mocked(saveDocumentRecovery).mockReturnValueOnce(oldHistory.promise);
    vi.mocked(saveWorkspaceRecovery).mockReturnValueOnce(oldWorkspace.promise);
    await start();
    await tick();
    const oldSession = vi.mocked(saveDocumentRecovery).mock.calls[0][0];

    await upload(presentation("Talk A reopened", initial.id));
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click("Discard changes");
    await tick();
    expect(title()).toBe("Talk A reopened");
    expect(vi.mocked(saveDocumentRecovery).mock.calls.at(-1)![0]).not.toBe(
      oldSession,
    );
    expect(status()).toMatch(/saved/i);

    await act(async () => {
      oldHistory.reject(new Error("Old session history failed"));
      oldWorkspace.resolve("localStorage");
    });
    expect(title()).toBe("Talk A reopened");
    expect(host.textContent).not.toContain("Old session history failed");
    expect(status()).not.toMatch(/history needs attention|limited storage/i);
    expect(findButton("Review recovered documents")).toBeUndefined();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
