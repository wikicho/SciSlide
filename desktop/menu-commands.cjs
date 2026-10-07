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
  const mac = platform === "darwin";
  const windows = platform === "win32";
  const primary = mac ? "Command" : "Control";
  const commandItem = (label, accelerator, command) => ({
    label,
    accelerator,
    click: () => sendCommand(command),
  });
  const item = (label, keys, command) =>
    commandItem(label, `${primary}+${keys}`, command);
  return [
    ...(platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        item("New presentation", "N", "new"),
        item("Open…", "O", "open"),
        item("Save", "S", "save"),
        item("Save As…", mac ? "Alt+Shift+S" : "Shift+S", "saveAs"),
        { type: "separator" },
        item("Export PDF…", mac ? "Alt+Shift+P" : "Alt+P", "exportPdf"),
        item("Export slide SVG…", "Alt+S", "exportSvg"),
        { type: "separator" },
        { role: platform === "darwin" ? "close" : "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("Undo", "Z", "undo"),
        item("Redo", mac ? "Shift+Z" : "Y", "redo"),
        { type: "separator" },
        item("Cut", "X", "cut"),
        item("Copy", "C", "copy"),
        item("Paste", "V", "paste"),
        item("Select all", "A", "selectAll"),
        ...(mac ? [item("Deselect all", "Shift+A", "deselectAll")] : []),
        { type: "separator" },
        ...(mac || windows
          ? [item("Duplicate selection or slide", "D", "duplicate")]
          : [
              commandItem(
                "Duplicate selection or slide",
                "Shift+F3",
                "duplicate",
              ),
            ]),
        ...(windows
          ? [item("Duplicate slide", "Shift+D", "duplicateSlide")]
          : []),
        item("Group", mac ? "Alt+G" : windows ? "G" : "Shift+G", "group"),
        item("Ungroup", mac || !windows ? "Alt+Shift+G" : "Shift+G", "ungroup"),
        ...(mac
          ? [
              { type: "separator" },
              item("Apply text / Present", "Enter", "finishTextEditing"),
            ]
          : []),
      ],
    },
    {
      label: "Insert",
      submenu: [
        item("Slide", mac ? "Shift+N" : "M", "addSlide"),
        mac
          ? item("Equation", "Alt+E", "insertEquation")
          : commandItem(
              "Equation",
              windows ? "Alt+=" : "Alt+Shift+E",
              "insertEquation",
            ),
        ...(mac ? [item("Figure…", "Shift+V", "insertFigure")] : []),
      ],
    },
    {
      label: "Format",
      submenu: [
        item("Bold", "B", "bold"),
        item(
          "Increase font size",
          mac ? "Plus" : windows ? "Shift+." : "]",
          "increaseFontSize",
        ),
        item(
          "Decrease font size",
          mac ? "-" : windows ? "Shift+," : "[",
          "decreaseFontSize",
        ),
        { type: "separator" },
        item("Align text left", mac ? "Shift+[" : "L", "alignTextLeft"),
        item("Align text center", mac ? "Shift+\\" : "E", "alignTextCenter"),
        item("Align text right", mac ? "Shift+]" : "R", "alignTextRight"),
      ],
    },
    {
      label: "Arrange",
      submenu: [
        ...(!windows
          ? [
              item(
                "Bring to front",
                mac ? "Shift+F" : "Shift+numadd",
                "bringToFront",
              ),
            ]
          : []),
        item(
          "Bring forward",
          // Electron's Plus token implies Shift, so Plus/Shift+Plus would
          // collide. Impress binds the keypad ADD key with distinct modifiers.
          mac ? "Alt+Shift+F" : windows ? "Shift+]" : "numadd",
          "bringForward",
        ),
        item(
          "Send backward",
          mac ? "Alt+Shift+B" : windows ? "Shift+[" : "-",
          "sendBackward",
        ),
        ...(!windows
          ? [item("Send to back", mac ? "Shift+B" : "Shift+-", "sendToBack")]
          : []),
        ...(mac
          ? [
              { type: "separator" },
              item("Lock", "L", "lock"),
              item("Unlock", "Alt+L", "unlock"),
            ]
          : []),
      ],
    },
    {
      label: "View",
      submenu: [
        ...(mac
          ? []
          : [commandItem("Present from start", "F5", "presentFromStart")]),
        mac
          ? item("Present", "Alt+P", "present")
          : commandItem("Present", "Shift+F5", "present"),
        ...(windows
          ? [commandItem("Presenter view", "Alt+F5", "presenterView")]
          : []),
        ...(mac
          ? [
              { type: "separator" },
              item("Zoom in", "Shift+.", "zoomIn"),
              item("Zoom out", "Shift+,", "zoomOut"),
              item("Fit slide", "Alt+0", "fitSlide"),
            ]
          : windows
            ? [
                { type: "separator" },
                item("Zoom in", "Plus", "zoomIn"),
                item("Zoom out", "-", "zoomOut"),
                item("Fit slide", "Alt+O", "fitSlide"),
              ]
            : [
                { type: "separator" },
                // Bare zoom keys and keypad fit are renderer-only so native
                // menu accelerators cannot consume text input or media keys.
                commandItem("Zoom in", undefined, "zoomIn"),
                commandItem("Zoom out", undefined, "zoomOut"),
                commandItem("Fit slide", undefined, "fitSlide"),
              ]),
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
        mac
          ? item("Keyboard shortcuts", "Shift+/", "showShortcuts")
          : commandItem("Keyboard shortcuts", "F1", "showShortcuts"),
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
