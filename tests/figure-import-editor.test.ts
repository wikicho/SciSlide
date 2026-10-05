// @vitest-environment jsdom
import { setTimeout as pause } from "node:timers/promises";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type { Asset, Deck, FigureObject } from "../src/lib/model";
import { importFigure, loadRecovery } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";

const pdfPage = vi.hoisted(() => ({
  id: "imported-pdf-page-two",
  name: "research.pdf · page 2.png",
  mime: "image/png",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  width: 1600,
  height: 900,
}));

// Keep real history, destination validation, asset ownership and scene rendering.
// The page chooser is a decoding boundary; engine and real-dialog tests cover PDF
// parsing/page preview separately. SVG uses the actual importer and sanitizer.
vi.mock("../src/components/PdfFigureDialog", async () => {
  const { createElement: element } = await import("react");
  return {
    PdfFigureDialog: ({
      file,
      onInsert,
      onCancel,
    }: {
      file: File;
      onInsert(asset: Asset): void;
      onCancel(): void;
    }) =>
      element(
        "section",
        { role: "dialog", "aria-label": "PDF figure page chooser" },
        element("p", { "data-pdf-file": file.name }, file.name),
        element("button", { onClick: onCancel }, "Cancel PDF import"),
        element(
          "button",
          { onClick: () => onInsert(pdfPage) },
          "Insert PDF page 2",
        ),
      ),
  };
});
vi.mock("../src/lib/persistence", async (original) => {
  const real = await original<typeof import("../src/lib/persistence")>();
  return {
    ...real,
    loadRecovery: vi.fn(),
    importFigure: vi.fn(real.importFigure),
  };
});
vi.mock("../src/lib/workspace-recovery", async (original) => ({
  ...(await original<typeof import("../src/lib/workspace-recovery")>()),
  loadWorkspaceRecovery: vi.fn(),
  saveWorkspaceRecovery: vi.fn(),
}));
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));

function replacementDeck() {
  const deck = createDemoDeck();
  const source: Asset = {
    id: "existing-figure-source",
    name: "previous.svg",
    mime: "image/svg+xml",
    dataUrl:
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#0077cc"/></svg>',
      ),
    width: 400,
    height: 200,
  };
  const figure: FigureObject = {
    id: "existing-cropped-figure",
    type: "figure",
    name: "Existing research plot",
    alt: "Keep my plot description",
    assetId: source.id,
    crop: { x: 0.2, y: 0.1, width: 0.5, height: 0.6 },
    transform: { x: 211, y: 153, width: 455, height: 288, rotation: 19 },
    visible: true,
    locked: false,
    opacity: 0.7,
    metadata: { source: "Existing scientific result" },
  };
  deck.slides = [
    { ...createBlankSlide(), title: "Research plot", objects: [figure] },
    { ...createBlankSlide(), title: "Another slide", objects: [] },
  ];
  deck.assets = [source];
  deck.pageNumbers = undefined;
  return { deck, source, figure };
}

