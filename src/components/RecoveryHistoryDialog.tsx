import { useEffect, useRef, useState } from "react";
import { History, Trash2, X } from "lucide-react";
import type { DocumentRecoverySummary } from "../lib/recovery-history";
import "./RecoveryHistoryDialog.css";

export function RecoveryHistoryDialog({
  entries,
  unavailableCount,
  loading,
  busy,
  suspended = false,
  error,
  onRestore,
  onRemove,
  onClose,
}: {
  entries: DocumentRecoverySummary[];
  unavailableCount: number;
  loading: boolean;
  busy: boolean;
  suspended?: boolean;
  error: string;
  onRestore: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("[data-close]")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    if (suspended) return;
    if (!busy && !dialog.current?.contains(document.activeElement))
      dialog.current?.querySelector<HTMLButtonElement>("[data-close]")?.focus();
    if (busy) dialog.current?.focus({ preventScroll: true });
  }, [busy, suspended]);
  useEffect(() => {
    if (!entries.some((entry) => entry.id === removing)) setRemoving(null);
  }, [entries, removing]);
  return (
    <div
      className="modal-backdrop recovery-history-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) {
            if (removing) setRemoving(null);
            else onClose();
          }
        }
        if (event.key === "Tab") {
          const buttons = [
            ...(dialog.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? []),
          ];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (!buttons.length) {
            event.preventDefault();
            dialog.current?.focus();
          } else if (
            index < 0 ||
            (event.shiftKey ? index === 0 : index === buttons.length - 1)
          ) {
            event.preventDefault();
            buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
          }
        }
      }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        className="recovery-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-history-title"
        aria-describedby="recovery-history-description"
        aria-busy={busy || loading}
        aria-hidden={suspended || undefined}
        inert={suspended}
      >
        <header>
          <div>
            <History size={22} aria-hidden="true" />
            <h2 id="recovery-history-title">Recovered documents</h2>
          </div>
          <button
            data-close
            type="button"
            aria-label="Close recovered documents"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <p id="recovery-history-description">
          Open a local recovery copy to keep editing. Each work session has its
          own copy, including unfinished equation drafts. Save as .scislide to
          keep a portable file.
        </p>
        <p className="recovery-history-limit">
          Up to 10 copies and 100 MiB. Older copies stay until you remove them.
        </p>
        {error && (
          <p className="recovery-history-error" role="alert">
            {error}
          </p>
        )}
        {unavailableCount > 0 && (
          <p className="recovery-history-error" role="status">
            {unavailableCount} saved{" "}
            {unavailableCount === 1 ? "copy could" : "copies could"} not be
            read. Other valid copies are available below.
          </p>
        )}
        {loading ? (
          <p role="status">Loading recovered documents…</p>
        ) : !entries.length ? (
          <p className="recovery-history-empty">No recovered documents yet.</p>
        ) : (
          <ul className="recovery-history-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <div className="recovery-history-details">
                  <h3>{entry.title || "Untitled presentation"}</h3>
                  <time dateTime={entry.savedAt}>
                    {new Date(entry.savedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                  <p>
                    {entry.slideCount}{" "}
                    {entry.slideCount === 1 ? "slide" : "slides"}
                    {entry.draftCount
                      ? ` · ${entry.draftCount} unfinished equation ${entry.draftCount === 1 ? "draft" : "drafts"}`
                      : ""}{" "}
                    · {(entry.bytes / (1024 * 1024)).toFixed(1)} MiB
                  </p>
                </div>
                {removing === entry.id ? (
                  <div
                    className="recovery-history-remove-confirm"
                    role="group"
                    aria-label={`Remove recovery for ${entry.title}`}
                  >
                    <p>
                      Remove this recovery copy? Your open presentation and
                      saved files stay available.
                    </p>
                    <button disabled={busy} onClick={() => setRemoving(null)}>
                      Cancel removal
                    </button>
                    <button
                      className="recovery-history-remove"
                      disabled={busy}
                      onClick={() => onRemove(entry.id)}
                    >
                      Remove saved copy
                    </button>
                  </div>
                ) : (
                  <div className="recovery-history-actions">
                    <button
                      disabled={busy}
                      onClick={() => onRestore(entry.id)}
                      aria-label={`Open recovery for ${entry.title}`}
                    >
                      Open copy
                    </button>
                    <button
                      className="recovery-history-remove"
                      disabled={busy}
                      onClick={() => setRemoving(entry.id)}
                      aria-label={`Remove recovery for ${entry.title}`}
                    >
                      <Trash2 size={16} /> Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
