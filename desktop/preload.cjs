const { contextBridge, ipcRenderer } = require("electron");

const commands = new Set([
  "new",
  "open",
  "save",
  "saveAs",
  "undo",
  "redo",
  "present",
  "exportPdf",
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
