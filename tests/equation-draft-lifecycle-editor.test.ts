// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type { Deck, EquationObject, Slide } from "../src/lib/model";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";
import type {
  RecoveredEquationDraft,
  WorkspaceRecovery,
} from "../src/lib/workspace-recovery";
import { renderEquation } from "../src/lib/equations";
import {
  buildDeckArchive,
  downloadBlob,
  readDeckArchive,
} from "../src/lib/persistence";
import { saveDocumentRecovery } from "../src/lib/recovery-history";

// Exercise real editor hydration, selection, draft fields, apply, and shutdown
// handlers. Rendering and storage transactions have separate integration tests.
vi.mock("../src/lib/workspace-recovery", () => ({
  loadWorkspaceRecovery: vi.fn(),
  saveWorkspaceRecovery: vi.fn(),
}));
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(() => null),
  buildDeckArchive: vi.fn(),
  downloadBlob: vi.fn(),
  readDeckArchive: vi.fn(),
}));
vi.mock("../src/lib/recovery-history", () => ({
  saveDocumentRecovery: vi.fn(),
  listDocumentRecoveries: vi.fn(async () => ({
    entries: [],
    unavailableCount: 0,
  })),
  loadDocumentRecovery: vi.fn(async () => null),
  deleteDocumentRecovery: vi.fn(async () => undefined),
}));
vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  desktop: undefined,
}));
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));
vi.mock("../src/lib/equations", () => ({
  renderEquation: vi.fn(),
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
    createElement(
      "svg",
      { className: "slide-scene", "data-recovery-slide": slide.id },
      createElement("text", null, slide.title),
    ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function recoveryDeck(): Deck {
  const demo = createDemoDeck();
  const template = demo.slides
    .flatMap((slide) => slide.objects)
    .find((object) => object.type === "equation") as EquationObject;
  const slide = {
    ...createBlankSlide(),
    id: "restored-slide",
    title: "Latest restored slide",
  };
  slide.objects = [
    {
      ...structuredClone(template),
      id: "equation-a",
      name: "Equation A",
      latex: "a=1",
      style: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#111827" },
    },
    {
      ...structuredClone(template),
      id: "equation-b",
      name: "Equation B",
      latex: "b=2",
      style: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#111827" },
    },
  ];
  return {
    ...demo,
    id: "restored-deck",
    title: "Latest IndexedDB revision",
    slides: [slide],
    assets: [],
  };
}

function draft(
  deck: Deck,
  equationId: string,
  latex: string,
): RecoveredEquationDraft {
  return {
    deckId: deck.id,
    slideId: deck.slides[0].id,
    equationId,
    updatedAt: "2026-10-04T12:00:00.000Z",
    draft: {
      latex,
      font: "mathjax-fira",
      size: 52,
      color: "#123456",
      renderer: "mathjax",
      engine: "latex",
      preamble: "",
    },
  };
}

describe("equation draft lifecycle across object and slide deletion", () => {
  let host: HTMLDivElement, root: Root;
  let pending: ReturnType<typeof deferred<WorkspaceRecovery | null>>;
  let snapshots: Array<{ deck: Deck; drafts: RecoveredEquationDraft[] }>;
  let historySnapshots: Array<{ deck: Deck; drafts: RecoveredEquationDraft[] }>;
  let observe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    vi.setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("indexedDB", {});
    observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
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
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    pending = deferred();
    snapshots = [];
    historySnapshots = [];
    vi.mocked(saveDocumentRecovery)
      .mockReset()
      .mockImplementation(async (_id, deck, drafts = []) => {
        historySnapshots.push({
          deck: structuredClone(deck),
          drafts: structuredClone(drafts),
        });
        return "indexeddb";
      });
    vi.mocked(buildDeckArchive)
      .mockReset()
      .mockResolvedValue(new Blob(["deck archive"]));
    vi.mocked(downloadBlob).mockReset();
    vi.mocked(readDeckArchive).mockReset();
    vi.mocked(loadWorkspaceRecovery).mockReset();
    vi.mocked(loadWorkspaceRecovery).mockReturnValue(pending.promise);
    vi.mocked(saveWorkspaceRecovery).mockReset();
    vi.mocked(saveWorkspaceRecovery).mockImplementation(
      async (deck, drafts = []) => {
        snapshots.push({
          deck: structuredClone(deck),
          drafts: structuredClone(drafts),
        });
        return "indexeddb";
      },
    );
    vi.mocked(renderEquation).mockReset();
    vi.mocked(renderEquation).mockResolvedValue({
      svg: '<svg viewBox="0 0 400 80"><path d="M0 40L400 40"/></svg>',
      width: 400,
      height: 80,
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
  async function render() {
    await act(async () => root.render(createElement(App)));
  }
  async function tick(milliseconds = 750) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }
  async function hydrate(
    deck: Deck,
    equationDrafts: RecoveredEquationDraft[] = [],
  ) {
    await act(async () =>
      pending.resolve({
        deck,
        equationDrafts,
        savedAt: "2026-10-04T12:00:00.000Z",
      }),
    );
    await click("Resume previous work");
  }
  function field(label: string) {
    return host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[aria-label='${label}']`,
    )!;
  }
  async function input(label: string, value: string) {
    const element = field(label);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function click(label: string) {
    const target = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) =>
        button.getAttribute("aria-label") === label ||
        button.textContent?.trim() === label ||
        button.getAttribute("aria-label")?.startsWith(`${label} · `),
    );
    if (!target) throw new Error(`Missing recovery-editor button: ${label}`);
    await act(async () => target.click());
  }
  async function shutdownEvents() {
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("beforeunload"));
    });
  }
  function latest() {
    return snapshots.at(-1)!;
  }

  async function editEquation(name: string) {
    if (host.querySelector(".equation-editor-dialog"))
      await click("Close equation editor");
    await click("Select " + name);
    await click("Style");
    await click("Edit equation");
  }

  async function uploadAnotherDocument() {
    const next = {
      ...recoveryDeck(),
      id: "another-deck",
      title: "Another talk",
    };
    vi.mocked(readDeckArchive).mockResolvedValueOnce(next);
    const field = host.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".scislide"]',
    )!;
    await act(async () => {
      Object.defineProperty(field, "files", {
        configurable: true,
        value: [new File(["deck"], "another.scislide")],
      });
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  const badge = () => host.querySelector(".equation-draft-state");
  const latestHistory = () => historySnapshots.at(-1)!;

  it("stops counting a deleted equation's draft and allows the pending document change to save its file", async () => {
    const restored = recoveryDeck();
    await render();
    await hydrate(restored, [
      draft(restored, "equation-a", "a=unfinished+source"),
    ]);
    await tick();
    await click("Select Equation A");
    await click("Arrange");
    await click("Delete");
    await tick();
    expect(
      latest().deck.slides[0].objects.some(
        (object) => object.id === "equation-a",
      ),
    ).toBe(false);
    expect(badge()).toBeNull();
    expect(latest().drafts).toEqual([]);
    expect(latestHistory().drafts).toEqual([]);
    await uploadAnotherDocument();
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Save changes",
    )!;
    expect(save.disabled).toBe(false);
    await click("Save changes");
    expect(buildDeckArchive).toHaveBeenCalledOnce();
    expect(downloadBlob).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(buildDeckArchive)
        .mock.calls[0][0].slides[0].objects.some(
          (object) => object.id === "equation-a",
        ),
    ).toBe(false);
    expect(field("Presentation title").value).toBe("Another talk");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("filters drafts from a removed slide in autosave and shutdown history without discarding the drafts needed for Undo", async () => {
    const restored = recoveryDeck();
    const equationC: EquationObject = {
      ...structuredClone(restored.slides[0].objects[0] as EquationObject),
      id: "equation-c",
      name: "Equation C",
      latex: "c=3",
    };
    const second = {
      ...createBlankSlide(),
      id: "second-slide",
      title: "Remaining slide",
      objects: [equationC],
    };
    restored.slides.push(second);
    const draftC = {
      ...draft(restored, "equation-c", "c=live+draft"),
      slideId: second.id,
    };
    await render();
    await hydrate(restored, [
      draft(restored, "equation-a", "a=removed+slide+draft"),
      draft(restored, "equation-b", "b=removed+slide+draft"),
      draftC,
    ]);
    await tick();
    expect(badge()?.textContent).toBe("3 equation drafts · local only");
    await click("Delete slide");
    await tick();
    expect(latest().deck.slides.map(({ id }) => id)).toEqual(["second-slide"]);
    expect(badge()?.textContent).toBe("1 equation draft · local only");
    expect(latest().drafts).toEqual([draftC]);
    expect(latestHistory().drafts).toEqual([draftC]);
    await shutdownEvents();
    expect(latest().drafts).toEqual([draftC]);
    expect(latestHistory().drafts).toEqual([draftC]);
    await click("Undo");
    await tick();
    expect(badge()?.textContent).toBe("3 equation drafts · local only");
    expect(
      latestHistory()
        .drafts.map(({ equationId }) => equationId)
        .sort(),
    ).toEqual(["equation-a", "equation-b", "equation-c"]);
    await click("Slide 1: Latest restored slide");
    await editEquation("Equation A");
    expect(field("LaTeX source").value).toBe("a=removed+slide+draft");
  });

  it("updates only the live equation draft count through deletion, Undo, and Redo", async () => {
    const restored = recoveryDeck();
    await render();
    await hydrate(restored, [
      draft(restored, "equation-a", "a=keep+for+undo"),
      draft(restored, "equation-b", "b=still+live"),
    ]);
    await click("Select Equation A");
    await click("Arrange");
    await click("Delete");
    await tick();
    expect(badge()?.textContent).toBe("1 equation draft · local only");
    expect(latestHistory().drafts.map(({ equationId }) => equationId)).toEqual([
      "equation-b",
    ]);
    await click("Undo");
    await tick();
    expect(badge()?.textContent).toBe("2 equation drafts · local only");
    await editEquation("Equation A");
    expect(field("LaTeX source").value).toBe("a=keep+for+undo");
    await click("Close equation editor");
    await click("Redo");
    await tick();
    expect(badge()?.textContent).toBe("1 equation draft · local only");
    expect(latest().drafts.map(({ equationId }) => equationId)).toEqual([
      "equation-b",
    ]);
    expect(latestHistory().drafts.map(({ equationId }) => equationId)).toEqual([
      "equation-b",
    ]);
  });
});
