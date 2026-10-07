import { useEffect, useId, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import {
  isShortcutAvailable,
  shortcutLabel,
  type KeyboardPlatform,
  type ShortcutAction,
} from "../lib/shortcuts";
import "./KeyboardShortcutsDialog.css";

const platforms: { id: KeyboardPlatform; label: string }[] = [
  { id: "mac", label: "macOS" },
  { id: "linux", label: "Ubuntu / Linux" },
  { id: "windows", label: "Windows" },
];

type ShortcutRow = (
  | { label: string; action: ShortcutAction }
  | { label: string; keys: string | ((platform: KeyboardPlatform) => string) }
) & { platforms?: KeyboardPlatform[] };

const groups: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: "File",
    rows: [
      { label: "New presentation", action: "new" },
      { label: "Open presentation", action: "open" },
      { label: "Save", action: "save" },
      { label: "Save as", action: "saveAs" },
      { label: "Export PDF", action: "exportPdf" },
      { label: "Export current slide as SVG", action: "exportSvg" },
    ],
  },
  {
    title: "Editing",
    rows: [
      { label: "Undo", action: "undo" },
      { label: "Redo", action: "redo" },
      { label: "Select all objects", action: "selectAll" },
      { label: "Deselect all objects", action: "deselectAll" },
      { label: "Copy objects", action: "copy" },
      { label: "Cut objects", action: "cut" },
      { label: "Paste objects", action: "paste" },
      { label: "Duplicate selection or slide", action: "duplicate" },
      { label: "Duplicate current slide", action: "duplicateSlide" },
      { label: "Group objects", action: "group" },
      { label: "Ungroup objects", action: "ungroup" },
    ],
  },
  {
    title: "Insert",
    rows: [
      { label: "Add slide from a layout", action: "addSlide" },
      { label: "Insert equation", action: "insertEquation" },
      { label: "Insert image, SVG or PDF", action: "insertFigure" },
    ],
  },
  {
    title: "Slides",
    rows: [
      { label: "Next slide", action: "nextSlide" },
      { label: "Previous slide", action: "previousSlide" },
      { label: "First slide", action: "firstSlide" },
      { label: "Last slide", action: "lastSlide" },
      {
        label: "Select slides in the slide navigator",
        keys: "↑ / ↓",
      },
      {
        label: "Delete slide in the slide navigator",
        keys: (platform) =>
          platform === "mac" ? "⌫ / Fn + ⌫" : "Delete / Backspace",
      },
      { label: "Move focused slide up", action: "moveSlideUp" },
      { label: "Move focused slide down", action: "moveSlideDown" },
      {
        label: "Move focused slide to the beginning",
        action: "moveSlideFirst",
      },
      { label: "Move focused slide to the end", action: "moveSlideLast" },
    ],
  },
  {
    title: "Text",
    rows: [
      { label: "Edit selected text", keys: "Enter / Double-click" },
      { label: "Insert a new line", keys: "Enter" },
      { label: "Apply text changes", action: "finishTextEditing" },
      { label: "Cancel text changes", keys: "Esc" },
      { label: "Toggle bold on selected text objects", action: "bold" },
      { label: "Increase selected text size", action: "increaseFontSize" },
      { label: "Decrease selected text size", action: "decreaseFontSize" },
      { label: "Align selected text left", action: "alignTextLeft" },
      { label: "Center selected text", action: "alignTextCenter" },
      { label: "Align selected text right", action: "alignTextRight" },
    ],
  },
  {
    title: "Canvas",
    rows: [
      { label: "Move objects by 1 px", keys: "Arrow keys" },
      { label: "Move objects by 10 px", keys: "Shift + Arrow keys" },
      {
        label: "Add or remove objects from selection",
        keys: (platform) =>
          platform === "mac" ? "⌘ + click / Shift + click" : "Shift + click",
      },
      {
        label: "Bypass alignment guides while dragging",
        keys: (platform) => (platform === "mac" ? "Option" : "Alt"),
      },
      {
        label: "Delete selected objects",
        keys: (platform) =>
          platform === "mac" ? "⌫ / Fn + ⌫" : "Delete / Backspace",
      },
      { label: "Cancel drawing or clear selection", keys: "Esc" },
    ],
  },
  {
    title: "Object order and locks",
    rows: [
      { label: "Lock selected objects", action: "lock" },
      { label: "Unlock selected objects", action: "unlock" },
      { label: "Bring to front", action: "bringToFront" },
      { label: "Send to back", action: "sendToBack" },
      { label: "Bring forward one layer", action: "bringForward" },
      { label: "Send backward one layer", action: "sendBackward" },
    ],
  },
  {
    title: "View",
    rows: [
      { label: "Zoom in", action: "zoomIn" },
      { label: "Zoom out", action: "zoomOut" },
      { label: "Fit slide to window", action: "fitSlide" },
    ],
  },
  {
    title: "Presentation",
    rows: [
      { label: "Start presentation", action: "present", platforms: ["mac"] },
      { label: "Start from first slide", action: "presentFromStart" },
      {
        label: "Start from current slide",
        action: "present",
        platforms: ["linux", "windows"],
      },
      { label: "Open presenter display", action: "presenterView" },
      {
        label: "End presentation",
        keys: (platform) =>
          platform === "mac"
            ? "Esc / Q"
            : platform === "linux"
              ? "Esc / -"
              : "Esc",
      },
      {
        label: "Next slide or build",
        keys: (platform) =>
          platform === "windows"
            ? "→ / ↓ / Space / Page Down / Enter / N"
            : platform === "linux"
              ? "→ / ↓ / Space / Page Down / Enter"
              : "→ / ↓ / Space / Page Down",
      },
      {
        label: "Previous slide or build",
        keys: (platform) =>
          platform === "windows"
            ? "← / ↑ / Page Up / Backspace / P"
            : platform === "linux"
              ? "← / ↑ / Page Up / Backspace"
              : "← / ↑ / Page Up",
      },
      { label: "First / last slide", keys: "Home / End" },
    ],
  },
  {
    title: "Help",
    rows: [{ label: "Keyboard shortcuts", action: "help" }],
  },
];

