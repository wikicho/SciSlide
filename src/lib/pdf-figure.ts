import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { newId } from "./model";
import type { Asset } from "./model";
import { MAX_FIGURE_BYTES } from "./persistence";

type PdfLibrary = typeof import("pdfjs-dist");
type PdfLoadingTask = ReturnType<PdfLibrary["getDocument"]>;
type PdfPage = Awaited<
  ReturnType<Awaited<PdfLoadingTask["promise"]>["getPage"]>
>;
type PdfRenderTask = ReturnType<PdfPage["render"]>;

const MAX_RENDER_SIDE = 3200;
const MAX_RENDER_PIXELS = 8_000_000;

// Vite emits every resource locally, including the CMaps used by CJK PDFs.
// A filename lookup also works with hashed asset names in packaged Electron apps.
const resourceUrls = import.meta.glob<string>(
  [
    "../../node_modules/pdfjs-dist/cmaps/*.bcmap",
    "../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
    "../../node_modules/pdfjs-dist/wasm/*.wasm",
  ],
  { query: "?url&no-inline", import: "default", eager: true },
);

class LocalPdfBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const folder = {
      cMapUrl: "cmaps",
      standardFontDataUrl: "standard_fonts",
      wasmUrl: "wasm",
    }[kind];
    const url =
      folder &&
      resourceUrls[`../../node_modules/pdfjs-dist/${folder}/${filename}`];
    if (!url)
      throw new Error("The PDF requested an unavailable local resource.");
    const response = await fetch(new URL(url, document.baseURI));
    if (!response.ok)
      throw new Error("The local PDF resource could not be read.");
    return new Uint8Array(await response.arrayBuffer());
  }
}

export interface PdfFigureDocument {
  name: string;
  pageCount: number;
  /** Page numbers are one-based. The returned asset is a portable PNG image. */
  renderPage(page: number, signal?: AbortSignal): Promise<Asset>;
  /** Cancels pending rendering and releases the document's dedicated worker. */
  destroy(): Promise<void>;
}

export function isPdfFigure(file: File): boolean {
  return (
    file.type.toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name)
  );
}

function abortError(): DOMException {
  return new DOMException("PDF import was cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/** The underlying promise stays observed even if cancellation wins the race. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(signal.aborted ? abortError() : error);
      },
    );
    if (signal.aborted) abort();
  });
}

async function readPdfBytes(
  file: File,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (typeof file.arrayBuffer === "function")
    return new Uint8Array(await abortable(file.arrayBuffer(), signal));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const clean = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      reader.abort();
      clean();
      reject(abortError());
    };
    reader.onload = () => {
      clean();
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => {
      clean();
      reject(new Error("The PDF file could not be read."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    reader.readAsArrayBuffer(file);
  });
}

function pdfFailure(error: unknown, rendering = false): Error {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  )
    return error as Error;
  if (
    error instanceof Error &&
    error.message ===
      "PDF rendering could not start. Reload SciSlide and try again."
  )
    return error;
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "PasswordException"
  )
    return new Error(
      "This PDF is password-protected. Export an unlocked copy before importing.",
    );
  return new Error(
    rendering
      ? "The PDF page could not be rendered. Try exporting a new copy of the PDF."
      : "The PDF could not be opened. Check that the file is a valid PDF.",
  );
}

