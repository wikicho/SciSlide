const registry = require("./keyboard-shortcuts.json");

function keyboardPlatform(platform) {
  return { darwin: "mac", win32: "windows", linux: "linux" }[platform];
}

function getNativeAccelerator(definition, platform) {
  const profile = definition.platforms[platform];
  if (
    !definition.native ||
    !profile?.nativeMenu ||
    profile.nativeAccelerator === false ||
    definition.scope === "thumbnail" ||
    definition.scope === "slideNavigation"
  )
    return undefined;
  const { binding } = profile;
  const punctuation = {
    Slash: "/",
    Period: ".",
    Comma: ",",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Equal: "=",
    Minus: "-",
    NumpadAdd: "numadd",
    NumpadMultiply: "nummult",
  };
  const key =
    binding.nativeKey ??
    punctuation[binding.code] ??
    (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return [
    ...(binding.primary ? [platform === "mac" ? "Command" : "Control"] : []),
    ...(binding.alt ? ["Alt"] : []),
    ...(binding.shift ? ["Shift"] : []),
    key,
  ].join("+");
}

// Fixed declaration data is the only source of IPC command IDs. It cannot be
// extended by document contents, renderer payloads, or preferences.
const COMMANDS = new Set(
  registry.commands
    .filter((definition) => definition.native)
    .map((definition) => definition.native.command),
);

module.exports = { registry, COMMANDS, keyboardPlatform, getNativeAccelerator };
