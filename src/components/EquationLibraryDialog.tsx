import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Plus,
  Save,
  Search,
  Sigma,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { renderEquation } from "../lib/equations";
import { FONT_SET_IDS } from "../lib/model";
import type { FontSetId } from "../lib/model";
import { desktop, DEFAULT_LOCAL_PREAMBLE } from "../lib/desktop";
import { downloadBlob } from "../lib/persistence";
import {
  createEquationLibraryEntry,
  loadEquationLibrary,
  MAX_LIBRARY_BYTES,
  mergeEquationLibraries,
  parseEquationLibrary,
  saveEquationLibrary,
  searchEquationLibrary,
  serializeEquationLibrary,
  validateEquationLibrary,
} from "../lib/equation-library";
import type {
  EquationLibraryEntry,
  EquationLibraryEquation,
} from "../lib/equation-library";
import {
  MAX_EQUATION_SOURCE_CHARACTERS,
  MAX_LOCAL_PREAMBLE_CHARACTERS,
} from "../lib/local-tex-draft";

interface LibraryEditor {
  name: string;
  tags: string;
  equation: EquationLibraryEquation;
}

function newEditor(equation?: EquationLibraryEquation): LibraryEditor {
  return {
    name: "",
    tags: "",
    equation: equation
      ? structuredClone(equation)
      : {
          latex: "",
          displayMode: true,
          description: "",
          style: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#111827" },
          renderer: "mathjax",
        },
  };
}

