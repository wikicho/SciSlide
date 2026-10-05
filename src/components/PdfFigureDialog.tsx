import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileImage,
  LoaderCircle,
  X,
} from "lucide-react";
import type { Asset } from "../lib/model";
import { openPdfFigure } from "../lib/pdf-figure";
import "./PdfFigureDialog.css";

type PdfSource = Awaited<ReturnType<typeof openPdfFigure>>;

interface PdfSession {
  source: PdfSource;
  live: boolean;
  page: number;
  request: number;
  rendering: boolean;
  controller: AbortController | null;
}

interface PagePreview {
  session: PdfSession;
  page: number;
  asset: Asset;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The PDF could not be read.";
}

export function PdfFigureDialog({
  file,
  onInsert,
  onCancel,
  title = "Choose a PDF page.",
  actionLabel = "Insert image",
}: {
  file: File;
  onInsert: (asset: Asset) => void;
  onCancel: () => void;
  title?: string;
  actionLabel?: string;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const section = useRef<HTMLElement>(null);
  const pageInput = useRef<HTMLInputElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const disposeRef = useRef<() => void>(() => undefined);
  const sessionRef = useRef<PdfSession | null>(null);
  const previewRef = useRef<PagePreview | null>(null);
  const pageRef = useRef(1);
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("1");
  const [pageCount, setPageCount] = useState(0);
  const [name, setName] = useState(file.name);
  const [busy, setBusy] = useState(true);
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [error, setError] = useState("");

  // One render runs at a time. A newer request cancels the active render and
  // replaces any queued page, so an old preview can never become insertable.
  async function renderLatest(session: PdfSession) {
    if (session.rendering || !session.live) return;
    session.rendering = true;
    while (session.live) {
      const request = session.request;
      const requestedPage = session.page;
      const controller = new AbortController();
      session.controller = controller;
      try {
        const asset = await session.source.renderPage(
          requestedPage,
          controller.signal,
        );
        if (session.live && session.request === request) {
          const result = { session, page: requestedPage, asset };
          previewRef.current = result;
          setPreview(result);
          setError("");
        }
      } catch (failure) {
        if (
          session.live &&
          session.request === request &&
          !controller.signal.aborted
        ) {
          setError(failureMessage(failure));
        }
      } finally {
        if (session.controller === controller) session.controller = null;
      }
      if (session.request === request) {
        if (session.live) setBusy(false);
        break;
      }
    }
    session.rendering = false;
  }

  function requestPage(next: number) {
    const session = sessionRef.current;
    if (!session || !session.live) return;
    const normalized = Math.max(1, Math.min(session.source.pageCount, next));
    setInput(String(normalized));
    if (pageRef.current === normalized) return;
    pageRef.current = normalized;
    setPage(normalized);
    session.page = normalized;
    session.request += 1;
    session.controller?.abort();
    previewRef.current = null;
    setPreview(null);
    setError("");
    setBusy(true);
    void renderLatest(session);
  }

  function cancel() {
    disposeRef.current();
    onCancelRef.current();
  }

  useEffect(() => {
    let live = true;
    let session: PdfSession | null = null;
    const controller = new AbortController();
    pageRef.current = 1;
    previewRef.current = null;
    setPage(1);
    setInput("1");
    setPageCount(0);
    setName(file.name);
    setPreview(null);
    setError("");
    setBusy(true);
    const dispose = () => {
      if (!live) return;
      live = false;
      controller.abort();
      if (session) {
        session.live = false;
        session.controller?.abort();
        void session.source.destroy().catch(() => undefined);
      }
      if (sessionRef.current === session) sessionRef.current = null;
      previewRef.current = null;
    };
    disposeRef.current = dispose;
    void openPdfFigure(file, controller.signal)
      .then((source) => {
        if (!live) {
          void source.destroy().catch(() => undefined);
          return;
        }
        session = {
          source,
          live: true,
          page: 1,
          request: 0,
          rendering: false,
          controller: null,
        };
        sessionRef.current = session;
        setPageCount(source.pageCount);
        setName(source.name);
        void renderLatest(session);
      })
      .catch((failure) => {
        if (live && !controller.signal.aborted) {
          setError(failureMessage(failure));
          setBusy(false);
        }
      });
    return dispose;
  }, [file]);

  useEffect(() => {
    const previous = document.activeElement;
    section.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        section.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      ).filter((element) => !element.hidden);
      const first = controls[0],
        last = controls.at(-1);
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || !section.current?.contains(active))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !section.current?.contains(active))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  const inputPage = Number(input);
  const validInput =
    input.trim() !== "" &&
    Number.isInteger(inputPage) &&
    inputPage >= 1 &&
    inputPage <= pageCount;
  const ready =
    !!preview &&
    preview.page === page &&
    preview.session === sessionRef.current &&
    !busy &&
    validInput;

  return (
    <div className="modal-backdrop pdf-figure-backdrop" onClick={cancel}>
      <section
        ref={section}
        className="pdf-figure-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="library-eyebrow">PDF IMAGE</span>
            <h2 id={headingId}>{title}</h2>
            <p id={descriptionId}>
              Choose a page to add as a high-resolution image.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close PDF import"
            onClick={cancel}
          >
            <X size={19} />
          </button>
        </header>
        <div className="pdf-figure-toolbar">
          <span className="pdf-figure-filename" title={name}>
            <FileImage size={16} /> {name}
          </span>
          <div
            className="pdf-figure-pagination"
            role="group"
            aria-label="PDF pages"
          >
            <button
              className="icon-button"
              aria-label="Previous PDF page"
              disabled={!pageCount || page <= 1}
              onClick={() => requestPage(page - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <label>
              <span className="pdf-figure-page-label">Page</span>
              <input
                ref={pageInput}
                aria-label="PDF page"
                aria-invalid={pageCount > 0 && !validInput ? true : undefined}
                type="number"
                min={1}
                max={pageCount || 1}
                step={1}
                disabled={!pageCount}
                value={input}
                onChange={(event) => {
                  const value = event.target.value;
                  setInput(value);
                  const number = Number(value);
                  if (
                    value &&
                    Number.isInteger(number) &&
                    number >= 1 &&
                    number <= pageCount
                  )
                    requestPage(number);
                }}
                onBlur={() => setInput(String(pageRef.current))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const number = Number(input);
                    if (input && Number.isInteger(number)) requestPage(number);
                    else setInput(String(pageRef.current));
                  }
                }}
              />
            </label>
            <span aria-live="polite">of {pageCount || "…"}</span>
            <button
              className="icon-button"
              aria-label="Next PDF page"
              disabled={!pageCount || page >= pageCount}
              onClick={() => requestPage(page + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div
          className="pdf-figure-preview"
          aria-label="PDF page preview"
          aria-busy={busy}
        >
          {busy ? (
            <div className="pdf-figure-placeholder" role="status">
              <LoaderCircle className="pdf-figure-spinner" size={26} />
              <span>
                {pageCount ? `Rendering page ${page}…` : "Opening PDF…"}
              </span>
            </div>
          ) : error ? (
            <div
              className="pdf-figure-placeholder pdf-figure-error"
              role="alert"
            >
              <FileImage size={26} />
              <strong>Unable to preview this PDF</strong>
              <span>{error}</span>
            </div>
          ) : preview ? (
            <img
              src={preview.asset.dataUrl}
              alt={`${name}, page ${preview.page}`}
            />
          ) : null}
        </div>
        <footer>
          <p>
            The selected page is embedded in your presentation. Processed on
            this device.
          </p>
          <div className="pdf-figure-actions">
            <button className="button light" onClick={cancel}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!ready}
              onClick={() => {
                const current = previewRef.current;
                if (
                  current &&
                  current.page === pageRef.current &&
                  current.session === sessionRef.current &&
                  current.session.live
                )
                  onInsert(current.asset);
              }}
            >
              <FileImage size={15} /> {actionLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
