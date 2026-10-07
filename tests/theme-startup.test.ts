// @vitest-environment jsdom
import { setTimeout as pause } from "node:timers/promises";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { getDeckThemeId } from "../src/lib/deck-themes";
import { KEYNOTE_WHITE_LAYOUTS } from "../src/lib/keynote-white-layouts";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type {
  Asset,
  Deck,
  FigureObject,
  TextObject,
  VideoObject,
} from "../src/lib/model";
import {
  importFigure,
  importVideo,
  loadRecovery,
  readDeckArchive,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

// Render the real chooser and editor; only asynchronous recovery and archive
// decoding are fixtures so startup cannot depend on browser storage or dialogs.
// SVG uses the real importer; video decoding is a browser media boundary.
vi.mock("../src/lib/persistence", async (original) => {
  const real = await original<typeof import("../src/lib/persistence")>();
  return {
    ...real,
    loadRecovery: vi.fn(),
    readDeckArchive: vi.fn(),
    importFigure: vi.fn(real.importFigure),
    importVideo: vi.fn(),
  };
});
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
  return {
    ...createDemoDeck(),
    id: "previous-presentation",
    title: "Previous research talk",
    slides: [
      {
        ...createBlankSlide(),
        id: "previous-slide",
        title: "Previously edited slide",
        objects: [],
        notes: "Keep these speaker notes",
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("theme selection at presentation startup", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck | undefined;

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
    vi.mocked(loadRecovery).mockReset().mockReturnValue(null);
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        saved = structuredClone(deck);
        return "localStorage";
      });
    vi.mocked(readDeckArchive).mockReset();
    vi.mocked(importFigure).mockClear();
    vi.mocked(importVideo).mockReset();
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

  async function render() {
    await act(async () => root.render(createElement(App)));
  }

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

  function chooserHeading() {
    return [...host.querySelectorAll("h1,h2")].find(
      (element) => element.textContent?.trim() === "Choose your theme.",
    );
  }

  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return saved;
  }

  async function upload(file: File) {
    const input = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].find((element) => element.accept.includes(".scislide"));
    if (!input) throw new Error("Missing presentation file input");
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function uploadMedia(file: File, kind: "figure" | "video") {
    const input = host.querySelector<HTMLInputElement>(
      `input[type="file"][aria-label="Insert ${kind} file"]`,
    );
    if (!input) throw new Error(`Missing ${kind} file picker`);
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function whiteLayout(id: (typeof KEYNOTE_WHITE_LAYOUTS)[number]["id"]) {
    await render();
    await click("Keynote White");
    await click("Create presentation");
    await click("Add slide");
    const layout = KEYNOTE_WHITE_LAYOUTS.find((item) => item.id === id)!;
    await click(`Use ${layout.name} layout`);
    return structuredClone((await persist())!);
  }

  async function settle(condition: () => boolean) {
    for (let index = 0; index < 30 && !condition(); index++)
      await act(async () => pause(5));
    expect(condition()).toBe(true);
  }

  it("starts at the chooser with an accessible theme selection and waits before saving a new deck", async () => {
    await render();
    expect(chooserHeading()).toBeTruthy();
    expect(
      host.querySelector(
        '[role="radiogroup"][aria-label="Presentation theme"]',
      ),
    ).toBeTruthy();
    const themes = [...host.querySelectorAll('[role="radio"]')];
    expect(themes.map((theme) => theme.getAttribute("aria-label"))).toEqual([
      "Scientific",
      "Minimal White",
      "Minimal Black",
      "Navy",
      "Keynote White",
    ]);
    expect(
      themes.filter((theme) => theme.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);
    expect(host.querySelector(".slide-paper")).toBeNull();
    expect(host.textContent).not.toContain("Resume previous work");
    await persist();
    expect(saveWorkspaceRecovery).not.toHaveBeenCalled();
  });

  it("creates a new editable title slide in the chosen theme instead of opening the demo deck", async () => {
    await render();
    await click("Minimal Black");
    expect(button("Minimal Black").getAttribute("aria-checked")).toBe("true");
    await click("Create presentation");
    expect(chooserHeading()).toBeUndefined();
    expect(host.querySelector(".slide-paper svg")).toBeTruthy();
    const current = (await persist())!;
    expect(current.slides).toHaveLength(1);
    expect(current.assets).toEqual([]);
    expect(
      current.slides[0].objects.some(
        (object) => object.type === "text" && !object.locked,
      ),
    ).toBe(true);
    expect(current.slides[0].background).not.toBe("#ffffff");
    const title = current.slides[0].objects.find(
      (object) => object.type === "text",
    ) as TextObject;
    expect(title.color).not.toBe(current.slides[0].background);
    expect(current.title).toBe("Untitled presentation");
    expect(current.slides[0].background).toBe("#080808");
  });

  it("creates Keynote White, offers its fifteen layouts, and retains them through Undo and workspace recovery", async () => {
    await render();
    await click("Keynote White");
    await click("Create presentation");
    const initial = structuredClone((await persist())!);
    expect(getDeckThemeId(initial)).toBe("keynote-white");
    expect(initial.slides).toHaveLength(1);
    expect(initial.slides[0].background).toBe("#ffffff");

    await click("Add slide");
    const cards = [
      ...host.querySelectorAll<HTMLButtonElement>(".template-card"),
    ];
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual(
      KEYNOTE_WHITE_LAYOUTS.map(({ name }) => `Use ${name} layout`),
    );
    expect(cards).toHaveLength(15);
    expect(host.querySelector(".template-count")?.textContent).toBe(
      "15 layouts",
    );
    for (const card of cards) {
      expect(
        card.querySelector("svg.slide-scene")?.getAttribute("viewBox"),
      ).toBe("0 0 1600 900");
    }
    const photos = KEYNOTE_WHITE_LAYOUTS.find(
      ({ id }) => id === "keynote-white-three-photos",
    )!;
    await click(`Use ${photos.name} layout`);
    expect(host.querySelector(".template-dialog")).toBeNull();
    const inserted = structuredClone((await persist())!);
    expect(inserted.slides).toHaveLength(2);
    expect(inserted.slides[0]).toEqual(initial.slides[0]);
    expect(inserted.slides[1].title).toBe(photos.name);
    expect(inserted.slides[1].background).toBe("#ffffff");
    expect(inserted.slides[1].objects.length).toBeGreaterThan(0);
    expect(inserted.slides[1].objects.every((object) => !object.locked)).toBe(
      true,
    );
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(initial);
    await click("Redo · Ctrl+Y");
    expect(await persist()).toEqual(inserted);

    await act(async () => root.unmount());
    root = createRoot(host);
    vi.mocked(loadWorkspaceRecovery).mockResolvedValue({
      deck: inserted,
      equationDrafts: [],
      savedAt: "2026-10-05T12:00:00.000Z",
    });
    await render();
    expect(chooserHeading()).toBeTruthy();
    await click("Resume previous work");
    expect(await persist()).toEqual(inserted);
    await click("Add slide");
    expect(host.querySelectorAll(".template-card")).toHaveLength(15);
    await click("Close slide templates");
    expect(await persist()).toEqual(inserted);
  });

  it("fills a selected photo placeholder with an imported SVG while preserving its frame and layer", async () => {
    const before = await whiteLayout("keynote-white-title-photo-alternate");
    const slide = before.slides[1];
    const frame = slide.objects.find(
      ({ metadata }) => metadata.mediaPlaceholder === "photo",
    )!;
    await click("Select Photo placeholder");
    await click("Figure");
    expect(
      button("Select Photo placeholder").getAttribute("aria-pressed"),
    ).toBe("true");
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><path d="M20 180L200 30L380 120" stroke="#26867a" fill="none"/></svg>',
      ],
      "result.svg",
      { type: "image/svg+xml" },
    );
    await uploadMedia(file, "figure");
    await settle(() => !!host.querySelector(".slide-paper image"));
    expect(importFigure).toHaveBeenCalledWith(file);
    const current = structuredClone((await persist())!);
    const asset = current.assets.find(({ name }) => name === file.name)!;
    expect(asset).toMatchObject({
      mime: "image/svg+xml",
      width: 400,
      height: 200,
    });
    const filled = current.slides[1];
    const figure = filled.objects.find(
      (object) => object.type === "figure",
    ) as FigureObject;
    expect(figure).toBeTruthy();
    expect(figure.assetId).toBe(asset.id);
    expect(figure.transform).toEqual(frame.transform);
    expect(figure.opacity).toBe(frame.opacity);
    expect(figure.metadata.mediaPlaceholder).toBeUndefined();
    expect(figure.crop).toBeTruthy();
    expect(
      (asset.width * figure.crop!.width) / (asset.height * figure.crop!.height),
    ).toBeCloseTo(frame.transform.width / frame.transform.height);
    expect(
      filled.objects.some(
        ({ metadata }) => metadata.mediaPlaceholderFor === frame.id,
      ),
    ).toBe(false);
    expect(filled.objects.map(({ id }) => id)).toEqual(
      slide.objects
        .filter(({ metadata }) => metadata.mediaPlaceholderFor !== frame.id)
        .map(({ id }) => (id === frame.id ? figure.id : id)),
    );
    expect(current.slides[0]).toEqual(before.slides[0]);
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(before);
    await click("Redo · Ctrl+Y");
    expect(await persist()).toEqual(current);
  });

  it("fills a selected video placeholder as one undoable embedded video", async () => {
    const before = await whiteLayout("keynote-white-large-video");
    const slide = before.slides[1];
    const frame = slide.objects.find(
      ({ metadata }) => metadata.mediaPlaceholder === "video",
    )!;
    const bytes = new Uint8Array([
      0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115,
      111, 109, 109, 112, 52, 50,
    ]);
    const asset: Asset = {
      id: "video-placeholder-import",
      name: "experiment.mp4",
      mime: "video/mp4",
      dataUrl: `data:video/mp4;base64,${btoa(String.fromCharCode(...bytes))}`,
      width: 640,
      height: 360,
    };
    vi.mocked(importVideo).mockResolvedValue(asset);
    await click("Select Video placeholder");
    await click("Video");
    expect(
      button("Select Video placeholder").getAttribute("aria-pressed"),
    ).toBe("true");
    const file = new File([bytes], asset.name, { type: asset.mime });
    await uploadMedia(file, "video");
    expect(importVideo).toHaveBeenCalledWith(file);
    const current = structuredClone((await persist())!);
    const filled = current.slides[1];
    const video = filled.objects.find(
      (object) => object.type === "video",
    ) as VideoObject;
    expect(video).toBeTruthy();
    expect(video.assetId).toBe(asset.id);
    expect(video.transform).toEqual(frame.transform);
    expect(video.controls).toBe(true);
    expect(video.metadata.mediaPlaceholder).toBeUndefined();
    expect(current.assets).toEqual([asset]);
    expect(filled.objects.map(({ id }) => id)).toEqual(
      slide.objects
        .filter(({ metadata }) => metadata.mediaPlaceholderFor !== frame.id)
        .map(({ id }) => (id === frame.id ? video.id : id)),
    );
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(before);
    await click("Redo · Ctrl+Y");
    expect(await persist()).toEqual(current);
  });

  it("offers recovery as an explicit choice and resumes the newest recovered deck without replacing it", async () => {
    const old = existingDeck();
    const latest = {
      ...old,
      title: "Newest local revision",
      slides: [{ ...old.slides[0], notes: "Latest saved notes" }],
    };
    vi.mocked(loadRecovery).mockReturnValue(old);
    vi.mocked(loadWorkspaceRecovery).mockResolvedValue({
      deck: latest,
      equationDrafts: [],
      savedAt: "2026-10-05T12:00:00.000Z",
    });
    await render();
    expect(chooserHeading()).toBeTruthy();
    expect(button("Resume previous work")).toBeTruthy();
    expect(host.querySelector(".slide-paper")).toBeNull();
    await persist();
    expect(saveWorkspaceRecovery).not.toHaveBeenCalled();
    await click("Resume previous work");
    expect(chooserHeading()).toBeUndefined();
    expect(await persist()).toEqual(latest);
  });

  it("opens the chooser for New without saving or changing the current deck, and Cancel returns to that deck", async () => {
    const deck = existingDeck();
    vi.mocked(loadRecovery).mockReturnValue(deck);
    await render();
    await click("Resume previous work");
    expect(await persist()).toEqual(deck);
    const saves = vi.mocked(saveWorkspaceRecovery).mock.calls.length;
    await click("New presentation");
    expect(chooserHeading()).toBeTruthy();
    await click("Navy");
    await persist();
    expect(saveWorkspaceRecovery).toHaveBeenCalledTimes(saves);
    await click("Cancel");
    expect(chooserHeading()).toBeUndefined();
    expect(await persist()).toEqual(deck);
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
  });

  it("keeps the chooser open after an invalid file, then enters the editor after opening a valid file", async () => {
    await render();
    vi.mocked(readDeckArchive).mockRejectedValueOnce(
      new Error("Unreadable presentation archive"),
    );
    await click("Open presentation");
    await upload(new File(["invalid"], "broken.scislide"));
    expect(readDeckArchive).toHaveBeenCalledTimes(1);
    expect(chooserHeading()).toBeTruthy();
    expect(host.querySelector(".slide-paper")).toBeNull();
    await persist();
    expect(saveWorkspaceRecovery).not.toHaveBeenCalled();
    const opened = existingDeck();
    vi.mocked(readDeckArchive).mockResolvedValueOnce(opened);
    await upload(new File(["fixture"], "talk.scislide"));
    expect(chooserHeading()).toBeUndefined();
    expect(await persist()).toEqual(opened);
  });
});
