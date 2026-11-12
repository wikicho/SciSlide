import { useId, useState } from "react";
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
  const [height, setHeight] = useState(140);
  const id = useId();
  return (
    <section
      className={`speaker-notes ${open ? "is-open" : ""}`}
      aria-label="Presenter notes"
    >
      {open && (
        <PanelResizeHandle
          label="Resize speaker notes"
          orientation="horizontal"
          value={height}
          min={90}
          max={320}
          onChange={setHeight}
        />
      )}
      <button
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
      <div id={id} hidden={!open} className="notes-content" style={{ height }}>
        <textarea
          aria-label="Speaker notes"
          value={value}
          placeholder="Add a reminder for your presentation…"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
    </section>
  );
}
