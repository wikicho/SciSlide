// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import {
  createBlankSlide,
  createDemoDeck,
  type Deck,
  type EquationObject,
  type TextObject,
} from "../src/lib/model";
import {
  buildDeckArchive,
  downloadBlob,
  loadRecovery,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
  type RecoveredEquationDraft,
} from "../src/lib/workspace-recovery";
import { saveDocumentRecovery } from "../src/lib/recovery-history";
import { renderEquation } from "../src/lib/equations";

// Keep the real App, canvas, equation dialog, Layers, and keyboard routing.
// Replace storage/archive boundaries and the equation renderer only.
vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  desktop: undefined,
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
vi.mock("../src/lib/recovery-history", async (original) => ({
  ...(await original<typeof import("../src/lib/recovery-history")>()),
  saveDocumentRecovery: vi.fn(),
  listDocumentRecoveries: vi.fn(async () => ({
    entries: [],
    unavailableCount: 0,
  })),
  loadDocumentRecovery: vi.fn(async () => null),
  deleteDocumentRecovery: vi.fn(async () => undefined),
}));
vi.mock("../src/lib/equations", async (original) => ({
  ...(await original<typeof import("../src/lib/equations")>()),
  renderEquation: vi.fn(),
}));
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function presentation(): Deck {
  const demo = createDemoDeck();
  const equation = demo.slides
    .flatMap((slide) => slide.objects)
    .find((object): object is EquationObject => object.type === "equation")!;
  const text = demo.slides
    .flatMap((slide) => slide.objects)
    .find((object): object is TextObject => object.type === "text")!;
  return {
    ...demo,
    id: "draft-review-deck",
    title: "Review drafts",
    assets: [],
    pageNumbers: undefined,
    slides: [
      {
        ...createBlankSlide(),
        id: "main-slide",
        title: "Main slide",
        objects: [
          {
            ...structuredClone(text),
            id: "body",
            name: "Body text",
            text: "Original saved body",
            visible: true,
            locked: false,
            transform: {
              x: 100,
              y: 100,
              width: 1100,
              height: 150,
              rotation: 0,
            },
          },
        ],
      },
      {
        ...createBlankSlide(),
        id: "draft-slide",
        title: "Draft slide",
        objects: ["B", "C"].map((name, index) => ({
          ...structuredClone(equation),
          id: `equation-${name.toLowerCase()}`,
          name: `Equation ${name}`,
          description: `Equation ${name}`,
          latex: `${name.toLowerCase()}=${index + 2}`,
          visible: true,
          locked: false,
          style: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#111827" },
          transform: {
            x: 150,
            y: 200 + 200 * index,
            width: 600,
            height: 120,
            rotation: 0,
          },
        })),
      },
    ],
  };
}
function equationDraft(equationId: string): RecoveredEquationDraft {
  return {
    deckId: "draft-review-deck",
    slideId: "draft-slide",
    equationId,
    updatedAt: "2026-11-15T10:00:00.000Z",
    draft: {
      latex: `${equationId}=unfinished+source`,
      font: "mathjax-stix2",
      size: 48,
      color: "#111827",
      renderer: "mathjax",
      engine: "latex",
      preamble: "",
      inheritTypography: false,
    },
  };
}

