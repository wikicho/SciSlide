// @vitest-environment jsdom
import { setTimeout as pause } from "node:timers/promises";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
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
import { openPdfFigure } from "../src/lib/pdf-figure";

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
vi.mock("../src/lib/pdf-figure", () => ({ openPdfFigure: vi.fn() }));

function initialDeck(): Deck {
  return {
    ...createDemoDeck(),
    id: "external-input-deck",
    title: "External input talk",
    slides: [
      {
        ...createBlankSlide(),
        id: "external-input-slide",
        objects: [],
        notes: "Keep these notes",
      },
    ],
    assets: [],
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
    dataUrl:
      file.type === "image/svg+xml"
        ? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#123456"/></svg>')}`
        : `data:${file.type};base64,aW1hZ2U=`,
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

describe("external file drops in the editor", () => {
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
    vi.mocked(openPdfFigure).mockReset();
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
    await act(async () => vi.advanceTimersByTimeAsync(710));
    return structuredClone(recovered!);
  }
  const canvas = () =>
    host.querySelector<HTMLElement>('[aria-label="Slide canvas"]')!;
  async function render() {
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    const svg = canvas().querySelector<SVGSVGElement>("svg.slide-scene")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 20,
      top: 25,
      width: 800,
      height: 450,
      right: 820,
      bottom: 475,
      x: 20,
      y: 25,
      toJSON() {},
    });
    expect(await persist()).toEqual(initialDeck());
    return svg;
  }
  async function drag(
    type: "dragover" | "drop",
    files: File[],
    target: Element = canvas(),
    coordinates = { clientX: 220, clientY: 175 },
    types = ["Files"],
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...coordinates,
    });
    const transfer = { files, types, dropEffect: "none" };
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    await act(async () => target.dispatchEvent(event));
    return { event, transfer };
  }
  async function settle(condition: () => boolean) {
    for (let count = 0; count < 40 && !condition(); count++)
      await act(async () => pause(5));
    expect(condition()).toBe(true);
  }

  it.each([
    {
      zoom: "50",
      left: 20,
      top: 25,
      width: 800,
      height: 450,
      clientX: 220,
      clientY: 175,
    },
    {
      zoom: "150",
      left: -500,
      top: -200,
      width: 2400,
      height: 1350,
      clientX: 100,
      clientY: 250,
    },
  ])(
    "inserts at slide coordinates after zoom $zoom and a shifted canvas",
    async (geometry) => {
      const svg = await render();
      const zoom = host.querySelector<HTMLInputElement>(
        '[aria-label="Canvas zoom"]',
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(zoom, geometry.zoom);
        zoom.dispatchEvent(new Event("input", { bubbles: true }));
      });
      vi.mocked(svg.getBoundingClientRect).mockReturnValue({
        ...geometry,
        x: geometry.left,
        y: geometry.top,
        right: geometry.left + geometry.width,
        bottom: geometry.top + geometry.height,
        toJSON() {},
      });
      const file = image("result.png");
      const over = await drag("dragover", [file]);
      expect(over.event.defaultPrevented).toBe(true);
      expect(over.transfer.dropEffect).toBe("copy");
      expect(canvas().classList.contains("file-drop-active")).toBe(true);
      const dropped = await drag("drop", [file], canvas(), geometry);
      expect(dropped.event.defaultPrevented).toBe(true);
      expect(canvas().classList.contains("file-drop-active")).toBe(false);
      const current = await persist();
      const figure = current.slides[0].objects[0] as FigureObject;
      expect(figure).toMatchObject({
        type: "figure",
        assetId: asset(file).id,
        transform: { x: 400, y: 300, width: 400, height: 200 },
      });
      expect(current.assets).toEqual([asset(file)]);
      await click("Undo");
      expect(await persist()).toEqual(initialDeck());
    },
  );

  it("preserves PNG/JPEG/SVG file order despite decode order and undoes the entire batch once", async () => {
    await render();
    const files = [
      image("first.png"),
      image("second.jpg", "image/jpeg"),
      image("third.svg", "image/svg+xml"),
    ];
    const pending = files.map(() => deferred<Asset>());
    vi.mocked(importFigure).mockImplementation(
      (file) => pending[files.indexOf(file)].promise,
    );
    await drag("drop", files);
    await act(async () => pending[2].resolve(asset(files[2])));
    await act(async () => pending[0].resolve(asset(files[0])));
    expect(await persist()).toEqual(initialDeck());
    await act(async () => pending[1].resolve(asset(files[1])));
    const current = await persist();
    expect(current.assets.map(({ name }) => name)).toEqual(
      files.map(({ name }) => name),
    );
    expect(
      current.slides[0].objects.map(
        (object) => (object as FigureObject).assetId,
      ),
    ).toEqual(files.map((file) => asset(file).id));
    expect(
      current.slides[0].objects.map(({ transform }) => [
        transform.x,
        transform.y,
      ]),
    ).toEqual([
      [400, 300],
      [428, 328],
      [456, 356],
    ]);
    await click("Undo");
    expect(await persist()).toEqual(initialDeck());
    expect(button("Undo").disabled).toBe(true);
    await click("Redo");
    expect(await persist()).toEqual(current);
  });

  it("rejects an unsupported mixed batch without importing or changing history", async () => {
    await render();
    await drag("drop", [
      image("valid.png"),
      new File(["plain text"], "notes.txt", { type: "text/plain" }),
    ]);
    expect(importFigure).not.toHaveBeenCalled();
    expect(await persist()).toEqual(initialDeck());
    expect(button("Undo").disabled).toBe(true);
    expect(host.textContent).toContain("Drop PNG, JPEG or SVG");
  });

  it("keeps a failed image batch atomic even if another image decoded successfully", async () => {
    await render();
    vi.mocked(importFigure)
      .mockResolvedValueOnce(asset(image("valid.png")))
      .mockRejectedValueOnce(new Error("Corrupt image"));
    await drag("drop", [image("valid.png"), image("broken.png")]);
    expect(await persist()).toEqual(initialDeck());
    expect(button("Undo").disabled).toBe(true);
    expect(host.textContent).toContain("Corrupt image");
  });

  it("uses the shared importer for the file picker and a drop", async () => {
    await render();
    const file = image("result.svg", "image/svg+xml");
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Insert figure file"]',
    )!;
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const picked = await persist();
    await click("Undo");
    await drag("drop", [file]);
    const dropped = await persist();
    expect(importFigure).toHaveBeenNthCalledWith(1, file);
    expect(importFigure).toHaveBeenNthCalledWith(2, file);
    expect(dropped.assets).toEqual(picked.assets);
    const pickedFigure = picked.slides[0].objects[0] as FigureObject;
    const droppedFigure = dropped.slides[0].objects[0] as FigureObject;
    expect(droppedFigure.assetId).toBe(pickedFigure.assetId);
    expect([
      droppedFigure.transform.width,
      droppedFigure.transform.height,
    ]).toEqual([pickedFigure.transform.width, pickedFigure.transform.height]);
  });

  it("confirms a single dropped document, preserves A on Cancel, and clears history after Discard", async () => {
    await render();
    const next = { ...initialDeck(), id: "document-B", title: "Dropped B" };
    vi.mocked(readDeckArchive).mockResolvedValue(next);
    const file = new File(["deck"], "B.scislide");
    await drag("drop", [file]);
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click("Cancel");
    expect(await persist()).toEqual(initialDeck());
    await drag("drop", [file]);
    await click("Discard changes");
    expect(await persist()).toEqual(next);
    expect(button("Undo").disabled).toBe(true);
    expect(importFigure).not.toHaveBeenCalled();
  });

  it("does not import canvas figures when files are dropped over the inline text input", async () => {
    await render();
    await click("Text");
    const input = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit text on slide"]',
    )!;
    expect(input).toBeTruthy();
    const before = await persist();
    const file = image("text-target.png");
    const over = await drag("dragover", [file], input);
    // The document-level guard prevents browser navigation, while the canvas
    // must leave the text field outside its insertion path.
    expect(over.transfer.dropEffect).toBe("none");
    expect(canvas().classList.contains("file-drop-active")).toBe(false);
    await drag("drop", [file], input);
    expect(importFigure).not.toHaveBeenCalled();
    expect(await persist()).toEqual(before);
  });

  it("opens the PDF page picker, preserves the document on cancel, and inserts at the drop position", async () => {
    await render();
    const pdf = new File(["%PDF-1.7"], "paper.pdf", {
      type: "application/pdf",
    });
    const page = asset(image("paper-page-1.png"));
    const source = {
      name: pdf.name,
      pageCount: 2,
      renderPage: vi.fn().mockResolvedValue(page),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(openPdfFigure).mockResolvedValue(source);
    await drag("drop", [pdf]);
    await settle(() => !!host.querySelector(".pdf-figure-dialog"));
    expect(openPdfFigure).toHaveBeenCalledWith(pdf, expect.any(AbortSignal));
    await drag("drop", [image("behind-modal.png")]);
    expect(importFigure).not.toHaveBeenCalled();
    await click("Cancel");
    expect(await persist()).toEqual(initialDeck());
    await drag("drop", [pdf]);
    await settle(
      () =>
        !!host.querySelector(".pdf-figure-dialog") &&
        !button("Insert image").disabled,
    );
    await click("Insert image");
    const current = await persist();
    expect(current.assets).toEqual([page]);
    expect(current.slides[0].objects[0]).toMatchObject({
      type: "figure",
      assetId: page.id,
      transform: { x: 400, y: 300 },
    });
    expect(importFigure).not.toHaveBeenCalled();
  });

  it("explains unsupported web image URL drops without navigating or changing the deck", async () => {
    await render();
    const result = await drag("drop", [], canvas(), undefined, [
      "text/html",
      "text/uri-list",
    ]);
    expect(result.event.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("Web image URLs are not supported");
    expect(await persist()).toEqual(initialDeck());
    expect(importFigure).not.toHaveBeenCalled();
  });
});