export function EquationLibraryDialog({
  onClose,
  onInsert,
  initialEquation,
}: {
  onClose: () => void;
  onInsert: (
    entry: EquationLibraryEntry,
  ) => boolean | void | Promise<boolean | void>;
  initialEquation?: EquationLibraryEquation;
}) {
  const [loaded] = useState(() => {
    try {
      return { entries: loadEquationLibrary(), error: "" };
    } catch (error) {
      return {
        entries: [] as EquationLibraryEntry[],
        error: `라이브러리를 읽지 못했습니다: ${(error as Error).message} 라이브러리 파일을 가져와 복구해주세요.`,
      };
    }
  });
  const [entries, setEntries] = useState(loaded.entries);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<LibraryEditor>(() =>
    newEditor(initialEquation),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState(loaded.error);
  const [storageReadable, setStorageReadable] = useState(!loaded.error);
  const [inserting, setInserting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const section = useRef<HTMLElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const visible = useMemo(
    () => searchEquationLibrary(entries, query),
    [entries, query],
  );
  const equation = editor.equation;

  useEffect(() => {
    const previous = document.activeElement;
    section.current
      ?.querySelector<HTMLInputElement>(
        "input[aria-label='Search saved equations']",
      )
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(section.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled)",
        ) ?? []),
      ].filter((element) => !element.hidden);
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    setPreview("");
    setPreviewError("");
    if (equation.renderer === "local-latex" || !equation.latex.trim()) return;
    const timeout = window.setTimeout(() => {
      renderEquation(
        equation.latex,
        equation.style.fontSetId ?? "mathjax-stix2",
        equation.style.fontSize ?? 48,
        equation.style.color ?? "#111827",
        equation.displayMode,
      )
        .then((result) => {
          if (live) setPreview(result.svg);
        })
        .catch((failure) => {
          if (live) setPreviewError((failure as Error).message);
        });
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timeout);
    };
  }, [equation]);

  function updateEquation(change: Partial<EquationLibraryEquation>) {
    setEditor({ ...editor, equation: { ...equation, ...change } });
    setMessage("");
  }
  function buildEntry(): EquationLibraryEntry {
    const entry = createEquationLibraryEntry(
      editor.name,
      equation,
      editor.tags.split(","),
    );
    const saved = entries.find((item) => item.id === editingId);
    return saved
      ? { ...entry, id: saved.id, createdAt: saved.createdAt }
      : entry;
  }
  function save() {
    try {
      if (!storageReadable)
        throw new Error("라이브러리 파일을 가져와 복구한 뒤 저장해주세요.");
      const entry = buildEntry();
      const next = validateEquationLibrary(
        editingId
          ? entries.map((item) => (item.id === editingId ? entry : item))
          : [...entries, entry],
      );
      saveEquationLibrary(next);
      setEntries(next);
      setStorageReadable(true);
      setEditingId(entry.id);
      setEditor({
        name: entry.name,
        tags: entry.tags.join(", "),
        equation: structuredClone(entry.equation),
      });
      setError("");
      setMessage("수식을 라이브러리에 저장했습니다.");
    } catch (failure) {
      setError((failure as Error).message);
      setMessage("");
    }
  }

  async function insert() {
    if (inserting) return;
    try {
      const entry = buildEntry();
      setInserting(true);
      setError("");
      const result = await onInsert(entry);
      if (result === false) {
        setError("수식을 삽입하지 못했습니다. 원문을 확인해주세요.");
        return;
      }
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setInserting(false);
    }
  }

  async function exportLibrary() {
    if (exporting) return;
    try {
      const source = serializeEquationLibrary(entries);
      setExporting(true);
      setMessage("");
      if (desktop) {
        const saved = await desktop.saveExport({
          bytes: new TextEncoder().encode(source),
          suggestedName: "scislide-equations.json",
          kind: "json",
        });
        if (!saved) return;
      } else {
        downloadBlob(
          new Blob([source], { type: "application/json" }),
          "scislide-equations.json",
        );
      }
      setError("");
      setMessage("수식 라이브러리를 내보냈습니다.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setExporting(false);
    }
  }
  function remove() {
    try {
      const next = entries.filter((entry) => entry.id !== editingId);
      saveEquationLibrary(next);
      setEntries(next);
      setEditingId(null);
      setEditor(newEditor());
      setError("");
      setMessage("저장한 수식을 삭제했습니다.");
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  async function importFile(file: File) {
    try {
      if (file.size > MAX_LIBRARY_BYTES)
        throw new Error("라이브러리 파일은 8 MB 이하로 가져와주세요.");
      const source =
        typeof file.text === "function"
          ? await file.text()
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsText(file);
            });
      const next = mergeEquationLibraries(
        entries,
        parseEquationLibrary(source),
      );
      saveEquationLibrary(next);
      setEntries(next);
      setError("");
      setStorageReadable(true);
      setMessage(`${next.length - entries.length}개의 수식을 가져왔습니다.`);
    } catch (failure) {
      setError((failure as Error).message);
      setMessage("");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={section}
        className="math-library personal-equation-library"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-equation-library-title"
        aria-describedby="personal-equation-library-description"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="library-eyebrow">
              PERSONAL EQUATIONS · {entries.length} SAVED
            </span>
            <h2 id="personal-equation-library-title">My equation library</h2>
            <p id="personal-equation-library-description">
              자주 쓰는 수식을 이름과 태그로 저장하고 다른 발표에서 다시
              사용하세요.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close equation library"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="equation-library-toolbar">
          <label className="equation-library-search">
            <Search size={15} />
            <input
              aria-label="Search saved equations"
              placeholder="Search name, tags, or LaTeX"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className="button light"
            onClick={() => {
              setEditingId(null);
              setEditor(newEditor());
              if (storageReadable) setError("");
              setMessage("");
            }}
          >
            <Plus size={14} /> New equation
          </button>
        </div>
        <div className="library-body">
          <nav aria-label="Saved equations">
            {visible.map((entry) => (
              <button
                key={entry.id}
                className={entry.id === editingId ? "selected" : ""}
                aria-pressed={entry.id === editingId}
                onClick={() => {
                  setEditingId(entry.id);
                  setEditor({
                    name: entry.name,
                    tags: entry.tags.join(", "),
                    equation: structuredClone(entry.equation),
                  });
                  setError("");
                  setMessage("");
                }}
              >
                <span>
                  {entry.name}
                  <small>
                    {entry.tags.join(" · ") ||
                      entry.equation.description ||
                      (entry.equation.renderer === "local-latex"
                        ? "Local LaTeX"
                        : "MathJax")}
                  </small>
                </span>
                <Sigma size={14} />
              </button>
            ))}
            {!visible.length && (
              <p className="equation-library-empty">
                {entries.length
                  ? "검색 결과가 없습니다."
                  : "아직 저장한 수식이 없습니다."}
              </p>
            )}
          </nav>
          <form
            className="library-detail equation-library-editor"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="field">
              <span>Name</span>
              <input
                aria-label="Saved equation name"
                value={editor.name}
                maxLength={200}
                placeholder="e.g. Friedmann equation"
                onChange={(event) =>
                  setEditor({ ...editor, name: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Tags · comma separated</span>
              <input
                aria-label="Saved equation tags"
                value={editor.tags}
                maxLength={2500}
                placeholder="cosmology, expansion"
                onChange={(event) =>
                  setEditor({ ...editor, tags: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea
                aria-label="Saved equation description"
                value={equation.description}
                maxLength={10_000}
                rows={2}
                onChange={(event) =>
                  updateEquation({ description: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Equation renderer</span>
              <select
                aria-label="Library equation renderer"
                value={equation.renderer ?? "mathjax"}
                onChange={(event) =>
                  updateEquation({
                    renderer: event.target
                      .value as EquationLibraryEquation["renderer"],
                    ...(event.target.value === "local-latex" &&
                    !equation.localTex
                      ? {
                          localTex: {
                            engine: "latex",
                            preamble: DEFAULT_LOCAL_PREAMBLE,
                          },
                        }
                      : {}),
                  })
                }
              >
                <option value="mathjax">MathJax · Live preview</option>
                <option value="local-latex">
                  Local LaTeX · Compile after insertion
                </option>
              </select>
            </label>
            <label className="field">
              <span>LaTeX source</span>
              <textarea
                className="latex-input"
                aria-label="Library LaTeX source"
                value={equation.latex}
                maxLength={MAX_EQUATION_SOURCE_CHARACTERS}
                spellCheck={false}
                rows={5}
                onChange={(event) =>
                  updateEquation({ latex: event.target.value })
                }
              />
            </label>
            {equation.renderer === "local-latex" && (
              <>
                <label className="field">
                  <span>TeX engine</span>
                  <select
                    aria-label="Library TeX engine"
                    value={equation.localTex?.engine ?? "latex"}
                    onChange={(event) =>
                      updateEquation({
                        localTex: {
                          engine: event.target.value as "latex" | "xelatex",
                          preamble: equation.localTex?.preamble ?? "",
                        },
                      })
                    }
                  >
                    <option value="latex">LaTeX</option>
                    <option value="xelatex">XeLaTeX</option>
                  </select>
                </label>
                <label className="field">
                  <span>Local preamble</span>
                  <textarea
                    className="latex-input preamble-input"
                    aria-label="Library LaTeX preamble"
                    value={equation.localTex?.preamble ?? ""}
                    maxLength={MAX_LOCAL_PREAMBLE_CHARACTERS}
                    spellCheck={false}
                    rows={4}
                    onChange={(event) =>
                      updateEquation({
                        localTex: {
                          engine: equation.localTex?.engine ?? "latex",
                          preamble: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              </>
            )}
            <div className="equation-library-style">
              <label className="field">
                <span>Math font</span>
                <select
                  aria-label="Library equation font"
                  value={equation.style.fontSetId ?? "mathjax-stix2"}
                  onChange={(event) =>
                    updateEquation({
                      style: {
                        ...equation.style,
                        fontSetId: event.target.value as FontSetId,
                      },
                    })
                  }
                >
                  {FONT_SET_IDS.map((font) => (
                    <option key={font} value={font}>
                      {font.replace("mathjax-", "")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Size</span>
                <input
                  type="number"
                  aria-label="Library equation size"
                  min={4}
                  max={500}
                  value={equation.style.fontSize ?? 48}
                  onChange={(event) =>
                    updateEquation({
                      style: {
                        ...equation.style,
                        fontSize: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Color</span>
                <input
                  aria-label="Library equation color"
                  maxLength={64}
                  value={equation.style.color ?? "#111827"}
                  onChange={(event) =>
                    updateEquation({
                      style: { ...equation.style, color: event.target.value },
                    })
                  }
                />
              </label>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                aria-label="Library display equation"
                checked={equation.displayMode}
                onChange={(event) =>
                  updateEquation({ displayMode: event.target.checked })
                }
              />{" "}
              Display equation
            </label>
            <div
              className="library-preview"
              aria-label="Saved equation preview"
            >
              {equation.renderer === "local-latex" ? (
                <span>
                  슬라이드에 삽입한 후 Compile로 미리보기를 생성하세요.
                </span>
              ) : previewError ? (
                <span className="library-error">{previewError}</span>
              ) : preview ? (
                <div dangerouslySetInnerHTML={{ __html: preview }} />
              ) : (
                <span>
                  {equation.latex.trim()
                    ? "Typesetting…"
                    : "LaTeX 원문을 입력하세요."}
                </span>
              )}
            </div>
            {error && (
              <p className="library-error" role="alert">
                {error}
              </p>
            )}
            {message && <p role="status">{message}</p>}
            <div className="equation-library-actions">
              <button
                type="submit"
                className="button light"
                disabled={!storageReadable || inserting}
              >
                <Save size={14} />{" "}
                {editingId ? "Save changes" : "Save equation"}
              </button>
              <button
                type="button"
                className="button primary"
                disabled={
                  inserting || !editor.name.trim() || !equation.latex.trim()
                }
                onClick={() => void insert()}
              >
                <Plus size={14} /> Insert into slide
              </button>
              {editingId && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Delete saved equation"
                  onClick={remove}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </form>
        </div>
        <footer>
          <div className="equation-library-actions">
            <button
              className="button light"
              onClick={() => importInput.current?.click()}
            >
              <Upload size={14} /> Import library
            </button>
            <button
              className="button light"
              disabled={exporting || !entries.length}
              onClick={() => void exportLibrary()}
            >
              <Download size={14} /> Export library
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              aria-label="Import equation library file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </div>
          <span>
            이 기기에 저장됩니다. 삽입한 수식은 독립적으로 편집할 수 있습니다.
          </span>
        </footer>
      </section>
    </div>
  );
}
