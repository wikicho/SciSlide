// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import { shapeFromDrag } from "../src/lib/drawing";
import type { Asset, Deck, FigureObject } from "../src/lib/model";
import {
  importFigure,
  loadRecovery,
  readDeckArchive,
} from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  desktop: undefined,
}));
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
  importFigure: vi.fn(),
  readDeckArchive: vi.fn(),
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

function initialDeck(): Deck {
  const demo = createDemoDeck();
  const panel = {
    ...shapeFromDrag("rect", { x: 100, y: 100 }, { x: 200, y: 180 }),
    id: "clipboard-panel",
    name: "Clipboard panel",
    groupId: "clipboard-group",
  };
  const plot: FigureObject = {
    id: "clipboard-plot",
    name: "Clipboard plot",
    type: "figure",
    groupId: "clipboard-group",
    assetId: "clipboard-asset",
    alt: "Original plot",
    transform: { x: 300, y: 100, width: 200, height: 100, rotation: 0 },
    visible: true,
    locked: false,
    opacity: 1,
    metadata: {},
  };
  const title = {
    ...panel,
    id: "clipboard-title",
    name: "Clipboard title",
    groupId: undefined,
    type: "text" as const,
    text: "Internal A",
    fontFamily: "Inter",
    fontSize: 40,
    fontWeight: 400,
    color: "#000000",
    align: "left" as const,
  };
  return {
    ...demo,
    id: "clipboard-deck",
    title: "Clipboard talk",
    slides: [
      {
        ...createBlankSlide(),
        id: "clipboard-slide",
        title: "Clipboard slide",
        objects: [panel, plot, title],
        notes: "Native notes",
      },
    ],
    assets: [{ ...demo.assets[0], id: "clipboard-asset" }],
    pageNumbers: undefined,
  };
}
function image(name: string, mime = "image/png") {
  return new File(["image fixture"], name, { type: mime });
}
function asset(file: File): Asset {
  return {
    id: `asset-${file.name}`,
    name: file.name,
    mime: file.type,
    dataUrl: `data:${file.type};base64,aW1hZ2U=`,
    width: 400,
    height: 200,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("system clipboard in the editor", () => {
  let host: HTMLDivElement;
  let root: Root;
  let recovered: Deck | undefined;

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
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D);
    localStorage.clear();
    recovered = undefined;
    vi.mocked(loadRecovery).mockReset().mockReturnValue(initialDeck());
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        recovered = structuredClone(deck);
        return "localStorage";
      });
    vi.mocked(importFigure)
      .mockReset()
      .mockImplementation(async (file) => asset(file));
    vi.mocked(readDeckArchive).mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(navigator, "clipboard");
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
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return structuredClone(recovered!);
  }
  async function render() {
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
  }
  function transfer(files: File[] = []) {
    const values = new Map<string, string>();
    const data = {
      files,
      getData: (type: string) => values.get(type) ?? "",
      setData: (type: string, value: string) => values.set(type, value),
    };
    return { values, data };
  }
  async function clipboard(
    type: "copy" | "cut" | "paste",
    data: ReturnType<typeof transfer>["data"],
    target: EventTarget = window,
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    await act(async () => target.dispatchEvent(event));
    return event;
  }
  async function open(next: Deck) {
    vi.mocked(readDeckArchive).mockResolvedValueOnce(next);
    const input = host.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".scislide"]',
    )!;
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["deck"], "reopened.scislide")],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Discard changes");
    return persist();
  }

  it("copies and pastes a group with embedded media, relative geometry, and one-step Undo", async () => {
    await render();
    await click("Select Clipboard panel");
    const copied = transfer();
    expect((await clipboard("copy", copied.data)).defaultPrevented).toBe(true);
    expect(copied.values.get("text/plain")).toContain("Clipboard panel");
    await clipboard("paste", copied.data);
    const result = await persist();
    expect(result.slides[0].objects).toHaveLength(5);
    const pasted = result.slides[0].objects.slice(-2);
    expect(pasted[0].groupId).toBe(pasted[1].groupId);
    expect(pasted[0].groupId).not.toBe("clipboard-group");
    expect(pasted[0].transform.x).toBe(132);
    expect(pasted[1].transform.x).toBe(332);
    expect(result.assets).toEqual(initialDeck().assets);
    expect((pasted[1] as FigureObject).assetId).toBe("clipboard-asset");
    await click("Undo");
    expect(await persist()).toEqual(initialDeck());
  });

  it("uses external B after internal A was copied", async () => {
    await render();
    await click("Select Clipboard panel");
    await clipboard("copy", transfer().data);
    const external = transfer();
    external.values.set("text/plain", "External B from another application");
    await clipboard("paste", external.data);
    const result = await persist();
    expect(result.slides[0].objects).toHaveLength(4);
    expect(result.slides[0].objects.at(-1)).toMatchObject({
      type: "text",
      text: "External B from another application",
    });
    await click("Undo");
    expect(await persist()).toEqual(initialDeck());
  });

  it("imports a pasted PNG and removes its object and asset with one Undo", async () => {
    await render();
    const png = image("screenshot.png");
    expect(
      (await clipboard("paste", transfer([png]).data)).defaultPrevented,
    ).toBe(true);
    expect(importFigure).toHaveBeenCalledWith(png);
    const result = await persist();
    expect(result.slides[0].objects.at(-1)).toMatchObject({
      type: "figure",
      assetId: asset(png).id,
    });
    expect(result.assets.at(-1)).toEqual(asset(png));
    await click("Undo");
    expect(await persist()).toEqual(initialDeck());
  });

  it("keeps native copy, cut and paste in text fields and an AI modal without changing background objects", async () => {
    await render();
    const notes = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Speaker notes"]',
    )!;
    await act(async () => notes.focus());
    const external = transfer();
    external.values.set("text/plain", "Native text");
    for (const type of ["copy", "cut", "paste"] as const)
      expect(
        (await clipboard(type, external.data, notes)).defaultPrevented,
      ).toBe(false);
    expect(await persist()).toEqual(initialDeck());
    await click("AI draft");
    const prompt = host.querySelector<HTMLTextAreaElement>(
      '[aria-label="AI slide instructions"]',
    )!;
    expect(prompt).toBeTruthy();
    await act(async () => prompt.focus());
    for (const type of ["copy", "cut", "paste"] as const)
      expect(
        (await clipboard(type, external.data, prompt)).defaultPrevented,
      ).toBe(false);
    const key = new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => prompt.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
    expect(await persist()).toEqual(initialDeck());
    expect(importFigure).not.toHaveBeenCalled();
  });

  it("retains cut originals when the system clipboard cannot be written", async () => {
    await render();
    await click("Select Clipboard panel");
    const failed = transfer();
    failed.data.setData = () => {
      throw new Error("Clipboard write failed");
    };
    await clipboard("cut", failed.data);
    expect(await persist()).toEqual(initialDeck());
    expect(button("Undo").disabled).toBe(true);
    expect(host.textContent).toContain("Clipboard write failed");
  });

  it.each(["new", "same-id"])(
    "ignores an async system paste after document replacement: %s",
    async (replacement) => {
      await render();
      const read = deferred<ClipboardItem[]>();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { read: () => read.promise },
      });
      await click("Paste");
      if (replacement === "new") {
        await act(async () =>
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "n",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
        await click("Create presentation");
        await click("Discard changes");
      } else {
        const reopened = {
          ...initialDeck(),
          title: "Same IDs, new editing session",
        };
        await open(reopened);
      }
      const before = await persist();
      await act(async () =>
        read.resolve([
          {
            types: ["text/plain"],
            getType: async () =>
              ({ text: async () => "Stale clipboard text", size: 20 }) as Blob,
          } as ClipboardItem,
        ]),
      );
      expect(await persist()).toEqual(before);
      expect(JSON.stringify(before)).not.toContain("Stale clipboard text");
    },
  );
});
