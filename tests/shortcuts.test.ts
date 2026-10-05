import { describe, expect, it } from "vitest";
import {
  getKeyboardPlatform,
  getPlatformShortcuts,
  getShortcut,
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
    expect(shortcutLabel("redo", "linux")).toBe("Ctrl+Shift+Z");
    expect(shortcutLabel("exportPdf", "mac")).toBe("⌘+⌥+P");
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
      expect(shortcuts.map(({ action }) => action)).toEqual(SHORTCUT_ACTIONS);
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
    ).toBe("exportPdf");
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

  it("keeps Windows Ctrl+Shift+Z as a redo alias", () => {
    expect(matchShortcut(key("y", { ctrlKey: true }), "windows")).toBe("redo");
    expect(
      matchShortcut(key("Z", { ctrlKey: true, shiftKey: true }), "windows"),
    ).toBe("redo");
    expect(matchShortcut(key("y", { ctrlKey: true }), "linux")).toBeNull();
  });

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
      matchShortcut(key("y", { code: "KeyZ", ctrlKey: true }), "linux"),
    ).toBeNull();
    expect(
      matchShortcut(key("é", { code: "KeyS", ctrlKey: true }), "linux"),
    ).toBeNull();
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
