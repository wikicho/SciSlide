import { useEffect, useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Check, Sigma, X } from "lucide-react";
import {
  matchShortcut,
  matchesShortcut,
  shortcutLabel,
} from "../lib/shortcuts";
import type { KeyboardPlatform } from "../lib/shortcuts";
import "./EquationEditorDialog.css";

export function EquationEditorDialog({
  children,
  sourceRef,
  platform,
  canApply,
  applying,
  suspended = false,
  onApply,
  onCompile,
  onClose,
}: {
  children: ReactNode;
  sourceRef: RefObject<HTMLTextAreaElement | null>;
  platform: KeyboardPlatform;
  canApply: boolean;
  applying: boolean;
  suspended?: boolean;
  onApply: () => void;
  onCompile: () => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const hintId = useId();
  const dialog = useRef<HTMLElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    sourceRef.current?.focus({ preventScroll: true });
    sourceRef.current?.select();
  }, [sourceRef]);
  useEffect(() => {
    if (!suspended) sourceRef.current?.focus({ preventScroll: true });
  }, [sourceRef, suspended]);

  return (
    <div
      className="modal-backdrop equation-editor-backdrop"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !applying && !suspended)
          onClose();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          suspended ||
          event.defaultPrevented ||
          composing.current ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229 ||
          event.getModifierState("AltGraph")
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (!event.repeat && !applying) onClose();
        } else if (
          matchesShortcut(event.nativeEvent, "compileEquation", platform)
        ) {
          event.preventDefault();
          if (!event.repeat && !applying) onCompile();
        } else if (
          matchesShortcut(event.nativeEvent, "finishTextEditing", platform)
        ) {
          event.preventDefault();
          if (!event.repeat && canApply && !applying) onApply();
        } else if (event.key === "Tab") {
          const controls = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              "button:enabled, textarea:enabled, input:enabled, select:enabled, [tabindex='0']",
            ) ?? [],
          ).filter((control) => !control.closest("[hidden]"));
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        } else {
          const action = matchShortcut(event.nativeEvent, platform);
          if (
            action &&
            !["cut", "copy", "paste", "selectAll", "undo", "redo"].includes(
              action,
            ) &&
            ![
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
              "PageUp",
              "PageDown",
              "Enter",
              "Backspace",
              "Delete",
            ].includes(event.key)
          )
            event.preventDefault();
        }
      }}
    >
      <section
        ref={dialog}
        className="equation-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={hintId}
        data-equation-editor="true"
        inert={suspended}
      >
        <header className="equation-editor-header">
          <div>
            <span>
              <Sigma size={14} aria-hidden="true" /> LATEX EQUATION
            </span>
            <h2 id={headingId}>Edit equation</h2>
            <p id={hintId}>
              Edit the source, check the preview, then apply it to the slide.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close equation editor"
            title="Close equation editor"
            disabled={applying}
            onClick={onClose}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <fieldset className="equation-editor-content" disabled={applying}>
          {children}
        </fieldset>
        <footer className="equation-editor-footer">
          <span>Unapplied changes are kept as a draft.</span>
          <div>
            <button
              type="button"
              className="button"
              disabled={applying}
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!canApply || applying}
              title={`${shortcutLabel("finishTextEditing", platform)} to apply`}
              onClick={onApply}
            >
              <Check size={15} aria-hidden="true" />{" "}
              {applying ? "Applying…" : "Apply equation"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
