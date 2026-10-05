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

// Exercise real editor hydration, selection, draft fields, apply, and shutdown
// handlers. Rendering and storage transactions have separate integration tests.
vi.mock("../src/lib/workspace-recovery", () => ({
  loadWorkspaceRecovery: vi.fn(),
  saveWorkspaceRecovery: vi.fn(),
}));
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(() => null),
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

describe("editor workspace recovery and unapplied equation drafts", () => {
  let host: HTMLDivElement, root: Root;
  let pending: ReturnType<typeof deferred<WorkspaceRecovery | null>>;
  let snapshots: Array<{ deck: Deck; drafts: RecoveredEquationDraft[] }>;
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
        button.textContent?.trim() === label,
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

  it("never writes the initial demo before hydration, including hidden and unload events", async () => {
    await render();
    expect(host.querySelector("[role=status]")?.textContent).toContain(
      "Restoring your workspace",
    );
    expect(observe).not.toHaveBeenCalled();
    await tick(3000);
    await shutdownEvents();
    expect(saveWorkspaceRecovery).not.toHaveBeenCalled();
    const restored = recoveryDeck();
    await hydrate(restored);
    expect(field("Presentation title").value).toBe(restored.title);
    expect(
      host
        .querySelector(".slide-paper [data-recovery-slide]")
        ?.getAttribute("data-recovery-slide"),
    ).toBe(restored.slides[0].id);
    expect(observe).toHaveBeenCalled();
    await tick();
    expect(snapshots.length).toBeGreaterThan(0);
    expect(
      snapshots.every((snapshot) => snapshot.deck.id === restored.id),
    ).toBe(true);
    await shutdownEvents();
    expect(latest().deck.title).toBe(restored.title);
  });

  it("persists edited unapplied source under the selected deck, slide, and equation IDs", async () => {
    const restored = recoveryDeck();
    await render();
    await hydrate(restored);
    await tick();
    await click("Select Equation A");
    await input("LaTeX source", String.raw`a = \alpha + 3`);
    await tick();
    expect(latest().drafts).toHaveLength(1);
    expect(latest().drafts[0]).toMatchObject({
      deckId: "restored-deck",
      slideId: "restored-slide",
      equationId: "equation-a",
      draft: { latex: String.raw`a = \alpha + 3` },
    });
    expect((latest().deck.slides[0].objects[0] as EquationObject).latex).toBe(
      "a=1",
    );
  });

  it("restores each equation draft independently while switching selections", async () => {
    const restored = recoveryDeck();
    const drafts = [
      draft(restored, "equation-a", "a=restored+draft"),
      draft(restored, "equation-b", "b=independent+draft"),
    ];
    await render();
    await hydrate(restored, drafts);
    await tick();
    await click("Select Equation A");
    expect(field("LaTeX source").value).toBe("a=restored+draft");
    await input("LaTeX source", "a=user+edited");
    await click("Select Equation B");
    expect(field("LaTeX source").value).toBe("b=independent+draft");
    await click("Select Equation A");
    expect(field("LaTeX source").value).toBe("a=user+edited");
    await click("Select Equation B");
    expect(field("LaTeX source").value).toBe("b=independent+draft");
    await shutdownEvents();
    expect(
      latest().drafts.find((entry) => entry.equationId === "equation-a")?.draft
        .latex,
    ).toBe("a=user+edited");
    expect(
      latest().drafts.find((entry) => entry.equationId === "equation-b")?.draft
        .latex,
    ).toBe("b=independent+draft");
  });

  it("applies the restored draft to its equation and removes only that recovered draft", async () => {
    const restored = recoveryDeck();
    await render();
    await hydrate(restored, [
      draft(restored, "equation-a", "a=applied+source"),
      draft(restored, "equation-b", "b=still+unapplied"),
    ]);
    await click("Select Equation A");
    await tick(250);
    await click("Apply equation");
    await tick();
    expect(
      (
        latest().deck.slides[0].objects.find(
          (object) => object.id === "equation-a",
        ) as EquationObject
      ).latex,
    ).toBe("a=applied+source");
    expect(
      latest().drafts.some((entry) => entry.equationId === "equation-a"),
    ).toBe(false);
    expect(
      latest().drafts.find((entry) => entry.equationId === "equation-b")?.draft
        .latex,
    ).toBe("b=still+unapplied");
    await click("Select Equation B");
    await click("Select Equation A");
    expect(field("LaTeX source").value).toBe("a=applied+source");
  });

  it("keeps recovery writes disabled after hydration rejects, even if the fallback editor is used", async () => {
    await render();
    await act(async () => pending.reject(new Error("Database unavailable")));
    await click("Explore demo");
    expect(host.textContent).toContain("Recovery unavailable");
    await input("Presentation title", "Edited fallback deck");
    await tick(3000);
    await shutdownEvents();
    expect(saveWorkspaceRecovery).not.toHaveBeenCalled();
  });
});
