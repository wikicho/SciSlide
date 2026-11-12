// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { shapeFromDrag } from "../src/lib/drawing";
import { createBlankSlide, createDemoDeck, newId } from "../src/lib/model";
import type { Asset, Deck, FigureObject, SlideObject } from "../src/lib/model";
import { importFigure, loadRecovery } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

// Keep real editor history, selection, media ownership and scene rendering.
// Only persistence and the file-decoding boundary are replaced with fixtures.
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
  importFigure: vi.fn(),
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

function rectangle(name: string, x = 200, y = 250, width = 100, height = 80) {
  return {
    ...shapeFromDrag("rect", { x, y }, { x: x + width, y: y + height }),
    name,
  };
}

function deckWith(objects: SlideObject[], assets: Asset[] = []): Deck {
  return {
    ...createDemoDeck(),
    title: "Convenience editor tests",
    slides: [
      { ...createBlankSlide(), title: "Source", objects },
      { ...createBlankSlide(), title: "Destination", objects: [] },
    ],
    assets,
    pageNumbers: undefined,
  };
}

describe("editor convenience flows", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck;

  beforeEach(() => {
    // Keep shortcut labels deterministic across CI operating systems.
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1600,
      bottom: 900,
      width: 1600,
      height: 900,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "0",
      paddingRight: "0",
      paddingTop: "0",
      paddingBottom: "0",
    } as CSSStyleDeclaration);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1600);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(900);
    localStorage.clear();
    vi.mocked(loadRecovery).mockReset();
    vi.mocked(importFigure).mockReset();
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

  async function persist() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(710);
    });
    return saved;
  }

  async function render(deck: Deck) {
    vi.mocked(loadRecovery).mockReturnValue(deck);
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
  }

  function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing editor button: ${label}`);
    return found;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function key(
    value: string,
    options: KeyboardEventInit = {},
    target: EventTarget = window,
  ) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event;
  }

  async function slide(index: number) {
    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>(".slide-card")[index].click(),
    );
  }

  it.each([
    ["Linux x86_64", { ctrlKey: true }],
    ["Win32", { ctrlKey: true }],
    ["MacIntel", { metaKey: true }],
  ])(
    "copies and repeatedly pastes the focused slide on %s, with undo and redo",
    async (platform, modifiers) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const locked = rectangle("Locked background");
      locked.locked = true;
      const deck = deckWith([locked]);
      deck.slides[0].notes = "Keep my notes";
      deck.slides[0].background = "#123456";
      await render(deck);
      const source = button("Slide 1: Source");
      await act(async () => source.focus());
      await key("c", modifiers, source);
      expect(await persist()).toEqual(deck);
      const destination = button("Slide 2: Destination");
      await act(async () => destination.focus());
      await key("v", modifiers, destination);
      let current = await persist();
      expect(current.slides.map((item) => item.title)).toEqual([
        "Source",
        "Destination",
        "Source",
      ]);
      expect(current.slides[2]).toMatchObject({
        notes: "Keep my notes",
        background: "#123456",
      });
      expect(current.slides[2].objects[0].transform).toEqual(locked.transform);
      expect(current.slides[2].objects[0].id).not.toBe(locked.id);
      expect(current.slides[2].objects[0].locked).toBe(true);
      expect(document.activeElement?.getAttribute("data-slide-id")).toBe(
        current.slides[2].id,
      );
      await key("v", modifiers, document.activeElement!);
      current = await persist();
      expect(current.slides).toHaveLength(4);
      expect(current.slides[3].objects[0].id).not.toBe(
        current.slides[2].objects[0].id,
      );
      await key("z", modifiers);
      expect((await persist()).slides).toHaveLength(3);
      await key("z", modifiers);
      expect(await persist()).toEqual(deck);
      await key(platform === "MacIntel" ? "Z" : "y", {
        ...modifiers,
        shiftKey: platform === "MacIntel",
      });
      expect((await persist()).slides).toHaveLength(3);
    },
  );

  it("cuts a complete slide, restores pruned media on paste and undoes each edit", async () => {
    const asset = createDemoDeck().assets[0];
    const figure: FigureObject = {
      ...rectangle("Plot"),
      type: "figure",
      assetId: asset.id,
      alt: "plot",
    };
    const deck = deckWith([figure], [asset]);
    await render(deck);
    const source = button("Slide 1: Source");
    await act(async () => source.focus());
    await key("x", { ctrlKey: true }, source);
    let current = await persist();
    expect(current.slides.map((item) => item.title)).toEqual(["Destination"]);
    expect(current.assets).toEqual([]);
    const remaining = button("Slide 1: Destination");
    await key("x", { ctrlKey: true }, remaining);
    expect(await persist()).toEqual(current);
    await key("v", { ctrlKey: true }, remaining);
    current = await persist();
    expect(current.slides.map((item) => item.title)).toEqual([
      "Destination",
      "Source",
    ]);
    expect(current.assets[0].dataUrl).toBe(asset.dataUrl);
    await key("z", { ctrlKey: true });
    expect((await persist()).slides).toHaveLength(1);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it("exposes slide copy and paste buttons and keeps object clipboard actions separate", async () => {
    const deck = deckWith([rectangle("Plot")]);
    await render(deck);
    expect(button("Paste copied slide").disabled).toBe(true);
    await click("Copy slide");
    expect(button("Paste copied slide").disabled).toBe(false);
    await slide(1);
    await click("Paste copied slide");
    expect((await persist()).slides.map((item) => item.title)).toEqual([
      "Source",
      "Destination",
      "Source",
    ]);
    await click("Select Plot");
    await act(async () =>
      host.querySelector<HTMLElement>('[aria-label="Slide canvas"]')!.focus(),
    );
    await key("c", { ctrlKey: true });
    expect(button("Paste copied slide").disabled).toBe(true);
    await key("v", { ctrlKey: true });
    const current = await persist();
    expect(current.slides).toHaveLength(3);
    expect(current.slides[2].objects).toHaveLength(2);
  });

  it("adds slides immediately, repeats the last chosen layout and records one undo step per insertion", async () => {
    const deck = deckWith([]);
    await render(deck);
    await click("New slide");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    let current = await persist();
    expect(current.slides.map((slide) => slide.title)).toEqual([
      "Source",
      "Key findings",
      "Destination",
    ]);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
    await click("Choose slide layout");
    await click("Blank slide");
    const afterLayout = await persist();
    await click("New slide");
    current = await persist();
    expect(current.slides).toHaveLength(4);
    expect(current.slides[2].objects).toEqual([]);
    expect(current.slides[2].id).not.toBe(current.slides[1].id);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(afterLayout);
  });

  it("collapses notes without losing slide content and resizes notes without editing the deck", async () => {
    const deck = deckWith([]);
    deck.slides[0].notes = "A source reminder";
    await render(deck);
    expect(button("Toggle speaker notes").getAttribute("aria-expanded")).toBe(
      "false",
    );
    await click("Toggle speaker notes");
    const notes = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Speaker notes"]',
    )!;
    expect(notes.value).toBe("A source reminder");
    const handle = host.querySelector<HTMLElement>(
      '[aria-label="Resize speaker notes"]',
    )!;
    await key("ArrowUp", {}, handle);
    expect(handle.getAttribute("aria-valuenow")).toBe("150");
    await click("Toggle speaker notes");
    await click("Toggle speaker notes");
    expect(notes.value).toBe("A source reminder");
    await slide(1);
    expect(notes.value).toBe("");
    await slide(0);
    expect(notes.value).toBe("A source reminder");
    expect(await persist()).toEqual(deck);
  });

  it("shows one Format tab at a time and changes panel width without adding document history", async () => {
    const deck = deckWith([rectangle("Plot")]);
    await render(deck);
    const inspector = host.querySelector<HTMLElement>(
      '[aria-label="Inspector panel"]',
    )!;
    const layers = host.querySelector<HTMLElement>(
      '[aria-label="Objects and layers panel"]',
    )!;
    expect(inspector.hidden).toBe(false);
    expect(layers.hidden).toBe(true);
    await click("Layers");
    expect(inspector.hidden).toBe(true);
    expect(layers.hidden).toBe(false);
    await click("Style");
    await click("Select Plot");
    expect(
      host.querySelector<HTMLElement>('[data-inspector-section="style"]')!
        .hidden,
    ).toBe(false);
    await click("Arrange");
    expect(
      host.querySelector<HTMLElement>('[data-inspector-section="style"]')!
        .hidden,
    ).toBe(true);
    expect(
      host.querySelector<HTMLElement>('[data-inspector-section="arrange"]')!
        .hidden,
    ).toBe(false);
    await click("Document");
    expect(
      host.querySelector<HTMLElement>('[data-inspector-section="document"]')!
        .hidden,
    ).toBe(false);
    const handle = host.querySelector<HTMLElement>(
      '[aria-label="Resize Format panel"]',
    )!;
    await key("ArrowLeft", {}, handle);
    expect(handle.getAttribute("aria-valuenow")).toBe("318");
    expect(await persist()).toEqual(deck);
  });

  it("selects unlocked visible units, cuts complete groups, pastes across slides after media pruning and undoes both edits", async () => {
    const asset = createDemoDeck().assets[0];
    const figure: FigureObject = {
      ...rectangle("Plot"),
      type: "figure",
      assetId: asset.id,
      alt: "plot",
    };
    const hidden = rectangle("Hidden annotation", 400, 250);
    figure.groupId = hidden.groupId = "source-group";
    hidden.visible = false;
    const locked = rectangle("Locked background");
    locked.locked = true;
    const deck = deckWith([locked, figure, hidden], [asset]);
    await render(deck);
    expect((await key("a", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(button("Select Plot").getAttribute("aria-pressed")).toBe("true");
    expect(
      button("Select Hidden annotation").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      button("Select Locked background").getAttribute("aria-pressed"),
    ).toBe("false");
    await key("x", { ctrlKey: true });
    let current = await persist();
    expect(current.slides[0].objects).toEqual([locked]);
    expect(current.assets).toEqual([]);
    await slide(1);
    await key("v", { ctrlKey: true });
    current = await persist();
    expect(current.slides[1].objects).toHaveLength(2);
    const [pastedFigure, pastedHidden] = current.slides[1].objects;
    expect(pastedFigure.type).toBe("figure");
    expect(pastedFigure.id).not.toBe(figure.id);
    expect(pastedFigure.groupId).toBe(pastedHidden.groupId);
    expect(pastedFigure.groupId).not.toBe("source-group");
    expect(pastedHidden.visible).toBe(false);
    expect(pastedFigure.transform.x).toBe(figure.transform.x + 32);
    expect(current.assets).toHaveLength(1);
    expect(current.assets[0].dataUrl).toBe(asset.dataUrl);
    expect((pastedFigure as FigureObject).assetId).toBe(current.assets[0].id);
    await key("z", { ctrlKey: true });
    current = await persist();
    expect(current.slides[1].objects).toEqual([]);
    expect(current.slides[0].objects).toEqual([locked]);
    expect(current.assets).toEqual([]);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it("allows copying a locked object while cut and native text-field shortcuts preserve the deck", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const locked = rectangle("Locked plot");
    locked.locked = true;
    const deck = deckWith([locked]);
    await render(deck);
    await click("Select Locked plot");
    await key("c", { metaKey: true });
    await key("x", { metaKey: true });
    expect(await persist()).toEqual(deck);
    const notes = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Speaker notes"]',
    )!;
    for (const shortcut of ["a", "c", "x", "v"])
      expect(
        (await key(shortcut, { metaKey: true }, notes)).defaultPrevented,
      ).toBe(false);
    expect(await persist()).toEqual(deck);
    await slide(1);
    await key("v", { metaKey: true });
    const current = await persist();
    expect(current.slides[1].objects).toHaveLength(1);
    expect(current.slides[1].objects[0].locked).toBe(true);
    expect(current.slides[1].objects[0].id).not.toBe(locked.id);
  });

  it("omits object-position alignment buttons while retaining text alignment and spacing controls", async () => {
    const source = createDemoDeck().slides[0].objects.find(
      (object) => object.type === "text",
    );
    if (!source) throw new Error("Missing demo text fixture");
    const text = {
      ...source,
      name: "Text",
      text: "Text alignment remains",
      align: "left" as const,
    };
    const deck = deckWith([text]);
    await render(deck);
    await click("Select Text");
    const labels = [...host.querySelectorAll<HTMLButtonElement>("button")].map(
      (element) =>
        element.getAttribute("aria-label") ?? element.textContent?.trim(),
    );
    for (const direction of [
      "left",
      "center",
      "right",
      "top",
      "middle",
      "bottom",
    ]) {
      expect(labels).not.toContain(`Align ${direction}`);
      expect(labels).not.toContain(
        direction[0].toUpperCase() + direction.slice(1),
      );
    }
    for (const label of [
      "Distribute horizontally",
      "Distribute vertically",
      "Equal horizontal gaps",
      "Equal vertical gaps",
      "Group",
      "Ungroup",
      "Send back",
      "Bring front",
    ]) {
      expect(button(label)).toBeDefined();
    }
    expect(button("Align text left").getAttribute("aria-pressed")).toBe("true");
    expect(button("Align text right")).toBeDefined();
    await click("Align text center");
    expect((await persist()).slides[0].objects[0]).toEqual({
      ...text,
      align: "center",
    });
    expect(button("Align text center").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(button("Align text left").getAttribute("aria-pressed")).toBe(
      "false",
    );
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });

  it.each(["x", "y"] as const)(
    "distributes %s gaps with the toolbar while preserving its anchors",
    async (axis) => {
      const shapes =
        axis === "x"
          ? [
              rectangle("First", 100, 20, 80),
              rectangle("Middle", 250, 30, 120),
              rectangle("Last", 700, 40, 200),
            ]
          : [
              rectangle("First", 20, 100, 100, 80),
              rectangle("Middle", 30, 250, 100, 120),
              rectangle("Last", 40, 700, 100, 200),
            ];
      const deck = deckWith(shapes);
      await render(deck);
      await key("a", { ctrlKey: true });
      await click(
        axis === "x" ? "Distribute horizontally" : "Distribute vertically",
      );
      const current = await persist();
      expect(current.slides[0].objects[0]).toEqual(shapes[0]);
      expect(current.slides[0].objects[1].transform[axis]).toBe(380);
      expect(current.slides[0].objects[2]).toEqual(shapes[2]);
      await key("z", { ctrlKey: true });
      expect(await persist()).toEqual(deck);
    },
  );

  it("hides, selects, renames and reorders objects through the layer panel", async () => {
    const a = rectangle("Back");
    const b = rectangle("Middle");
    const c = rectangle("Front");
    await render(deckWith([a, b, c]));
    await click("Hide Middle");
    expect((await persist()).slides[0].objects[1].visible).toBe(false);
    expect(host.querySelectorAll(".slide-paper .canvas-object")).toHaveLength(
      2,
    );
    await click("Select Middle");
    expect(button("Select Middle").getAttribute("aria-pressed")).toBe("true");
    await click("Rename Middle");
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Rename Middle"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Hidden label");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await key("Enter", {}, input);
    expect((await persist()).slides[0].objects[1].name).toBe("Hidden label");
    await click("Move Back forward");
    expect(
      (await persist()).slides[0].objects.map((object) => object.id),
    ).toEqual([b.id, a.id, c.id]);
    await key("z", { ctrlKey: true });
    expect(
      (await persist()).slides[0].objects.map((object) => object.id),
    ).toEqual([a.id, b.id, c.id]);
  });

  it("moves an interleaved group backward as the atomic unit shown by the layer panel", async () => {
    const first = rectangle("Group first");
    const between = rectangle("Between");
    const last = rectangle("Group last");
    first.groupId = last.groupId = "interleaved";
    await render(deckWith([first, between, last]));
    expect(button("Move Group first backward").disabled).toBe(false);
    await click("Move Group first backward");
    expect(
      (await persist()).slides[0].objects.map((object) => object.id),
    ).toEqual([first.id, last.id, between.id]);
  });

  it("replaces figure bytes while preserving frame, crop, metadata and appearance, and restores them with Undo", async () => {
    const oldAsset = createDemoDeck().assets[0];
    const replacement = {
      ...oldAsset,
      id: newId(),
      name: "new-result.svg",
      width: 900,
      height: 100,
    };
    const figure: FigureObject = {
      ...rectangle("Result plot", 200, 150, 500, 300),
      type: "figure",
      assetId: oldAsset.id,
      alt: "Result plot",
      opacity: 0.7,
      crop: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
      build: { step: 3, effect: "fade", durationMs: 300 },
      metadata: { source: "simulation" },
    };
    figure.transform.rotation = 15;
    const deck = deckWith([figure], [oldAsset]);
    await render(deck);
    await click("Select Result plot");
    vi.mocked(importFigure).mockResolvedValue(replacement);
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    await click("Replace figure");
    const input = inputClick.mock.instances[0] as HTMLInputElement;
    const file = new File(["fixture"], "new-result.svg", {
      type: "image/svg+xml",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const current = await persist();
    expect(importFigure).toHaveBeenCalledWith(file);
    expect(current.slides[0].objects[0]).toEqual({
      ...figure,
      assetId: replacement.id,
    });
    expect(current.assets).toEqual([replacement]);
    await key("z", { ctrlKey: true });
    expect(await persist()).toEqual(deck);
  });
});
