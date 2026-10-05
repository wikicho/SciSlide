// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfFigureDialog } from "../src/components/PdfFigureDialog";
import { openPdfFigure } from "../src/lib/pdf-figure";
import type { Asset } from "../src/lib/model";

vi.mock("../src/lib/pdf-figure", () => ({ openPdfFigure: vi.fn() }));

function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function asset(page: number): Asset {
  return {
    id: `pdf-page-${page}`,
    name: `research-page-${page}.png`,
    mime: "image/png",
    dataUrl: `data:image/png;base64,cGFnZQ==#${page}`,
    width: 2400,
    height: 1600,
  };
}

describe("PDF image page picker", () => {
  let host: HTMLDivElement;
  let opener: HTMLButtonElement;
  let root: Root;
  let onInsert: ReturnType<typeof vi.fn<(value: Asset) => void>>;
  let onCancel: ReturnType<typeof vi.fn<() => void>>;
  let file: File;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(openPdfFigure).mockReset();
    host = document.createElement("div");
    opener = document.createElement("button");
    opener.textContent = "Insert image";
    document.body.append(opener, host);
    opener.focus();
    root = createRoot(host);
    onInsert = vi.fn();
    onCancel = vi.fn();
    file = new File(["%PDF-1.7"], "research.pdf", { type: "application/pdf" });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    opener.remove();
    vi.unstubAllGlobals();
  });

  async function mount(extra: { title?: string; actionLabel?: string } = {}) {
    await act(async () =>
      root.render(
        createElement(PdfFigureDialog, { file, onInsert, onCancel, ...extra }),
      ),
    );
  }

  function button(label: string): HTMLButtonElement {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === label ||
        candidate.textContent?.trim() === label,
    );
    if (!result) throw new Error(`Missing PDF control: ${label}`);
    return result;
  }

  async function click(control: Element) {
    await act(async () =>
      control.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  }

  async function key(key: string, shiftKey = false) {
    const event = new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.activeElement?.dispatchEvent(event));
    return event;
  }

  function mockSource() {
    const source = {
      name: "research.pdf",
      pageCount: 4,
      renderPage: vi
        .fn<(page: number, signal?: AbortSignal) => Promise<Asset>>()
        .mockImplementation(async (page) => asset(page)),
      destroy: vi.fn<() => Promise<void>>().mockResolvedValue(),
    };
    vi.mocked(openPdfFigure).mockResolvedValue(source);
    return source;
  }

  it("waits for preview and inserts the same high-resolution rendered asset", async () => {
    const source = mockSource();
    const opening = deferred<typeof source>();
    vi.mocked(openPdfFigure).mockReturnValue(opening.promise);
    await mount();
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby")!)
        ?.textContent,
    ).toBe("Choose a PDF page.");
    expect(host.querySelector("[role=status]")?.textContent).toContain(
      "Opening PDF",
    );
    expect(button("Insert image").disabled).toBe(true);
    expect(button("Next PDF page").disabled).toBe(true);
    expect(document.activeElement).toBe(button("Close PDF import"));
    await act(async () => opening.resolve(source));
    expect(source.renderPage).toHaveBeenCalledExactlyOnceWith(
      1,
      expect.any(AbortSignal),
    );
    expect(host.querySelector("img")?.alt).toBe("research.pdf, page 1");
    expect(button("Previous PDF page").disabled).toBe(true);
    expect(button("Insert image").disabled).toBe(false);
    await click(button("Insert image"));
    expect(onInsert).toHaveBeenCalledExactlyOnceWith(asset(1));
    expect(source.renderPage).toHaveBeenCalledTimes(1);
    expect(host.querySelector("footer")?.textContent).toContain(
      "Processed on this device",
    );
  });

  it("serializes rapid page changes and never inserts an outdated preview", async () => {
    const source = mockSource();
    const first = deferred<Asset>(),
      fourth = deferred<Asset>();
    source.renderPage.mockImplementation((page) =>
      page === 1 ? first.promise : fourth.promise,
    );
    await mount();
    const firstSignal = source.renderPage.mock.calls[0][1]!;
    await click(button("Next PDF page"));
    await click(button("Next PDF page"));
    await click(button("Next PDF page"));
    expect(firstSignal.aborted).toBe(true);
    expect(button("Insert image").disabled).toBe(true);
    expect(button("Next PDF page").disabled).toBe(true);
    expect(host.querySelector("[role=status]")?.textContent).toContain(
      "page 4",
    );
    expect(source.renderPage.mock.calls.map(([page]) => page)).toEqual([1]);
    await act(async () => first.resolve(asset(1)));
    expect(source.renderPage.mock.calls.map(([page]) => page)).toEqual([1, 4]);
    expect(host.querySelector("img")).toBeNull();
    expect(button("Insert image").disabled).toBe(true);
    await act(async () => fourth.resolve(asset(4)));
    expect(host.querySelector("img")?.alt).toBe("research.pdf, page 4");
    await click(button("Insert image"));
    expect(onInsert).toHaveBeenCalledExactlyOnceWith(asset(4));
  });

  it("accepts a page number and keeps the last valid page for blank input", async () => {
    const source = mockSource();
    await mount();
    const input = host.querySelector<HTMLInputElement>(
      "input[aria-label='PDF page']",
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(source.renderPage.mock.calls.map(([page]) => page)).toEqual([1, 3]);
    expect(host.querySelector("img")?.alt).toBe("research.pdf, page 3");
    await act(async () => {
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(source.renderPage).toHaveBeenCalledTimes(2);
    expect(button("Insert image").disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    input.focus();
    await act(async () => button("Cancel").focus());
    expect(input.value).toBe("3");
    expect(button("Insert image").disabled).toBe(false);
    await click(button("Previous PDF page"));
    expect(input.value).toBe("2");
    expect(host.querySelector("img")?.alt).toBe("research.pdf, page 2");
  });

  it("exposes errors and keeps image insertion disabled", async () => {
    vi.mocked(openPdfFigure).mockRejectedValue(
      new Error("This PDF is password protected."),
    );
    await mount();
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "password protected",
    );
    expect(button("Insert image").disabled).toBe(true);
    expect(button("Next PDF page").disabled).toBe(true);
    expect(host.querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    await click(button("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels rendering on Escape, traps focus, and restores the opener", async () => {
    const source = mockSource();
    const rendering = deferred<Asset>();
    source.renderPage.mockReturnValue(rendering.promise);
    await mount({
      title: "Replace image from PDF.",
      actionLabel: "Replace image",
    });
    const first = button("Close PDF import"),
      last = button("Cancel");
    expect((await key("Tab", true)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect((await key("Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const signal = source.renderPage.mock.calls[0][1]!;
    expect((await key("Escape")).defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(true);
    expect(source.destroy).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
    await act(async () => rendering.resolve(asset(1)));
    expect(onInsert).not.toHaveBeenCalled();
    expect(source.destroy).toHaveBeenCalledOnce();
  });

  it("destroys a document that finishes opening after cancellation", async () => {
    const source = mockSource();
    const opening = deferred<typeof source>();
    vi.mocked(openPdfFigure).mockReturnValue(opening.promise);
    await mount();
    const signal = vi.mocked(openPdfFigure).mock.calls[0][1]!;
    await click(button("Cancel"));
    expect(signal.aborted).toBe(true);
    await act(async () => opening.resolve(source));
    expect(source.destroy).toHaveBeenCalledOnce();
    expect(source.renderPage).not.toHaveBeenCalled();
    expect(host.querySelector("img")).toBeNull();
    expect(onInsert).not.toHaveBeenCalled();
  });
});
