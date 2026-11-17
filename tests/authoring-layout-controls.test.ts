// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import {
  createBlankSlide,
  createDemoDeck,
  DEFAULT_PAGE_NUMBERS,
  type Deck,
  type TextObject,
} from "../src/lib/model";
import { cloneDeck } from "../src/lib/deck-editing";
import { shapeFromDrag } from "../src/lib/drawing";
import {
  loadRecovery,
  readDeckArchive,
  downloadBlob,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";
import { exportDeckPdf } from "../src/lib/export";
import * as layouts from "../src/lib/user-layouts";

vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  desktop: undefined,
}));
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
  readDeckArchive: vi.fn(),
  downloadBlob: vi.fn(),
}));
vi.mock("../src/lib/workspace-recovery", async (original) => ({
  ...(await original<typeof import("../src/lib/workspace-recovery")>()),
  loadWorkspaceRecovery: vi.fn(),
  saveWorkspaceRecovery: vi.fn(),
}));
vi.mock("../src/lib/recovery-history", () => ({
  saveDocumentRecovery: vi.fn(async () => "localStorage"),
  listDocumentRecoveries: vi.fn(async () => ({
    entries: [],
    unavailableCount: 0,
  })),
  loadDocumentRecovery: vi.fn(async () => null),
  deleteDocumentRecovery: vi.fn(async () => undefined),
}));
vi.mock("../src/lib/user-layouts", async (original) => {
  const real = await original<typeof import("../src/lib/user-layouts")>();
  return {
    ...real,
    listUserSlideLayouts: vi.fn(real.listUserSlideLayouts),
    saveUserSlideLayout: vi.fn(real.saveUserSlideLayout),
    deleteUserSlideLayout: vi.fn(real.deleteUserSlideLayout),
  };
});
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));

