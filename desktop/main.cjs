const {
  app,
  BrowserWindow,
  dialog,
  clipboard,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pathToFileURL, fileURLToPath } = require("node:url");
const {
  COMMANDS,
  MAX_DOCUMENT_BYTES,
  parseDevUrl,
  isTrustedPage,
  presentationWindowRole,
  isAppOrigin,
  allowsFullscreen,
  isAllowedRequest,
  validateSaveDocument,
  validateSaveExport,
  validateCompile,
  validateJobId,
  validateCommandAvailability,
  resolveAsset,
} = require("./host-utils.cjs");
const { pdfResourcePolicy } = require("./pdf-policy.cjs");
const {
  buildMenuTemplate,
  setMenuCommandAvailability,
  isMenuCommandEnabled,
  dispatchMenuCommand,
  protectTextComposition,
} = require("./menu-commands.cjs");

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
const runningJobs = new Map();
const editorWindows = new Map();
let focusedEditor = null;
let launchOperations = Promise.resolve();
let texModule;
let aiModule;
let quittingAfterCleanup = false;
let quitCleanup;
const closingJobs = new Set();
let desktopInitialized = false;
const pendingDocuments = [];
const documentExtensions = new Set([".scislide", ".pptx"]);

function queueDocuments(arguments_, workingDirectory = process.cwd()) {
  for (let filename of arguments_) {
    if (typeof filename !== "string" || filename.startsWith("-")) continue;
    try {
      if (filename.startsWith("file:")) filename = fileURLToPath(filename);
      if (!documentExtensions.has(path.extname(filename).toLowerCase()))
        continue;
      filename = path.resolve(workingDirectory, filename);
      if (!pendingDocuments.includes(filename)) pendingDocuments.push(filename);
    } catch {
      // Ignore malformed launch arguments; document contents are checked on read.
    }
  }
}

function getFocusedEditor() {
  const window = BrowserWindow.getFocusedWindow();
  if (window) return editorWindows.get(window.webContents) || null;
  return focusedEditor && !focusedEditor.window.isDestroyed()
    ? focusedEditor
    : null;
}

