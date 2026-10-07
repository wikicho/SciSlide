export type KeyboardPlatform = "mac" | "windows" | "linux";

export type ShortcutAction =
  | "new"
  | "open"
  | "save"
  | "saveAs"
  | "undo"
  | "redo"
  | "selectAll"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "group"
  | "ungroup"
  | "present"
  | "presentFromStart"
  | "presenterView"
  | "duplicateSlide"
  | "moveSlideUp"
  | "moveSlideDown"
  | "moveSlideFirst"
  | "moveSlideLast"
  | "exportPdf"
  | "exportSvg"
  | "help"
  | "finishTextEditing"
  | "addSlide"
  | "insertEquation"
  | "insertFigure"
  | "deselectAll"
  | "lock"
  | "unlock"
  | "bringToFront"
  | "sendToBack"
  | "bringForward"
  | "sendBackward"
  | "zoomIn"
  | "zoomOut"
  | "fitSlide"
  | "nextSlide"
  | "previousSlide"
  | "firstSlide"
  | "lastSlide"
  | "bold"
  | "increaseFontSize"
  | "decreaseFontSize"
  | "alignTextLeft"
  | "alignTextCenter"
  | "alignTextRight";

export type ShortcutCategory =
  | "File"
  | "Editing"
  | "Objects"
  | "Presentation"
  | "Help"
  | "Text"
  | "Slides"
  | "Canvas";

