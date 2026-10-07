import { describe, expect, it } from "vitest";
import {
  getKeyboardPlatform,
  getPlatformShortcuts,
  getShortcut,
  isShortcutAvailable,
  matchShortcut,
  matchesShortcut,
  modifierLabel,
  SHORTCUT_ACTIONS,
  shortcutLabel,
  type ShortcutKeyEvent,
} from "../src/lib/shortcuts";

function key(
  value: string,
  overrides: Partial<ShortcutKeyEvent> = {},
): ShortcutKeyEvent {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("platform-aware keyboard shortcuts", () => {
  it.each([
    ["darwin", "mac"],
    ["win32", "windows"],
    ["linux", "linux"],
  ] as const)("prefers Electron %s over browser metadata", (host, result) => {
    expect(
      getKeyboardPlatform(host, {
        userAgentData: { platform: "Windows" },
        platform: "MacIntel",
      }),
    ).toBe(result);
  });

  it.each([
    [{ userAgentData: { platform: "macOS" }, platform: "Win32" }, "mac"],
    [
      { userAgentData: { platform: "Windows" }, platform: "Linux x86_64" },
      "windows",
    ],
    [{ userAgentData: { platform: "Linux" } }, "linux"],
    [{ platform: "MacIntel" }, "mac"],
    [{ platform: "Win32" }, "windows"],
    [{ platform: "Linux x86_64" }, "linux"],
    [{ userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64)" }, "linux"],
    [{ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "windows"],
    [{ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" }, "mac"],
    [{ platform: "Unknown" }, "linux"],
  ] as const)("detects browser metadata %j", (metadata, result) => {
    expect(getKeyboardPlatform(undefined, metadata)).toBe(result);
  });

  it("falls back safely when Electron metadata is unrecognized", () => {
    expect(getKeyboardPlatform("unknown", { platform: "MacIntel" })).toBe(
      "mac",
    );
    expect(getKeyboardPlatform(undefined, {})).toBe("linux");
  });

  it("renders familiar platform modifiers and Windows redo", () => {
    expect(shortcutLabel("save", "mac")).toBe("⌘+S");
    expect(shortcutLabel("redo", "mac")).toBe("⌘+⇧+Z");
    expect(shortcutLabel("redo", "windows")).toBe("Ctrl+Y");
    expect(shortcutLabel("redo", "linux")).toBe("Ctrl+Y");
    expect(shortcutLabel("exportPdf", "mac")).toBe("⌘+⌥+⇧+P");
    expect(shortcutLabel("exportPdf", "windows")).toBe("Ctrl+Alt+P");
    expect(getShortcut("redo", "windows").alternateKeys).toEqual([
      "Ctrl+Shift+Z",
    ]);
    expect(modifierLabel("mac", "alt")).toBe("⌥");
    expect(modifierLabel("linux", "primary")).toBe("Ctrl");
  });

  it.each(["mac", "windows", "linux"] as const)(
    "makes every documented %s shortcut executable",
    (platform) => {
      const shortcuts = getPlatformShortcuts(platform);
      expect(shortcuts.map(({ action }) => action)).toEqual(
        SHORTCUT_ACTIONS.filter((action) =>
          isShortcutAvailable(action, platform),
        ),
      );
      expect(new Set(shortcuts.map(({ action }) => action)).size).toBe(
        shortcuts.length,
      );
      for (const { action, binding, aliases } of shortcuts) {
        for (const candidate of [binding, ...aliases]) {
          const event = key(candidate.key, {
            code: candidate.code,
            metaKey: platform === "mac" && candidate.primary,
            ctrlKey: platform !== "mac" && candidate.primary,
            shiftKey: Boolean(candidate.shift),
            altKey: Boolean(candidate.alt),
          });
          expect(matchesShortcut(event, action, platform)).toBe(true);
          expect(matchShortcut(event, platform)).toBe(
            action === "finishTextEditing" ? "present" : action,
          );
        }
      }
    },
  );

  it.each(["mac", "windows", "linux"] as const)(
    "requires the correct %s primary modifier without extra modifiers",
    (platform) => {
      const primary =
        platform === "mac" ? { metaKey: true } : { ctrlKey: true };
      const wrongPrimary =
        platform === "mac" ? { ctrlKey: true } : { metaKey: true };
      expect(matchShortcut(key("s", primary), platform)).toBe("save");
      expect(matchShortcut(key("s"), platform)).toBeNull();
      expect(matchShortcut(key("s", wrongPrimary), platform)).toBeNull();
      expect(
        matchShortcut(key("s", { ctrlKey: true, metaKey: true }), platform),
      ).toBeNull();
      expect(
        matchesShortcut(
          key("s", { ...primary, shiftKey: true }),
          "save",
          platform,
        ),
      ).toBe(false);
      expect(
        matchesShortcut(
          key("s", { ...primary, altKey: true }),
          "save",
          platform,
        ),
      ).toBe(false);
    },
  );

  it("distinguishes save-as and export rather than treating them as save", () => {
    expect(
      matchShortcut(key("S", { ctrlKey: true, shiftKey: true }), "linux"),
    ).toBe("saveAs");
    expect(
      matchShortcut(key("s", { ctrlKey: true, altKey: true }), "linux"),
    ).toBe("exportSvg");
    expect(
      matchShortcut(key("p", { metaKey: true, altKey: true }), "mac"),
    ).toBe("present");
    expect(
      matchShortcut(
        key("P", { metaKey: true, altKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("exportPdf");
  });

  it("accepts Shift+/ as '?' and also handles the physical slash key", () => {
    expect(
      matchShortcut(key("?", { ctrlKey: true, shiftKey: true }), "linux"),
    ).toBe("help");
    expect(
      matchShortcut(key("/", { metaKey: true, shiftKey: true }), "mac"),
    ).toBe("help");
    expect(
      matchShortcut(
        key("é", { code: "Slash", ctrlKey: true, shiftKey: true }),
        "windows",
      ),
    ).toBe("help");
    expect(matchShortcut(key("?", { ctrlKey: true }), "linux")).toBeNull();
  });

  it("accepts macOS Option symbols for export while preserving Latin layouts", () => {
    expect(
      matchShortcut(
        key("ß", { code: "KeyS", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBe("exportSvg");
    expect(
      matchShortcut(
        key("π", { code: "KeyP", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBe("present");
    expect(
      matchShortcut(
        key("q", { code: "KeyS", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBeNull();
    expect(
      matchShortcut(key("ß", { code: "KeyS", metaKey: true }), "mac"),
    ).toBeNull();
  });

  it.each(["windows", "linux"] as const)(
    "keeps Ctrl+Shift+Z as a %s redo alias",
    (platform) => {
      expect(matchShortcut(key("y", { ctrlKey: true }), platform)).toBe("redo");
      expect(
        matchShortcut(key("Z", { ctrlKey: true, shiftKey: true }), platform),
      ).toBe("redo");
    },
  );

  it("follows Keynote grouping and Save As while retaining existing SciSlide aliases", () => {
    expect(
      matchShortcut(key("g", { metaKey: true, altKey: true }), "mac"),
    ).toBe("group");
    expect(
      matchShortcut(
        key("g", { metaKey: true, altKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("ungroup");
    expect(
      matchShortcut(
        key("s", { metaKey: true, altKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("saveAs");
    expect(matchShortcut(key("g", { metaKey: true }), "mac")).toBe("group");
    expect(
      matchShortcut(key("g", { metaKey: true, shiftKey: true }), "mac"),
    ).toBe("ungroup");
    expect(
      matchShortcut(key("s", { metaKey: true, shiftKey: true }), "mac"),
    ).toBe("saveAs");
    expect(matchShortcut(key("Enter", { metaKey: true }), "mac")).toBe(
      "present",
    );
  });

  it("recognizes Mac punctuation and Option-modified digit keys independently of keycaps", () => {
    expect(
      matchShortcut(
        key(".", { code: "Period", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("zoomIn");
    expect(
      matchShortcut(
        key(",", { code: "Comma", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("zoomOut");
    expect(
      matchShortcut(
        key("º", { code: "Digit0", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBe("fitSlide");
    expect(
      matchShortcut(
        key("+", { code: "Equal", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("increaseFontSize");
    expect(
      matchShortcut(key("=", { code: "Equal", metaKey: true }), "mac"),
    ).toBe("increaseFontSize");
    expect(
      matchShortcut(
        key("[", { code: "BracketLeft", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("alignTextLeft");
  });

  it.each(["linux", "windows"] as const)(
    "shares supported commands without leaking Keynote-only keys on %s",
    (platform) => {
      expect(
        matchShortcut(key("n", { ctrlKey: true, shiftKey: true }), platform),
      ).toBeNull();
      expect(matchShortcut(key("l", { ctrlKey: true }), platform)).toBe(
        "alignTextLeft",
      );
      expect(
        matchShortcut(key("e", { ctrlKey: true, altKey: true }), platform),
      ).toBeNull();
      expect(isShortcutAvailable("lock", platform)).toBe(false);
      expect(isShortcutAvailable("insertFigure", platform)).toBe(false);
      expect(matchShortcut(key("PageDown"), platform)).toBe("nextSlide");
      expect(matchShortcut(key("Home"), platform)).toBe("firstSlide");
    },
  );

  it("uses physical letter keys in Korean input layouts without remapping Latin layouts", () => {
    expect(
      matchShortcut(key("ㄴ", { code: "KeyS", ctrlKey: true }), "linux"),
    ).toBe("save");
    expect(
      matchShortcut(key("ㅌ", { code: "KeyX", metaKey: true }), "mac"),
    ).toBe("cut");
    expect(
      matchShortcut(key("ы", { code: "KeyS", ctrlKey: true }), "windows"),
    ).toBe("save");
    expect(
      matchShortcut(key("q", { code: "KeyZ", ctrlKey: true }), "linux"),
    ).toBeNull();
    expect(
      matchShortcut(key("é", { code: "KeyS", ctrlKey: true }), "linux"),
    ).toBeNull();
  });

  it.each(["windows", "linux"] as const)(
    "uses F5/Shift-F5 and Ctrl-M in the %s profile",
    (platform) => {
      expect(matchShortcut(key("F5"), platform)).toBe("presentFromStart");
      expect(matchShortcut(key("F5", { shiftKey: true }), platform)).toBe(
        "present",
      );
      expect(matchShortcut(key("m", { ctrlKey: true }), platform)).toBe(
        "addSlide",
      );
      expect(matchShortcut(key("F1"), platform)).toBe("help");
      expect(matchShortcut(key("Enter", { ctrlKey: true }), platform)).toBe(
        "present",
      );
    },
  );

  it("distinguishes PowerPoint grouping, formula, slide duplication and layer shortcuts", () => {
    expect(matchShortcut(key("g", { ctrlKey: true }), "windows")).toBe("group");
    expect(
      matchShortcut(key("g", { ctrlKey: true, shiftKey: true }), "windows"),
    ).toBe("ungroup");
    expect(
      matchShortcut(key("=", { altKey: true, code: "Equal" }), "windows"),
    ).toBe("insertEquation");
    expect(
      matchShortcut(key("=", { ctrlKey: true, altKey: true }), "windows"),
    ).toBeNull();
    expect(
      matchShortcut(key("d", { ctrlKey: true, shiftKey: true }), "windows"),
    ).toBe("duplicateSlide");
    expect(
      matchShortcut(
        key("]", { ctrlKey: true, shiftKey: true, code: "BracketRight" }),
        "windows",
      ),
    ).toBe("bringForward");
    expect(
      matchShortcut(
        key("[", { ctrlKey: true, shiftKey: true, code: "BracketLeft" }),
        "windows",
      ),
    ).toBe("sendBackward");
    expect(matchShortcut(key("F5", { altKey: true }), "windows")).toBe(
      "presenterView",
    );
    expect(isShortcutAvailable("bringToFront", "windows")).toBe(false);
    expect(
      matchShortcut(key("f", { ctrlKey: true, shiftKey: true }), "windows"),
    ).toBeNull();
  });

  it("uses current Impress group, formula and arrange defaults", () => {
    expect(
      matchShortcut(key("g", { ctrlKey: true, shiftKey: true }), "linux"),
    ).toBe("group");
    expect(
      matchShortcut(
        key("g", { ctrlKey: true, shiftKey: true, altKey: true }),
        "linux",
      ),
    ).toBe("ungroup");
    expect(
      matchShortcut(key("E", { shiftKey: true, altKey: true }), "linux"),
    ).toBe("insertEquation");
    expect(
      matchShortcut(
        key("=", { ctrlKey: true, altKey: true, code: "Equal" }),
        "linux",
      ),
    ).toBe("insertEquation");
    expect(matchShortcut(key("F3", { shiftKey: true }), "linux")).toBe(
      "duplicate",
    );
    expect(
      matchShortcut(key("+", { ctrlKey: true, code: "NumpadAdd" }), "linux"),
    ).toBe("bringForward");
    expect(
      matchShortcut(
        key("+", { ctrlKey: true, shiftKey: true, code: "Equal" }),
        "linux",
      ),
    ).toBe("bringToFront");
    expect(matchShortcut(key("-", { ctrlKey: true }), "linux")).toBe(
      "sendBackward",
    );
    expect(
      matchShortcut(
        key("_", { ctrlKey: true, shiftKey: true, code: "Minus" }),
        "linux",
      ),
    ).toBe("sendToBack");
    expect(matchShortcut(key("]", { ctrlKey: true }), "linux")).toBe(
      "increaseFontSize",
    );
    expect(isShortcutAvailable("duplicateSlide", "linux")).toBe(false);
    expect(isShortcutAvailable("presenterView", "linux")).toBe(false);
  });

  it("separates platform zoom from text sizing and restricts Impress fit to the keypad", () => {
    expect(
      matchShortcut(
        key("+", { ctrlKey: true, shiftKey: true, code: "Equal" }),
        "windows",
      ),
    ).toBe("zoomIn");
    expect(
      matchShortcut(
        key(">", { ctrlKey: true, shiftKey: true, code: "Period" }),
        "windows",
      ),
    ).toBe("increaseFontSize");
    expect(
      matchShortcut(key("o", { ctrlKey: true, altKey: true }), "windows"),
    ).toBe("fitSlide");
    expect(matchShortcut(key("+", { shiftKey: true }), "linux")).toBe("zoomIn");
    expect(matchShortcut(key("-"), "linux")).toBe("zoomOut");
    expect(matchShortcut(key("*", { code: "NumpadMultiply" }), "linux")).toBe(
      "fitSlide",
    );
    expect(
      matchShortcut(key("*", { code: "Digit8", shiftKey: true }), "linux"),
    ).toBeNull();
    expect(shortcutLabel("fitSlide", "linux")).toBe("Num *");
  });

  it("registers the platform slide reorder keys and Impress guide aliases", () => {
    expect(matchShortcut(key("ArrowUp", { ctrlKey: true }), "windows")).toBe(
      "moveSlideUp",
    );
    expect(
      matchShortcut(
        key("ArrowUp", { ctrlKey: true, shiftKey: true }),
        "windows",
      ),
    ).toBe("moveSlideFirst");
    expect(
      matchShortcut(key("PageDown", { altKey: true, shiftKey: true }), "linux"),
    ).toBe("moveSlideDown");
    expect(
      matchShortcut(key("End", { altKey: true, shiftKey: true }), "linux"),
    ).toBe("moveSlideLast");
    expect(
      matchShortcut(
        key("ArrowDown", { ctrlKey: true, shiftKey: true }),
        "linux",
      ),
    ).toBe("moveSlideDown");
    expect(
      matchShortcut(key("Home", { ctrlKey: true, shiftKey: true }), "linux"),
    ).toBe("moveSlideFirst");
    expect(matchShortcut(key("F5"), "mac")).toBeNull();
  });

  it.each([
    { isComposing: true },
    { keyCode: 229 },
    { getModifierState: (modifier: string) => modifier === "AltGraph" },
  ])("does not trigger commands during composition or AltGr: %j", (state) => {
    expect(
      matchShortcut(key("s", { ctrlKey: true, ...state }), "linux"),
    ).toBeNull();
    expect(
      matchesShortcut(
        key("Enter", { metaKey: true, ...state }),
        "finishTextEditing",
        "mac",
      ),
    ).toBe(false);
  });

  it("returns fresh binding records so consumer edits do not change the registry", () => {
    const save = getShortcut("save", "mac");
    save.binding.key = "q";
    const redo = getShortcut("redo", "windows");
    redo.aliases[0].key = "r";
    expect(shortcutLabel("save", "mac")).toBe("⌘+S");
    expect(
      matchesShortcut(
        key("Z", { ctrlKey: true, shiftKey: true }),
        "redo",
        "windows",
      ),
    ).toBe(true);
  });
});