async function focusEditor(editor = getFocusedEditor()) {
  editor ||= [...editorWindows.values()].at(-1) || (await createMainWindow());
  const window = editor.window;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function editorForPath(filename) {
  const normalize = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const target = normalize(path.resolve(filename));
  return [...editorWindows.values()].find((editor) =>
    [
      editor.documentPath,
      editor.openingPath,
      editor.savingPath,
      ...editor.pendingDocuments,
      ...editor.openCandidates,
    ]
      .filter(Boolean)
      .some((value) => normalize(path.resolve(value)) === target),
  );
}

async function openDocumentWindow(filename) {
  // Resolve aliases before checking for an existing editor of the same file.
  const selectedPath = await fs.realpath(filename).catch(() => filename);
  const editor =
    editorForPath(selectedPath) || (await createMainWindow(selectedPath));
  await focusEditor(editor);
  return editor;
}

function openQueuedDocuments(ensureWindow = false) {
  const result = launchOperations.then(async () => {
    while (pendingDocuments.length)
      await openDocumentWindow(pendingDocuments.shift());
    if (ensureWindow && !editorWindows.size) await createMainWindow();
  });
  launchOperations = result.catch(() => undefined);
  return result;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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
  ".pfb": "application/octet-stream",
  ".bcmap": "application/octet-stream",
  ".wasm": "application/wasm",
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
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

function compiler() {
  texModule ||= import(pathToFileURL(path.join(__dirname, "tex.mjs")).href);
  return texModule;
}

function aiHost() {
  aiModule ||= import(pathToFileURL(path.join(__dirname, "ai.mjs")).href);
  return aiModule;
}

async function detectInstalledTex(binDirectory) {
  const configuration = path.join(app.getPath("userData"), "tex-path.json");
  if (binDirectory === undefined) {
    try {
      binDirectory = JSON.parse(
        await fs.readFile(configuration, "utf8"),
      ).binDirectory;
      if (typeof binDirectory !== "string" || !path.isAbsolute(binDirectory))
        binDirectory = undefined;
    } catch {
      /* Use automatic discovery until a folder has been selected. */
    }
  }
  return (await compiler()).detectTex({
    ...(binDirectory ? { binDirectory } : {}),
  });
}

function validateSender(event) {
  const editor = editorWindows.get(event.sender);
  if (
    !editor ||
    editor.window.isDestroyed() ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedPage(event.senderFrame.url, devUrl)
  )
    throw new Error(
      "This desktop action is only available to SciSlide's main window.",
    );
  return editor;
}

function ipc(channel, action, { editorOnly = false } = {}) {
  ipcMain.handle(channel, (event, ...args) => {
    const editor = validateSender(event);
    if (editorOnly && new URL(event.senderFrame.url).hash)
      throw new Error(
        "Command availability is only available to the main editor.",
      );
    return action(editor, ...args);
  });
}

function withFileOperation(editor, action) {
  const result = editor.fileOperations.then(action, action);
  editor.fileOperations = result.catch(() => undefined);
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
  const extension = path.extname(selectedPath).toLowerCase();
  if (!documentExtensions.has(extension))
    throw new Error("Choose a .scislide or .pptx document.");
  const file = await fs.open(selectedPath, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !stat.size || stat.size > MAX_DOCUMENT_BYTES)
      throw new Error(`Choose a ${extension} document smaller than 64 MB.`);
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
      throw new Error(`The document must be a ${extension} archive.`);
    return new Uint8Array(bytes.subarray(0, read));
  } finally {
    await file.close();
  }
}

async function chosenDestination(editor, selectedPath, extension) {
  if (selectedPath.toLowerCase().endsWith(`.${extension}`)) return selectedPath;
  const destination = `${selectedPath}.${extension}`;
  // Native dialogs do not consistently append extensions on every platform.
  // Confirm the final path if adding the extension would replace a different file.
  const exists = await fs.access(destination).then(
    () => true,
    () => false,
  );
  if (exists) {
    const result = await dialog.showMessageBox(editor.window, {
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

function syncEditorMenu(editor = getFocusedEditor()) {
  setMenuCommandAvailability(
    Menu.getApplicationMenu(),
    Object.fromEntries(
      [...COMMANDS].map((command) => [
        command,
        editor ? editor.commandAvailability[command] !== false : false,
      ]),
    ),
  );
}

function setDocumentPath(editor, filename) {
  editor.documentPath = filename;
  editor.window.setTitle?.(
    filename ? `${path.basename(filename)} · SciSlide` : "SciSlide",
  );
  editor.window.setRepresentedFilename?.(filename || "");
}

function getAudienceDisplay(editorWindow) {
  const current = screen.getDisplayMatching(editorWindow.getBounds());
  const alternatives = screen.getAllDisplays().filter(
    (display) =>
      display.id !== current.id &&
      // Mirrored outputs can have distinct IDs and share a desktop origin.
      (display.bounds.x !== current.bounds.x ||
        display.bounds.y !== current.bounds.y),
  );
  return alternatives.find((display) => !display.internal) ?? alternatives[0];
}

function registerIpc() {
  ipcMain.on("scislide:has-audience-display", (event) => {
    try {
      const editor = validateSender(event);
      event.returnValue =
        !new URL(event.senderFrame.url).hash &&
        !!getAudienceDisplay(editor.window);
    } catch {
      event.returnValue = false;
    }
  });
  ipc(
    "scislide:take-open-document",
    (editor) =>
      withFileOperation(editor, async () => {
        const selectedPath = editor.pendingDocuments.shift();
        if (!selectedPath) return null;
        editor.openingPath = selectedPath;
        try {
          const bytes = await readDocument(selectedPath);
          if (path.extname(selectedPath).toLowerCase() === ".scislide")
            editor.openCandidates.add(selectedPath);
          return {
            bytes,
            name: path.basename(selectedPath),
            path: selectedPath,
          };
        } finally {
          editor.openingPath = null;
        }
      }),
    { editorOnly: true },
  );
  ipc(
    "scislide:set-command-availability",
    (editor, states) => {
      Object.assign(
        editor.commandAvailability,
        validateCommandAvailability(states),
      );
      if (getFocusedEditor() === editor) syncEditorMenu(editor);
    },
    { editorOnly: true },
  );
  ipc("scislide:open-document", (editor) =>
    withFileOperation(editor, async () => {
      const result = await dialog.showOpenDialog(editor.window, {
        title: "Open presentations",
        filters: [
          { name: "Presentations", extensions: ["scislide", "pptx"] },
          { name: "SciSlide", extensions: ["scislide"] },
          { name: "PowerPoint", extensions: ["pptx"] },
        ],
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      for (const selectedPath of result.filePaths)
        await openDocumentWindow(selectedPath);
      // The requesting renderer keeps its current document, including unsaved edits.
      return null;
    }),
  );
  ipc(
    "scislide:accept-open-document",
    (editor, selectedPath) =>
      withFileOperation(editor, () => {
        if (
          typeof selectedPath !== "string" ||
          !editor.openCandidates.has(selectedPath)
        )
          throw new Error(
            "Only a document read by this editor can be accepted.",
          );
        setDocumentPath(editor, selectedPath);
        editor.openCandidates.clear();
      }),
    { editorOnly: true },
  );
  ipc(
    "scislide:watch-close-document",
    (editor, enabled) => {
      if (typeof enabled !== "boolean")
        throw new TypeError("Close confirmation state must be a boolean.");
      editor.closeConfirmationEnabled = enabled;
    },
    { editorOnly: true },
  );
  ipc(
    "scislide:confirm-close-document",
    (editor) => {
      if (!editor.closeRequested || editor.window.isDestroyed()) return;
      editor.closeApproved = true;
      editor.window.close();
    },
    { editorOnly: true },
  );
  ipc(
    "scislide:write-clipboard",
    (_editor, value) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => !["text", "html"].includes(key)) ||
        typeof value.text !== "string" ||
        typeof value.html !== "string" ||
        value.text.length > 64 * 1024 * 1024 ||
        value.html.length > 96 * 1024 * 1024 ||
        Buffer.byteLength(value.text, "utf8") > 64 * 1024 * 1024 ||
        Buffer.byteLength(value.html, "utf8") > 96 * 1024 * 1024
      )
        throw new Error("Clipboard text or HTML is invalid or too large.");
      clipboard.write({ text: value.text, html: value.html });
    },
    { editorOnly: true },
  );
  ipc(
    "scislide:read-clipboard",
    () => {
      const text = clipboard.readText();
      const html = clipboard.readHTML();
      if (
        text.length > 64 * 1024 * 1024 ||
        html.length > 96 * 1024 * 1024 ||
        Buffer.byteLength(text, "utf8") > 64 * 1024 * 1024 ||
        Buffer.byteLength(html, "utf8") > 96 * 1024 * 1024
      )
        throw new Error("Clipboard data exceeds the supported size limit.");
      const image = clipboard.readImage();
      const png = image.isEmpty() ? undefined : image.toPNG();
      if (png && png.length > 20 * 1024 * 1024)
        throw new Error("The clipboard image exceeds the 20 MB limit.");
      return { text, html, ...(png ? { png: new Uint8Array(png) } : {}) };
    },
    { editorOnly: true },
  );
  ipc("scislide:save-document", (editor, value) => {
    const request = validateSaveDocument(value);
    return withFileOperation(editor, async () => {
      let destination = editor.documentPath;
      if (!destination || request.saveAs) {
        const result = await dialog.showSaveDialog(editor.window, {
          title: "Save SciSlide document",
          defaultPath: destination || request.suggestedName,
          filters: [{ name: "SciSlide document", extensions: ["scislide"] }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        });
        if (result.canceled || !result.filePath) return null;
        destination = await chosenDestination(
          editor,
          result.filePath,
          "scislide",
        );
        if (!destination) return null;
      }
      destination = await fs.realpath(destination).catch(() => destination);
      const owner = editorForPath(destination);
      if (owner && owner !== editor)
        throw new Error(
          "This file is open in another SciSlide window. Save there or choose a different filename.",
        );
      editor.savingPath = destination;
      try {
        await writeAtomically(destination, request.bytes);
        setDocumentPath(editor, destination);
        return { path: destination, name: path.basename(destination) };
      } finally {
        editor.savingPath = null;
      }
    });
  });
  ipc(
    "scislide:clear-document",
    (editor) =>
      withFileOperation(editor, () => {
        setDocumentPath(editor, null);
        editor.openCandidates.clear();
      }),
    { editorOnly: true },
  );
  ipc("scislide:save-export", (editor, value) => {
    const request = validateSaveExport(value);
    return withFileOperation(editor, async () => {
      const result = await dialog.showSaveDialog(editor.window, {
        title:
          request.kind === "json"
            ? "Export equation library"
            : request.kind === "pptx"
              ? "Export PowerPoint"
              : `Export ${request.kind.toUpperCase()}`,
        defaultPath: request.suggestedName,
        filters: [
          {
            name:
              request.kind === "pptx"
                ? "PowerPoint"
                : request.kind.toUpperCase(),
            extensions: [request.kind],
          },
        ],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return null;
      const destination = await chosenDestination(
        editor,
        result.filePath,
        request.kind,
      );
      if (!destination) return null;
      await writeAtomically(destination, request.bytes);
      return { path: destination, name: path.basename(destination) };
    });
  });
  ipc("scislide:detect-tex", () => detectInstalledTex());
  ipc("scislide:choose-tex-directory", async (editor) => {
    const result = await dialog.showOpenDialog(editor.window, {
      title: "Choose the folder containing latex or xelatex",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const binDirectory = result.filePaths[0];
    const capabilities = await detectInstalledTex(binDirectory);
    if (
      !capabilities.engines.some(
        ({ id }) => path.dirname(capabilities.paths[id] || "") === binDirectory,
      )
    ) {
      // Restore detection for the previously saved choice after an invalid selection.
      await detectInstalledTex();
      throw new Error(
        "No working latex or xelatex executable was found in this folder.",
      );
    }
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    await writeAtomically(
      path.join(app.getPath("userData"), "tex-path.json"),
      JSON.stringify({ binDirectory }),
    );
    return capabilities;
  });
  ipc("scislide:compile-tex", async (editor, value) => {
    const request = validateCompile(value);
    if (runningJobs.has(request.jobId))
      throw new Error("That equation job is already running.");
    if (runningJobs.size >= 2)
      throw new Error(
        "Two equations are already compiling. Wait or cancel one.",
      );
    runningJobs.set(request.jobId, editor);
    try {
      const module = await compiler();
      if (editor.window.isDestroyed())
        throw new Error("This editor was closed.");
      return await module.compileTex(request);
    } finally {
      runningJobs.delete(request.jobId);
    }
  });
  ipc("scislide:cancel-compile", async (editor, value) => {
    const jobId = validateJobId(value);
    if (runningJobs.get(jobId) === editor)
      await (await compiler()).cancelCompile(jobId);
  });
  ipc("scislide:detect-ai", async () => (await aiHost()).detectAi());
  ipc("scislide:generate-ai", async (editor, value) => {
    const module = await aiHost();
    if (editor.window.isDestroyed()) throw new Error("This editor was closed.");
    editor.ai ||= module.createAiHost();
    return editor.ai.generateAi(value);
  });
  ipc("scislide:cancel-ai", async (editor, value) => {
    const module = await aiHost();
    module.validateAiJobId(value);
    if (editor.ai) await editor.ai.cancelAi(value);
  });
}

function sendCommand(command) {
  const editor = getFocusedEditor();
  if (
    !COMMANDS.has(command) ||
    !editor ||
    editor.window.isDestroyed() ||
    !isMenuCommandEnabled(Menu.getApplicationMenu(), command)
  )
    return;
  const contents = editor.window.webContents;
  if (!isTrustedPage(contents.getURL(), devUrl)) return;
  void dispatchMenuCommand(contents, command);
}

function installMenu() {
  const template = buildMenuTemplate(process.platform, sendCommand, {
    development: Boolean(devUrl),
    onAbout: () =>
      dialog.showMessageBox(getFocusedEditor()?.window, {
        type: "info",
        title: "SciSlide",
        message: "SciSlide",
        detail: `Scientific Presentation Editor\nVersion ${app.getVersion()}\nMathJax and local LaTeX equation editing`,
      }),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function configureSession() {
  const desktopSession = session.defaultSession;
  const permitFullscreen = (contents, permission, details) =>
    Boolean(
      editorWindows.has(contents) &&
      !editorWindows.get(contents).window.isDestroyed() &&
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
        "Content-Security-Policy": [
          pdfResourcePolicy(details.url, csp, devUrl),
        ],
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
          "Content-Security-Policy": pdfResourcePolicy(
            request.url,
            csp,
            devUrl,
          ),
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

async function createMainWindow(selectedPath = null) {
  const workspaceId =
    !selectedPath &&
    ![...editorWindows.values()].some((editor) => editor.workspaceId === "main")
      ? "main"
      : randomUUID();
  const window = new BrowserWindow({
    title: "SciSlide",
    width: 1440,
    height: 900,
    minWidth: 620,
    minHeight: 550,
    show: false,
    backgroundColor: "#f3f5f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [`--scislide-workspace=${workspaceId}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  const editor = {
    window,
    workspaceId,
    documentPath: null,
    pendingDocuments: selectedPath ? [selectedPath] : [],
    openingPath: null,
    savingPath: null,
    openCandidates: new Set(),
    fileOperations: Promise.resolve(),
    closeConfirmationEnabled: false,
    closeRequested: false,
    closeApproved: false,
    commandAvailability: {},
    ai: null,
  };
  const contents = window.webContents;
  editorWindows.set(contents, editor);
  focusedEditor = editor;
  window.on("focus", () => {
    focusedEditor = editor;
    syncEditorMenu(editor);
  });
  protectTextComposition(window.webContents);
  window.webContents.setWindowOpenHandler(({ url }) => {
    const role = presentationWindowRole(url, devUrl);
    if (!role) return { action: "deny" };
    const audience = role === "audience" ? getAudienceDisplay(window) : null;
    if (role === "audience" && !audience) return { action: "deny" };
    const macAudience = Boolean(audience && process.platform === "darwin");
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        ...(audience
          ? {
              ...audience.bounds,
              title: "SciSlide · Slide show",
              backgroundColor: "#000000",
              frame: false,
              fullscreen: !macAudience,
              show: false,
            }
          : {
              title: "SciSlide · Presenter display",
              width: 1100,
              height: 800,
              minWidth: 620,
              minHeight: 550,
            }),
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false,
          ...(macAudience
            ? {
                // Video and slide fullscreen stay inside the audience window.
                disableHtmlFullscreenWindowResize: true,
                focusOnNavigation: false,
              }
            : {}),
        },
      },
    };
  });
  window.webContents.on("did-create-window", (child, details) => {
    child.setMenu(null);
    child.webContents.setWindowOpenHandler(() => ({
      action: "deny",
    }));
    // window.open dispatches its first navigation after did-create-window.
    let initialNavigation = true;
    const guardNavigation = (event) => {
      if (!initialNavigation || !event.isMainFrame || event.url !== details.url)
        event.preventDefault();
    };
    child.webContents.once("did-navigate", () => {
      initialNavigation = false;
    });
    child.webContents.on("will-frame-navigate", guardNavigation);
    child.webContents.on("will-navigate", guardNavigation);
    child.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    const closeChild = () => {
      if (!child.isDestroyed()) child.close();
    };
    window.once("closed", closeChild);
    child.once("closed", () => window.removeListener("closed", closeChild));
    if (presentationWindowRole(details.url, devUrl) !== "audience") return;

    const { x, y } = details.options;
    const target = screen
      .getAllDisplays()
      .find((display) => display.bounds.x === x && display.bounds.y === y);
    const presenter = screen.getDisplayMatching(window.getBounds());
    if (!target || target.id === presenter.id) {
      closeChild();
      return;
    }
    const checkDisplays = () => {
      const displays = screen.getAllDisplays();
      const source = displays.find((display) => display.id === presenter.id);
      const audience = displays.find((display) => display.id === target.id);
      if (
        !source ||
        !audience ||
        (source.bounds.x === audience.bounds.x &&
          source.bounds.y === audience.bounds.y)
      ) {
        closeChild();
        return;
      }
      return audience;
    };
    screen.on("display-removed", checkDisplays);
    screen.on("display-metrics-changed", checkDisplays);
    child.once("closed", () => {
      screen.removeListener("display-removed", checkDisplays);
      screen.removeListener("display-metrics-changed", checkDisplays);
    });
    const macAudience = process.platform === "darwin";
    if (macAudience) {
      child.on("close", () => {
        // Simple fullscreen changes app-wide menu and Dock visibility.
        if (child.isSimpleFullScreen()) child.setSimpleFullScreen(false);
      });
    }
    child.once("ready-to-show", () => {
      if (child.isDestroyed()) return;
      const display = checkDisplays();
      if (!display) return;
      if (macAudience) {
        // AppKit chooses the fullscreen frame from the window's current screen.
        // Give the inactive window an on-screen frame before entering fullscreen.
        child.setBounds(display.workArea);
      }
      child.showInactive();
      // Native Wayland compositors may not support showing an inactive window.
      if (!child.isVisible()) child.show();
      if (macAudience) {
        if (screen.getDisplayMatching(child.getBounds()).id !== display.id) {
          closeChild();
          return;
        }
        child.setSimpleFullScreen(true);
      }
    });
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (!editor.closeConfirmationEnabled || editor.closeApproved) return;
    event.preventDefault();
    editor.closeRequested = true;
    window.webContents.send("scislide:close-document-requested");
  });
  window.on("closed", () => {
    // Electron has already destroyed the BrowserWindow by the closed event.
    editorWindows.delete(contents);
    if (focusedEditor === editor)
      focusedEditor = [...editorWindows.values()].at(-1) || null;
    syncEditorMenu();
    const cleanup = Promise.allSettled([
      ...(editor.ai ? [editor.ai.cancelAllAi()] : []),
      ...[...runningJobs]
        .filter(([, owner]) => owner === editor)
        .map(([jobId]) =>
          compiler().then((module) => module.cancelCompile(jobId)),
        ),
    ]);
    closingJobs.add(cleanup);
    cleanup.finally(() => closingJobs.delete(cleanup));
  });
  try {
    await window.loadURL(appUrl);
    return editor;
  } catch (error) {
    editor.closeApproved = true;
    window.close();
    throw error;
  }
}

const cliArguments = (process.argv ?? []).slice(app.isPackaged ? 1 : 2);
const updateCommand =
  cliArguments.some((argument) =>
    [
      "--update",
      "--check-update",
      "--help",
      "-h",
      "--version",
      "--cli",
    ].includes(argument),
  ) ||
  [
    "schema",
    "create",
    "inspect",
    "validate",
    "apply",
    "unpack",
    "pack",
    "export",
  ].includes(cliArguments[0]);
if (updateCommand) {
  // CLI commands run independently of an open editor and never create a window.
  const cliEntry = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "scislide-cli",
        "desktop",
        "update-cli.mjs",
      )
    : path.join(__dirname, "update-cli.mjs");
  import(pathToFileURL(cliEntry).href)
    .then(({ runCli }) =>
      runCli(cliArguments, {
        currentVersion: app.getVersion(),
        defaultDestination: path.join(
          app.getPath("downloads"),
          "SciSlide-updates",
        ),
      }),
    )
    .then((code) => app.exit(code))
    .catch((error) => {
      console.error(`SciSlide CLI failed: ${error.message || error}`);
      app.exit(1);
    });
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Finder can deliver this event before ready, IPC registration, or the editor mounts.
  app.on("open-file", (event, filename) => {
    event.preventDefault();
    queueDocuments([filename]);
    if (desktopInitialized) void openQueuedDocuments().catch(console.error);
  });
  queueDocuments(cliArguments);
  app.on("second-instance", (_event, arguments_, workingDirectory) => {
    queueDocuments(arguments_.slice(app.isPackaged ? 1 : 2), workingDirectory);
    if (desktopInitialized)
      void openQueuedDocuments(true)
        .then(() => {
          if (
            !arguments_
              .slice(app.isPackaged ? 1 : 2)
              .some(
                (value) =>
                  typeof value === "string" &&
                  /\.(?:scislide|pptx)$/i.test(value),
              )
          )
            return focusEditor();
        })
        .catch(console.error);
  });
  app
    .whenReady()
    .then(async () => {
      await configureSession();
      registerIpc();
      installMenu();
      desktopInitialized = true;
      await openQueuedDocuments(true);
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
    if (!editorWindows.size)
      createMainWindow().catch((error) => console.error(error));
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (quittingAfterCleanup) {
      // A later Quit must still clean up jobs if a renderer cancels this attempt.
      quittingAfterCleanup = false;
      return;
    }
    if (!aiModule && !runningJobs.size && !closingJobs.size) return;
    event.preventDefault();
    if (quitCleanup) return;
    quitCleanup = Promise.allSettled([
      ...(aiModule ? [aiModule.then((module) => module.cancelAllAi())] : []),
      ...[...editorWindows.values()]
        .filter((editor) => editor.ai)
        .map((editor) => editor.ai.cancelAllAi()),
      ...closingJobs,
      ...(runningJobs.size
        ? [
            compiler().then((module) =>
              Promise.allSettled(
                Array.from(runningJobs.keys(), (jobId) =>
                  module.cancelCompile(jobId),
                ),
              ),
            ),
          ]
        : []),
    ]).finally(() => {
      quitCleanup = null;
      quittingAfterCleanup = true;
      app.quit();
    });
  });
}
