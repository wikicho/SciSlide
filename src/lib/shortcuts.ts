import registry from "../../desktop/keyboard-shortcuts.json";
import type { DesktopCommand } from "./desktop";

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
  | "alignTextRight"
  | "toggleInspector"
  | "toggleObjectList";

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
  /** Electron punctuation/keypad spelling; ignored by renderer matching. */
  nativeKey?: string;
}

export type ShortcutScope =
  "editor" | "thumbnail" | "slideNavigation" | "textEditing";
export type ShortcutAvailability =
  | "always"
  | "idle"
  | "undo"
  | "redo"
  | "clipboard"
  | "selection"
  | "unlockedSelection"
  | "lockedSelection"
  | "group"
  | "ungroup"
  | "objects"
  | "textSelection"
  | "selectionOrSlide"
  | "slide"
  | "focusedSlide";
export type ShortcutRepeatPolicy = "once" | "repeat";

/** Availability flags are derived from the active editor target, never DOM data. */
export interface ShortcutAvailabilityState {
  busy: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  canPaste?: boolean;
  hasSelection?: boolean;
  hasUnlockedSelection?: boolean;
  hasLockedSelection?: boolean;
  canGroup?: boolean;
  canUngroup?: boolean;
  hasTextSelection?: boolean;
  hasObjects?: boolean;
  hasSlide?: boolean;
  hasFocusedSlide?: boolean;
}

export interface PlatformShortcut {
  action: ShortcutAction;
  label: string;
  category: ShortcutCategory;
  scope: ShortcutScope;
  availability: ShortcutAvailability;
  repeatPolicy: ShortcutRepeatPolicy;
  globalInText: boolean;
  nativeCommand?: DesktopCommand;
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
  scope: ShortcutScope;
  availability: ShortcutAvailability;
  repeatPolicy: ShortcutRepeatPolicy;
  globalInText: boolean;
  native?: { command: DesktopCommand; label: string };
  platforms: Partial<
    Record<
      KeyboardPlatform,
      {
        binding: ShortcutBinding;
        aliases: ShortcutBinding[];
      }
    >
  >;
}

// This data also feeds Electron's menus. Native key spellings live alongside
// renderer bindings so aliases and punctuation cannot silently drift apart.
const DEFINITIONS = registry.commands as readonly ShortcutDefinition[];

export function isShortcutAvailable(
  action: ShortcutAction,
  platform: KeyboardPlatform,
): boolean {
  return Boolean(
    DEFINITIONS.find((entry) => entry.action === action)?.platforms[platform],
  );
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = DEFINITIONS.map(
  ({ action }) => action,
);

/** One predicate is shared by renderer keyboard and native command routing. */
export function isShortcutEnabled(
  action: ShortcutAction,
  platform: KeyboardPlatform,
  state: ShortcutAvailabilityState,
): boolean {
  if (!isShortcutAvailable(action, platform)) return false;
  const { availability } = getShortcut(action, platform);
  if (availability === "always") return true;
  if (state.busy) return false;
  const enabled: Record<ShortcutAvailability, boolean> = {
    always: true,
    idle: true,
    undo: Boolean(state.canUndo),
    redo: Boolean(state.canRedo),
    clipboard: Boolean(state.canPaste),
    selection: Boolean(state.hasSelection),
    unlockedSelection: Boolean(state.hasUnlockedSelection),
    lockedSelection: Boolean(state.hasLockedSelection),
    group: Boolean(state.canGroup),
    ungroup: Boolean(state.canUngroup),
    objects: Boolean(state.hasObjects),
    textSelection: Boolean(state.hasTextSelection),
    selectionOrSlide: Boolean(state.hasUnlockedSelection || state.hasSlide),
    slide: Boolean(state.hasSlide),
    focusedSlide: Boolean(state.hasFocusedSlide),
  };
  return enabled[availability];
}

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
      : binding.code === "NumpadAdd"
        ? "Num +"
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
  const profile = definition.platforms[platform];
  if (!profile) throw new Error(`${action} is not available on ${platform}.`);
  const binding = { ...profile.binding };
  const aliases = profile.aliases.map((alias) => ({ ...alias }));
  return {
    action: definition.action,
    label: definition.label,
    category: definition.category,
    scope: definition.scope,
    availability: definition.availability,
    repeatPolicy: definition.repeatPolicy,
    globalInText: definition.globalInText,
    nativeCommand: definition.native?.command,
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