export function KeyboardShortcutsDialog({
  platform,
  onClose,
}: {
  platform: KeyboardPlatform;
  onClose: () => void;
}) {
  const id = useId();
  const section = useRef<HTMLElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [previewPlatform, setPreviewPlatform] = useState(platform);
  const currentIndex = platforms.findIndex(({ id }) => id === previewPlatform);
  const selectedPlatform = platforms[currentIndex];
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter(
        (row) =>
          (!row.platforms || row.platforms.includes(previewPlatform)) &&
          (!("action" in row) ||
            isShortcutAvailable(row.action, previewPlatform)),
      ),
    }))
    .filter((group) => group.rows.length > 0);

  useEffect(() => setPreviewPlatform(platform), [platform]);

  useEffect(() => {
    const previous = document.activeElement;
    tabs.current
      .find((tab) => tab?.getAttribute("aria-selected") === "true")
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        section.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      ).filter((element) => !element.hidden && element.tabIndex >= 0);
      const first = controls[0];
      const last = controls.at(-1);
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

  return (
    <div
      className="modal-backdrop keyboard-shortcuts-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <section
        ref={section}
        className="keyboard-shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <header className="keyboard-shortcuts-header">
          <div>
            <p className="keyboard-shortcuts-eyebrow">
              <Keyboard size={14} aria-hidden="true" /> Work with your keyboard
            </p>
            <h2 id={`${id}-title`}>Keyboard shortcuts</h2>
            <p id={`${id}-description`}>
              Shortcuts for your computer, with a reference for each platform.
            </p>
          </div>
          <button
            type="button"
            className="keyboard-shortcuts-close"
            aria-label="Close keyboard shortcuts"
            onClick={() => closeRef.current()}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <div
          className="keyboard-shortcuts-tabs"
          role="tablist"
          aria-label="Shortcut platform"
        >
          {platforms.map((entry, index) => (
            <button
              ref={(element) => {
                tabs.current[index] = element;
              }}
              key={entry.id}
              id={`${id}-${entry.id}-tab`}
              type="button"
              role="tab"
              aria-selected={previewPlatform === entry.id}
              aria-controls={`${id}-panel`}
              tabIndex={previewPlatform === entry.id ? 0 : -1}
              onClick={() => setPreviewPlatform(entry.id)}
              onKeyDown={(event) => {
                let next: number;
                if (event.key === "ArrowRight")
                  next = (index + 1) % platforms.length;
                else if (event.key === "ArrowLeft")
                  next = (index + platforms.length - 1) % platforms.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = platforms.length - 1;
                else return;
                event.preventDefault();
                event.stopPropagation();
                setPreviewPlatform(platforms[next].id);
                tabs.current[next]?.focus();
              }}
            >
              {entry.label}
              {entry.id === platform && <span>Current</span>}
            </button>
          ))}
        </div>
        <div
          id={`${id}-panel`}
          className="keyboard-shortcuts-body"
          role="tabpanel"
          aria-labelledby={`${id}-${selectedPlatform.id}-tab`}
          tabIndex={0}
        >
          {visibleGroups.map((group) => (
            <section key={group.title} className="keyboard-shortcuts-group">
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map((row) => (
                  <div key={row.label} className="keyboard-shortcuts-row">
                    <dt>{row.label}</dt>
                    <dd>
                      <kbd>
                        {"action" in row
                          ? shortcutLabel(row.action, previewPlatform)
                          : typeof row.keys === "function"
                            ? row.keys(previewPlatform)
                            : row.keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="keyboard-shortcuts-note">
            While editing text, copy, paste, selection, and arrow keys work on
            the text. Browsers may reserve New and Open; use their toolbar
            buttons or the desktop app.
          </p>
          {previewPlatform === "mac" && (
            <p className="keyboard-shortcuts-note">
              On compact Mac keyboards, Fn + ↓ / ↑ gives Page Down / Page Up; Fn
              + ← / → gives Home / End. Slide-navigator arrow and delete keys
              work when a thumbnail has focus. Bold, size and alignment apply to
              whole selected text objects on the canvas. ⌘+Enter applies an
              inline text edit; on the canvas it also remains a presentation
              shortcut.
            </p>
          )}
          {previewPlatform !== "mac" && (
            <p className="keyboard-shortcuts-note">
              {previewPlatform === "windows"
                ? "Windows follows PowerPoint conventions for supported actions."
                : "Ubuntu / Linux follows LibreOffice Impress conventions for supported actions."}{" "}
              Slide-navigator arrow, delete and move keys work when a thumbnail
              has focus. Bold, size and alignment apply to whole selected text
              objects on the canvas. Ctrl+Enter applies an inline text edit; on
              the canvas it remains a shortcut to present from the current
              slide.
              {previewPlatform === "linux" &&
                " Use numeric-keypad + for Ctrl++ and Ctrl+Shift++; the main-keyboard equivalents are Ctrl+= and Ctrl+Shift+=. Shift+F3 immediately duplicates the selection or slide. Alt+Shift+E inserts an equation. Export commands are SciSlide additions."}
              {previewPlatform === "windows" &&
                " Export commands are SciSlide additions."}
            </p>
          )}
        </div>
        <footer className="keyboard-shortcuts-footer">
          <p>
            Your shortcuts follow{" "}
            {platforms.find(({ id }) => id === platform)!.label}. Tabs only
            change this reference.
          </p>
          <button type="button" onClick={() => closeRef.current()}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