function presentation(): Deck {
  const demo = createDemoDeck();
  const text = demo.slides
    .flatMap((slide) => slide.objects)
    .find((object): object is TextObject => object.type === "text")!;
  const frame = shapeFromDrag("rect", { x: 100, y: 120 }, { x: 900, y: 320 });
  frame.id = "layout-frame";
  frame.groupId = "layout-group";
  frame.build = { step: 1, effect: "appear", durationMs: 300 };
  return {
    ...demo,
    id: "authoring-layout-deck",
    title: "Authoring controls",
    assets: [],
    pageNumbers: {
      ...DEFAULT_PAGE_NUMBERS,
      enabled: true,
      format: "number-total",
      hideFirst: false,
      startAt: 7,
    },
    slides: [
      {
        ...createBlankSlide(),
        id: "layout-source",
        title: "Layout source",
        notes: "Source notes",
        objects: [
          frame,
          {
            ...structuredClone(text),
            id: "layout-text",
            groupId: "layout-group",
            text: "Reusable scientific content",
            transform: { x: 120, y: 140, width: 700, height: 120, rotation: 0 },
          },
        ],
      },
      {
        ...createBlankSlide(),
        id: "closing-slide",
        title: "Closing",
        notes: "Closing notes",
        objects: [],
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("authoring layout controls in the editor", () => {
  let root: Root, host: HTMLDivElement, deck: Deck, stored: Deck | undefined;
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("IntersectionObserver", undefined);
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
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as CanvasRenderingContext2D);
    localStorage.clear();
    deck = presentation();
    stored = undefined;
    vi.mocked(loadRecovery)
      .mockReset()
      .mockImplementation(() => structuredClone(deck));
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (snapshot) => {
        stored = structuredClone(snapshot);
        return "localStorage";
      });
    vi.mocked(readDeckArchive).mockReset();
    vi.mocked(downloadBlob).mockReset();
    vi.mocked(exportDeckPdf)
      .mockReset()
      .mockResolvedValue(new Blob(["PDF"], { type: "application/pdf" }));
    vi.mocked(layouts.listUserSlideLayouts).mockClear();
    vi.mocked(layouts.saveUserSlideLayout).mockClear();
    vi.mocked(layouts.deleteUserSlideLayout).mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    await layouts.listUserSlideLayouts().catch(() => undefined);
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  function control(label: string): HTMLElement {
    const result = [
      ...host.querySelectorAll<HTMLElement>("button,summary"),
    ].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label ||
        element.getAttribute("aria-label")?.startsWith(`${label} · `) ||
        element.title === label ||
        element.title?.startsWith(`${label} · `),
    );
    if (!result) throw new Error(`Missing control: ${label}`);
    return result;
  }
  async function click(label: string) {
    await act(async () => control(label).click());
  }
  async function input(label: string, value: string) {
    const field = host.querySelector<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(`[aria-label="${label}"]`)!;
    expect(field).toBeTruthy();
    await act(async () => {
      const prototype =
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : field instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        field,
        value,
      );
      field.dispatchEvent(
        new Event(field instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  }
  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return stored!;
  }
  async function start() {
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
  }
  async function manage() {
    await click("File");
    await click("User layouts");
    expect(host.querySelector(".user-layout-dialog")).toBeTruthy();
  }
  async function choose(name: string) {
    await click("Choose slide layout");
    await click(`Use ${name} user layout`);
    await persist();
  }
  async function upload(next: Deck) {
    vi.mocked(readDeckArchive).mockResolvedValueOnce(next);
    const input = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].find((field) => field.accept.includes(".scislide"))!;
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["archive"], "reopened.scislide")],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("saves the current slide from File and adds a fresh editable copy from the layout gallery", async () => {
    await start();
    const original = structuredClone(deck.slides[0]);
    await manage();
    await input("Layout name", "Results layout");
    await click("Save as new layout");
    const saved = (await layouts.listUserSlideLayouts()).entries;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Results layout");
    expect(saved[0].snapshot.slide.notes).toBe(original.notes);
    await click("Close user layouts");
    await choose("Results layout");
    const result = await persist();
    expect(result.slides).toHaveLength(3);
    const copy = result.slides[1];
    expect(copy.id).not.toBe(original.id);
    expect(copy.notes).toBe(original.notes);
    expect(copy.objects.map((object) => object.transform)).toEqual(
      original.objects.map((object) => object.transform),
    );
    expect(
      copy.objects.every(
        (object) => !original.objects.some((source) => source.id === object.id),
      ),
    ).toBe(true);
    expect(copy.objects[0].groupId).toBe(copy.objects[1].groupId);
    expect(copy.objects[0].groupId).not.toBe(original.objects[0].groupId);
    expect(result.slides[0]).toEqual(original);
    await click("Undo");
    expect((await persist()).slides).toEqual(deck.slides);
  });

  it("edits a layout copy and updates its saved entry without changing previously applied slides", async () => {
    const entry = layouts.captureUserSlideLayout(
      deck,
      deck.slides[0],
      "Reusable A",
    );
    await layouts.saveUserSlideLayout(entry);
    const earlier = layouts.instantiateUserSlideLayout(
      deck,
      deck.slides[0].id,
      entry,
    );
    const earlierSnapshot = structuredClone(earlier);
    await start();
    await manage();
    await click("Edit Reusable A layout");
    expect(host.querySelector(".user-layout-dialog")).toBeNull();
    expect((await persist()).slides).toHaveLength(4);
    await click("Toggle speaker notes");
    await input("Speaker notes", "Notes from the edited layout");
    await persist();
    await manage();
    await input("Layout name", "Reusable A revised");
    await click("Update Reusable A");
    const saved = (await layouts.listUserSlideLayouts()).entries;
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(entry.id);
    expect(saved[0].snapshot.slide.notes).toBe("Notes from the edited layout");
    expect(
      (await persist()).slides.find((slide) => slide.id === earlier.id),
    ).toEqual(earlierSnapshot);
    await click("Close user layouts");
    await choose("Reusable A revised");
    const result = await persist();
    expect(result.slides).toHaveLength(5);
    expect(
      result.slides.filter(
        (slide) => slide.notes === "Notes from the edited layout",
      ),
    ).toHaveLength(2);
    expect(result.slides.find((slide) => slide.id === earlier.id)).toEqual(
      earlierSnapshot,
    );
    expect(
      result.slides.find((slide) => slide.id === deck.slides[0].id)?.notes,
    ).toBe("Source notes");
  });

  it("cancels without saving and keeps the current slide available after a storage error", async () => {
    await start();
    await manage();
    await input("Layout name", "Cancelled");
    await click("Close user layouts");
    expect(layouts.saveUserSlideLayout).not.toHaveBeenCalled();
    expect(await persist()).toEqual(deck);
    vi.mocked(layouts.saveUserSlideLayout).mockRejectedValueOnce(
      new Error("Layout storage denied"),
    );
    await manage();
    await input("Layout name", "Could not save");
    await click("Save as new layout");
    expect(
      host.querySelector(".user-layout-dialog [role=alert]")?.textContent,
    ).toContain("Layout storage denied");
    expect((await layouts.listUserSlideLayouts()).entries).toEqual([]);
    expect(await persist()).toEqual(deck);
    await click("Close user layouts");
    expect(host.querySelector(".user-layout-dialog")).toBeNull();
  });

  it("does not revive the old layout dialog or editing target when a pending save finishes after a same-ID document reopen", async () => {
    const actual = await vi.importActual<
      typeof import("../src/lib/user-layouts")
    >("../src/lib/user-layouts");
    const gate = deferred<void>();
    vi.mocked(layouts.saveUserSlideLayout).mockImplementationOnce(
      async (entry) => {
        await gate.promise;
        return actual.saveUserSlideLayout(entry);
      },
    );
    await start();
    await manage();
    await input("Layout name", "Old session layout");
    await click("Save as new layout");
    const next = cloneDeck(deck);
    next.title = "Reopened document";
    next.slides[0].title = "New session slide";
    next.slides[0].notes = "New session notes";
    await upload(next);
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click("Discard changes");
    expect((await persist()).title).toBe(next.title);
    expect(host.querySelector(".user-layout-dialog")).toBeNull();
    await act(async () => gate.resolve());
    expect(
      (await layouts.listUserSlideLayouts()).entries.map((entry) => entry.name),
    ).toContain("Old session layout");
    expect((await persist()).slides[0].notes).toBe("New session notes");
    expect(host.querySelector(".user-layout-dialog")).toBeNull();
    await manage();
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Layout name"]')?.value,
    ).toBe("New session slide");
    expect(
      [...host.querySelectorAll(".user-layout-dialog button")].some((button) =>
        button.textContent?.startsWith("Update "),
      ),
    ).toBe(false);
  });

  it("ignores an older failed layout-list read after reopening and clears a current read error after a successful retry", async () => {
    await start();
    let reject!: (error: Error) => void;
    const oldRead = new Promise<
      Awaited<ReturnType<typeof layouts.listUserSlideLayouts>>
    >((_resolve, no) => {
      reject = no;
    });
    vi.mocked(layouts.listUserSlideLayouts).mockImplementationOnce(
      () => oldRead,
    );
    await manage();
    await click("Close user layouts");
    await manage();
    await act(async () => reject(new Error("Old layout read failed")));
    expect(host.querySelector('.user-layout-dialog [role="alert"]')).toBeNull();
    await click("Close user layouts");
    vi.mocked(layouts.listUserSlideLayouts).mockRejectedValueOnce(
      new Error("Current layout read failed"),
    );
    await manage();
    expect(
      host.querySelector('.user-layout-dialog [role="alert"]')?.textContent,
    ).toContain("Current layout read failed");
    await click("Close user layouts");
    await manage();
    expect(host.querySelector('.user-layout-dialog [role="alert"]')).toBeNull();
  });

  it("sets the first numbered slide from the document control and restores numbering with Undo", async () => {
    await start();
    await click("Document");
    const original = structuredClone(deck.pageNumbers);
    await input("First numbered slide", "2");
    expect((await persist()).pageNumbers).toMatchObject({
      firstSlide: 2,
      startAt: 7,
    });
    expect(host.querySelector(".slide-paper .slide-page-number")).toBeNull();
    await click("Undo");
    expect((await persist()).pageNumbers).toEqual(original);
    expect(
      host.querySelector(".slide-paper .slide-page-number")?.textContent,
    ).toBe("7 / 8");
  });

  it("shows the effective hide-first setting while retaining the legacy choice for switching back", async () => {
    deck.pageNumbers!.hideFirst = true;
    await start();
    await click("Document");
    const row = [...host.querySelectorAll("label.check-field")].find((item) =>
      item.textContent?.includes("Hide number on the first slide"),
    )!;
    const hideFirst = row.querySelector("input")!;
    expect(hideFirst.checked).toBe(true);
    expect(host.querySelector(".slide-paper .slide-page-number")).toBeNull();
    await input("First numbered slide", "1");
    expect(hideFirst.disabled).toBe(true);
    expect(hideFirst.checked).toBe(false);
    expect((await persist()).pageNumbers?.hideFirst).toBe(true);
    expect(
      host.querySelector(".slide-paper .slide-page-number")?.textContent,
    ).toBe("7 / 8");
    await input("First numbered slide", "legacy");
    expect(hideFirst.disabled).toBe(false);
    expect(hideFirst.checked).toBe(true);
    expect(host.querySelector(".slide-paper .slide-page-number")).toBeNull();
  });

  it("passes the PDF animation-step preference to export without changing the deck or Undo history", async () => {
    await start();
    const before = structuredClone(await persist());
    expect((control("Undo") as HTMLButtonElement).disabled).toBe(true);
    await click("Export");
    const checkbox = host.querySelector<HTMLInputElement>(
      '[aria-label="Include animation steps in PDF"]',
    )!;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false);
    await act(async () => checkbox.click());
    await click("Export PDF");
    expect(exportDeckPdf).toHaveBeenCalledExactlyOnceWith(before, {
      includeBuildSteps: true,
    });
    expect(await persist()).toEqual(before);
    expect((control("Undo") as HTMLButtonElement).disabled).toBe(true);
    await click("Export");
    const again = host.querySelector<HTMLInputElement>(
      '[aria-label="Include animation steps in PDF"]',
    )!;
    expect(again.checked).toBe(true);
    await act(async () => again.click());
    await click("Export PDF");
    expect(exportDeckPdf).toHaveBeenLastCalledWith(before);
    expect(await persist()).toEqual(before);
    expect((control("Undo") as HTMLButtonElement).disabled).toBe(true);
    expect(downloadBlob).toHaveBeenCalledTimes(2);
  });
});
