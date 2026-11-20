import { useEffect, useRef } from "react";
import type { PptxImportWarning } from "../lib/import-pptx";

export function PptxImportReport({
  warnings,
  onClose,
}: {
  warnings: PptxImportWarning[];
  onClose: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    button.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop save-changes-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "Tab") {
          event.preventDefault();
          (document.activeElement === list.current
            ? button.current
            : list.current
          )?.focus();
        }
      }}
    >
      <div
        className="save-changes-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pptx-report-title"
        aria-describedby="pptx-report-description"
      >
        <h2 id="pptx-report-title">PowerPoint import details</h2>
        <p id="pptx-report-description">
          Review elements that were omitted or changed during import.
        </p>
        <ul
          ref={list}
          className="pptx-import-warnings"
          aria-label="Import details by slide"
          tabIndex={0}
        >
          {warnings.map(({ slide, messages }) => (
            <li key={slide}>
              <strong>Slide {slide}</strong>
              <ul>
                {messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <div className="save-changes-actions">
          <button ref={button} className="primary-button" onClick={onClose}>
            Continue editing
          </button>
        </div>
      </div>
    </div>
  );
}