export interface NavigatorPlatformMetadata {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

export interface ShortcutBinding {
  key: string;
  primary: boolean;
  shift?: boolean;
  alt?: boolean;
  code?: string;
  codeOnly?: boolean;
}

export interface PlatformShortcut {
  action: ShortcutAction;
  label: string;
  category: ShortcutCategory;
  keys: string;
  alternateKeys: string[];
  binding: ShortcutBinding;
  aliases: ShortcutBinding[];
}

export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
> &
  Partial<
    Pick<KeyboardEvent, "code" | "isComposing" | "getModifierState" | "keyCode">
  >;

interface ShortcutDefinition {
  action: ShortcutAction;
  label: string;
  category: ShortcutCategory;
  binding: ShortcutBinding;
  platforms?: readonly KeyboardPlatform[];
}

function macShortcut(
  action: ShortcutAction,
  label: string,
  category: ShortcutCategory,
  binding: ShortcutBinding,
): ShortcutDefinition {
  return { action, label, category, binding, platforms: ["mac"] };
}

const DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    action: "new",
    label: "New presentation",
    category: "File",
    binding: { key: "n", primary: true },
  },
  {
    action: "open",
    label: "Open presentation",
    category: "File",
    binding: { key: "o", primary: true },
  },
  {
    action: "save",
    label: "Save presentation",
    category: "File",
    binding: { key: "s", primary: true },
  },
  {
    action: "saveAs",
    label: "Save presentation as",
    category: "File",
    binding: { key: "s", primary: true, shift: true },
  },
  {
    action: "undo",
    label: "Undo",
    category: "Editing",
    binding: { key: "z", primary: true },
  },
  {
    action: "redo",
    label: "Redo",
    category: "Editing",
    binding: { key: "z", primary: true, shift: true },
  },
  {
    action: "selectAll",
    label: "Select all objects",
    category: "Objects",
    binding: { key: "a", primary: true },
  },
  {
    action: "copy",
    label: "Copy objects",
    category: "Editing",
    binding: { key: "c", primary: true },
  },
  {
    action: "cut",
    label: "Cut objects",
    category: "Editing",
    binding: { key: "x", primary: true },
  },
  {
    action: "paste",
    label: "Paste objects",
    category: "Editing",
    binding: { key: "v", primary: true },
  },
  {
    action: "duplicate",
    label: "Duplicate selection or slide",
    category: "Objects",
    binding: { key: "d", primary: true },
  },
  {
    action: "group",
    label: "Group selected objects",
    category: "Objects",
    binding: { key: "g", primary: true },
  },
  {
    action: "ungroup",
    label: "Ungroup selected objects",
    category: "Objects",
    binding: { key: "g", primary: true, shift: true },
  },
  {
    action: "present",
    label: "Present from current slide",
    category: "Presentation",
    binding: { key: "Enter", primary: true },
  },
  {
    action: "presentFromStart",
    label: "Present from first slide",
    category: "Presentation",
    binding: { key: "F5", primary: false },
    platforms: ["windows", "linux"],
  },
  {
    action: "presenterView",
    label: "Open presenter display",
    category: "Presentation",
    binding: { key: "F5", primary: false, alt: true },
    platforms: ["windows"],
  },
  {
    action: "duplicateSlide",
    label: "Duplicate current slide",
    category: "Slides",
    binding: { key: "d", primary: true, shift: true },
    platforms: ["windows"],
  },
  ...(
    [
      ["moveSlideUp", "Move slide up", false, "ArrowUp"],
      ["moveSlideDown", "Move slide down", false, "ArrowDown"],
      ["moveSlideFirst", "Move slide to start", true, "ArrowUp"],
      ["moveSlideLast", "Move slide to end", true, "ArrowDown"],
    ] as const
  ).map(([action, label, shift, key]): ShortcutDefinition => ({
    action,
    label,
    category: "Slides",
    binding: { key, primary: true, shift },
    platforms: ["windows", "linux"],
  })),
  {
    action: "exportPdf",
    label: "Export PDF",
    category: "File",
    binding: { key: "p", primary: true, alt: true },
  },
  {
    action: "exportSvg",
    label: "Export current slide as SVG",
    category: "File",
    binding: { key: "s", primary: true, alt: true },
  },
  {
    action: "help",
    label: "Keyboard shortcuts",
    category: "Help",
    binding: { key: "/", code: "Slash", primary: true, shift: true },
  },
  {
    action: "finishTextEditing",
    label: "Apply text editing",
    category: "Text",
    binding: { key: "Enter", primary: true },
  },
  macShortcut("addSlide", "Add slide from a layout", "Slides", {
    key: "n",
    primary: true,
    shift: true,
  }),
  macShortcut("insertEquation", "Insert equation", "Objects", {
    key: "e",
    primary: true,
    alt: true,
  }),
  macShortcut("insertFigure", "Insert image, SVG or PDF", "Objects", {
    key: "v",
    primary: true,
    shift: true,
  }),
  macShortcut("deselectAll", "Deselect all objects", "Objects", {
    key: "a",
    primary: true,
    shift: true,
  }),
  macShortcut("lock", "Lock selected objects", "Objects", {
    key: "l",
    primary: true,
  }),
  macShortcut("unlock", "Unlock selected objects", "Objects", {
    key: "l",
    primary: true,
    alt: true,
  }),
  macShortcut("bringToFront", "Bring to front", "Objects", {
    key: "f",
    primary: true,
    shift: true,
  }),
  macShortcut("sendToBack", "Send to back", "Objects", {
    key: "b",
    primary: true,
    shift: true,
  }),
  macShortcut("bringForward", "Bring forward one layer", "Objects", {
    key: "f",
    primary: true,
    alt: true,
    shift: true,
  }),
  macShortcut("sendBackward", "Send backward one layer", "Objects", {
    key: "b",
    primary: true,
    alt: true,
    shift: true,
  }),
  macShortcut("zoomIn", "Zoom in", "Canvas", {
    key: ">",
    code: "Period",
    primary: true,
    shift: true,
  }),
  macShortcut("zoomOut", "Zoom out", "Canvas", {
    key: "<",
    code: "Comma",
    primary: true,
    shift: true,
  }),
  macShortcut("fitSlide", "Fit slide to window", "Canvas", {
    key: "0",
    code: "Digit0",
    primary: true,
    alt: true,
  }),
  macShortcut("nextSlide", "Next slide", "Slides", {
    key: "PageDown",
    primary: false,
  }),
  macShortcut("previousSlide", "Previous slide", "Slides", {
    key: "PageUp",
    primary: false,
  }),
  macShortcut("firstSlide", "First slide", "Slides", {
    key: "Home",
    primary: false,
  }),
  macShortcut("lastSlide", "Last slide", "Slides", {
    key: "End",
    primary: false,
  }),
  macShortcut("bold", "Toggle bold on selected text objects", "Text", {
    key: "b",
    primary: true,
  }),
  macShortcut("increaseFontSize", "Increase selected text size", "Text", {
    key: "+",
    code: "Equal",
    primary: true,
  }),
  macShortcut("decreaseFontSize", "Decrease selected text size", "Text", {
    key: "-",
    code: "Minus",
    primary: true,
  }),
  macShortcut("alignTextLeft", "Align selected text left", "Text", {
    key: "{",
    code: "BracketLeft",
    primary: true,
    shift: true,
  }),
  macShortcut("alignTextCenter", "Center selected text", "Text", {
    key: "|",
    code: "Backslash",
    primary: true,
    shift: true,
  }),
  macShortcut("alignTextRight", "Align selected text right", "Text", {
    key: "}",
    code: "BracketRight",
    primary: true,
    shift: true,
  }),
];

