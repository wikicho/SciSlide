const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const {
  COMMANDS,
  MAX_DOCUMENT_BYTES,
  parseDevUrl,
  isTrustedPage,
  isAppOrigin,
  allowsFullscreen,
  isAllowedRequest,
  validateSaveDocument,
  validateSaveExport,
  validateCompile,
  validateJobId,
  resolveAsset,
} = require("./host-utils.cjs");

app.setName("SciSlide");
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "scislide",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const devUrl = app.isPackaged
  ? null
  : parseDevUrl(process.env.SCISLIDE_DEV_URL);
const appUrl = devUrl || "scislide://app/";
const distRoot = path.join(__dirname, "..", "dist");
const runningJobs = new Set();
let mainWindow = null;
let documentPath = null;
let fileOperations = Promise.resolve();
let texModule;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ico": "image/x-icon",
};
const csp = [
  "default-src 'none'",
  `script-src 'self'${devUrl ? " 'unsafe-inline'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${devUrl ? " ws://127.0.0.1:5173" : ""}`,
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

function compiler() {
  texModule ||= import(pathToFileURL(path.join(__dirname, "tex.mjs")).href);
  return texModule;
}

function validateSender(event) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedPage(event.senderFrame.url, devUrl)
  )
    throw new Error(
      "This desktop action is only available to SciSlide's main window.",
    );
}

function ipc(channel, action) {
  ipcMain.handle(channel, (event, ...args) => {
    validateSender(event);
    return action(...args);
  });
}

function withFileOperation(action) {
  const result = fileOperations.then(action, action);
  fileOperations = result.catch(() => undefined);
  return result;
}

async function writeAtomically(destination, bytes) {
  const temporary = path.join(
    path.dirname(destination),
    `.scislide-${randomUUID()}.tmp`,
  );
  try {
    const file = await fs.open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readDocument(selectedPath) {
  if (path.extname(selectedPath).toLowerCase() !== ".scislide")
    throw new Error("Choose a .scislide document.");
  const file = await fs.open(selectedPath, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !stat.size || stat.size > MAX_DOCUMENT_BYTES)
      throw new Error("Choose a .scislide document smaller than 64 MB.");
    const bytes = Buffer.alloc(stat.size + 1);
    let read = 0;
    while (read < bytes.length) {
      const chunk = await file.read(bytes, read, bytes.length - read, null);
      if (!chunk.bytesRead) break;
      read += chunk.bytesRead;
    }
    if (read !== stat.size || (await file.stat()).size !== stat.size)
      throw new Error("The document changed while opening. Try again.");
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
      throw new Error("The document must be a .scislide archive.");
    return new Uint8Array(bytes.subarray(0, read));
  } finally {
    await file.close();
  }
}

async function chosenDestination(selectedPath, extension) {
  if (selectedPath.toLowerCase().endsWith(`.${extension}`)) return selectedPath;
  const destination = `${selectedPath}.${extension}`;
  // Native dialogs do not consistently append extensions on every platform.
  // Confirm the final path if adding the extension would replace a different file.
  const exists = await fs.access(destination).then(
    () => true,
    () => false,
  );
  if (exists) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Replace existing file?",
      message: `Replace ${path.basename(destination)}?`,
      detail: "A file with the completed extension already exists.",
      buttons: ["Cancel", "Replace"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return null;
  }
  return destination;
}

function registerIpc() {
  ipc("scislide:open-document", () =>
    withFileOperation(async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Open SciSlide document",
        filters: [{ name: "SciSlide document", extensions: ["scislide"] }],
        properties: ["openFile"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const selectedPath = result.filePaths[0];
      const bytes = await readDocument(selectedPath);
      documentPath = selectedPath;
      return { bytes, name: path.basename(selectedPath), path: selectedPath };
    }),
  );
  ipc("scislide:save-document", (value) => {
    const request = validateSaveDocument(value);
    return withFileOperation(async () => {
      let destination = documentPath;
      if (!destination || request.saveAs) {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: "Save SciSlide document",
          defaultPath: destination || request.suggestedName,
          filters: [{ name: "SciSlide document", extensions: ["scislide"] }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });
        if (result.canceled || !result.filePath) return null;
        destination = await chosenDestination(result.filePath, "scislide");
        if (!destination) return null;
      }
      await writeAtomically(destination, request.bytes);
      documentPath = destination;
      return { path: destination, name: path.basename(destination) };
    });
  });
  ipc("scislide:clear-document", () =>
    withFileOperation(() => {
      documentPath = null;
    }),
  );
  ipc("scislide:save-export", (value) => {
    const request = validateSaveExport(value);
    return withFileOperation(async () => {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: `Export ${request.kind.toUpperCase()}`,
        defaultPath: request.suggestedName,
        filters: [
          { name: request.kind.toUpperCase(), extensions: [request.kind] },
        ],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return null;
      const destination = await chosenDestination(
        result.filePath,
        request.kind,
      );
      if (!destination) return null;
      await writeAtomically(destination, request.bytes);
      return { path: destination, name: path.basename(destination) };
    });
  });
  ipc("scislide:detect-tex", async () => (await compiler()).detectTex());
  ipc("scislide:compile-tex", async (value) => {
    const request = validateCompile(value);
    if (runningJobs.has(request.jobId))
      throw new Error("That equation job is already running.");
    if (runningJobs.size >= 2)
      throw new Error(
        "Two equations are already compiling. Wait or cancel one.",
      );
    runningJobs.add(request.jobId);
    try {
      return await (await compiler()).compileTex(request);
    } finally {
      runningJobs.delete(request.jobId);
    }
  });
  ipc("scislide:cancel-compile", async (value) => {
    const jobId = validateJobId(value);
    if (runningJobs.has(jobId)) await (await compiler()).cancelCompile(jobId);
  });
}

