// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  matchPlaybackShortcut,
  type PlaybackShortcutEvent,
} from "../src/lib/playback-shortcuts";

function key(
  value: string,
  overrides: Partial<PlaybackShortcutEvent> = {},
): PlaybackShortcutEvent {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("shared audience and presenter shortcuts", () => {
  it.each(["mac", "windows", "linux"] as const)(
    "keeps baseline build navigation and endpoints on %s",
    (platform) => {
      for (const value of ["ArrowRight", "ArrowDown", " ", "PageDown"])
        expect(matchPlaybackShortcut(key(value), platform)).toEqual({
          action: "next",
          execute: true,
        });
      for (const value of ["ArrowLeft", "ArrowUp", "PageUp"])
        expect(matchPlaybackShortcut(key(value), platform)).toEqual({
          action: "previous",
          execute: true,
        });
      for (const [value, action] of [
        ["Home", "first"],
        ["End", "last"],
        ["Escape", "exit"],
      ] as const)
        expect(matchPlaybackShortcut(key(value), platform)).toEqual({
          action,
          execute: true,
        });
    },
  );

  it.each([
    ["mac", "q", "exit"],
    ["windows", "n", "next"],
    ["windows", "p", "previous"],
    ["windows", "Enter", "next"],
    ["windows", "Backspace", "previous"],
    ["linux", "Enter", "next"],
    ["linux", "Backspace", "previous"],
    ["linux", "-", "exit"],
  ] as const)("matches the %s playback key %s", (platform, value, action) => {
    expect(matchPlaybackShortcut(key(value), platform)).toEqual({
      action,
      execute: true,
    });
  });

  it.each([
    ["mac", "Enter"],
    ["mac", "Backspace"],
    ["mac", "-"],
    ["linux", "q"],
    ["linux", "n"],
    ["linux", "p"],
    ["windows", "q"],
    ["windows", "-"],
  ] as const)("leaves another profile's %s key %s alone", (platform, value) => {
    expect(matchPlaybackShortcut(key(value), platform)).toBeNull();
  });

  it("retains Shift+arrow build navigation while rejecting other shifted playback keys", () => {
    for (const platform of ["mac", "windows", "linux"] as const) {
      for (const value of ["ArrowRight", "ArrowDown"])
        expect(
          matchPlaybackShortcut(key(value, { shiftKey: true }), platform),
        ).toEqual({ action: "next", execute: true });
      for (const value of ["ArrowLeft", "ArrowUp"])
        expect(
          matchPlaybackShortcut(key(value, { shiftKey: true }), platform),
        ).toEqual({ action: "previous", execute: true });
      for (const value of [
        "Escape",
        "Q",
        "-",
        " ",
        "Enter",
        "Backspace",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "N",
        "P",
      ])
        expect(
          matchPlaybackShortcut(key(value, { shiftKey: true }), platform),
        ).toBeNull();
    }
  });

  it("consumes recognized auto-repeat without repeating actions", () => {
    for (const [platform, value] of [
      ["mac", "ArrowRight"],
      ["mac", "ArrowLeft"],
      ["mac", "Home"],
      ["mac", "End"],
      ["mac", "Escape"],
      ["mac", "q"],
      ["windows", "n"],
      ["windows", "p"],
      ["linux", "-"],
    ] as const)
      expect(
        matchPlaybackShortcut(key(value, { repeat: true }), platform)?.execute,
      ).toBe(false);
    expect(
      matchPlaybackShortcut(key("unbound", { repeat: true }), "mac"),
    ).toBeNull();
  });

  it.each([
    { defaultPrevented: true },
    { isComposing: true },
    { keyCode: 229 },
    { getModifierState: (modifier: string) => modifier === "AltGraph" },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ])("leaves owned input and extra modifiers alone: %j", (overrides) => {
    for (const platform of ["mac", "windows", "linux"] as const)
      for (const value of ["ArrowRight", "Home", "Escape", "q", "-"])
        expect(
          matchPlaybackShortcut(key(value, overrides), platform),
        ).toBeNull();
  });

  it.each([
    '<input type="range">',
    "<textarea></textarea>",
    "<select><option>1</option></select>",
    "<video></video>",
    "<audio></audio>",
    '<div class="video-player"><button>Play</button></div>',
    '<div contenteditable="true"><span>Text</span></div>',
    '<div role="slider"><span>Volume</span></div>',
    '<div role="textbox"></div>',
    "<dialog open><button>Close</button></dialog>",
  ])(
    "focused editable/media/modal owns Escape and navigation in %s",
    (markup) => {
      const container = document.createElement("div");
      container.innerHTML = markup;
      const target =
        container.firstElementChild!.lastElementChild ??
        container.firstElementChild;
      for (const platform of ["mac", "windows", "linux"] as const)
        for (const value of [
          "ArrowRight",
          "ArrowLeft",
          " ",
          "Enter",
          "Escape",
          "q",
          "-",
        ])
          expect(
            matchPlaybackShortcut(key(value), platform, target),
          ).toBeNull();
    },
  );

  it.each([
    "<button><span>Next</span></button>",
    '<div role="button"><span>Next</span></div>',
    '<a href="#help"><span>Help</span></a>',
  ])("retains activation but allows Escape outside media in %s", (markup) => {
    const container = document.createElement("div");
    container.innerHTML = markup;
    const target = container.querySelector("span")!;
    for (const platform of ["mac", "windows", "linux"] as const) {
      expect(matchPlaybackShortcut(key(" "), platform, target)).toBeNull();
      expect(matchPlaybackShortcut(key("Enter"), platform, target)).toBeNull();
      expect(matchPlaybackShortcut(key("Escape"), platform, target)).toEqual({
        action: "exit",
        execute: true,
      });
    }
  });

  it("also reads a dispatched KeyboardEvent target", () => {
    const target = document.createElement("video");
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    target.dispatchEvent(event);
    expect(matchPlaybackShortcut(event, "mac")).toBeNull();
    expect(
      matchPlaybackShortcut(
        new KeyboardEvent("keydown", { key: "Escape" }),
        "mac",
      ),
    ).toEqual({ action: "exit", execute: true });
  });
});
