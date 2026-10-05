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
  | "exportPdf"
  | "exportSvg"
  | "help"
  | "finishTextEditing";

export type ShortcutCategory =
  "File" | "Editing" | "Objects" | "Presentation" | "Help" | "Text";

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
    label: "Start presentation",
    category: "Presentation",
    binding: { key: "Enter", primary: true },
  },
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
];

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
    binding.key.length === 1 ? binding.key.toUpperCase() : binding.key,
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
  const binding =
    action === "redo" && platform === "windows"
      ? { key: "y", primary: true }
      : { ...definition.binding };
  const aliases =
    action === "redo" && platform === "windows"
      ? [{ ...definition.binding }]
      : [];
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
  return SHORTCUT_ACTIONS.map((action) => getShortcut(action, platform));
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
