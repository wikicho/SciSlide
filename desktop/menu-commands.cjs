const { validateCommandAvailability } = require("./host-utils.cjs");
const {
  registry,
  COMMANDS,
  keyboardPlatform,
  getNativeAccelerator,
} = require("./shortcut-registry.cjs");

// These fixed scripts inspect focus only; no renderer data is evaluated as code.
const EDITABLE_FOCUS_SCRIPT = `(() => {
  const active = document.activeElement;
  const field = active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  const objectControl = field?.matches('input') &&
    ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'image', 'submit', 'reset', 'hidden'].includes(field.type);
  return Boolean(active && (field || active.isContentEditable) && !objectControl);
})()`;

const PRESENT_FULLSCREEN_SCRIPT = `(() => {
  const active = document.activeElement;
  const field = active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  const objectControl = field?.matches('input') &&
    ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'image', 'submit', 'reset', 'hidden'].includes(field.type);
  const editing = Boolean(active && (field || active.isContentEditable) && !objectControl);
  const blocked = Array.from(document.querySelectorAll('[role="dialog"], .theme-chooser, .app-shell[aria-busy="true"], .recovery-loading'))
    .some(element => element.getClientRects().length > 0);
  if (editing || blocked || document.fullscreenElement) return;
  return document.documentElement.requestFullscreen();
})()`;

const nativeTextCommands = new Set([
  "cut",
  "copy",
  "paste",
  "selectAll",
  "undo",
  "redo",
]);

async function dispatchMenuCommand(contents, command) {
  if (!COMMANDS.has(command) || contents.isDestroyed()) return;
  if (nativeTextCommands.has(command)) {
    let editing;
    try {
      editing = await contents.executeJavaScript(EDITABLE_FOCUS_SCRIPT);
    } catch {
      return;
    }
    if (contents.isDestroyed()) return;
    if (editing) {
      contents[command]();
      return;
    }
  } else if (
    command === "present" ||
    command === "presentFromStart" ||
    command === "presenterView" ||
    command === "finishTextEditing"
  ) {
    // Native menu accelerators consume the key event. Finish inline editing in
    // the renderer, but grant fullscreen only when the canvas is active.
    try {
      await contents.executeJavaScript(PRESENT_FULLSCREEN_SCRIPT, true);
    } catch {
      // Presentation remains usable when the window cannot enter fullscreen.
    }
  }
  if (!contents.isDestroyed()) contents.send("scislide:command", command);
}

function protectTextComposition(contents) {
  let altGraph = false;
  contents.on("before-input-event", (_event, input) => {
    if (input.key === "AltGraph") altGraph = input.type !== "keyUp";
    // Keep key events flowing to IME/text controls while suppressing native
    // menu accelerators, which otherwise consume them before the renderer.
    // Repeated editor commands likewise reach the renderer repeat-policy guard.
    contents.setIgnoreMenuShortcuts(
      Boolean(input.isComposing || altGraph || input.isAutoRepeat),
    );
  });
  contents.on("blur", () => {
    altGraph = false;
    if (!contents.isDestroyed()) contents.setIgnoreMenuShortcuts(false);
  });
}

function buildMenuTemplate(
  platform,
  sendCommand,
  { development = false, onAbout } = {},
) {
  const profile = keyboardPlatform(platform);
  const definitions = new Map(
    registry.commands.map((entry) => [entry.action, entry]),
  );
  const menus = registry.menus.map((menu) => ({
    label: menu.label,
    submenu: menu.items
      .flatMap((action) => {
        if (action === "separator") return [{ type: "separator" }];
        if (action === "closeOrQuit")
          return [{ role: platform === "darwin" ? "close" : "quit" }];
        if (action === "togglefullscreen")
          return [{ role: "togglefullscreen" }];
        if (action === "development")
          return development
            ? [
                { type: "separator" },
                { role: "reload" },
                { role: "toggleDevTools" },
              ]
            : [];
        if (action === "about")
          return [{ label: "About SciSlide", click: onAbout }];
        const definition = definitions.get(action);
        if (!definition?.native || !definition.platforms[profile]?.nativeMenu)
          return [];
        return [
          {
            id: definition.native.command,
            label: definition.native.label,
            accelerator: getNativeAccelerator(definition, profile),
            click: () => sendCommand(definition.native.command),
          },
        ];
      })
      .filter(
        (item, index, items) =>
          item.type !== "separator" ||
          (index > 0 &&
            index < items.length - 1 &&
            items[index - 1].type !== "separator"),
      ),
  }));
  return [...(platform === "darwin" ? [{ role: "appMenu" }] : []), ...menus];
}

function setMenuCommandAvailability(menu, states) {
  const checked = validateCommandAvailability(states);
  for (const [command, enabled] of Object.entries(checked)) {
    const item = menu?.getMenuItemById(command);
    if (item) item.enabled = enabled;
  }
}

function isMenuCommandEnabled(menu, command) {
  const item = menu?.getMenuItemById(command);
  return COMMANDS.has(command) && Boolean(item && item.enabled !== false);
}

module.exports = {
  buildMenuTemplate,
  setMenuCommandAvailability,
  isMenuCommandEnabled,
  dispatchMenuCommand,
  protectTextComposition,
  EDITABLE_FOCUS_SCRIPT,
  PRESENT_FULLSCREEN_SCRIPT,
};
