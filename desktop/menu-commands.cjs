const { COMMANDS } = require("./host-utils.cjs");

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
  } else if (command === "present") {
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
    contents.setIgnoreMenuShortcuts(Boolean(input.isComposing || altGraph));
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
  const primary = platform === "darwin" ? "Command" : "Control";
  const item = (label, keys, command) => ({
    label,
    accelerator: `${primary}+${keys}`,
    click: () => sendCommand(command),
  });
  return [
    ...(platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        item("New presentation", "N", "new"),
        item("Open…", "O", "open"),
        item("Save", "S", "save"),
        item("Save As…", "Shift+S", "saveAs"),
        { type: "separator" },
        item("Export PDF…", "Alt+P", "exportPdf"),
        item("Export slide SVG…", "Alt+S", "exportSvg"),
        { type: "separator" },
        { role: platform === "darwin" ? "close" : "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("Undo", "Z", "undo"),
        item("Redo", platform === "win32" ? "Y" : "Shift+Z", "redo"),
        { type: "separator" },
        item("Cut", "X", "cut"),
        item("Copy", "C", "copy"),
        item("Paste", "V", "paste"),
        item("Select all", "A", "selectAll"),
        { type: "separator" },
        item("Duplicate selection or slide", "D", "duplicate"),
        item("Group", "G", "group"),
        item("Ungroup", "Shift+G", "ungroup"),
      ],
    },
    {
      label: "View",
      submenu: [
        item("Present", "Enter", "present"),
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(development
          ? [
              { type: "separator" },
              { role: "reload" },
              { role: "toggleDevTools" },
            ]
          : []),
      ],
    },
    {
      label: "Help",
      submenu: [
        item("Keyboard shortcuts", "Shift+/", "showShortcuts"),
        { label: "About SciSlide", click: onAbout },
      ],
    },
  ];
}

module.exports = {
  buildMenuTemplate,
  dispatchMenuCommand,
  protectTextComposition,
  EDITABLE_FOCUS_SCRIPT,
  PRESENT_FULLSCREEN_SCRIPT,
};