// Keynote conventions where SciSlide has the corresponding feature. PDF
// export moves away from Option+Command+P, which is Keynote's Play shortcut.
const MAC_BINDINGS: Partial<Record<ShortcutAction, ShortcutBinding>> = {
  saveAs: { key: "s", primary: true, alt: true, shift: true },
  group: { key: "g", primary: true, alt: true },
  ungroup: { key: "g", primary: true, alt: true, shift: true },
  present: { key: "p", primary: true, alt: true },
  exportPdf: { key: "p", primary: true, alt: true, shift: true },
};

// PowerPoint on Windows and Impress on Linux. Keep unavailable Keynote
// commands out of the other profiles rather than inheriting their keys.
const WINDOWS_BINDINGS: Partial<Record<ShortcutAction, ShortcutBinding>> = {
  redo: { key: "y", primary: true },
  addSlide: { key: "m", primary: true },
  present: { key: "F5", primary: false, shift: true },
  help: { key: "F1", primary: false },
  insertEquation: { key: "=", code: "Equal", primary: false, alt: true },
  bringForward: {
    key: "]",
    code: "BracketRight",
    primary: true,
    shift: true,
  },
  sendBackward: {
    key: "[",
    code: "BracketLeft",
    primary: true,
    shift: true,
  },
  zoomIn: { key: "+", code: "Equal", primary: true },
  zoomOut: { key: "-", code: "Minus", primary: true },
  fitSlide: { key: "o", primary: true, alt: true },
  nextSlide: { key: "PageDown", primary: false },
  previousSlide: { key: "PageUp", primary: false },
  firstSlide: { key: "Home", primary: false },
  lastSlide: { key: "End", primary: false },
  bold: { key: "b", primary: true },
  increaseFontSize: {
    key: ">",
    code: "Period",
    primary: true,
    shift: true,
  },
  decreaseFontSize: {
    key: "<",
    code: "Comma",
    primary: true,
    shift: true,
  },
  alignTextLeft: { key: "l", primary: true },
  alignTextCenter: { key: "e", primary: true },
  alignTextRight: { key: "r", primary: true },
};

