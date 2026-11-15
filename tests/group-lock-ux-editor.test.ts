// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import {
  createBlankSlide,
  createDemoDeck,
  type Deck,
  type TextObject,
} from "../src/lib/model";
import { loadRecovery } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

// Keep real selection expansion, Inspector controls, lock state and Undo/Redo.
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
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

function text(name: string, locked = false, groupId?: string): TextObject {
  return {
    id: name.toLowerCase(),
    type: "text",
    name,
    text: `${name} content`,
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: 400,
    color: "#123456",
    align: "left",
    transform: { x: 100, y: 100, width: 400, height: 100, rotation: 0 },
    opacity: 1,
    visible: true,
    locked,
    ...(groupId ? { groupId } : {}),
    metadata: {},
  };
}
function deckWith(objects: TextObject[]): Deck {
  return {
    ...createDemoDeck(),
    id: "group-lock-ux-deck",
    title: "Group lock UX",
    slides: [
      {
        ...createBlankSlide(),
        id: "group-lock-slide",
        title: "Group locks",
        objects,
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("effective group locking in the Inspector", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck;

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
      measureText: (value: string) => ({ width: value.length * 10 }),
    } as CanvasRenderingContext2D);
    localStorage.clear();
    vi.mocked(loadRecovery).mockReset();
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        saved = structuredClone(deck);
        return "localStorage";
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
  function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label ||
        element.getAttribute("aria-label")?.startsWith(`${label} · `),
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(750));
    return structuredClone(saved);
  }
  async function render(deck: Deck) {
    vi.mocked(loadRecovery).mockReturnValue(deck);
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
  }
  async function editMember(name: string) {
    await click("Layers");
    await click(`Select ${name}`);
    await click("Style");
    const summary = host.querySelector('[aria-label="Selected objects"]');
    if (summary) {
      const disclosure = summary.querySelector("details")!;
      if (!disclosure.open)
        await act(async () => disclosure.querySelector("summary")!.click());
      await click(`Edit ${name}`);
    }
  }
  const inspector = () =>
    host.querySelector<HTMLElement>('[aria-label="Inspector panel"]')!;
  const lockButton = () =>
    inspector().querySelector<HTMLButtonElement>(
      ".object-heading .icon-button",
    )!;
  const indirectLockHint = () =>
    [...inspector().querySelectorAll("p")].find(
      (paragraph) =>
        !paragraph.closest("[hidden]") &&
        paragraph.textContent?.includes(
          "This group is locked by another member.",
        ),
    );

  it("shows the effective lock and its cause when editing a member whose own lock is off", async () => {
    const initial = deckWith([
      text("Alpha", true, "research-group"),
      text("Beta", false, "research-group"),
    ]);
    await render(initial);
    await editMember("Beta");
    expect(lockButton().classList.contains("active")).toBe(true);
    expect(lockButton().getAttribute("aria-label")).toBe("Unlock group");
    expect(indirectLockHint()).toBeTruthy();
    expect(host.querySelector(".canvas-hint")?.textContent).toMatch(/locked/i);
    expect(await persist()).toEqual(initial);
    expect(button("Undo").disabled).toBe(true);
    await click("Arrange");
    expect(
      inspector().querySelector<HTMLInputElement>('[aria-label="Object x"]')
        ?.disabled,
    ).toBe(true);
  });

  it("unlocks the complete group, preserves unrelated locks and restores the original mixed locks with Undo", async () => {
    const initial = deckWith([
      text("Alpha", true, "research-group"),
      text("Beta", false, "research-group"),
      text("Outside", true),
    ]);
    await render(initial);
    await editMember("Beta");
    await click("Unlock group");
    const unlocked = structuredClone(initial);
    unlocked.slides[0].objects[0].locked = false;
    expect(await persist()).toEqual(unlocked);
    expect(lockButton().getAttribute("aria-label")).toBe("Lock group");
    expect(lockButton().classList.contains("active")).toBe(false);
    expect(indirectLockHint()).toBeUndefined();
    await click("Arrange");
    expect(
      inspector().querySelector<HTMLInputElement>('[aria-label="Object x"]')
        ?.disabled,
    ).toBe(false);
    // Unlocking never ungroups the member to make its size fields editable.
    expect(
      inspector().querySelector<HTMLInputElement>('[aria-label="Object width"]')
        ?.disabled,
    ).toBe(true);
    await click("Undo");
    expect(await persist()).toEqual(initial);
    expect(button("Undo").disabled).toBe(true);
    await editMember("Beta");
    expect(lockButton().getAttribute("aria-label")).toBe("Unlock group");
    expect(indirectLockHint()).toBeTruthy();
    await click("Redo");
    expect(await persist()).toEqual(unlocked);
  });

  it("keeps a standalone object's Unlock action scoped to that object", async () => {
    const initial = deckWith([text("Solo", true), text("Outside", true)]);
    await render(initial);
    await editMember("Solo");
    expect(lockButton().getAttribute("aria-label")).toBe("Unlock object");
    expect(lockButton().classList.contains("active")).toBe(true);
    expect(indirectLockHint()).toBeUndefined();
    await click("Unlock object");
    const unlocked = structuredClone(initial);
    unlocked.slides[0].objects[0].locked = false;
    expect(await persist()).toEqual(unlocked);
    expect(lockButton().getAttribute("aria-label")).toBe("Lock object");
    expect(lockButton().classList.contains("active")).toBe(false);
    await click("Arrange");
    expect(
      inspector().querySelector<HTMLInputElement>('[aria-label="Object width"]')
        ?.disabled,
    ).toBe(false);
    await click("Undo");
    expect(await persist()).toEqual(initial);
  });

  it("locks and unlocks an initially unlocked group as separate complete-group Undo steps", async () => {
    const initial = deckWith([
      text("Alpha", false, "research-group"),
      text("Beta", false, "research-group"),
      text("Outside"),
    ]);
    await render(initial);
    await editMember("Beta");
    expect(lockButton().getAttribute("aria-label")).toBe("Lock group");
    expect(lockButton().classList.contains("active")).toBe(false);
    await click("Lock group");
    const locked = structuredClone(initial);
    locked.slides[0].objects[0].locked = true;
    locked.slides[0].objects[1].locked = true;
    expect(await persist()).toEqual(locked);
    expect(lockButton().getAttribute("aria-label")).toBe("Unlock group");
    expect(lockButton().classList.contains("active")).toBe(true);
    await click("Unlock group");
    expect(await persist()).toEqual(initial);
    await click("Undo");
    expect(await persist()).toEqual(locked);
    await click("Undo");
    expect(await persist()).toEqual(initial);
    expect(button("Undo").disabled).toBe(true);
  });
});
