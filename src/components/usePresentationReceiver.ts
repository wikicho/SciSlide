import { useCallback, useEffect, useRef, useState } from "react";
import { desktop } from "../lib/desktop";
import { validateDeck, type Deck } from "../lib/model";
import { matchPlaybackShortcut } from "../lib/playback-shortcuts";
import {
  presenterChannelName,
  validatePresenterState,
  type PresenterAction,
  type PresenterMessage,
  type PresenterState,
} from "../lib/presenter";
import { getKeyboardPlatform } from "../lib/shortcuts";

/** Connects a separate presentation window to its editor's playback state. */
export function usePresentationReceiver(token: string) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [state, setState] = useState<PresenterState | null>(null);
  const [connected, setConnected] = useState(true);
  const [ended, setEnded] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const exitRequested = useRef(false);
  const [keyboardPlatform] = useState(() =>
    getKeyboardPlatform(desktop?.platform),
  );

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      setConnected(false);
      return;
    }
    const connection = new BroadcastChannel(presenterChannelName(token));
    let activeDeck: Deck | null = null;
    let lastMessage = Date.now();
    channel.current = connection;
    exitRequested.current = false;
    const requestState = () => {
      connection.postMessage({
        type: "ready",
        needsDeck: !activeDeck,
      } satisfies PresenterMessage);
    };
    const heartbeat = setInterval(() => {
      requestState();
      if (Date.now() - lastMessage > 7000) setConnected(false);
    }, 3000);
    connection.onmessage = (event: MessageEvent<PresenterMessage>) => {
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "ended") {
        setEnded(true);
        clearInterval(heartbeat);
        connection.close();
        channel.current = null;
        return;
      }
      try {
        if (message.type === "deck") {
          const nextDeck = validateDeck(message.deck);
          const nextState = validatePresenterState(message.state, nextDeck);
          activeDeck = nextDeck;
          setDeck(nextDeck);
          setState(nextState);
        } else if (message.type === "state" && activeDeck) {
          setState(validatePresenterState(message.state, activeDeck));
        } else return;
        lastMessage = Date.now();
        setConnected(true);
      } catch {
        // Keep the last valid snapshot during a failed update.
      }
    };
    requestState();
    return () => {
      clearInterval(heartbeat);
      connection.close();
      channel.current = null;
    };
  }, [token]);

  const send = useCallback(
    (action: PresenterAction) => {
      if (ended || !connected || !state || exitRequested.current) return;
      if (action === "exit") exitRequested.current = true;
      channel.current?.postMessage({
        type: "action",
        action,
      } satisfies PresenterMessage);
    },
    [connected, ended, state],
  );
  useEffect(() => {
    if (ended) return;
    const key = (event: KeyboardEvent) => {
      const shortcut = matchPlaybackShortcut(event, keyboardPlatform);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut.execute) send(shortcut.action);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ended, keyboardPlatform, send]);
  return { deck, state, connected, ended, send };
}
