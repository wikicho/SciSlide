import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FilePlus2, X } from "lucide-react";
import type { Deck } from "../lib/model";
import {
  createThemedSlide,
  getDeckLayouts,
  getDeckTheme,
} from "../lib/deck-themes";
import type { DeckSlideLayoutId } from "../lib/deck-themes";
import { SlideScene } from "./SlideScene";

const layoutCategories = [
  { id: "all", name: "All layouts" },
  { id: "scientific", name: "Scientific" },
  { id: "keynote", name: "Keynote-inspired" },
] as const;

export function SlideTemplateDialog({
  deck,
  onChoose,
  onClose,
}: {
  deck: Deck;
  onChoose: (id: DeckSlideLayoutId) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [category, setCategory] =
    useState<(typeof layoutCategories)[number]["id"]>("all");
  const layouts = useMemo(
    () =>
      getDeckLayouts(deck)
        .filter((template) => template.id !== "blank")
        .map((template) => ({
          ...template,
          slide: createThemedSlide(template.id, deck),
        })),
    [deck],
  );
  const visibleLayouts = layouts.filter(
    (template) => category === "all" || template.category === category,
  );
  const dedicatedTheme = getDeckTheme(deck)?.id === "keynote-white";
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>(".template-card")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        dialog.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? [],
      );
      const first = buttons[0],
        last = buttons.at(-1);
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
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="template-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-dialog-title"
        aria-describedby="template-dialog-description"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <div className="template-heading-meta">
              <span className="library-eyebrow">
                {dedicatedTheme ? "KEYNOTE WHITE LAYOUTS" : "SLIDE LAYOUTS"}
              </span>
              <span className="template-count" aria-live="polite">
                {visibleLayouts.length} layouts
              </span>
            </div>
            <h2 id="template-dialog-title">Choose a slide layout.</h2>
            <p id="template-dialog-description">
              {dedicatedTheme
                ? "Coordinated white layouts with bold type and media placeholders."
                : "Scientific and Keynote-inspired starters."}{" "}
              All objects are editable.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close slide templates"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {!dedicatedTheme && (
          <div
            className="template-filters"
            role="group"
            aria-label="Slide layout category"
          >
            {layoutCategories.map((item) => (
              <button
                key={item.id}
                className="template-filter"
                aria-pressed={category === item.id}
                onClick={(event) => {
                  setCategory(item.id);
                  if (grid.current) grid.current.scrollTop = 0;
                  event.currentTarget.focus();
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        <div ref={grid} className="template-grid">
          {visibleLayouts.map((template) => (
            <button
              key={template.id}
              className="template-card"
              aria-label={`Use ${template.name} layout`}
              onClick={() => onChoose(template.id)}
            >
              <span className="template-thumbnail">
                <SlideScene deck={deck} slide={template.slide} />
              </span>
              <span className="template-card-label">
                <span>
                  <strong>{template.name}</strong>
                  <small>{template.description}</small>
                </span>
                <ArrowRight size={16} />
              </span>
            </button>
          ))}
        </div>
        <footer>
          <span>Inserted after the current slide.</span>
          <button className="button light" onClick={() => onChoose("blank")}>
            <FilePlus2 size={15} /> Blank slide
          </button>
        </footer>
      </section>
    </div>
  );
}
