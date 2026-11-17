import { useEffect, useMemo, useRef, useState } from "react";
import type { Deck, Slide } from "../lib/model";
import type { UserSlideLayout } from "../lib/user-layouts";
import {
  isUserSlideLayoutCompatible,
  userSlideLayoutPreviewDeck,
} from "../lib/user-layouts";
import { DeferredSlideScene } from "./DeferredSlideScene";
import "./UserLayoutDialog.css";

export function UserLayoutDialog({
  deck,
  slide,
  entries,
  editingLayoutId = null,
  busy = false,
  error = "",
  onSave,
  onDelete,
  onEdit,
  onClose,
}: {
  deck: Deck;
  slide: Slide;
  entries: UserSlideLayout[];
  editingLayoutId?: string | null;
  busy?: boolean;
  error?: string;
  onSave: (name: string, replaceId?: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit: (id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const editing = entries.find((entry) => entry.id === editingLayoutId);
  const [name, setName] = useState(editing?.name ?? slide.title ?? "");
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const disabled = busy || pending;
  const savedPreviews = useMemo(
    () =>
      entries.map((entry) => ({
        entry,
        preview: userSlideLayoutPreviewDeck(entry),
        compatible: isUserSlideLayoutCompatible(entry, deck),
      })),
    [entries, deck.slideSize.width, deck.slideSize.height],
  );
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    setName(
      entries.find((entry) => entry.id === editingLayoutId)?.name ??
        slide.title,
    );
    setFailure("");
  }, [editingLayoutId, slide.id]);
  useEffect(() => {
    if (disabled) dialog.current?.focus();
  }, [disabled]);
  async function run(action: () => void | Promise<void>) {
    if (disabled) return;
    setPending(true);
    setFailure("");
    try {
      await action();
    } catch (caught) {
      setFailure((caught as Error).message);
    } finally {
      setPending(false);
    }
  }
  function save(replaceId?: string) {
    if (!name.trim()) {
      setFailure("Enter a name for this layout.");
      return;
    }
    void run(() => onSave(name.trim(), replaceId));
  }
  return (
    <div
      className="modal-backdrop user-layout-backdrop"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) {
            if (removing) setRemoving(null);
            else onClose();
          }
        }
        if (event.key === "Tab") {
          const controls = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled)",
            ) ?? []),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (
            !controls.includes(document.activeElement as HTMLElement) ||
            (event.shiftKey
              ? document.activeElement === first
              : document.activeElement === last)
          ) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
            if (!controls.length) dialog.current?.focus();
          }
        }
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className="user-layout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-layout-title"
        aria-describedby="user-layout-description"
        aria-busy={disabled}
      >
        <header>
          <h2 id="user-layout-title">User layouts</h2>
          <button
            type="button"
            aria-label="Close user layouts"
            disabled={disabled}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <p id="user-layout-description">
          Save the current slide as a reusable layout. Copies keep their
          content, positions, appearance, and notes. Updating a layout does not
          change slides already created from it. Unapplied equation drafts stay
          in local recovery.
        </p>
        {(error || failure) && <p role="alert">{failure || error}</p>}
        <section
          className="user-layout-current"
          aria-label="Save current slide layout"
        >
          <div
            className="user-layout-preview"
            style={{
              aspectRatio: `${deck.slideSize.width}/${deck.slideSize.height}`,
            }}
          >
            <DeferredSlideScene deck={deck} slide={slide} />
          </div>
          <div>
            <label>
              Layout name
              <input
                aria-label="Layout name"
                value={name}
                maxLength={200}
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p>
              {deck.slideSize.width} × {deck.slideSize.height} ·{" "}
              {slide.objects.length} objects
            </p>
            <div className="user-layout-actions">
              <button type="button" disabled={disabled} onClick={() => save()}>
                Save as new layout
              </button>
              {editing && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => save(editing.id)}
                >
                  Update {editing.name}
                </button>
              )}
            </div>
          </div>
        </section>
        <h3>Saved layouts</h3>
        {!entries.length ? (
          <p>No saved layouts yet.</p>
        ) : (
          <ul className="user-layout-list">
            {savedPreviews.map(({ entry, preview, compatible }) => {
              return (
                <li key={entry.id}>
                  <div
                    className="user-layout-preview"
                    style={{
                      aspectRatio: `${entry.slideSize.width}/${entry.slideSize.height}`,
                    }}
                  >
                    <DeferredSlideScene
                      deck={preview}
                      slide={preview.slides[0]}
                    />
                  </div>
                  <div>
                    <strong>{entry.name}</strong>
                    <p>
                      {entry.slideSize.width} × {entry.slideSize.height} ·{" "}
                      {entry.snapshot.content.objects.length} objects
                    </p>
                    {removing === entry.id ? (
                      <div
                        className="user-layout-actions"
                        role="group"
                        aria-label={`Delete ${entry.name} layout`}
                      >
                        <span>
                          Delete this saved layout? Existing slides stay
                          unchanged.
                        </span>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => setRemoving(null)}
                        >
                          Cancel deletion
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            void run(async () => {
                              await onDelete(entry.id);
                              setRemoving(null);
                            })
                          }
                        >
                          Delete saved layout
                        </button>
                      </div>
                    ) : (
                      <div className="user-layout-actions">
                        <button
                          type="button"
                          disabled={disabled || !compatible}
                          aria-label={`Edit ${entry.name} layout`}
                          title={
                            compatible
                              ? "Open an independent copy on the canvas"
                              : "This layout needs a document with matching page dimensions"
                          }
                          onClick={() => void run(() => onEdit(entry.id))}
                        >
                          Edit a copy
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          aria-label={`Delete ${entry.name} layout`}
                          onClick={() => setRemoving(entry.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
