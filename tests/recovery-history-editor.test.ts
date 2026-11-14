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
} from "../src/lib/model";
import { loadRecovery, readDeckArchive } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
  type RecoveredEquationDraft,
} from "../src/lib/workspace-recovery";
import * as recoveryHistory from "../src/lib/recovery-history";

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
vi.mock("../src/lib/recovery-history", async (original) => {
  const real = await original<typeof import("../src/lib/recovery-history")>();
  return {
    ...real,
    saveDocumentRecovery: vi.fn(real.saveDocumentRecovery),
    listDocumentRecoveries: vi.fn(real.listDocumentRecoveries),
    loadDocumentRecovery: vi.fn(real.loadDocumentRecovery),
    deleteDocumentRecovery: vi.fn(real.deleteDocumentRecovery),
  };
});
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

function deck(title: string, id = title): Deck {
  id = id.replace(/[^a-zA-Z0-9_.-]/g, "-");
  return {
    ...createDemoDeck(),
    id: `deck-${id}`,
    title,
    slides: [
      {
        ...createBlankSlide(),
        id: `slide-${id}`,
        title: `${title} slide`,
        objects: [],
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("document recovery history in the editor", () => {
  let host: HTMLDivElement, root: Root;
  let saved: Deck | undefined;
  const initial = deck("Talk A");

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
    localStorage.clear();
    vi.mocked(loadRecovery)
      .mockReset()
      .mockReturnValue(structuredClone(initial));
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (snapshot) => {
        saved = structuredClone(snapshot);
        return "localStorage";
      });
    vi.mocked(readDeckArchive).mockReset();
    vi.mocked(recoveryHistory.saveDocumentRecovery).mockClear();
    vi.mocked(recoveryHistory.listDocumentRecoveries).mockClear();
    vi.mocked(recoveryHistory.loadDocumentRecovery).mockClear();
    vi.mocked(recoveryHistory.deleteDocumentRecovery).mockClear();
    saved = undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    await recoveryHistory.listDocumentRecoveries().catch(() => undefined);
    host.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const button = (label: string) => {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  const click = async (label: string) => {
    await act(async () => button(label).click());
  };
  async function start() {
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
  }
  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return saved!;
  }
  async function upload(next: Deck) {
    vi.mocked(readDeckArchive).mockResolvedValueOnce(next);
    const input = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].find((entry) => entry.accept.includes(".scislide"))!;
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["deck"], `${next.title}.scislide`)],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  const title = () =>
    host.querySelector<HTMLInputElement>('[aria-label="Presentation title"]')
      ?.value;

  it("preserves A through a local-recovery transition and opens it from B with independent history", async () => {
    await start();
    await upload(deck("Talk B"));
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click("Keep recovery and continue");
    expect(title()).toBe("Talk B");
    await persist();
    await click("Recovered documents");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Talk A",
    );
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Talk B",
    );
    await click("Open recovery for Talk A");
    expect(title()).toBe("Talk A");
    expect(button("Undo · Ctrl+Z").disabled).toBe(true);
    expect(
      host.querySelector('[aria-label="Document save status"]')?.textContent,
    ).toBe("Unsaved changes");
    expect((await persist()).id).toBe(initial.id);
  });

  it("keeps distinct recovery sessions when the same document ID is reopened", async () => {
    await start();
    await persist();
    const reopened = { ...structuredClone(initial), title: "Talk A reopened" };
    await upload(reopened);
    await click("Keep recovery and continue");
    await persist();
    const result = await recoveryHistory.listDocumentRecoveries();
    expect(
      result.entries
        .filter((entry) => entry.deckId === initial.id)
        .map((entry) => entry.title)
        .sort(),
    ).toEqual(["Talk A", "Talk A reopened"]);
    expect(new Set(result.entries.map((entry) => entry.id)).size).toBe(2);
  });

  it("blocks a recovery-only transition on storage failure and preserves the current presentation", async () => {
    await start();
    vi.mocked(recoveryHistory.saveDocumentRecovery).mockRejectedValueOnce(
      new Error("Recovery storage full"),
    );
    await upload(deck("Talk B"));
    await click("Keep recovery and continue");
    expect(title()).toBe("Talk A");
    expect(host.textContent).toContain("Recovery storage full");
    expect((await persist()).id).toBe(initial.id);
  });

  it("restores unapplied equation drafts as editable local work", async () => {
    const source = createDemoDeck();
    const equation = source.slides
      .flatMap((slide) => slide.objects)
      .find((object): object is EquationObject => object.type === "equation")!;
    const recovered = deck("Equation recovery");
    recovered.slides[0].objects = [
      {
        ...structuredClone(equation),
        id: "draft-equation",
        name: "Recovered equation",
      },
    ];
    const draft: RecoveredEquationDraft = {
      deckId: recovered.id,
      slideId: recovered.slides[0].id,
      equationId: "draft-equation",
      updatedAt: "2026-11-14T00:00:00Z",
      draft: {
        latex: "x_{unfinished}=17",
        font: "mathjax-fira",
        size: 48,
        color: "#123456",
        renderer: "mathjax",
        engine: "latex",
        preamble: "",
        inheritTypography: false,
      },
    };
    await recoveryHistory.saveDocumentRecovery(
      "unfinished-session",
      recovered,
      [draft],
    );
    await start();
    await persist();
    await click("Recovered documents");
    expect(host.textContent).toContain("1 unfinished equation draft");
    await click("Open recovery for Equation recovery");
    await click("Keep recovery and continue");
    await persist();
    const restored = vi.mocked(saveWorkspaceRecovery).mock.calls.at(-1)!;
    expect(restored[0].title).toBe("Equation recovery");
    expect(restored[1]).toEqual([
      expect.objectContaining({
        equationId: "draft-equation",
        draft: expect.objectContaining({
          latex: "x_{unfinished}=17",
          font: "mathjax-fira",
        }),
      }),
    ]);
  });

  it("keeps the current presentation when a recovery cannot be loaded", async () => {
    await start();
    await persist();
    await click("Recovered documents");
    vi.mocked(recoveryHistory.loadDocumentRecovery).mockRejectedValueOnce(
      new Error("Damaged recovery copy"),
    );
    await click("Open recovery for Talk A");
    expect(title()).toBe("Talk A");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Damaged recovery copy",
    );
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("requires confirmation to remove a recovery and leaves the active document intact", async () => {
    await start();
    await persist();
    await click("Recovered documents");
    await click("Remove recovery for Talk A");
    expect(recoveryHistory.deleteDocumentRecovery).not.toHaveBeenCalled();
    await click("Cancel removal");
    expect(
      (await recoveryHistory.listDocumentRecoveries()).entries,
    ).toHaveLength(1);
    await click("Remove recovery for Talk A");
    await click("Remove saved copy");
    expect((await recoveryHistory.listDocumentRecoveries()).entries).toEqual(
      [],
    );
    expect(title()).toBe("Talk A");
    await click("Close recovered documents");
    expect(title()).toBe("Talk A");
  });

  it("opens the recovery list from the startup chooser without creating a presentation", async () => {
    const archived = deck("Older talk");
    await recoveryHistory.saveDocumentRecovery("older-session", archived);
    vi.mocked(loadRecovery).mockReturnValue(null);
    await act(async () => root.render(createElement(App)));
    await click("Recovered documents");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "Older talk",
    );
    await click("Open recovery for Older talk");
    expect(title()).toBe("Older talk");
    expect(host.querySelector(".theme-chooser")).toBeNull();
  });

  it("cancels replacement of dirty work without changing either recovery", async () => {
    await recoveryHistory.saveDocumentRecovery(
      "other-session",
      deck("Other talk"),
    );
    await start();
    await persist();
    await click("Recovered documents");
    await click("Open recovery for Other talk");
    await click("Cancel");
    expect(title()).toBe("Talk A");
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    expect(
      (await recoveryHistory.listDocumentRecoveries()).entries
        .map((entry) => entry.title)
        .sort(),
    ).toEqual(["Other talk", "Talk A"]);
  });
});