describe("PDF and SVG figure import in the editor", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck | undefined;

  beforeEach(() => {
    // Keep shortcut labels deterministic across CI operating systems.
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1600);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "0",
      paddingRight: "0",
      paddingTop: "0",
      paddingBottom: "0",
    } as CSSStyleDeclaration);
    localStorage.clear();
    vi.mocked(loadRecovery).mockReset().mockReturnValue(null);
    vi.mocked(importFigure).mockClear();
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        saved = structuredClone(deck);
        return "localStorage";
      });
    saved = undefined;
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
      (node) =>
        node.getAttribute("aria-label") === label ||
        node.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(710));
    if (!saved) throw new Error("Expected a workspace snapshot");
    return saved;
  }

  async function render(deck?: Deck) {
    vi.mocked(loadRecovery).mockReturnValue(deck ?? null);
    await act(async () => root.render(createElement(App)));
    await click(deck ? "Resume previous work" : "Explore demo");
    return persist();
  }

  function picker(replace = false) {
    const label = replace ? "Replace figure file" : "Insert figure file";
    const found = host.querySelector<HTMLInputElement>(
      `input[type="file"][aria-label="${label}"]`,
    );
    if (!found) throw new Error(`Missing file picker: ${label}`);
    return found;
  }

  async function upload(file: File, replace = false) {
    const input = picker(replace);
    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function settle(condition: () => boolean) {
    for (let i = 0; i < 30 && !condition(); i++)
      await act(async () => pause(5));
    expect(condition()).toBe(true);
  }

  function pdfFile(type = "application/pdf") {
    return new File(["%PDF-1.7\nfixture page chooser"], "research.pdf", {
      type,
    });
  }

  function pageChooser() {
    return host.querySelector(
      '[role="dialog"][aria-label="PDF figure page chooser"]',
    );
  }

  it("offers PDF and SVG alongside PNG and JPEG for insertion and replacement", async () => {
    await render();
    for (const input of [picker(), picker(true)]) {
      const accepts = input.accept.split(",");
      for (const format of [
        ".pdf",
        ".svg",
        "application/pdf",
        "image/svg+xml",
        "image/png",
        "image/jpeg",
      ])
        expect(accepts).toContain(format);
    }
  });

  it.each(["application/pdf", ""])(
    "previews a PDF without committing and leaves the deck intact on Cancel (MIME %s)",
    async (mime) => {
      const before = await render();
      const undoDisabled = button("Undo · Ctrl+Z").disabled;
      await upload(pdfFile(mime));
      await settle(() => !!pageChooser());
      expect(host.querySelector("[data-pdf-file]")?.textContent).toBe(
        "research.pdf",
      );
      expect(importFigure).not.toHaveBeenCalled();
      expect(await persist()).toEqual(before);
      expect(button("Undo · Ctrl+Z").disabled).toBe(undoDisabled);
      await click("Cancel PDF import");
      expect(pageChooser()).toBeNull();
      expect(await persist()).toEqual(before);
      expect(button("Undo · Ctrl+Z").disabled).toBe(undoDisabled);
    },
  );

  it("embeds the selected PDF page on the intended slide as one undoable figure", async () => {
    const before = await render();
    await upload(pdfFile());
    await settle(() => !!pageChooser());
    // The modal normally blocks background controls; changing selection here
    // exercises the async destination guard instead of relying on that overlay.
    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>(".slide-card")[1].click(),
    );
    await click("Insert PDF page 2");
    expect(pageChooser()).toBeNull();
    const current = await persist();
    const created = current.slides[0].objects.find(
      (object) => object.type === "figure" && object.assetId === pdfPage.id,
    ) as FigureObject;
    expect(created).toBeTruthy();
    expect(current.assets).toContainEqual(pdfPage);
    expect(current.slides[1]).toEqual(before.slides[1]);
    expect(created.transform.width).toBeLessThanOrEqual(800);
    expect(created.transform.height).toBeLessThanOrEqual(600);
    expect(
      host.querySelector(`.slide-paper image[href="${pdfPage.dataUrl}"]`),
    ).toBeTruthy();
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(before);
  });

  it("replaces a figure with a PDF page while preserving its frame, crop and description", async () => {
    const { deck, figure } = replacementDeck();
    await render(deck);
    await click("Select Existing research plot");
    await click("Replace figure");
    await upload(pdfFile(), true);
    await settle(() => !!pageChooser());
    expect(await persist()).toEqual(deck);
    await click("Insert PDF page 2");
    const current = await persist();
    expect(current.slides[0].objects[0]).toEqual({
      ...figure,
      assetId: pdfPage.id,
    });
    expect(current.assets).toEqual([pdfPage]);
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(deck);
  });

  it("rejects a pending PDF replacement when its target is locked before insertion", async () => {
    const { deck, figure, source } = replacementDeck();
    await render(deck);
    await click("Select Existing research plot");
    await click("Replace figure");
    await upload(pdfFile(), true);
    await settle(() => !!pageChooser());
    await click("Lock Existing research plot");
    const locked = await persist();
    expect(locked.slides[0].objects[0]).toEqual({ ...figure, locked: true });
    await click("Insert PDF page 2");
    expect(pageChooser()).toBeNull();
    expect(await persist()).toEqual(locked);
    expect(saved?.assets).toEqual([source]);
    expect(host.textContent).toContain(
      "The selected figure changed. Select it again.",
    );
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(deck);
  });

  it("rejects a PDF page whose original destination slide was removed", async () => {
    await render();
    await upload(pdfFile());
    await settle(() => !!pageChooser());
    await click("Delete slide");
    const afterRemoval = await persist();
    await click("Insert PDF page 2");
    expect(pageChooser()).toBeNull();
    expect(await persist()).toEqual(afterRemoval);
    expect(saved?.assets.some((asset) => asset.id === pdfPage.id)).toBe(false);
    expect(host.textContent).toContain(
      "The destination slide is no longer available.",
    );
  });

  it("imports a vector SVG through the real sanitizer and displays its embedded asset", async () => {
    const before = await render();
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" onload="alert(1)"><script>alert(1)</script><path d="M20 160L100 80L300 20" stroke="#0088bb" fill="none"/><image href="https://example.com/tracking.png" width="1" height="1"/></svg>';
    const file = new File([source], "scientific-plot.svg", {
      type: "image/svg+xml",
    });
    await upload(file);
    await settle(() => !host.textContent?.includes("Importing figure"));
    expect(importFigure).toHaveBeenCalledWith(file);
    expect(pageChooser()).toBeNull();
    const current = await persist();
    const asset = current.assets.find((entry) => entry.name === file.name)!;
    expect(asset).toMatchObject({
      mime: "image/svg+xml",
      width: 320,
      height: 180,
    });
    const vector = atob(asset.dataUrl.split(",")[1]);
    expect(vector).toContain('d="M20 160L100 80L300 20"');
    expect(vector).not.toMatch(/script|onload|https:\/\/example\.com/);
    expect(
      host.querySelector(`.slide-paper image[href="${asset.dataUrl}"]`),
    ).toBeTruthy();
    await click("Undo · Ctrl+Z");
    expect(await persist()).toEqual(before);
  });
});
