// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPdfFigure, openPdfFigure } from "../src/lib/pdf-figure";
import { MAX_FIGURE_BYTES } from "../src/lib/persistence";

const boundary = vi.hoisted(() => ({
  getDocument: vi.fn(),
  createWorker: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({
  getDocument: boundary.getDocument,
  PDFWorker: { create: boundary.createWorker },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg9sAAAAASUVORK5CYII=";
const pdfBytes = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF",
);
function file(name = "research.pdf", type = "application/pdf") {
  return new File([pdfBytes], name, { type });
}

function harness(width = 612, height = 792, pageCount = 3) {
  const render = { promise: Promise.resolve(), cancel: vi.fn() };
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    })),
    render: vi.fn(() => render),
    cleanup: vi.fn(),
  };
  const pdf = {
    numPages: pageCount,
    getPage: vi.fn(async () => page),
  };
  const loadingTask = {
    promise: Promise.resolve(pdf),
    destroy: vi.fn(async () => undefined),
  };
  const worker = { destroy: vi.fn() };
  const terminate = vi.fn();
  const events = new EventTarget();
  const NativeWorker = vi.fn(function (this: {
    terminate: typeof terminate;
    addEventListener: EventTarget["addEventListener"];
    removeEventListener: EventTarget["removeEventListener"];
  }) {
    this.terminate = terminate;
    this.addEventListener = events.addEventListener.bind(events);
    this.removeEventListener = events.removeEventListener.bind(events);
  });
  vi.stubGlobal("Worker", NativeWorker);
  boundary.createWorker.mockReturnValue(worker);
  boundary.getDocument.mockReturnValue(loadingTask);
  return {
    page,
    pdf,
    render,
    loadingTask,
    worker,
    NativeWorker,
    terminate,
    events,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("local PDF figure import", () => {
  it("recognizes extension or MIME, including MIME-less and uppercase PDFs", () => {
    expect(isPdfFigure(file("plot.PDF", ""))).toBe(true);
    expect(isPdfFigure(file("plot", "application/pdf"))).toBe(true);
    expect(isPdfFigure(file("plot.svg", "image/svg+xml"))).toBe(false);
    expect(isPdfFigure(file("plot.pdf.png", "image/png"))).toBe(false);
  });

  it("rejects empty, oversized and disguised files before creating a PDF worker", async () => {
    await expect(openPdfFigure(new File([], "empty.pdf"))).rejects.toThrow(
      "20 MB",
    );
    const oversized = file();
    Object.defineProperty(oversized, "size", { value: MAX_FIGURE_BYTES + 1 });
    await expect(openPdfFigure(oversized)).rejects.toThrow("20 MB");
    await expect(
      openPdfFigure(
        new File(["<svg/>"], "disguised.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow("PDF header");
    expect(boundary.getDocument).not.toHaveBeenCalled();
  });

  it("reads the actual local bytes and supplies its own local module worker port", async () => {
    const h = harness();
    const imported = await openPdfFigure(file());
    expect(imported.name).toBe("research.pdf");
    expect(imported.pageCount).toBe(3);
    const init = boundary.getDocument.mock.calls[0][0];
    expect(Array.from(init.data)).toEqual(Array.from(pdfBytes));
    expect(init.url).toBeUndefined();
    expect(init.worker).toBe(h.worker);
    expect(init.useWorkerFetch).toBe(false);
    expect(init.enableXfa).toBe(false);
    expect(init.useSystemFonts).toBe(false);
    const [url, options] = h.NativeWorker.mock.calls[0] as unknown as [
      URL,
      object,
    ];
    expect(url.protocol).toBe("http:");
    expect(url.origin).toBe(window.location.origin);
    expect(options).toEqual({ type: "module" });
    expect(boundary.createWorker).toHaveBeenCalledWith({
      port: h.NativeWorker.mock.instances[0],
    });
    await imported.destroy();
  });

  it("supports File.arrayBuffer and headers with a short binary prefix", async () => {
    harness();
    const prefixed = new Uint8Array([0, 255, 3, ...pdfBytes]);
    const pdfFile = new File([prefixed], "binary-prefix.pdf");
    const read = vi.fn(async () => prefixed.buffer);
    Object.defineProperty(pdfFile, "arrayBuffer", { value: read });
    const imported = await openPdfFigure(pdfFile);
    expect(read).toHaveBeenCalledOnce();
    expect(boundary.getDocument.mock.calls[0][0].data).toEqual(prefixed);
    await imported.destroy();
  });

  it("loads bundled CJK fonts, standard fonts and image codecs without remote URLs", async () => {
    harness();
    const imported = await openPdfFigure(file());
    const BinaryFactory =
      boundary.getDocument.mock.calls[0][0].BinaryDataFactory;
    const factory = new BinaryFactory();
    const fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    vi.stubGlobal("fetch", fetch);
    for (const request of [
      { kind: "cMapUrl", filename: "Adobe-Korea1-UCS2.bcmap" },
      { kind: "standardFontDataUrl", filename: "LiberationSans-Regular.ttf" },
      { kind: "wasmUrl", filename: "openjpeg.wasm" },
    ]) {
      expect(await factory.fetch(request)).toEqual(new Uint8Array([1, 2, 3]));
      const [url] = fetch.mock.lastCall! as unknown as [URL];
      expect(url.origin).toBe(window.location.origin);
    }
    const calls = fetch.mock.calls.length;
    await expect(
      factory.fetch({ kind: "cMapUrl", filename: "../../external-file.bcmap" }),
    ).rejects.toThrow("unavailable local resource");
    await expect(
      factory.fetch({
        kind: "remoteUrl",
        filename: "https://example.com/font",
      }),
    ).rejects.toThrow("unavailable local resource");
    expect(fetch).toHaveBeenCalledTimes(calls);
    await imported.destroy();
  });

  it("renders the chosen one-based page as a high-resolution embedded PNG and frees the canvas", async () => {
    const h = harness();
    const imported = await openPdfFigure(file());
    const asset = await imported.renderPage(2);
    expect(h.pdf.getPage).toHaveBeenCalledWith(2);
    expect(asset).toMatchObject({
      name: "research.pdf · page 2.png",
      mime: "image/png",
      dataUrl: png,
      width: 1836,
      height: 2376,
    });
    expect(asset.id).toBeTruthy();
    const rendering = h.page.render.mock.calls[0][0] as unknown as {
      canvas: HTMLCanvasElement;
      viewport: { width: number; height: number };
      background: string;
    };
    expect(rendering.viewport).toEqual({ width: 1836, height: 2376 });
    expect(rendering.background).toBe("#ffffff");
    expect(rendering.canvas.width).toBe(0);
    expect(rendering.canvas.height).toBe(0);
    expect(h.page.cleanup).toHaveBeenCalledOnce();
    expect(h.loadingTask.destroy).not.toHaveBeenCalled();
    await imported.destroy();
    await imported.destroy();
    expect(h.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(h.worker.destroy).toHaveBeenCalledOnce();
    expect(h.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    [400, 200, 1200, 600],
    [20_000, 4000, 3200, 640],
    [4000, 4000, 2828, 2828],
    [400, 20_000, 64, 3200],
  ])(
    "bounds a %s × %s point page by both side length and total pixels",
    async (w, h, expectedW, expectedH) => {
      harness(w, h);
      const imported = await openPdfFigure(file());
      const asset = await imported.renderPage(1);
      expect(asset.width).toBe(expectedW);
      expect(asset.height).toBe(expectedH);
      expect(Math.max(asset.width, asset.height)).toBeLessThanOrEqual(3200);
      expect(asset.width * asset.height).toBeLessThanOrEqual(8_000_000);
      expect(asset.width / asset.height).toBeCloseTo(w / h, 2);
      await imported.destroy();
    },
  );

  it("rejects non-integer, zero and out-of-range pages without rendering", async () => {
    const h = harness();
    const imported = await openPdfFigure(file());
    for (const page of [0, -1, 4, 1.5, NaN, Infinity])
      await expect(imported.renderPage(page)).rejects.toThrow(
        "between 1 and 3",
      );
    expect(h.pdf.getPage).not.toHaveBeenCalled();
    await imported.destroy();
    await expect(imported.renderPage(1)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it.each([
    ["PasswordException", "password-protected"],
    ["InvalidPDFException", "valid PDF"],
  ])(
    "cleans up its dedicated worker when loading fails with %s",
    async (name, message) => {
      const h = harness();
      h.loadingTask.promise = Promise.reject(
        Object.assign(new Error("PDF.js failed"), { name }),
      );
      h.loadingTask.promise.catch(() => undefined);
      await expect(openPdfFigure(file())).rejects.toThrow(message);
      expect(h.loadingTask.destroy).toHaveBeenCalledOnce();
      expect(h.worker.destroy).toHaveBeenCalledOnce();
      expect(h.terminate).toHaveBeenCalledOnce();
    },
  );

  it("reports a zero-page PDF and releases loading resources", async () => {
    const h = harness(100, 100, 0);
    await expect(openPdfFigure(file())).rejects.toThrow("contains no pages");
    expect(h.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(h.terminate).toHaveBeenCalledOnce();
  });

  it("reports an asynchronous worker startup failure instead of leaving import pending", async () => {
    const h = harness();
    const wait = deferred<typeof h.pdf>();
    h.loadingTask.promise = wait.promise;
    const opened = openPdfFigure(file());
    await vi.waitFor(() => expect(boundary.getDocument).toHaveBeenCalledOnce());
    h.events.dispatchEvent(new Event("error"));
    await expect(opened).rejects.toThrow("Reload SciSlide");
    expect(h.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(h.terminate).toHaveBeenCalledOnce();
    wait.resolve(h.pdf);
  });

  it("cleans up a failed render without closing the document's other pages", async () => {
    const h = harness();
    h.render.promise = Promise.reject(new Error("Unsupported compressed data"));
    h.render.promise.catch(() => undefined);
    const imported = await openPdfFigure(file());
    await expect(imported.renderPage(2)).rejects.toThrow(
      "could not be rendered",
    );
    expect(h.page.cleanup).toHaveBeenCalledOnce();
    expect(h.loadingTask.destroy).not.toHaveBeenCalled();
    h.render.promise = Promise.resolve();
    expect((await imported.renderPage(1)).mime).toBe("image/png");
    await imported.destroy();
  });

  it("rejects unusable dimensions and a PNG above the portable figure size limit", async () => {
    const h = harness(0, 100);
    const imported = await openPdfFigure(file());
    await expect(imported.renderPage(1)).rejects.toThrow("invalid dimensions");
    expect(h.page.render).not.toHaveBeenCalled();
    h.page.getViewport.mockImplementation(({ scale }) => ({
      width: 100 * scale,
      height: 100 * scale,
    }));
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(
      `data:image/png;base64,${"A".repeat(Math.ceil((MAX_FIGURE_BYTES * 4) / 3) + 4)}`,
    );
    await expect(imported.renderPage(1)).rejects.toThrow("20 MB figure limit");
    expect(h.page.cleanup).toHaveBeenCalledTimes(2);
    await imported.destroy();
  });

  it("cancels loading immediately and releases its worker even before the PDF resolves", async () => {
    const h = harness();
    const wait = deferred<typeof h.pdf>();
    h.loadingTask.promise = wait.promise;
    const controller = new AbortController();
    const opened = openPdfFigure(file(), controller.signal);
    await vi.waitFor(() => expect(boundary.getDocument).toHaveBeenCalledOnce());
    controller.abort();
    await expect(opened).rejects.toMatchObject({ name: "AbortError" });
    expect(h.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(h.terminate).toHaveBeenCalledOnce();
    wait.resolve(h.pdf);
  });

  it("cancels only a superseded page render while keeping the PDF reusable", async () => {
    const h = harness();
    const wait = deferred<void>();
    h.render.promise = wait.promise;
    h.render.cancel.mockImplementation(() =>
      wait.reject(new Error("Rendering cancelled")),
    );
    const imported = await openPdfFigure(file());
    const controller = new AbortController();
    const rendered = imported.renderPage(2, controller.signal);
    await vi.waitFor(() => expect(h.page.render).toHaveBeenCalledOnce());
    controller.abort();
    await expect(rendered).rejects.toMatchObject({ name: "AbortError" });
    expect(h.render.cancel).toHaveBeenCalledOnce();
    expect(h.page.cleanup).toHaveBeenCalledOnce();
    expect(h.loadingTask.destroy).not.toHaveBeenCalled();
    h.render.promise = Promise.resolve();
    await expect(imported.renderPage(1)).resolves.toMatchObject({
      mime: "image/png",
    });
    await imported.destroy();
  });

  it("destroy cancels a pending render, releases the canvas and terminates the worker once", async () => {
    const h = harness();
    const wait = deferred<void>();
    h.render.promise = wait.promise;
    h.render.cancel.mockImplementation(() =>
      wait.reject(new Error("Rendering cancelled")),
    );
    const imported = await openPdfFigure(file());
    const rendered = imported.renderPage(1);
    await vi.waitFor(() => expect(h.page.render).toHaveBeenCalledOnce());
    await imported.destroy();
    await expect(rendered).rejects.toMatchObject({ name: "AbortError" });
    await imported.destroy();
    expect(h.render.cancel).toHaveBeenCalledOnce();
    expect(h.page.cleanup).toHaveBeenCalledOnce();
    expect(h.terminate).toHaveBeenCalledOnce();
  });

  it("cleans up a page that arrives after its rendering request was cancelled", async () => {
    const h = harness();
    const wait = deferred<typeof h.page>();
    h.pdf.getPage.mockReturnValue(wait.promise);
    const imported = await openPdfFigure(file());
    const controller = new AbortController();
    const rendered = imported.renderPage(1, controller.signal);
    controller.abort();
    await expect(rendered).rejects.toMatchObject({ name: "AbortError" });
    wait.resolve(h.page);
    await vi.waitFor(() => expect(h.page.cleanup).toHaveBeenCalledOnce());
    expect(h.page.render).not.toHaveBeenCalled();
    await imported.destroy();
  });
});
