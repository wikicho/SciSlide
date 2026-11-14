// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import * as equations from "../src/lib/equations";
import { shapeFromDrag } from "../src/lib/drawing";
import {
  createBlankSlide,
  createDemoDeck,
  type Deck,
  type SlideObject,
  type TextObject,
} from "../src/lib/model";
import { loadRecovery } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

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

function text(name: string, x = 100): TextObject {
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
    transform: { x, y: 100, width: 400, height: 100, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
  };
}
function rectangle(name: string, x: number) {
  return {
    ...shapeFromDrag("rect", { x, y: 250 }, { x: x + 100, y: 330 }),
    name,
  };
}
function deckWith(objects: SlideObject[] = []): Deck {
  return {
    ...createDemoDeck(),
    id: "selection-ux-deck",
    title: "Selection UX",
    slides: [
      {
        ...createBlankSlide(),
        id: "selection-slide",
        title: "Selection",
        objects,
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}

describe("selection guidance in the editor", () => {
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
    vi.spyOn(equations, "renderEquation").mockResolvedValue({
      width: 100,
      height: 44,
      baseline: 32,
      svg: '<svg width="100" height="44"><path d="M0 20L100 20"/></svg>',
    });
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
  function button(label: string, container: Element = host) {
    const found = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label ||
        element.getAttribute("aria-label")?.startsWith(`${label} · `),
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  async function click(label: string, options: MouseEventInit = {}) {
    await act(async () =>
      button(label).dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      ),
    );
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
  async function select(...names: string[]) {
    await click("Layers");
    for (const [index, name] of names.entries())
      await click(`Select ${name}`, { shiftKey: index > 0 });
    await click("Style");
  }
  const summary = () => host.querySelector('[aria-label="Selected objects"]');
  const canvas = () =>
    host.querySelector<HTMLElement>('[aria-label="Slide canvas"]')!;
  function visible(selector: string) {
    const field = host.querySelector(selector);
    return !!field && !field.closest("[hidden]");
  }
  async function key(value: string, target: EventTarget = canvas()) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  it("summarizes a mixed selection, hides first-object fields and keeps grouping one undo step", async () => {
    const first = text("Alpha"),
      second = rectangle("Beta", 700);
    const initial = deckWith([first, second]);
    await render(initial);
    await select("Alpha", "Beta");
    expect(summary()?.textContent).toContain("Alpha");
    expect(summary()?.textContent).toContain("Beta");
    expect(visible('textarea[aria-label="Text content"]')).toBe(false);
    expect(await persist()).toEqual(initial);
    expect(button("Undo").disabled).toBe(true);
    await click("Arrange selection");
    expect(button("Arrange").getAttribute("aria-selected")).toBe("true");
    expect(visible('input[aria-label="Object x"]')).toBe(false);
    expect(visible('input[aria-label="Object width"]')).toBe(false);
    expect(button("Group").disabled).toBe(false);
    await click("Group");
    const grouped = await persist();
    expect(grouped.slides[0].objects[0].groupId).toBeTruthy();
    expect(grouped.slides[0].objects[1].groupId).toBe(
      grouped.slides[0].objects[0].groupId,
    );
    await click("Undo");
    expect(await persist()).toEqual(initial);
  });

  it("enters one grouped member's Style editor without ungrouping or changing document history", async () => {
    const alpha = { ...text("Alpha"), groupId: "prose-group" };
    const beta = { ...text("Beta", 700), groupId: "prose-group" };
    const initial = deckWith([alpha, beta]);
    await render(initial);
    await select("Alpha");
    expect(summary()).toBeTruthy();
    const members = summary()!.querySelector("details")!;
    await act(async () => members.querySelector("summary")!.click());
    expect(members.open).toBe(true);
    await click("Edit Beta");
    expect(summary()).toBeNull();
    expect(button("Style").getAttribute("aria-selected")).toBe("true");
    expect(
      host.querySelector<HTMLTextAreaElement>('[aria-label="Text content"]')
        ?.value,
    ).toBe("Beta content");
    expect(document.activeElement).toBe(
      host.querySelector('[aria-label="Inspector panel"]'),
    );
    expect(await persist()).toEqual(initial);
    expect(button("Undo").disabled).toBe(true);
    await click("Arrange");
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Object width"]')
        ?.disabled,
    ).toBe(true);
  });

  it("starts an empty slide through existing text, equation and figure actions", async () => {
    const initial = deckWith();
    await render(initial);
    expect(host.querySelector(".inspector-empty h2")?.textContent).toBe(
      "Start this slide",
    );
    await click("Add text");
    expect(host.querySelector(".recovery-state")?.textContent).toBe(
      "Saving locally…",
    );
    await persist();
    expect(host.querySelector(".recovery-state")?.textContent).toContain(
      "Saved locally",
    );
    expect(saved.slides[0].objects).toHaveLength(1);
    expect(saved.slides[0].objects[0].type).toBe("text");
    const field = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Edit text on slide"]',
    )!;
    expect(document.activeElement).toBe(field);
    await key("Escape", field);
    await click("Undo");
    expect(await persist()).toEqual(initial);
    await click("Add equation");
    await persist();
    expect(saved.slides[0].objects).toHaveLength(1);
    expect(saved.slides[0].objects[0].type).toBe("equation");
    expect(host.querySelector(".equation-editor-dialog")).toBeTruthy();
    await click("Close equation editor");
    await click("Undo");
    expect(await persist()).toEqual(initial);
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Insert figure file"]',
    )!;
    const choose = vi.spyOn(input, "click").mockImplementation(() => {});
    await click("Add figure");
    expect(choose).toHaveBeenCalledOnce();
    expect(await persist()).toEqual(initial);
    expect(button("Undo").disabled).toBe(true);
  });

  it("explains Enter editing for selected text and keeps cancel from changing the document", async () => {
    const initial = deckWith([text("Alpha")]);
    await render(initial);
    await select("Alpha");
    expect(host.querySelector(".canvas-hint")?.textContent).toMatch(
      /Enter.*edit/,
    );
    await act(async () => canvas().focus());
    await key("Enter");
    const field = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Edit text on slide"]',
    )!;
    expect(field).toBeTruthy();
    expect(host.querySelector(".canvas-hint")?.textContent).toContain(
      "Editing text",
    );
    await key("Escape", field);
    expect(await persist()).toEqual(initial);
    expect(button("Undo").disabled).toBe(true);
  });

  it("explains a locked selection and keeps Enter from starting an editor", async () => {
    const initial = deckWith([{ ...text("Locked title"), locked: true }]);
    await render(initial);
    await select("Locked title");
    expect(host.querySelector(".canvas-hint")?.textContent).toMatch(/locked/i);
    await act(async () => canvas().focus());
    await key("Enter");
    expect(host.querySelector('[aria-label="Edit text on slide"]')).toBeNull();
    expect(await persist()).toEqual(initial);
    expect(button("Undo").disabled).toBe(true);
  });

  it("keeps editable bulk actions available when the first selected object is locked", async () => {
    const locked = { ...rectangle("Locked", 100), locked: true },
      editable = rectangle("Editable", 500);
    const initial = deckWith([locked, editable]);
    await render(initial);
    await select("Locked", "Editable");
    await click("Arrange selection");
    expect(
      host.querySelector('[aria-label="Inspector panel"]')?.textContent,
    ).toContain(
      "Select at least 3 unlocked objects or groups to distribute them.",
    );
    expect(button("Equal horizontal gaps").disabled).toBe(true);
    expect(button("Group").disabled).toBe(true);
    expect(button("Delete").disabled).toBe(false);
    await click("Delete");
    expect((await persist()).slides[0].objects).toEqual([locked]);
    await click("Undo");
    expect(await persist()).toEqual(initial);
  });
});