export async function openPdfFigure(
  file: File,
  signal?: AbortSignal,
): Promise<PdfFigureDocument> {
  throwIfAborted(signal);
  if (!file.size || file.size > MAX_FIGURE_BYTES)
    throw new Error("Choose a PDF smaller than 20 MB.");
  const bytes = await readPdfBytes(file, signal);
  // The PDF header may legally be preceded by a short binary prefix.
  if (
    !/%PDF-\d\.\d/.test(
      new TextDecoder("latin1").decode(bytes.subarray(0, 1024)),
    )
  )
    throw new Error("The selected file does not contain a valid PDF header.");
  throwIfAborted(signal);
  // Loading PDF.js only here keeps its worker and rendering code off the editor's
  // startup path. Direct page rendering never enables the viewer's scripting API.
  const pdfjs = await import("pdfjs-dist");
  throwIfAborted(signal);

  let nativeWorker: Worker | undefined;
  let worker: ReturnType<PdfLibrary["PDFWorker"]["create"]> | undefined;
  let loadingTask: PdfLoadingTask;
  let onWorkerError!: () => void;
  const workerFailure = new Promise<never>((_, reject) => {
    onWorkerError = () =>
      reject(
        new Error(
          "PDF rendering could not start. Reload SciSlide and try again.",
        ),
      );
  });
  workerFailure.catch(() => undefined);
  try {
    // Supplying a local port avoids PDF.js's blob wrapper on scislide:// origins.
    nativeWorker = new Worker(new URL(pdfWorkerUrl, document.baseURI), {
      type: "module",
    });
    nativeWorker.addEventListener("error", onWorkerError);
    worker = pdfjs.PDFWorker.create({ port: nativeWorker });
    loadingTask = pdfjs.getDocument({
      data: bytes,
      worker,
      useWorkerFetch: false,
      BinaryDataFactory: LocalPdfBinaryDataFactory,
      cMapPacked: true,
      enableXfa: false,
      useSystemFonts: false,
      maxImageSize: MAX_RENDER_PIXELS,
      canvasMaxAreaInBytes: MAX_RENDER_PIXELS * 4,
    });
  } catch (error) {
    nativeWorker?.removeEventListener("error", onWorkerError);
    worker?.destroy();
    nativeWorker?.terminate();
    throw pdfFailure(error);
  }

  let destroyed = false;
  let destruction: Promise<void> | undefined;
  const renders = new Set<PdfRenderTask>();
  const destroy = () => {
    if (destruction) return destruction;
    destroyed = true;
    signal?.removeEventListener("abort", onAbort);
    for (const render of renders) render.cancel();
    destruction = loadingTask.destroy().finally(() => {
      nativeWorker?.removeEventListener("error", onWorkerError);
      try {
        worker?.destroy();
      } finally {
        nativeWorker?.terminate();
      }
    });
    return destruction;
  };
  const onAbort = () => void destroy().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  let pdf: Awaited<PdfLoadingTask["promise"]>;
  try {
    pdf = await abortable(
      Promise.race([loadingTask.promise, workerFailure]),
      signal,
    );
    if (destroyed) throw abortError();
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1)
      throw new Error("The PDF contains no pages.");
  } catch (error) {
    await destroy().catch(() => undefined);
    if (
      error instanceof Error &&
      error.message === "The PDF contains no pages."
    )
      throw error;
    throw pdfFailure(error);
  }

  return {
    name: file.name,
    pageCount: pdf.numPages,
    destroy,
    async renderPage(pageNumber, renderSignal) {
      throwIfAborted(renderSignal);
      if (destroyed) throw abortError();
      if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > pdf.numPages
      )
        throw new Error(`Choose a PDF page between 1 and ${pdf.numPages}.`);
      const page = await abortable(
        Promise.race([
          pdf.getPage(pageNumber).then((value) => {
            if (destroyed || renderSignal?.aborted) {
              value.cleanup();
              throw abortError();
            }
            return value;
          }),
          workerFailure,
        ]),
        renderSignal,
      );
      let canvas: HTMLCanvasElement | undefined;
      let render: PdfRenderTask | undefined;
      const cancel = () => render?.cancel();
      try {
        const base = page.getViewport({ scale: 1 });
        if (
          !Number.isFinite(base.width) ||
          !Number.isFinite(base.height) ||
          base.width <= 0 ||
          base.height <= 0
        )
          throw new Error("The PDF page has invalid dimensions.");
        const scale = Math.min(
          3,
          MAX_RENDER_SIDE / base.width,
          MAX_RENDER_SIDE / base.height,
          Math.sqrt(MAX_RENDER_PIXELS / base.width / base.height),
        );
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext)
          throw new Error("This browser cannot render PDF pages to images.");
        throwIfAborted(renderSignal);
        if (destroyed) throw abortError();
        render = page.render({
          canvas,
          canvasContext,
          viewport,
          background: "#ffffff",
        });
        renders.add(render);
        renderSignal?.addEventListener("abort", cancel, { once: true });
        if (renderSignal?.aborted) cancel();
        await abortable(
          Promise.race([render.promise, workerFailure]),
          renderSignal,
        );
        if (destroyed) throw abortError();
        const dataUrl = canvas.toDataURL("image/png");
        const prefix = "data:image/png;base64,";
        if (!dataUrl.startsWith(prefix))
          throw new Error("The PDF page image could not be encoded.");
        const encoded = dataUrl.slice(prefix.length);
        const padding = encoded.endsWith("==")
          ? 2
          : encoded.endsWith("=")
            ? 1
            : 0;
        if (encoded.length * 0.75 - padding > MAX_FIGURE_BYTES)
          throw new Error("The PDF page image exceeds the 20 MB figure limit.");
        return {
          id: newId(),
          name: `${file.name} · page ${pageNumber}.png`,
          mime: "image/png",
          dataUrl,
          width,
          height,
        };
      } catch (error) {
        if (destroyed || renderSignal?.aborted) throw abortError();
        if (
          error instanceof Error &&
          /dimensions|cannot render|encoded|figure limit/.test(error.message)
        )
          throw error;
        throw pdfFailure(error, true);
      } finally {
        renderSignal?.removeEventListener("abort", cancel);
        if (render) renders.delete(render);
        if (canvas) canvas.width = canvas.height = 0;
        page.cleanup();
      }
    },
  };
}
