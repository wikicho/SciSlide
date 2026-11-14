// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { URL as NodeURL } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import {
  createBlankSlide,
  createDemoDeck,
  type Deck,
  type FigureObject,
} from "../src/lib/model";
import {
  downloadBlob,
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
  downloadBlob: vi.fn(),
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

function blank(): Deck {
  return {
    ...createDemoDeck(),
    id: "figure-notice-deck",
    title: "Figure advice",
    slides: [{ ...createBlankSlide(), id: "figure-notice-slide", objects: [] }],
    assets: [],
    pageNumbers: undefined,
  };
}
function warningSvg() {
  const font = btoa("wOF2" + "\u0000".repeat(8));
  return new File(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><style>@font-face{font-family:Plot;src:url(data:font/woff2;base64,${font})}</style><text font-family="Plot" y="30">Scientific label</text></svg>`,
    ],
    "woff-plot.svg",
    { type: "image/svg+xml" },
  );
}
function safeSvg() {
  return new File(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text font-family="Inter" y="30">Scientific label</text></svg>',
    ],
    "safe.svg",
    { type: "image/svg+xml" },
  );
}
const warning = "This figure's embedded font is not supported in PDF.";

describe("figure export advice through the editor", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 1;
        naturalHeight = 1;
        onload?: () => void;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
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
    vi.mocked(loadRecovery).mockReset().mockReturnValue(blank());
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        saved = structuredClone(deck);
        return "localStorage";
      });
    vi.mocked(downloadBlob).mockReset();
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
  async function settle(condition: () => boolean) {
    for (let count = 0; count < 80 && !condition(); count++)
      await act(async () => pause(5));
    expect(condition()).toBe(true);
  }
  async function render() {
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
  }
  async function upload(file: File, label = "Insert figure file") {
    const input = host.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    )!;
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(() => !host.querySelector(".toast.busy"));
    await persist();
    await click("Style");
  }
  const notice = () =>
    host.querySelector('[aria-label="Figure export compatibility"]');
  const toast = () =>
    host.querySelector(".toast[role=status]")?.textContent ?? "";

  it("shows import and inspector advice, retains source through save/reopen, and keeps Undo atomic", async () => {
    await render();
    await upload(warningSvg());
    expect(toast()).toContain(warning);
    expect(notice()?.textContent).toContain("SVG/PowerPoint");
    const imported = await persist();
    expect(imported.assets).toHaveLength(1);
    expect(imported.slides[0].objects).toHaveLength(1);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await settle(() => vi.mocked(downloadBlob).mock.calls.length === 1);
    const [archive, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(filename).toMatch(/\.scislide$/);
    const restored = await readDeckArchive(archive);
    expect(restored.assets).toEqual(imported.assets);
    await click("Undo");
    expect((await persist()).assets).toEqual([]);
    expect(notice()).toBeNull();
    await click("Redo");
    await persist();
    await click("Select Figure");
    await click("Style");
    expect(notice()?.textContent).toContain(warning);
    await act(async () => root.unmount());
    root = createRoot(host);
    vi.mocked(loadRecovery).mockReturnValue(restored);
    await render();
    await click("Select Figure");
    await click("Style");
    expect(notice()?.textContent).toContain(warning);
  });

  it.each(["ttf", "png"])(
    "imports an ordinary %s figure without compatibility warnings",
    async (format) => {
      await render();
      const file =
        format === "ttf"
          ? new File(
              [
                await readFile(
                  new NodeURL(
                    "../examples/scientific-equation-template.svg",
                    import.meta.url,
                  ),
                  "utf8",
                ),
              ],
              "ttf-example.svg",
              { type: "image/svg+xml" },
            )
          : new File(
              [
                Buffer.from(
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=",
                  "base64",
                ),
              ],
              "pixel.png",
              { type: "image/png" },
            );
      await upload(file);
      expect(saved.assets).toHaveLength(1);
      expect(notice()).toBeNull();
      expect(toast()).not.toContain("not supported in PDF");
    },
  );

  it("updates advice for replacement and restores the original asset and layout with one Undo", async () => {
    await render();
    await upload(safeSvg());
    expect(notice()).toBeNull();
    const before = await persist();
    await click("Replace figure");
    await upload(warningSvg(), "Replace figure file");
    const after = await persist();
    expect(notice()?.textContent).toContain(warning);
    expect(toast()).toContain(warning);
    expect(after.slides[0].objects[0]).toMatchObject({
      id: before.slides[0].objects[0].id,
      transform: before.slides[0].objects[0].transform,
    });
    expect((after.slides[0].objects[0] as FigureObject).assetId).not.toBe(
      (before.slides[0].objects[0] as FigureObject).assetId,
    );
    await click("Undo");
    expect(await persist()).toEqual(before);
    expect(notice()).toBeNull();
  });

  it("reports a mixed batch once and undoes all imported figures together", async () => {
    await render();
    const canvas = host.querySelector('[aria-label="Slide canvas"]')!;
    const event = new MouseEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: 250,
      clientY: 200,
    });
    Object.defineProperty(event, "dataTransfer", {
      value: { files: [safeSvg(), warningSvg()], types: ["Files"] },
    });
    await act(async () => canvas.dispatchEvent(event));
    await settle(() => !host.querySelector(".toast.busy"));
    await persist();
    expect(saved.assets.map((asset) => asset.name)).toEqual([
      "safe.svg",
      "woff-plot.svg",
    ]);
    expect(toast().split(warning)).toHaveLength(2);
    expect(saved.slides[0].objects).toHaveLength(2);
    await click("Undo");
    expect(await persist()).toEqual(blank());
  });
});
