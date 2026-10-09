import type { PresenterAction } from "./presenter";
import type { KeyboardPlatform, ShortcutKeyEvent } from "./shortcuts";

export type PlaybackShortcutEvent = ShortcutKeyEvent &
  Partial<Pick<KeyboardEvent, "defaultPrevented" | "repeat" | "target">>;

export interface PlaybackShortcutMatch {
  action: PresenterAction;
  /** Recognized repeat events are consumed without advancing or ending playback. */
  execute: boolean;
}

/** Shared audience/presenter routing; focused controls retain their own keys. */
export function matchPlaybackShortcut(
  event: PlaybackShortcutEvent,
  platform: KeyboardPlatform,
  target: EventTarget | null = event.target ?? null,
): PlaybackShortcutMatch | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.getModifierState?.("AltGraph") ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return null;

  const element = target instanceof Element ? target : null;
  if (
    element?.closest(
      'input,textarea,select,video,audio,.video-player,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],dialog,[role="dialog"],[role="alertdialog"]',
    ) ||
    (element instanceof HTMLElement && element.isContentEditable) ||
    (element?.closest('button,[role="button"],a[href]') &&
      [" ", "Enter"].includes(event.key))
  )
    return null;

  // Keep the existing Shift+arrow build navigation until separate slide/build
  // commands are introduced. All other playback bindings are unmodified.
  if (event.shiftKey && !event.key.startsWith("Arrow")) return null;

  const next =
    ["ArrowRight", "ArrowDown", " ", "PageDown"].includes(event.key) ||
    (platform !== "mac" && event.key === "Enter") ||
    (platform === "windows" && event.key.toLowerCase() === "n");
  const previous =
    ["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key) ||
    (platform !== "mac" && event.key === "Backspace") ||
    (platform === "windows" && event.key.toLowerCase() === "p");
  const action: PresenterAction | null = next
    ? "next"
    : previous
      ? "previous"
      : event.key === "Home"
        ? "first"
        : event.key === "End"
          ? "last"
          : event.key === "Escape" ||
              (platform === "linux" && event.key === "-") ||
              (platform === "mac" && event.key.toLowerCase() === "q")
            ? "exit"
            : null;

  return action ? { action, execute: !event.repeat } : null;
}