const LINUX_BINDINGS: Partial<Record<ShortcutAction, ShortcutBinding>> = {
  ...WINDOWS_BINDINGS,
  duplicate: { key: "F3", primary: false, shift: true },
  group: { key: "g", primary: true, shift: true },
  ungroup: { key: "g", primary: true, alt: true, shift: true },
  insertEquation: { key: "e", primary: false, alt: true, shift: true },
  bringForward: { key: "+", code: "Equal", primary: true },
  bringToFront: { key: "+", code: "Equal", primary: true, shift: true },
  sendBackward: { key: "-", code: "Minus", primary: true },
  sendToBack: { key: "-", code: "Minus", primary: true, shift: true },
  zoomIn: { key: "+", primary: false },
  zoomOut: { key: "-", code: "Minus", primary: false },
  fitSlide: {
    key: "*",
    code: "NumpadMultiply",
    codeOnly: true,
    primary: false,
  },
  increaseFontSize: { key: "]", code: "BracketRight", primary: true },
  decreaseFontSize: { key: "[", code: "BracketLeft", primary: true },
  moveSlideUp: { key: "PageUp", primary: false, alt: true, shift: true },
  moveSlideDown: { key: "PageDown", primary: false, alt: true, shift: true },
  moveSlideFirst: { key: "Home", primary: false, alt: true, shift: true },
  moveSlideLast: { key: "End", primary: false, alt: true, shift: true },
};

const PLATFORM_BINDINGS = {
  mac: MAC_BINDINGS,
  windows: WINDOWS_BINDINGS,
  linux: LINUX_BINDINGS,
};

