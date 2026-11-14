import { useEffect, useRef } from "react";
import "./SaveChangesDialog.css";

type Choice = "save" | "discard" | "cancel" | "recover";
export function SaveChangesDialog({
  title,
  onChoose,
  allowRecovery = false,
  draftCount = 0,
}: {
  title: string;
  onChoose: (choice: Choice) => void;
  allowRecovery?: boolean;
  draftCount?: number;
}) {
  const hasDrafts = draftCount > 0;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
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
          onChoose("cancel");
        }
        if (event.key === "Tab") {
          const buttons = [
            ...(dialog.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? []),
          ];
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (!buttons.includes(document.activeElement as HTMLButtonElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        ref={dialog}
        className="save-changes-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-changes-title"
        aria-describedby={
          hasDrafts
            ? "save-changes-description save-changes-drafts"
            : "save-changes-description"
        }
      >
        <h2 id="save-changes-title">Save changes before continuing?</h2>
        <p id="save-changes-description">
          {hasDrafts
            ? `“${title}” has unsaved changes. ${allowRecovery ? "Keep a recovery copy, discard the changes, or cancel to keep editing." : "Discard the changes, or cancel to keep editing."}`
            : `“${title}” has unsaved changes. Save the presentation, discard the changes, or cancel to keep editing.`}
        </p>
        {hasDrafts && (
          <p id="save-changes-drafts" className="save-changes-drafts">
            {draftCount} unfinished equation{" "}
            {draftCount === 1 ? "draft has" : "drafts have"} not been applied to
            the slide. Apply {draftCount === 1 ? "it" : "them"} before saving to
            a .scislide file.
          </p>
        )}
        {allowRecovery && (
          <p className="save-changes-recovery-hint">
            Keep a recovery copy to preserve this session and unfinished
            equation drafts locally. Previously saved recovery copies remain
            available until removed in Recovered documents.
          </p>
        )}
        <div className="save-changes-actions">
          <button data-cancel onClick={() => onChoose("cancel")}>
            Cancel
          </button>
          <button onClick={() => onChoose("discard")}>Discard changes</button>
          {allowRecovery && (
            <button
              className={hasDrafts ? "primary-button" : undefined}
              onClick={() => onChoose("recover")}
            >
              Keep recovery and continue
            </button>
          )}
          <button
            className={hasDrafts ? undefined : "primary-button"}
            disabled={hasDrafts}
            title={
              hasDrafts
                ? "Apply unfinished equation drafts before saving."
                : undefined
            }
            onClick={() => onChoose("save")}
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
