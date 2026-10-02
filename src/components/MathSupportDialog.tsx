import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Sigma, X } from "lucide-react";
import { renderEquation, SUPPORTED_MATH_PACKAGES } from "../lib/equations";
import type { EquationFontId } from "../lib/equations";

export function MathSupportDialog({
  font,
  onClose,
  onUse,
}: {
  font: EquationFontId;
  onClose: () => void;
  onUse: (source: string) => void;
}) {
  const [id, setId] = useState("amsfonts");
  const selected =
    SUPPORTED_MATH_PACKAGES.find((p) => p.id === id) ??
    SUPPORTED_MATH_PACKAGES[0];
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [fallbackCount, setFallbackCount] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    setPreview("");
    setError("");
    setFallbackCount(0);
    renderEquation(selected.example, font, 42, "#17263c")
      .then((r) => {
        if (live) {
          setPreview(r.svg);
          setFallbackCount(r.fallbackGlyphs?.length ?? 0);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selected.example, font]);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const buttons = Array.from(
          dialogRef.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        className="math-library"
        role="dialog"
        aria-modal="true"
        aria-labelledby="math-library-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="library-eyebrow">SCIENTIFIC MATHEMATICS</span>
            <h2 id="math-library-title">Math package library</h2>
            <p>AMS 표기부터 물리학 수식까지, 예제를 선택해 바로 편집하세요.</p>
          </div>
          <button
            className="icon-button"
            title="Close math library"
            aria-label="Close math library"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="library-body">
          <nav aria-label="Math packages">
            {SUPPORTED_MATH_PACKAGES.map((p) => (
              <button
                key={p.id}
                className={p.id === selected.id ? "selected" : ""}
                onClick={() => setId(p.id)}
              >
                <span>
                  {p.label}
                  <small>
                    {p.enabledByDefault ? "Included" : "Enable per equation"}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </nav>
          <div className="library-detail">
            <div className="library-package-heading">
              <span className="object-type-icon">
                <Sigma size={22} />
              </span>
              <div>
                <h3>{selected.label}</h3>
                <span>
                  {selected.enabledByDefault ? (
                    <>
                      <Check size={12} /> 기본 포함
                    </>
                  ) : (
                    "수식별로 활성화"
                  )}
                </span>
              </div>
            </div>
            <p>{selected.description}</p>
            <div
              className="library-preview"
              aria-label="Package example preview"
            >
              {error ? (
                <span className="library-error">{error}</span>
              ) : preview ? (
                <div dangerouslySetInnerHTML={{ __html: preview }} />
              ) : (
                <span>Typesetting…</span>
              )}
            </div>
            {fallbackCount > 0 && (
              <p className="math-fallback-note">
                일부 기호는 STIX Two의 벡터 글자로 보완했습니다.
              </p>
            )}
            <div className="section-label">LATEX EXAMPLE</div>
            <pre>{selected.example}</pre>
            {!selected.enabledByDefault && (
              <p className="library-note">
                이 예제의 패키지 선언은 해당 수식에만 적용됩니다.
              </p>
            )}
            <button
              className="button primary"
              disabled={!!error || !preview}
              onClick={() => {
                onUse(selected.example);
                onClose();
              }}
            >
              Use this example <ChevronRight size={14} />
            </button>
            <p className="field-hint">
              예제는 원문 입력란에 들어갑니다. Apply equation으로 슬라이드에
              반영하세요.
            </p>
          </div>
        </div>
        <footer>
          <code>\usepackage&#123;amsmath,amsfonts,amssymb&#125;</code>
          <span>
            지원 패키지는 로컬에 포함됩니다. 전체 LaTeX 문서·임의의 .sty 파일은
            지원하지 않습니다.
          </span>
        </footer>
      </section>
    </div>
  );
}