export function isShortcutAvailable(
  action: ShortcutAction,
  platform: KeyboardPlatform,
): boolean {
  const definition = DEFINITIONS.find((entry) => entry.action === action)!;
  return (
    !!PLATFORM_BINDINGS[platform][action] ||
    !definition.platforms ||
    definition.platforms.includes(platform)
  );
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = DEFINITIONS.map(
  ({ action }) => action,
);

function detectPlatform(value: string | undefined): KeyboardPlatform | null {
  if (!value) return null;
  if (/darwin|mac/i.test(value)) return "mac";
  if (/win/i.test(value)) return "windows";
  if (/linux|ubuntu|x11|cros/i.test(value)) return "linux";
  return null;
}

/** Prefer Electron's host OS; the browser metadata is only a fallback. */
export function getKeyboardPlatform(
  desktopPlatform?: string,
  metadata: NavigatorPlatformMetadata | undefined = typeof navigator ===
  "undefined"
    ? undefined
    : navigator,
): KeyboardPlatform {
  return (
    detectPlatform(desktopPlatform) ??
    detectPlatform(metadata?.userAgentData?.platform) ??
    detectPlatform(metadata?.platform) ??
    detectPlatform(metadata?.userAgent) ??
    "linux"
  );
}

export function formatShortcut(
  binding: ShortcutBinding,
  platform: KeyboardPlatform,
): string {
  const parts: string[] = [];
  if (binding.primary) parts.push(platform === "mac" ? "⌘" : "Ctrl");
  if (binding.alt) parts.push(platform === "mac" ? "⌥" : "Alt");
  if (binding.shift) parts.push(platform === "mac" ? "⇧" : "Shift");
  parts.push(
    binding.code === "NumpadMultiply"
      ? "Num *"
      : binding.key.length === 1
        ? binding.key.toUpperCase()
        : binding.key,
  );
  return parts.join("+");
}

export function modifierLabel(
  platform: KeyboardPlatform,
  modifier: "primary" | "alt" | "shift",
): string {
  const labels =
    platform === "mac"
      ? { primary: "⌘", alt: "⌥", shift: "⇧" }
      : { primary: "Ctrl", alt: "Alt", shift: "Shift" };
  return labels[modifier];
}

export function getShortcut(
  action: ShortcutAction,
  platform: KeyboardPlatform,
): PlatformShortcut {
  const definition = DEFINITIONS.find((entry) => entry.action === action)!;
  const binding = {
    ...(PLATFORM_BINDINGS[platform][action] ?? definition.binding),
  };
  const aliases: ShortcutBinding[] = [];
  if (
    (platform === "mac" &&
      ["saveAs", "group", "ungroup", "present"].includes(action)) ||
    (platform !== "mac" && ["redo", "present", "help"].includes(action)) ||
    (platform === "linux" && ["duplicate", "group"].includes(action))
  )
    aliases.push({ ...definition.binding });
  if (
    (platform === "mac" && action === "increaseFontSize") ||
    (platform === "windows" && action === "zoomIn") ||
    (platform === "linux" && action === "zoomIn")
  )
    aliases.push({ ...binding, shift: true });
  if (platform === "linux") {
    if (action === "insertEquation")
      aliases.push({ key: "=", code: "Equal", primary: true, alt: true });
    const legacyReorder: Partial<Record<ShortcutAction, string>> = {
      moveSlideUp: "ArrowUp",
      moveSlideDown: "ArrowDown",
      moveSlideFirst: "Home",
      moveSlideLast: "End",
    };
    const legacyKey = legacyReorder[action];
    if (legacyKey) aliases.push({ key: legacyKey, primary: true, shift: true });
  }
  return {
    ...definition,
    binding,
    aliases,
    keys: formatShortcut(binding, platform),
    alternateKeys: aliases.map((alias) => formatShortcut(alias, platform)),
  };
}

export function shortcutLabel(
  action: ShortcutAction,
  platform: KeyboardPlatform,
): string {
  return getShortcut(action, platform).keys;
}

export function getPlatformShortcuts(
  platform: KeyboardPlatform,
): PlatformShortcut[] {
  return SHORTCUT_ACTIONS.filter((action) =>
    isShortcutAvailable(action, platform),
  ).map((action) => getShortcut(action, platform));
}

function matchesBinding(
  event: ShortcutKeyEvent,
  binding: ShortcutBinding,
  platform: KeyboardPlatform,
): boolean {
  const primaryPressed = platform === "mac" ? event.metaKey : event.ctrlKey;
  const otherPrimaryPressed =
    platform === "mac" ? event.ctrlKey : event.metaKey;
  if (
    primaryPressed !== binding.primary ||
    otherPrimaryPressed ||
    event.shiftKey !== Boolean(binding.shift) ||
    event.altKey !== Boolean(binding.alt)
  ) {
    return false;
  }
  if (binding.code === "Slash") {
    // Shift+/ reports '?' in browsers; retain the physical slash key as well.
    return event.code === "Slash" || event.key === "/" || event.key === "?";
  }
  if (binding.codeOnly) return event.code === binding.code;
  // '+' commonly needs Shift on a US keyboard, while some layouts provide it
  // directly. Match the physical punctuation key for shifted/Option symbols.
  if (
    binding.code &&
    (event.code === binding.code || event.key === binding.key)
  )
    return true;
  if (event.key.toLowerCase() === binding.key.toLowerCase()) return true;
  // Option can turn S into ß on macOS, even with Command held. Physical keys
  // recover these symbols without remapping ordinary Latin letter layouts.
  const optionSymbol =
    platform === "mac" && binding.alt && !/^[a-z]$/i.test(event.key);
  // Korean and other non-Latin layouts also retain KeyS, KeyZ, etc.
  return (
    /^[a-z]$/i.test(binding.key) &&
    (optionSymbol ||
      (event.key.length === 1 && !/^[\p{Script=Latin}]$/u.test(event.key))) &&
    event.code === `Key${binding.key.toUpperCase()}`
  );
}

export function matchesShortcut(
  event: ShortcutKeyEvent,
  action: ShortcutAction,
  platform: KeyboardPlatform,
): boolean {
  if (
    !isShortcutAvailable(action, platform) ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.getModifierState?.("AltGraph")
  ) {
    return false;
  }
  const { binding, aliases } = getShortcut(action, platform);
  return [binding, ...aliases].some((candidate) =>
    matchesBinding(event, candidate, platform),
  );
}

/** Enter means Present globally; a text editor checks finishTextEditing itself. */
export function matchShortcut(
  event: ShortcutKeyEvent,
  platform: KeyboardPlatform,
): ShortcutAction | null {
  return (
    SHORTCUT_ACTIONS.find((action) =>
      matchesShortcut(event, action, platform),
    ) ?? null
  );
}
