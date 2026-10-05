import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowRight,
  Check,
  CircleHelp,
  FolderOpen,
  History,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { createThemeDeck, DECK_THEMES } from "../lib/deck-themes";
import type { DeckThemeId } from "../lib/deck-themes";
import { SlideScene } from "./SlideScene";
import "./ThemeChooser.css";

export function ThemeChooser({
  onChoose,
  onOpen,
  onResume,
  onDemo,
  onCancel,
  onHelp,
  busy = false,
}: {
  onChoose: (id: DeckThemeId) => void;
  onOpen: () => void;
  onResume?: () => void;
  onDemo?: () => void;
  onCancel?: () => void;
  onHelp?: () => void;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<DeckThemeId>("scientific");
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const previews = useMemo(
    () =>
      DECK_THEMES.map((theme) => ({
        ...theme,
        deck: createThemeDeck(theme.id),
      })),
    [],
  );
  const theme = DECK_THEMES.find((candidate) => candidate.id === selected)!;
  const chooser = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    cards.current[0]?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!busy)
      cards.current
        .find((card) => card?.getAttribute("aria-checked") === "true")
        ?.focus();
  }, [busy]);

  function selectWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (busy) return;
    let next = index;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % previews.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index + previews.length - 1) % previews.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = previews.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setSelected(previews[next].id);
    cards.current[next]?.focus();
  }

  return (
    <div ref={chooser} className="theme-chooser" aria-busy={busy}>
      <header className="theme-chooser-topbar">
        <div className="theme-chooser-brand">
          <span className="theme-chooser-logo" aria-hidden="true">
            <Sparkles size={23} />
          </span>
          <span>
            SciSlide<small>Ideas, beautifully presented.</small>
          </span>
        </div>
        <div className="theme-chooser-top-actions">
          {onHelp && (
            <button
              type="button"
              className="theme-chooser-cancel"
              onClick={onHelp}
              disabled={busy}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
            >
              <CircleHelp size={18} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="theme-chooser-open"
            onClick={onOpen}
            disabled={busy}
          >
            <FolderOpen size={17} aria-hidden="true" /> Open presentation
          </button>
          {onCancel && (
            <button
              type="button"
              className="theme-chooser-cancel"
              onClick={onCancel}
              disabled={busy}
            >
              <X size={17} aria-hidden="true" /> Cancel
            </button>
          )}
        </div>
      </header>
      <main
        className="theme-chooser-main"
        aria-labelledby="theme-chooser-title"
      >
        <section className="theme-chooser-intro">
          <div className="theme-chooser-eyebrow">A NEW PRESENTATION</div>
          <h1 id="theme-chooser-title">Choose your theme.</h1>
          <p>
            Start with a canvas that fits your story.
            <br />
            Make every word, figure and equation your own.
          </p>
          <div className="theme-chooser-specs">
            <span>16:9 widescreen</span>
            <span>Editable layouts</span>
            <span>LaTeX equations</span>
          </div>
          {onResume && (
            <button
              type="button"
              className="theme-chooser-resume"
              aria-label="Resume previous work"
              onClick={onResume}
              disabled={busy}
            >
              <span className="theme-chooser-resume-icon" aria-hidden="true">
                <History size={21} />
              </span>
              <span>
                <strong>Resume previous work</strong>
                <small>Your saved workspace is ready.</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
          {onDemo && (
            <button
              type="button"
              className="theme-chooser-demo"
              onClick={onDemo}
              disabled={busy}
            >
              <Play size={14} aria-hidden="true" /> Explore demo
            </button>
          )}
        </section>
        <section
          className="theme-chooser-gallery"
          aria-label="Choose a starting style"
        >
          <div className="theme-chooser-gallery-heading">
            <span>CURATED THEMES</span>
            <span>{previews.length} starting points</span>
          </div>
          <div
            className="theme-chooser-grid"
            role="radiogroup"
            aria-label="Presentation theme"
          >
            {previews.map((preview, index) => (
              <button
                type="button"
                key={preview.id}
                ref={(element) => {
                  cards.current[index] = element;
                }}
                className="theme-chooser-card"
                role="radio"
                aria-label={preview.name}
                aria-checked={selected === preview.id}
                aria-describedby={`theme-description-${preview.id}`}
                tabIndex={selected === preview.id ? 0 : -1}
                disabled={busy}
                onClick={() => setSelected(preview.id)}
                onKeyDown={(event) => selectWithKeyboard(event, index)}
              >
                <span className="theme-chooser-preview" aria-hidden="true">
                  <SlideScene
                    deck={preview.deck}
                    slide={preview.deck.slides[0]}
                  />
                  {selected === preview.id && (
                    <span className="theme-chooser-check">
                      <Check size={14} />
                    </span>
                  )}
                </span>
                <span className="theme-chooser-card-description">
                  <strong>{preview.name}</strong>
                  <span id={`theme-description-${preview.id}`}>
                    {preview.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="theme-chooser-selected" aria-live="polite">
            <span className="theme-chooser-palette" aria-hidden="true">
              {[
                theme.palette.background,
                theme.palette.ink,
                theme.palette.accent,
              ].map((color, index) => (
                <i key={index} style={{ background: color }} />
              ))}
            </span>
            <p>
              <strong>{theme.name}</strong>
              <span>{theme.detail}</span>
            </p>
          </div>
        </section>
      </main>
      <footer className="theme-chooser-footer">
        <p>One title slide to begin. Add layouts as your story grows.</p>
        <button
          type="button"
          className="theme-chooser-create"
          onClick={() => onChoose(selected)}
          disabled={busy}
        >
          {busy ? "Opening presentation…" : "Create presentation"}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}
