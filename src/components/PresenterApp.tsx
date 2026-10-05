import { useEffect, useRef, useState } from "react";
import type { Deck } from "../lib/model";
import { validateDeck } from "../lib/model";
import { SlideScene } from "./SlideScene";
import { maxBuildStep } from "../lib/presentation";
import { presenterChannelName, validatePresenterState } from "../lib/presenter";
import type {
  PresenterAction,
  PresenterMessage,
  PresenterState,
} from "../lib/presenter";

function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

export function PresenterApp({ token }: { token: string }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [state, setState] = useState<PresenterState | null>(null);
  const [ended, setEnded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(20);
  const [connected, setConnected] = useState(true);
  const channel = useRef<BroadcastChannel | null>(null);
  const base = useRef({ at: Date.now(), elapsed: 0 });
  const lastMessage = useRef(Date.now());
  const hasDeck = useRef(false);
  const sessionStart = useRef<number | null>(null);
  const activeDeck = useRef<Deck | null>(null);
  useEffect(() => {
    const connection = new BroadcastChannel(presenterChannelName(token));
    channel.current = connection;
    let heartbeat: ReturnType<typeof setInterval>;
    connection.onmessage = (event: MessageEvent<PresenterMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      lastMessage.current = Date.now();
      setConnected(true);
      if (message.type === "deck") {
        try {
          const nextDeck = validateDeck(message.deck);
          const nextState = validatePresenterState(message.state, nextDeck);
          activeDeck.current = nextDeck;
          setDeck(nextDeck);
          hasDeck.current = true;
          setState(nextState);
          if (sessionStart.current !== message.state.startedAt) {
            base.current = { at: message.state.startedAt, elapsed: 0 };
            sessionStart.current = message.state.startedAt;
          }
        } catch {
          /* A malformed snapshot cannot replace the last preview. */
        }
      } else if (message.type === "state" && activeDeck.current) {
        try {
          setState(validatePresenterState(message.state, activeDeck.current));
        } catch {
          /* Keep the last valid position. */
        }
      } else if (message.type === "ended") {
        setEnded(true);
        clearInterval(heartbeat);
        connection.close();
        channel.current = null;
      }
    };
    connection.postMessage({
      type: "ready",
      needsDeck: true,
    } satisfies PresenterMessage);
    heartbeat = setInterval(() => {
      connection.postMessage({
        type: "ready",
        needsDeck: !hasDeck.current,
      } satisfies PresenterMessage);
      if (Date.now() - lastMessage.current > 7000) setConnected(false);
    }, 3000);
    return () => {
      clearInterval(heartbeat);
      connection.close();
      channel.current = null;
    };
  }, [token]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!paused && !ended)
        setElapsed(
          base.current.elapsed + (Date.now() - base.current.at) / 1000,
        );
    }, 250);
    return () => clearInterval(timer);
  }, [paused, ended]);
  const send = (action: PresenterAction) => {
    if (ended || !connected || !deck || !state) return;
    channel.current?.postMessage({
      type: "action",
      action,
    } satisfies PresenterMessage);
  };
  useEffect(() => {
    if (ended) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest("input,textarea,select") ||
        (target?.closest("button") && [" ", "Enter"].includes(event.key))
      )
        return;
      const action = ["ArrowRight", "ArrowDown", " ", "PageDown"].includes(
        event.key,
      )
        ? "next"
        : ["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)
          ? "previous"
          : event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : event.key === "Escape"
                ? "exit"
                : null;
      if (action) {
        event.preventDefault();
        send(action);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
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
        <button onClick={() => send("exit")}>End presentation</button>
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
                setDuration(
                  Math.max(1, Math.min(600, Number(e.target.value) || 1)),
                )
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
      </div>
      <nav className="presenter-navigation">
        <button
          disabled={!connected || (!index && !state.step)}
          onClick={() => send("previous")}
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
          onClick={() => send("next")}
        >
          Next step / slide
        </button>
      </nav>
    </main>
  );
}
