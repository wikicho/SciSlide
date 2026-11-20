import { useEffect, useRef, useState } from "react";
import type { Deck } from "../lib/model";
import { SlideScene } from "./SlideScene";
import { maxBuildStep } from "../lib/presentation";
import type { PresenterAction, PresenterState } from "../lib/presenter";
import { usePresentationReceiver } from "./usePresentationReceiver";

function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

export function PresenterApp({ token }: { token: string }) {
  const { deck, state, connected, ended, send } =
    usePresentationReceiver(token);
  if (ended)
    return (
      <main className="presenter-shell presenter-message">
        <h1>Presentation ended</h1>
        <p>You can close this window.</p>
      </main>
    );
  if (!deck || !state)
    return (
      <main className="presenter-shell presenter-message">
        <h1>Presenter display</h1>
        <p>
          {connected
            ? "Connecting to your presentation…"
            : "The presentation window is unavailable."}
        </p>
      </main>
    );
  return (
    <PresenterDisplay
      deck={deck}
      state={state}
      connected={connected}
      onAction={send}
    />
  );
}

export function PresenterDisplay({
  deck,
  state,
  connected = true,
  onAction,
}: {
  deck: Deck;
  state: PresenterState;
  connected?: boolean;
  onAction: (action: PresenterAction) => void;
}) {
  const index = Math.max(
    0,
    deck.slides.findIndex((slide) => slide.id === state.slideId),
  );
  const current = deck.slides[index];
  const next = deck.slides[index + 1];
  return (
    <main className="presenter-shell">
      <header>
        <h1>
          {deck.title} <small>Presenter display</small>
        </h1>
        <button onClick={() => onAction("exit")}>End presentation</button>
      </header>
      {!connected && (
        <p role="status">
          Connection interrupted. Return to the audience window.
        </p>
      )}
      <div className="presenter-previews">
        <section>
          <h2>
            Current · {index + 1} / {deck.slides.length} · Step {state.step}
          </h2>
          <SlideScene
            deck={deck}
            slide={current}
            slideIndex={index}
            playback
            playMedia={false}
            presentationStep={state.step}
          />
        </section>
        <section>
          <h2>Next slide</h2>
          {next ? (
            <SlideScene
              deck={deck}
              slide={next}
              slideIndex={index + 1}
              playMedia={false}
            />
          ) : (
            <p>Last slide</p>
          )}
        </section>
      </div>
      <div className="presenter-details">
        <section className="presenter-notes">
          <h2>Speaker notes</h2>
          <p>{current.notes || "No speaker notes for this slide."}</p>
        </section>
        <PresenterTimer key={state.startedAt} startedAt={state.startedAt} />
      </div>
      <nav className="presenter-navigation">
        <button
          disabled={!connected || (!index && !state.step)}
          onClick={() => onAction("previous")}
        >
          Previous
        </button>
        <span>{current.title}</span>
        <button
          disabled={
            !connected ||
            (index === deck.slides.length - 1 &&
              state.step >= maxBuildStep(current))
          }
          onClick={() => onAction("next")}
        >
          Next step / slide
        </button>
      </nav>
    </main>
  );
}

function PresenterTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => (Date.now() - startedAt) / 1000);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(20);
  const base = useRef({ at: startedAt, elapsed: 0 });
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setElapsed(base.current.elapsed + (Date.now() - base.current.at) / 1000);
    }, 250);
    return () => clearInterval(timer);
  }, [paused]);
  return (
    <section className="presenter-timer">
      <h2>Presentation timer</h2>
      <output aria-label="Elapsed time">{clock(elapsed)}</output>
      <label>
        Target minutes{" "}
        <input
          aria-label="Presentation target minutes"
          type="number"
          min={1}
          max={600}
          value={duration}
          onChange={(e) =>
            setDuration(Math.max(1, Math.min(600, Number(e.target.value) || 1)))
          }
        />
      </label>
      <p className={elapsed > duration * 60 ? "timer-over" : ""}>
        {elapsed > duration * 60 ? "Over time" : "Remaining"}{" "}
        {clock(Math.abs(duration * 60 - elapsed))}
      </p>
      <div className="arrange-buttons">
        <button
          onClick={() => {
            base.current = { at: Date.now(), elapsed };
            setPaused(!paused);
          }}
        >
          {paused ? "Resume timer" : "Pause timer"}
        </button>
        <button
          onClick={() => {
            base.current = { at: Date.now(), elapsed: 0 };
            setElapsed(0);
          }}
        >
          Reset timer
        </button>
      </div>
    </section>
  );
}
