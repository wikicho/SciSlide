import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Sigma, X } from "lucide-react";
import { renderEquation } from "../lib/equations";
import type { EquationFontId } from "../lib/equations";
import {
  matchesShortcut,
  matchShortcut,
  shortcutLabel,
} from "../lib/shortcuts";
import type { KeyboardPlatform } from "../lib/shortcuts";
import "./InlineEquationDialog.css";

// Inline equations use the same source limit as the bundled MathJax renderer.
const MAX_INLINE_SOURCE_LENGTH = 12_000;

function sourceError(source: string): string {
  if (source.length > MAX_INLINE_SOURCE_LENGTH)
    return "Equation source must contain at most 12,000 characters.";
  if (
    /(^|[^\\])(?:\\\\)*\$/.test(source) ||
    /(^|[^\\])(?:\\\\)*\\[()[\]]/.test(source)
  )
    return "Enter LaTeX without $...$, \\(...\\), or \\[...\\] delimiters.";
  return "";
}

function renderError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error)
    return String(error.message);
  return "This equation could not be rendered. Check the LaTeX source.";
}

function needsDarkPreview(color: string): boolean {
  if (/^(white|snow|ivory|whitesmoke|lightyellow)$/i.test(color)) return true;
  const hex = color.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (!hex) return false;
  const rgb =
    hex.length <= 4
      ? [...hex.slice(0, 3)].map((digit) => Number.parseInt(digit + digit, 16))
      : [0, 2, 4].map((offset) =>
          Number.parseInt(hex.slice(offset, offset + 2), 16),
        );
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  // Choose the higher-contrast surface while keeping the slide's equation color.
  return luminance > 0.23;
}

export interface InlineEquationDialogProps {
  initialLatex: string;
  font: EquationFontId;
  fontSize: number;
  color: string;
  platform: KeyboardPlatform;
  onApply: (latex: string) => boolean | void;
  onCancel: () => void;
  editing?: boolean;
}

/** Preview an inline equation before inserting its raw LaTeX into the text. */
export function InlineEquationDialog({
  initialLatex,
  font,
  fontSize,
  color,
  platform,
  onApply,
  onCancel,
  editing = false,
}: InlineEquationDialogProps) {
  const headingId = useId();
  const sourceId = useId();
  const hintId = useId();
  const section = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const completed = useRef(false);
  const [source, setSource] = useState(initialLatex);
  const latex = source.trim();
  const validationError = sourceError(source);
  const previewKey = JSON.stringify([latex, font, fontSize, color]);
  const [preview, setPreview] = useState<{
    key: string;
    svg?: string;
    error?: string;
  }>();
  const current = preview?.key === previewKey ? preview : undefined;
  const error = validationError || current?.error || "";
  const canApply = !!latex && !error && !!current?.svg;

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  useEffect(() => {
    if (!latex || validationError) return;
    let active = true;
    renderEquation(latex, font, fontSize, color, false)
      .then((result) => {
        if (active) setPreview({ key: previewKey, svg: result.svg });
      })
      .catch((failure) => {
        if (active)
          setPreview({ key: previewKey, error: renderError(failure) });
      });
    return () => {
      active = false;
    };
  }, [latex, font, fontSize, color, previewKey, validationError]);

  const cancel = () => {
    if (completed.current) return;
    completed.current = true;
    onCancel();
  };
  const apply = () => {
    if (!canApply || composing.current || completed.current) return;
    completed.current = true;
    if (onApply(latex) === false) completed.current = false;
  };

  return (
    <div
      className="modal-backdrop inline-equation-backdrop"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) cancel();
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.defaultPrevented ||
          composing.current ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229 ||
          event.getModifierState("AltGraph")
        )
          return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (!event.repeat) cancel();
        } else if (
          matchesShortcut(event.nativeEvent, "finishTextEditing", platform)
        ) {
          event.preventDefault();
          if (!event.repeat) apply();
        } else if (event.key === "Tab") {
          const controls = Array.from(
            section.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
            ) ?? [],
          ).filter((control) => !control.hidden);
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        } else {
          const action = matchShortcut(event.nativeEvent, platform);
          const nativeEditing =
            action &&
            ["cut", "copy", "paste", "selectAll", "undo", "redo"].includes(
              action,
            );
          const nativeNavigation = [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "Backspace",
            "Delete",
            "Enter",
          ].includes(event.key);
          if (action && !nativeEditing && !nativeNavigation)
            event.preventDefault();
        }
      }}
    >
      <section
        ref={section}
        className="inline-equation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={hintId}
      >
        <header className="inline-equation-header">
          <div>
            <p className="inline-equation-eyebrow">
              <Sigma size={13} aria-hidden="true" /> INLINE MATHEMATICS
            </p>
            <h2 id={headingId}>
              {editing ? "Edit inline equation" : "Insert inline equation"}
            </h2>
          </div>
          <button
            type="button"
            className="inline-equation-close"
            aria-label="Close inline equation"
            title="Close inline equation"
            onClick={cancel}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="inline-equation-body">
          <label htmlFor={sourceId}>LaTeX source</label>
          <textarea
            id={sourceId}
            ref={input}
            aria-label="Inline equation source"
            aria-describedby={hintId}
            aria-invalid={!!error}
            value={source}
            rows={3}
            maxLength={MAX_INLINE_SOURCE_LENGTH}
            spellCheck={false}
            placeholder="U(1)"
            onChange={(event) => setSource(event.currentTarget.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
          />
          <p id={hintId} className="inline-equation-hint">
            Enter LaTeX only, such as <code>U(1)</code> or{" "}
            <code>{"\\frac{a}{b}"}</code>. Delimiters are added automatically.
          </p>
          <div className="inline-equation-preview-label">Preview</div>
          <div
            className={`inline-equation-preview${needsDarkPreview(color) ? " is-dark" : ""}`}
            aria-label="Inline equation preview"
            aria-busy={!!latex && !error && !current}
          >
            {error ? (
              <p className="inline-equation-error" role="alert">
                {error}
              </p>
            ) : current?.svg && latex ? (
              <div dangerouslySetInnerHTML={{ __html: current.svg }} />
            ) : latex ? (
              <p className="inline-equation-status" role="status">
                <LoaderCircle size={16} aria-hidden="true" /> Typesetting…
              </p>
            ) : (
              <p className="inline-equation-status">
                Enter an equation to see its preview.
              </p>
            )}
          </div>
        </div>
        <footer className="inline-equation-footer">
          <span>
            <kbd>{shortcutLabel("finishTextEditing", platform)}</kbd> to apply
          </span>
          <div>
            <button type="button" className="button" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!canApply}
              onClick={apply}
            >
              {editing ? "Apply equation" : "Insert equation"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