describe("actionable equation drafts and file save feedback", () => {
  let host: HTMLDivElement, root: Root, deck: Deck;
  let snapshots: Array<{ deck: Deck; drafts: RecoveredEquationDraft[] }>;
  let historyDrafts: RecoveredEquationDraft[][];

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
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D);
    deck = presentation();
    snapshots = [];
    historyDrafts = [];
    vi.mocked(loadRecovery).mockReset().mockReturnValue(null);
    vi.mocked(loadWorkspaceRecovery).mockReset();
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (current, drafts = []) => {
        snapshots.push({
          deck: structuredClone(current),
          drafts: structuredClone(drafts),
        });
        return "indexeddb";
      });
    vi.mocked(saveDocumentRecovery)
      .mockReset()
      .mockImplementation(async (_id, _current, drafts = []) => {
        historyDrafts.push(structuredClone(drafts));
        return "indexeddb";
      });
    vi.mocked(buildDeckArchive)
      .mockReset()
      .mockResolvedValue(new Blob(["applied deck archive"]));
    vi.mocked(downloadBlob).mockReset();
    vi.mocked(renderEquation).mockReset().mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 60"><path d="M0 30H160"/></svg>',
      width: 160,
      height: 60,
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
  function findButton(label: string) {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label ||
        element.getAttribute("aria-label")?.startsWith(`${label} · `),
    );
  }
  async function click(label: string) {
    const target = findButton(label);
    if (!target) throw new Error(`Missing button: ${label}`);
    await act(async () => target.click());
  }
  async function tick(milliseconds = 710) {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
  }
  async function start(
    drafts = [equationDraft("equation-b"), equationDraft("equation-c")],
  ) {
    vi.mocked(loadWorkspaceRecovery).mockResolvedValue({
      deck: structuredClone(deck),
      equationDrafts: drafts,
      savedAt: "2026-11-15T10:00:00.000Z",
    });
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await tick();
  }
  async function key(
    value: string,
    options: KeyboardEventInit = {},
    target: EventTarget = window,
  ) {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
    });
  }
  async function input(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) {
    await act(async () => {
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const source = () =>
    host.querySelector<HTMLTextAreaElement>('[aria-label="LaTeX source"]')!;
  const saveStatus = () =>
    host.querySelector('[aria-label="Document save status"]')?.textContent;
  const currentSlide = () =>
    host.querySelector(".slide-paper .slide-scene")?.getAttribute("aria-label");
  const latest = () => snapshots.at(-1)!;

  it("reviews a draft on another slide, focuses its real source, and then prefers the selected draft without changing Undo or stored work", async () => {
    await start();
    await input(
      host.querySelector<HTMLInputElement>(
        '[aria-label="Presentation title"]',
      )!,
      "Review drafts revised",
    );
    await tick();
    const before = structuredClone(latest());
    expect(findButton("Undo")?.disabled).toBe(false);
    expect(currentSlide()).toBe("Main slide");

    await click("Review equation drafts");
    await tick(250);
    expect(currentSlide()).toBe("Draft slide");
    expect(source().value).toBe(equationDraft("equation-b").draft.latex);
    expect(document.activeElement).toBe(source());
    await click("Close equation editor");
    await click("Select Equation C");
    await click("Review equation drafts");
    await tick(250);
    expect(source().value).toBe(equationDraft("equation-c").draft.latex);
    expect(document.activeElement).toBe(source());
    await click("Close equation editor");
    await tick();
    expect(latest()).toEqual(before);
    expect(historyDrafts.at(-1)).toEqual(before.drafts);

    await key("z", { ctrlKey: true });
    await tick();
    expect(latest().deck.title).toBe(deck.title);
    expect(latest().drafts).toEqual(before.drafts);
  });

  it("routes an inaccessible draft to Layers without showing it or unlocking its group", async () => {
    const hidden = deck.slides[1].objects[0];
    const locker = deck.slides[1].objects[1];
    hidden.visible = false;
    hidden.groupId = "locked-equation-group";
    locker.groupId = "locked-equation-group";
    locker.locked = true;
    await start([equationDraft("equation-b")]);
    await click("Review equation drafts");
    await tick();

    expect(currentSlide()).toBe("Draft slide");
    const layers = host.querySelector<HTMLElement>(
      '[aria-label="Objects and layers panel"]',
    )!;
    expect(layers.hidden).toBe(false);
    expect(findButton("Select Equation B")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(host.querySelector(".equation-editor-dialog")).toBeNull();
    expect(host.querySelector(".toast")?.textContent).toMatch(/show|hidden/i);
    expect(host.querySelector(".toast")?.textContent).toMatch(/unlock|locked/i);
    expect(latest().deck).toEqual(deck);
    expect(latest().drafts).toEqual([equationDraft("equation-b")]);
    expect(findButton("Undo")?.disabled).toBe(true);
  });

  it("saves applied content while explicitly reporting that the preserved drafts are local and absent from the file", async () => {
    await start();
    await key("s", { ctrlKey: true });
    expect(buildDeckArchive).toHaveBeenCalledExactlyOnceWith(deck);
    expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(
      expect.any(Blob),
      `${deck.title}.scislide`,
    );
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    const feedback = host.querySelector(".toast")?.textContent ?? "";
    expect(feedback).toMatch(/2.*draft/i);
    expect(feedback).toMatch(/local/i);
    expect(feedback).toMatch(/not.*(?:file|\.scislide)/i);
    expect(findButton("Review equation drafts")).toBeTruthy();
    await tick();
    expect(latest().deck).toEqual(deck);
    expect(latest().drafts).toEqual([
      equationDraft("equation-b"),
      equationDraft("equation-c"),
    ]);
    expect(historyDrafts.at(-1)).toEqual(latest().drafts);
  });

  it("removes the last draft action after Apply and then saves the newly applied equation normally", async () => {
    await start([equationDraft("equation-b")]);
    await click("Review equation drafts");
    await tick(250);
    await click("Apply equation");
    await tick();
    expect(host.querySelector(".equation-editor-dialog")).toBeNull();
    expect(findButton("Review equation drafts")).toBeUndefined();
    expect(latest().drafts).toEqual([]);
    expect(latest().deck.slides[1].objects[0]).toMatchObject({
      latex: equationDraft("equation-b").draft.latex,
    });

    await key("s", { ctrlKey: true });
    expect(buildDeckArchive).toHaveBeenCalledExactlyOnceWith(latest().deck);
    expect(downloadBlob).toHaveBeenCalledOnce();
    expect(host.querySelector(".toast")?.textContent).not.toMatch(/draft/i);
    expect(saveStatus()).toBe("Downloaded .scislide");
  });

  it("disables draft review while a save is busy and while another dialog owns focus", async () => {
    await start();
    const packaging = deferred<Blob>();
    vi.mocked(buildDeckArchive).mockReturnValueOnce(packaging.promise);
    await key("s", { ctrlKey: true });
    expect(findButton("Review equation drafts")?.disabled).toBe(true);
    await click("Review equation drafts");
    expect(currentSlide()).toBe("Main slide");
    expect(host.querySelector(".equation-editor-dialog")).toBeNull();
    await act(async () => packaging.resolve(new Blob(["saved archive"])));
    expect(findButton("Review equation drafts")?.disabled).toBe(false);

    await key("?", { ctrlKey: true, shiftKey: true, code: "Slash" });
    expect(
      host.querySelector(
        '.shortcuts-dialog,[aria-labelledby="keyboard-shortcuts-title"]',
      ) ?? host.querySelector('[role="dialog"]'),
    ).toBeTruthy();
    expect(findButton("Review equation drafts")?.disabled).toBe(true);
    const focused = document.activeElement;
    await click("Review equation drafts");
    expect(document.activeElement).toBe(focused);
    expect(currentSlide()).toBe("Main slide");
    expect(host.querySelector(".equation-editor-dialog")).toBeNull();
    await click("Close keyboard shortcuts");
    expect(findButton("Review equation drafts")?.disabled).toBe(false);
  });

  it("marks pending canvas text as unsaved immediately and restores the saved status when Escape cancels it", async () => {
    await start([]);
    await key("s", { ctrlKey: true });
    expect(saveStatus()).toBe("Downloaded .scislide");
    const body = [
      ...host.querySelectorAll<SVGTextElement>(".slide-paper svg text"),
    ].find((element) => element.textContent === "Original saved body")!;
    expect(body).toBeTruthy();
    await act(async () =>
      body
        .closest("g")!
        .dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
        ),
    );
    const editor = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Edit text on slide"]',
    )!;
    expect(editor).toBeTruthy();
    await input(editor, "Pending body that has not been committed");
    expect(saveStatus()).toBe("Unsaved changes");
    expect(
      host.querySelector(".status-dot")?.classList.contains("is-unsaved"),
    ).toBe(true);

    await key("Escape", {}, editor);
    expect(host.querySelector('[aria-label="Edit text on slide"]')).toBeNull();
    expect(saveStatus()).toBe("Downloaded .scislide");
    expect(
      host.querySelector(".status-dot")?.classList.contains("is-saved"),
    ).toBe(true);
    await tick();
    expect(latest().deck).toEqual(deck);
    expect(buildDeckArchive).toHaveBeenCalledOnce();
  });
});
