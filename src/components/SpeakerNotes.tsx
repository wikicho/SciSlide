import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, NotebookPen } from "lucide-react";
import { PanelResizeHandle } from "./PanelResizeHandle";

export function SpeakerNotes({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preferredHeight, setPreferredHeight] = useState(140);
  const [maximumHeight, setMaximumHeight] = useState(320);
  const section = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const id = useId();
  const height = Math.min(preferredHeight, maximumHeight);
  useLayoutEffect(() => {
    const notes = section.current,
      parent = notes?.parentElement,
      button = toggle.current;
    if (!notes || !parent || !button) return;
    const siblings = [...parent.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child !== notes,
    );
    const viewport = siblings.find((child) =>
      child.classList.contains("canvas-viewport"),
    );
    const fixed = siblings.filter((child) => child !== viewport);
    const pixels = (value: string) => Number.parseFloat(value) || 0;
    const measure = () => {
      // Standalone controls and non-layout environments retain the usual range.
      if (!viewport || parent.clientHeight <= 0) {
        setMaximumHeight(320);
        return;
      }
      const parentStyle = getComputedStyle(parent),
        notesStyle = getComputedStyle(notes);
      const available =
        parent.clientHeight -
        pixels(parentStyle.paddingTop) -
        pixels(parentStyle.paddingBottom) -
        fixed.reduce((total, child) => total + child.offsetHeight, 0) -
        pixels(getComputedStyle(viewport).minHeight) -
        button.offsetHeight -
        pixels(notesStyle.borderTopWidth) -
        pixels(notesStyle.borderBottomWidth);
      const maximum = Math.max(0, Math.min(320, Math.floor(available)));
      // Move focus before hiding/disabling its owner; browsers may otherwise
      // blur the input to the document during the following DOM update.
      if (maximum <= 0 && content.current?.contains(document.activeElement))
        button.focus({ preventScroll: true });
      setMaximumHeight(maximum);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    // The viewport's actual height changes as notes resize. Observe only the
    // available parent and fixed controls to avoid feeding that change back in.
    for (const target of [parent, ...fixed, button]) observer?.observe(target);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);
  return (
    <section
      ref={section}
      className={`speaker-notes ${open ? "is-open" : ""}`}
      aria-label="Presenter notes"
    >
      {open && (
        <PanelResizeHandle
          label="Resize speaker notes"
          orientation="horizontal"
          value={height}
          min={Math.min(90, maximumHeight)}
          max={maximumHeight}
          onChange={(next) => {
            if (next !== height) setPreferredHeight(Math.max(90, next));
          }}
        />
      )}
      <button
        ref={toggle}
        type="button"
        className="notes-toggle"
        aria-label="Toggle speaker notes"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{" "}
        <NotebookPen size={15} /> Speaker notes
        <span>{value.trim() ? "Notes added" : "Only visible to you"}</span>
      </button>
      <div
        ref={content}
        id={id}
        hidden={!open || height <= 0}
        className="notes-content"
        style={{
          height,
          paddingBottom: Math.min(14, height),
          overflow: "hidden",
        }}
      >
        <textarea
          aria-label="Speaker notes"
          disabled={height <= 0}
          value={value}
          placeholder="Add a reminder for your presentation…"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
    </section>
  );
}
