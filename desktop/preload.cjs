const { contextBridge, ipcRenderer } = require("electron");

const commands = new Set([
  "new",
  "open",
  "save",
  "saveAs",
  "undo",
  "redo",
  "present",
  "presentFromStart",
  "presenterView",
  "exportPdf",
  "exportSvg",
  "cut",
  "copy",
  "paste",
  "selectAll",
  "duplicate",
  "duplicateSlide",
  "group",
  "ungroup",
  "showShortcuts",
  "finishTextEditing",
  "addSlide",
  "insertEquation",
  "insertFigure",
  "deselectAll",
  "lock",
  "unlock",
  "bringToFront",
  "sendToBack",
  "bringForward",
  "sendBackward",
  "zoomIn",
  "zoomOut",
  "fitSlide",
  "bold",
  "increaseFontSize",
  "decreaseFontSize",
  "alignTextLeft",
  "alignTextCenter",
  "alignTextRight",
]);

contextBridge.exposeInMainWorld("scislideDesktop", {
  platform: process.platform,
  openDocument: () => ipcRenderer.invoke("scislide:open-document"),
  saveDocument: (request) =>
    ipcRenderer.invoke("scislide:save-document", request),
  clearDocument: () => ipcRenderer.invoke("scislide:clear-document"),
  saveExport: (request) => ipcRenderer.invoke("scislide:save-export", request),
  detectTex: () => ipcRenderer.invoke("scislide:detect-tex"),
  compileTex: (request) => ipcRenderer.invoke("scislide:compile-tex", request),
  cancelCompile: (jobId) =>
    ipcRenderer.invoke("scislide:cancel-compile", jobId),
  detectAi: () => ipcRenderer.invoke("scislide:detect-ai"),
  generateAi: (request) => ipcRenderer.invoke("scislide:generate-ai", request),
  cancelAi: (jobId) => ipcRenderer.invoke("scislide:cancel-ai", jobId),
  onCommand: (callback) => {
    if (typeof callback !== "function")
      throw new TypeError("A command listener must be a function.");
    const listener = (_event, command) => {
      if (commands.has(command)) callback(command);
    };
    ipcRenderer.on("scislide:command", listener);
    return () => ipcRenderer.removeListener("scislide:command", listener);
  },
});
