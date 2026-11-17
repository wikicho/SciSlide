import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  applyMacroFavorite,
  loadMacroFavorites,
  saveMacroFavorites,
  validateMacroFavorite,
  wrapEquationSourceColor,
} from "../lib/equation-macros";
import type {
  EquationMacroFavorite,
  EquationSourceEdit,
} from "../lib/equation-macros";
import "./EquationSourceTools.css";

export interface EquationSourceToolsProps {
  sourceRef: RefObject<HTMLTextAreaElement | null>;
  source: string;
  renderer?: "mathjax" | "local-latex";
  preamble?: string;
  disabled?: boolean;
  onSourceChange: (source: string, preamble?: string) => void;
}
interface Snapshot {
  source: string;
  preamble: string;
  start: number;
  end: number;
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The command could not be saved or applied.";

/** Source-only tools. No renderer global state or automatic Local LaTeX compile. */
export function EquationSourceTools({
  sourceRef,
  source,
  renderer = "mathjax",
  preamble = "",
  disabled = false,
  onSourceChange,
}: EquationSourceToolsProps) {
  const [favorites, setFavorites] = useState<EquationMacroFavorite[]>([]);
  const [storeReady, setStoreReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [id, setId] = useState("");
  const [name, setName] = useState("Real numbers");
  const [definitions, setDefinitions] = useState(
    String.raw`\newcommand{\RR}{\mathbb{R}}`,
  );
  const [invocation, setInvocation] = useState(String.raw`\RR`);
  const [color, setColor] = useState("#c62828");
  const [hasSelection, setHasSelection] = useState(false);
  const [, refreshHistory] = useState(0);
  const current = useRef<Snapshot>({ source, preamble, start: 0, end: 0 });
  const undo = useRef<Snapshot[]>([]),
    redo = useRef<Snapshot[]>([]);
  const pendingSelection = useRef<Snapshot | undefined>(undefined);
  const latest = useRef({ source, preamble, onSourceChange, disabled });
  latest.current = { source, preamble, onSourceChange, disabled };

  function reload() {
    try {
      const loaded = loadMacroFavorites();
      setFavorites(loaded);
      if (id && !loaded.some((entry) => entry.id === id)) setId("");
      setStoreReady(true);
      setStorageError("");
    } catch (failure) {
      setStoreReady(false);
      setStorageError(
        `Command favorites could not be loaded: ${message(failure)}`,
      );
    }
  }
  useEffect(reload, []);

  const remember = (next: Snapshot) => {
    if (
      next.source !== current.current.source ||
      next.preamble !== current.current.preamble
    ) {
      undo.current.push({ ...current.current });
      if (undo.current.length > 150) undo.current.shift();
      redo.current = [];
    }
    current.current = next;
    refreshHistory((value) => value + 1);
  };
  const edit = (next: EquationSourceEdit) => {
    const input = sourceRef.current;
    if (input) {
      current.current.start = input.selectionStart;
      current.current.end = input.selectionEnd;
    }
    const snapshot = {
      source: next.source,
      preamble: next.preamble ?? latest.current.preamble,
      start: next.selectionStart,
      end: next.selectionEnd,
    };
    remember(snapshot);
    pendingSelection.current = snapshot;
    onSourceChange(next.source, next.preamble);
    // Definitions already present may leave the controlled value unchanged.
    input?.focus({ preventScroll: true });
    if (input?.value === next.source) {
      input.setSelectionRange(snapshot.start, snapshot.end);
      pendingSelection.current = undefined;
    }
  };

  useLayoutEffect(() => {
    const input = sourceRef.current;
    if (
      source !== current.current.source ||
      preamble !== current.current.preamble
    )
      remember({
        source,
        preamble,
        start: input?.selectionStart ?? 0,
        end: input?.selectionEnd ?? 0,
      });
    const pending = pendingSelection.current;
    if (pending && pending.source === source && pending.preamble === preamble) {
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(pending.start, pending.end);
      pendingSelection.current = undefined;
      setHasSelection(pending.end > pending.start);
    }
  }, [source, preamble, sourceRef]);

  useEffect(() => {
    const input = sourceRef.current;
    if (!input) return;
    let compositionSnapshot: Snapshot | undefined;
    const selected = () => {
      current.current.start = input.selectionStart;
      current.current.end = input.selectionEnd;
      setHasSelection(input.selectionEnd > input.selectionStart);
    };
    const changed = () => {
      const next = {
        source: input.value,
        preamble: latest.current.preamble,
        start: input.selectionStart,
        end: input.selectionEnd,
      };
      if (compositionSnapshot) current.current = next;
      else remember(next);
      selected();
    };
    const restore = (backwards: boolean) => {
      if (latest.current.disabled || compositionSnapshot) return;
      const from = backwards ? undo.current : redo.current,
        to = backwards ? redo.current : undo.current;
      const next = from.pop();
      if (!next) return;
      to.push({
        ...current.current,
        start: input.selectionStart,
        end: input.selectionEnd,
      });
      current.current = { ...next };
      pendingSelection.current = next;
      latest.current.onSourceChange(next.source, next.preamble);
      refreshHistory((value) => value + 1);
    };
    const history = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.isComposing ||
        compositionSnapshot ||
        event.keyCode === 229 ||
        event.getModifierState("AltGraph")
      )
        return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) restore(key === "z" && !event.shiftKey);
    };
    const beforeInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      if (
        !compositionSnapshot &&
        !inputEvent.isComposing &&
        ["historyUndo", "historyRedo"].includes(inputEvent.inputType)
      ) {
        event.preventDefault();
        event.stopPropagation();
        restore(inputEvent.inputType === "historyUndo");
      } else selected();
    };
    const compositionStart = () => {
      compositionSnapshot = {
        ...current.current,
        start: input.selectionStart,
        end: input.selectionEnd,
      };
    };
    const compositionEnd = () => {
      if (!compositionSnapshot) return;
      const before = compositionSnapshot;
      compositionSnapshot = undefined;
      current.current = before;
      remember({
        source: input.value,
        preamble: latest.current.preamble,
        start: input.selectionStart,
        end: input.selectionEnd,
      });
    };
    input.addEventListener("select", selected);
    input.addEventListener("beforeinput", beforeInput, true);
    input.addEventListener("compositionstart", compositionStart);
    input.addEventListener("compositionend", compositionEnd);
    input.addEventListener("keyup", selected);
    input.addEventListener("pointerup", selected);
    input.addEventListener("input", changed, true);
    input.addEventListener("keydown", history, true);
    selected();
    return () => {
      input.removeEventListener("select", selected);
      input.removeEventListener("beforeinput", beforeInput, true);
      input.removeEventListener("compositionstart", compositionStart);
      input.removeEventListener("compositionend", compositionEnd);
      input.removeEventListener("keyup", selected);
      input.removeEventListener("pointerup", selected);
      input.removeEventListener("input", changed, true);
      input.removeEventListener("keydown", history, true);
    };
  }, [sourceRef]);

  const attempt = (operation: () => void) => {
    setError("");
    setStatus("");
    if (disabled) return;
    try {
      operation();
    } catch (failure) {
      setError(message(failure));
    }
  };
  const favorite = () =>
    validateMacroFavorite({
      id: id || crypto.randomUUID(),
      name,
      definitions,
      invocation,
    });
  const freshFavorites = () => {
    const fresh = loadMacroFavorites();
    if (
      id &&
      JSON.stringify(fresh.find((entry) => entry.id === id)) !==
        JSON.stringify(favorites.find((entry) => entry.id === id))
    )
      throw new Error(
        "This favorite changed in another window. Reload favorites before replacing it.",
      );
    return fresh;
  };
  const useFavorite = (insert: boolean) =>
    attempt(() => {
      const input = sourceRef.current;
      if (!input) return;
      edit(
        applyMacroFavorite(
          source,
          preamble,
          renderer,
          favorite(),
          input.selectionStart,
          input.selectionEnd,
          insert,
        ),
      );
      setStatus(
        renderer === "local-latex"
          ? "Command copied to this equation. Compile explicitly, then apply."
          : "Command copied to this equation's source. Check the preview, then apply.",
      );
    });

  return (
    <fieldset className="equation-source-tools" disabled={disabled}>
      <legend>Equation source tools</legend>
      <div className="equation-source-color">
        <label>
          Selection color{" "}
          <input
            type="color"
            aria-label="Selected LaTeX color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button"
          disabled={!hasSelection}
          onClick={() =>
            attempt(() => {
              const input = sourceRef.current;
              if (!input) return;
              const next = wrapEquationSourceColor(
                source,
                input.selectionStart,
                input.selectionEnd,
                color,
              );
              if (
                next.source.length > (renderer === "mathjax" ? 12_000 : 32_000)
              )
                throw new Error(
                  "The colored equation exceeds its source limit.",
                );
              edit(next);
            })
          }
        >
          Color selected LaTeX
        </button>
      </div>
      <details>
        <summary>Custom command favorites</summary>
        <div className="equation-macro-fields">
          <label>
            Saved commands
            <select
              aria-label="Command favorite"
              value={id}
              onChange={(event) => {
                setId(event.target.value);
                setError("");
                setStatus("");
                const saved = favorites.find(
                  (entry) => entry.id === event.target.value,
                );
                if (saved) {
                  setName(saved.name);
                  setDefinitions(saved.definitions);
                  setInvocation(saved.invocation);
                }
              }}
            >
              <option value="">New favorite</option>
              {favorites.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input
              aria-label="Command favorite name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Definitions
            <textarea
              aria-label="Command definitions"
              value={definitions}
              maxLength={4000}
              spellCheck={false}
              onChange={(event) => setDefinitions(event.target.value)}
            />
          </label>
          <label>
            Insert source
            <input
              aria-label="Command insertion source"
              value={invocation}
              maxLength={1000}
              spellCheck={false}
              onChange={(event) => setInvocation(event.target.value)}
            />
          </label>
          <p>
            Favorites stay on this device. Using one copies its definitions into
            the equation, so saved files and exports remain portable.
          </p>
          <div className="equation-macro-actions">
            <button type="button" className="button" onClick={reload}>
              Reload favorites
            </button>
            <button
              type="button"
              className="button"
              onClick={() => useFavorite(true)}
            >
              Insert command
            </button>
            <button
              type="button"
              className="button"
              onClick={() => useFavorite(false)}
            >
              Apply definitions
            </button>
            <button
              type="button"
              className="button"
              disabled={!storeReady}
              onClick={() =>
                attempt(() => {
                  const entry = favorite(),
                    fresh = freshFavorites(),
                    next = id
                      ? fresh.map((item) => (item.id === id ? entry : item))
                      : [...fresh, entry];
                  saveMacroFavorites(next);
                  setFavorites(next);
                  setId(entry.id);
                  setStatus("Command favorite saved on this device.");
                })
              }
            >
              Save favorite
            </button>
            <button
              type="button"
              className="button"
              disabled={!id || !storeReady}
              onClick={() =>
                attempt(() => {
                  const next = freshFavorites().filter(
                    (item) => item.id !== id,
                  );
                  saveMacroFavorites(next);
                  setFavorites(next);
                  setId("");
                  setStatus(
                    "Command favorite removed. Existing equations retain their definitions.",
                  );
                })
              }
            >
              Remove favorite
            </button>
          </div>
          {storageError && <p role="alert">{storageError}</p>}
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </fieldset>
  );
}