function sendCommand(command) {
  if (COMMANDS.has(command) && mainWindow && !mainWindow.isDestroyed())
    if (command === "present") {
      const contents = mainWindow.webContents;
      if (!isTrustedPage(contents.getURL(), devUrl)) return;
      // A native menu event has no renderer transient activation. This fixed
      // action grants a gesture only to the app's explicit Present command.
      void contents
        .executeJavaScript("document.documentElement.requestFullscreen()", true)
        .catch(() => undefined)
        .finally(() => {
          if (!contents.isDestroyed())
            contents.send("scislide:command", command);
        });
    } else mainWindow.webContents.send("scislide:command", command);
}

function installMenu() {
  const item = (label, accelerator, command) => ({
    label,
    accelerator,
    click: () => sendCommand(command),
  });
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        item("New presentation", "CmdOrCtrl+N", "new"),
        item("Open…", "CmdOrCtrl+O", "open"),
        item("Save", "CmdOrCtrl+S", "save"),
        item("Save As…", "CmdOrCtrl+Shift+S", "saveAs"),
        { type: "separator" },
        item("Export PDF…", "CmdOrCtrl+Alt+P", "exportPdf"),
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("Undo", "CmdOrCtrl+Z", "undo"),
        item("Redo", "CmdOrCtrl+Shift+Z", "redo"),
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        item("Present", "CmdOrCtrl+Enter", "present"),
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(devUrl
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
        {
          label: "About SciSlide",
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "SciSlide",
              message: "SciSlide",
              detail: `Scientific Presentation Editor\nVersion ${app.getVersion()}\nMathJax and local LaTeX equation editing`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function configureSession() {
  const desktopSession = session.defaultSession;
  const permitFullscreen = (contents, permission, details) =>
    Boolean(
      mainWindow &&
      !mainWindow.isDestroyed() &&
      contents === mainWindow.webContents &&
      allowsFullscreen(permission, contents.getURL(), details, devUrl),
    );
  desktopSession.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(permitFullscreen(contents, permission, details)),
  );
  desktopSession.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      isAppOrigin(requestingOrigin, devUrl) &&
      permitFullscreen(contents, permission, details),
  );
  desktopSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !isAllowedRequest(details.url, devUrl) }),
  );
  desktopSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
        "X-Content-Type-Options": ["nosniff"],
      },
    }),
  );
  desktopSession.on("will-download", (event) => event.preventDefault());
  protocol.handle("scislide", async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    try {
      const asset = await resolveAsset(request.url, distRoot);
      const type = MIME[path.extname(asset).toLowerCase()];
      if (!type) return new Response("Resource not found", { status: 404 });
      const body = request.method === "HEAD" ? null : await fs.readFile(asset);
      return new Response(body, {
        headers: {
          "Content-Type": type,
          "Content-Security-Policy": csp,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control":
            path.extname(asset) === ".html"
              ? "no-store"
              : "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return new Response("Resource not found", { status: 404 });
    }
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "SciSlide",
    width: 1440,
    height: 900,
    minWidth: 620,
    minHeight: 550,
    show: false,
    backgroundColor: "#f3f5f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
    documentPath = null;
  });
  await mainWindow.loadURL(appUrl);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      await configureSession();
      registerIpc();
      installMenu();
      await createMainWindow();
    })
    .catch((error) => {
      console.error("SciSlide desktop could not start:", error);
      dialog.showErrorBox(
        "SciSlide could not start",
        String(error.message || error),
      );
      app.quit();
    });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createMainWindow().catch((error) => console.error(error));
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    if (runningJobs.size)
      compiler()
        .then((module) =>
          Promise.allSettled(
            Array.from(runningJobs, (jobId) => module.cancelCompile(jobId)),
          ),
        )
        .catch(() => undefined);
  });
}
