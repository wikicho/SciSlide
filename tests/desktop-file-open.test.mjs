import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import test from "node:test";

const mainFile = fileURLToPath(new URL("../desktop/main.cjs", import.meta.url));
const mainSource = await readFile(mainFile, "utf8");
const require = createRequire(mainFile);
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise(setImmediate);
};

async function host(
  t,
  { platform = "linux", launch = [], packaged = true, fsOverrides = {} } = {},
) {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "scislide-file-open-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = new EventEmitter();
  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
  });
  let menuInstalled;
  const menuInstalledPromise = new Promise((resolve) => {
    menuInstalled = resolve;
  });
  Object.assign(app, {
    isPackaged: packaged,
    setName() {},
    enableSandbox() {},
    requestSingleInstanceLock: () => true,
    whenReady: () => readyPromise,
    getVersion: () => "0.6.4",
    getPath: () => directory,
    quit() {},
  });
  const windows = [];
  const screen = Object.assign(new EventEmitter(), {
    displays: [
      {
        id: 1,
        internal: true,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      },
    ],
    getAllDisplays() {
      return this.displays;
    },
    getDisplayMatching(rect) {
      return (
        this.displays.find(
          ({ bounds }) =>
            rect.x >= bounds.x &&
            rect.x < bounds.x + bounds.width &&
            rect.y >= bounds.y &&
            rect.y < bounds.y + bounds.height,
        ) ?? this.displays[0]
      );
    },
  });
  let focusedWindow;
  class BrowserWindow extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.bounds = { x: 0, y: 0, width: 900, height: 700 };
      this.destroyed = false;
      this.focused = 0;
      this.restored = 0;
      this.loadedUrl = "scislide://app/";
      this.webContents = Object.assign(new EventEmitter(), {
        id: windows.length + 1,
        mainFrame: { url: "scislide://app/" },
        getURL: () => this.loadedUrl,
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler: (handler) => {
          this.windowOpenHandler = handler;
        },
        setIgnoreMenuShortcuts() {},
        executeJavaScript: async () => false,
        send: (...args) => {
          this.messages.push(args);
        },
      });
      this.messages = [];
      windows.push(this);
    }
    static getAllWindows() {
      return windows.filter((window) => !window.destroyed);
    }
    static getFocusedWindow() {
      return focusedWindow?.destroyed ? null : focusedWindow;
    }
    static fromWebContents(contents) {
      return windows.find((window) => window.webContents === contents) ?? null;
    }
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return true;
    }
    restore() {
      this.restored++;
    }
    show() {}
    showInactive() {
      this.shownInactive = true;
    }
    isVisible() {
      return Boolean(this.shownInactive);
    }
    getBounds() {
      return this.bounds;
    }
    focus() {
      this.focused++;
      focusedWindow = this;
      this.emit("focus");
    }
    isFocused() {
      return focusedWindow === this;
    }
    setMenu(menu) {
      this.menu = menu;
    }
    setTitle(title) {
      this.title = title;
    }
    close() {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      this.emit("close", event);
      if (!event.prevented) {
        this.destroyed = true;
        this.emit("closed");
      }
    }
    async loadURL(url) {
      this.loadedUrl = url;
      this.webContents.mainFrame.url = url;
      focusedWindow = this;
      this.emit("focus");
      this.emit("ready-to-show");
    }
  }
  const handlers = new Map();
  const saveDialogs = [];
  const openDialogs = [];
  const saveResults = [];
  const openResults = [];
  const clipboardState = { text: "", html: "", png: null };
  let menu;
  const findMenuItem = (items, id) => {
    for (const item of items) {
      if (item.id === id) return item;
      const found = findMenuItem(item.submenu?.items ?? item.submenu ?? [], id);
      if (found) return found;
    }
    return undefined;
  };
  const electron = {
    app,
    clipboard: {
      write: (value) => Object.assign(clipboardState, value),
      readText: () => clipboardState.text,
      readHTML: () => clipboardState.html,
      readImage: () => ({
        isEmpty: () => !clipboardState.png,
        toPNG: () => clipboardState.png,
      }),
    },
    BrowserWindow,
    screen,
    ipcMain: Object.assign(new EventEmitter(), {
      handle: (channel, handler) => handlers.set(channel, handler),
    }),
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: {
      defaultSession: Object.assign(new EventEmitter(), {
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
      }),
    },
    Menu: {
      setApplicationMenu(value) {
        menu = value;
        menuInstalled();
      },
      getApplicationMenu: () => menu,
      buildFromTemplate: (items) => ({
        items,
        getMenuItemById: (id) => findMenuItem(items, id),
      }),
    },
    dialog: {
      showErrorBox: (...args) => assert.fail(args.join(": ")),
      showSaveDialog: async (_window, options) => {
        saveDialogs.push(options);
        return saveResults.shift() ?? { canceled: true };
      },
      showOpenDialog: async (_window, options) => {
        openDialogs.push(options);
        return openResults.shift() ?? { canceled: true };
      },
    },
  };
  const context = vm.createContext({
    require: (name) =>
      name === "electron"
        ? electron
        : name === "node:fs/promises"
          ? { ...require(name), ...fsOverrides }
          : require(name),
    __dirname: path.dirname(mainFile),
    console,
    URL,
    Response,
    Buffer,
    Uint8Array,
    process: {
      argv: ["scislide", ...(packaged ? [] : ["."]), ...launch],
      platform,
      cwd: () => directory,
      env: {},
    },
  });
  vm.runInContext(mainSource, context, { filename: mainFile });
  const invokeFor = (
    window,
    channel,
    args = [],
    frameUrl = "scislide://app/",
  ) => {
    const sender = window.webContents;
    sender.mainFrame.url = frameUrl;
    return handlers.get(channel)(
      { sender, senderFrame: sender.mainFrame },
      ...args,
    );
  };
  return {
    app,
    windows,
    directory,
    saveDialogs,
    openDialogs,
    saveResults,
    openResults,
    clipboardState,
    BrowserWindow,
    screen,
    hasAudienceDisplay: (window) => {
      const event = {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      };
      electron.ipcMain.emit("scislide:has-audience-display", event);
      return event.returnValue;
    },
    menuItem: (id) => menu?.getMenuItemById(id),
    invokeFor,
    injectModules: ({ tex, ai }) => {
      if (tex) {
        context.testTex = tex;
        vm.runInContext("texModule = Promise.resolve(testTex);", context);
      }
      if (ai) {
        context.testAi = ai;
        vm.runInContext("aiModule = Promise.resolve(testAi);", context);
      }
    },
    waitForDocumentOpens: () => vm.runInContext("launchOperations", context),
    start: async () => {
      ready();
      await menuInstalledPromise;
      await vm.runInContext("launchOperations", context);
    },
    invoke: (channel, args = [], frameUrl = "scislide://app/") => {
      return invokeFor(windows.at(-1), channel, args, frameUrl);
    },
    file: async (name, bytes = Buffer.from([0x50, 0x4b, 3, 4])) => {
      const filename = path.join(directory, name);
      await writeFile(filename, bytes);
      return filename;
    },
  };
}

test("a cold Linux launch opens a relative document after the renderer is ready and Save uses that path", async (t) => {
  const desktop = await host(t, {
    launch: ["--no-sandbox", "한글 deck.scislide"],
  });
  const filename = await desktop.file("한글 deck.scislide");
  assert.equal(desktop.windows.length, 0);
  await desktop.start();
  const result = await desktop.invoke("scislide:take-open-document");
  assert.equal(result.path, filename);
  assert.equal(result.name, "한글 deck.scislide");
  assert.deepEqual([...result.bytes], [0x50, 0x4b, 3, 4]);
  await desktop.invoke("scislide:accept-open-document", [result.path]);
  const bytes = new Uint8Array([0x50, 0x4b, 5, 6]);
  await desktop.invoke("scislide:save-document", [
    { bytes, suggestedName: "Renamed.scislide" },
  ]);
  assert.deepEqual(await readFile(filename), Buffer.from(bytes));
  assert.equal(await desktop.invoke("scislide:take-open-document"), null);
});

test("multiple launch documents have independent candidates and Save destinations", async (t) => {
  const desktop = await host(t, {
    launch: ["A.scislide", "A.scislide", "B.scislide"],
  });
  const originalA = Buffer.from([0x50, 0x4b, 3, 4]);
  const originalB = Buffer.from([0x50, 0x4b, 5, 6]);
  const fileA = await desktop.file("A.scislide", originalA);
  const fileB = await desktop.file("B.scislide", originalB);
  await desktop.start();
  assert.equal(desktop.windows.length, 2);
  const [windowA, windowB] = desktop.windows;
  const first = await desktop.invokeFor(windowA, "scislide:take-open-document");
  const second = await desktop.invokeFor(
    windowB,
    "scislide:take-open-document",
  );
  assert.equal(first.path, fileA);
  assert.equal(second.path, fileB);
  await assert.rejects(
    desktop.invokeFor(windowA, "scislide:accept-open-document", [fileB]),
    /Only a document read/,
  );
  await desktop.invokeFor(windowA, "scislide:accept-open-document", [
    first.path,
  ]);
  const bytesA = new Uint8Array([0x50, 0x4b, 7, 8]);
  await desktop.invokeFor(windowA, "scislide:save-document", [
    { bytes: bytesA, suggestedName: "A.scislide" },
  ]);
  assert.deepEqual(await readFile(fileA), Buffer.from(bytesA));
  assert.deepEqual(await readFile(fileB), originalB);
  await desktop.invokeFor(windowB, "scislide:accept-open-document", [
    second.path,
  ]);
  const bytesB = new Uint8Array([0x50, 0x4b, 9, 10]);
  await desktop.invokeFor(windowB, "scislide:save-document", [
    { bytes: bytesB, suggestedName: "B.scislide" },
  ]);
  assert.deepEqual(await readFile(fileB), Buffer.from(bytesB));
  assert.deepEqual(await readFile(fileA), Buffer.from(bytesA));
  assert.equal(
    await desktop.invokeFor(windowA, "scislide:take-open-document"),
    null,
  );
  assert.equal(
    await desktop.invokeFor(windowB, "scislide:take-open-document"),
    null,
  );
});

test("only read candidates can become the Save destination and clearing a document invalidates them", async (t) => {
  const desktop = await host(t, { launch: ["candidate.scislide"] });
  const candidate = await desktop.file("candidate.scislide");
  const unrelated = await desktop.file("unrelated.scislide");
  await desktop.start();
  await assert.rejects(
    desktop.invoke("scislide:accept-open-document", [unrelated]),
    /Only a document read/,
  );
  await desktop.invoke("scislide:take-open-document");
  await desktop.invoke("scislide:clear-document");
  await assert.rejects(
    desktop.invoke("scislide:accept-open-document", [candidate]),
    /Only a document read/,
  );
  const result = await desktop.invoke("scislide:save-document", [
    {
      bytes: new Uint8Array([0x50, 0x4b, 3, 4]),
      suggestedName: "New.scislide",
    },
  ]);
  assert.equal(result, null);
  assert.equal(desktop.saveDialogs.length, 1);
});

test("the multi-file picker opens separate editors and preserves the caller's Save destination", async (t) => {
  const desktop = await host(t, { launch: ["current.scislide"] });
  const current = await desktop.file("current.scislide");
  const candidate = await desktop.file("candidate.scislide");
  const other = await desktop.file("other.scislide");
  await desktop.start();
  const caller = desktop.windows[0];
  await desktop.invoke("scislide:take-open-document");
  await desktop.invoke("scislide:accept-open-document", [current]);
  desktop.openResults.push({ canceled: false, filePaths: [candidate, other] });
  const opened = await desktop.invoke("scislide:open-document");
  assert.equal(opened, null);
  assert.equal(desktop.windows.length, 3);
  assert.ok(desktop.openDialogs[0].properties.includes("multiSelections"));
  assert.equal(
    (await desktop.invokeFor(desktop.windows[1], "scislide:take-open-document"))
      .path,
    candidate,
  );
  assert.equal(
    (await desktop.invokeFor(desktop.windows[2], "scislide:take-open-document"))
      .path,
    other,
  );
  const request = {
    bytes: new Uint8Array([0x50, 0x4b, 5, 6]),
    suggestedName: "current.scislide",
  };
  assert.equal(
    (await desktop.invokeFor(caller, "scislide:save-document", [request])).path,
    current,
  );
  assert.deepEqual(await readFile(current), Buffer.from(request.bytes));
  assert.deepEqual(await readFile(candidate), Buffer.from([0x50, 0x4b, 3, 4]));
  assert.equal(desktop.saveDialogs.length, 0);
});

test("the native picker opens PowerPoint without making its source a Save destination", async (t) => {
  const desktop = await host(t);
  const source = await desktop.file("Research.PPTX");
  const destination = path.join(desktop.directory, "Research.scislide");
  await desktop.start();
  desktop.openResults.push({ canceled: false, filePaths: [source] });
  await desktop.invoke("scislide:open-document");
  assert.ok(desktop.openDialogs[0].filters[0].extensions.includes("pptx"));
  assert.equal(desktop.windows.length, 2);

  const opened = await desktop.invoke("scislide:take-open-document");
  assert.equal(opened.path, source);
  assert.equal(opened.name, "Research.PPTX");
  await assert.rejects(
    desktop.invoke("scislide:accept-open-document", [source]),
    /Only a document read by this editor/,
  );
  const bytes = new Uint8Array([0x50, 0x4b, 5, 6]);
  desktop.saveResults.push({ canceled: false, filePath: destination });
  const saved = await desktop.invoke("scislide:save-document", [
    { bytes, suggestedName: "Research.scislide" },
  ]);
  assert.equal(saved.path, destination);
  assert.deepEqual(await readFile(destination), Buffer.from(bytes));
  assert.deepEqual(await readFile(source), Buffer.from([0x50, 0x4b, 3, 4]));
});

test(
  "simultaneous Save As requests reserve the destination for exactly one editor",
  { timeout: 5_000 },
  async (t) => {
    const fs = require("node:fs/promises");
    let releaseWrite;
    let enteredWrite;
    const blocked = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    const started = new Promise((resolve) => {
      enteredWrite = resolve;
    });
    let intercepted = false;
    const desktop = await host(t, {
      launch: ["A.scislide", "B.scislide"],
      fsOverrides: {
        async open(filename, flags, ...args) {
          if (flags === "wx" && !intercepted) {
            intercepted = true;
            enteredWrite();
            await blocked;
          }
          return fs.open(filename, flags, ...args);
        },
      },
    });
    await desktop.file("A.scislide");
    await desktop.file("B.scislide");
    await desktop.start();
    const destination = path.join(desktop.directory, "shared-new.scislide");
    desktop.saveResults.push(
      { canceled: false, filePath: destination },
      { canceled: false, filePath: destination },
    );
    const [windowA, windowB] = desktop.windows;
    const bytesA = new Uint8Array([0x50, 0x4b, 10, 11]);
    const bytesB = new Uint8Array([0x50, 0x4b, 20, 21]);
    const first = desktop.invokeFor(windowA, "scislide:save-document", [
      {
        bytes: bytesA,
        suggestedName: "shared-new.scislide",
        saveAs: true,
      },
    ]);
    await started;
    const second = desktop.invokeFor(windowB, "scislide:save-document", [
      {
        bytes: bytesB,
        suggestedName: "shared-new.scislide",
        saveAs: true,
      },
    ]);
    try {
      await assert.rejects(second, /open in another SciSlide window/);
    } finally {
      releaseWrite();
    }
    assert.equal((await first).path, destination);
    assert.deepEqual(await readFile(destination), Buffer.from(bytesA));
  },
);

test(
  "a duplicate file event during an active read focuses the same editor",
  { timeout: 5_000 },
  async (t) => {
    const fs = require("node:fs/promises");
    let releaseRead;
    let enteredRead;
    const blocked = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const started = new Promise((resolve) => {
      enteredRead = resolve;
    });
    let intercepted = false;
    const desktop = await host(t, {
      launch: ["reading.scislide"],
      fsOverrides: {
        async open(filename, flags, ...args) {
          if (flags === "r" && !intercepted) {
            intercepted = true;
            enteredRead();
            await blocked;
          }
          return fs.open(filename, flags, ...args);
        },
      },
    });
    const filename = await desktop.file("reading.scislide");
    await desktop.start();
    const original = desktop.windows[0];
    const opening = desktop.invokeFor(original, "scislide:take-open-document");
    await started;
    try {
      desktop.app.emit("open-file", { preventDefault() {} }, filename);
      await desktop.waitForDocumentOpens();
      assert.equal(desktop.windows.length, 1);
      assert.ok(original.focused > 0);
    } finally {
      releaseRead();
    }
    assert.equal((await opening).path, filename);
    assert.equal(
      await desktop.invokeFor(original, "scislide:take-open-document"),
      null,
    );
  },
);

test("closing the editor waits for renderer confirmation and allows a later request after cancellation", async (t) => {
  const desktop = await host(t);
  await desktop.start();
  const window = desktop.windows[0];
  await desktop.invoke("scislide:watch-close-document", [true]);
  await desktop.invoke("scislide:confirm-close-document");
  assert.equal(window.destroyed, false);
  window.close();
  assert.equal(window.destroyed, false);
  assert.equal(window.messages.at(-1)[0], "scislide:close-document-requested");
  window.close();
  assert.equal(window.destroyed, false);
  assert.equal(
    window.messages.filter(
      ([channel]) => channel === "scislide:close-document-requested",
    ).length,
    2,
  );
  await desktop.invoke("scislide:confirm-close-document");
  assert.equal(window.destroyed, true);
});

test("close confirmation belongs to its editor and leaves other documents open", async (t) => {
  const desktop = await host(t, { launch: ["A.scislide", "B.scislide"] });
  await desktop.file("A.scislide");
  await desktop.file("B.scislide");
  await desktop.start();
  const [windowA, windowB] = desktop.windows;
  await desktop.invokeFor(windowA, "scislide:watch-close-document", [true]);
  await desktop.invokeFor(windowB, "scislide:watch-close-document", [true]);
  windowA.close();
  assert.equal(windowA.destroyed, false);
  assert.equal(
    windowB.messages.some(
      ([channel]) => channel === "scislide:close-document-requested",
    ),
    false,
  );
  await desktop.invokeFor(windowB, "scislide:confirm-close-document");
  assert.equal(windowA.destroyed, false);
  assert.equal(windowB.destroyed, false);
  await desktop.invokeFor(windowA, "scislide:confirm-close-document");
  assert.equal(windowA.destroyed, true);
  assert.equal(windowB.destroyed, false);
  assert.throws(
    () => desktop.invokeFor(windowA, "scislide:read-clipboard"),
    /main window/,
  );
  windowB.close();
  assert.equal(windowB.destroyed, false);
  await desktop.invokeFor(windowB, "scislide:confirm-close-document");
  assert.equal(windowB.destroyed, true);
});

test("native menu state and commands follow the focused editor", async (t) => {
  const desktop = await host(t, { launch: ["A.scislide", "B.scislide"] });
  await desktop.file("A.scislide");
  await desktop.file("B.scislide");
  await desktop.start();
  const [windowA, windowB] = desktop.windows;
  windowA.focus();
  await desktop.invokeFor(windowA, "scislide:set-command-availability", [
    { save: false },
  ]);
  await desktop.invokeFor(windowB, "scislide:set-command-availability", [
    { save: true },
  ]);
  assert.equal(desktop.menuItem("save").enabled, false);
  windowB.focus();
  assert.equal(desktop.menuItem("save").enabled, true);
  desktop.menuItem("save").click();
  await flush();
  assert.ok(
    windowB.messages.some(
      ([channel, command]) =>
        channel === "scislide:command" && command === "save",
    ),
  );
  assert.equal(
    windowA.messages.some(
      ([channel, command]) =>
        channel === "scislide:command" && command === "save",
    ),
    false,
  );
  await desktop.invokeFor(windowA, "scislide:set-command-availability", [
    { save: false },
  ]);
  assert.equal(desktop.menuItem("save").enabled, true);
  windowA.focus();
  assert.equal(desktop.menuItem("save").enabled, false);
  desktop.menuItem("save").click();
  await flush();
  assert.equal(
    windowA.messages.some(
      ([channel, command]) =>
        channel === "scislide:command" && command === "save",
    ),
    false,
  );
});

test("presenter windows stay attached to their owning editor and cannot use editor IPC", async (t) => {
  const desktop = await host(t, { launch: ["A.scislide", "B.scislide"] });
  await desktop.file("A.scislide");
  await desktop.file("B.scislide");
  await desktop.start();
  const [windowA, windowB] = desktop.windows;
  const presenterA = new desktop.BrowserWindow();
  const presenterB = new desktop.BrowserWindow();
  const url = "scislide://app/#presenter=9b244a24-6546-491a-a341-fbe6e34c6052";
  windowA.webContents.emit("did-create-window", presenterA, { url });
  windowB.webContents.emit("did-create-window", presenterB, { url });
  assert.equal(presenterA.menu, null);
  assert.throws(
    () => desktop.invokeFor(presenterA, "scislide:read-clipboard"),
    /main window/,
  );
  windowA.close();
  assert.equal(presenterA.destroyed, true);
  assert.equal(windowB.destroyed, false);
  assert.equal(presenterB.destroyed, false);
  windowB.close();
  assert.equal(presenterB.destroyed, true);
});

test("audience windows open fullscreen on an extended display and close when it is unplugged", async (t) => {
  const desktop = await host(t);
  await desktop.start();
  const [editor] = desktop.windows;
  const url = "scislide://app/#audience=9b244a24-6546-491a-a341-fbe6e34c6052";
  const [builtin] = desktop.screen.displays;
  const external = {
    id: 2,
    internal: false,
    bounds: { x: -1920, y: -80, width: 1920, height: 1080 },
  };
  assert.equal(desktop.hasAudienceDisplay(editor), false);
  assert.equal(editor.windowOpenHandler({ url }).action, "deny");
  desktop.screen.displays = [builtin, { ...external, bounds: builtin.bounds }];
  assert.equal(desktop.hasAudienceDisplay(editor), false);
  assert.equal(editor.windowOpenHandler({ url }).action, "deny");

  desktop.screen.displays = [builtin, external];
  assert.equal(desktop.hasAudienceDisplay(editor), true);
  const result = editor.windowOpenHandler({ url });
  assert.equal(result.action, "allow");
  const options = result.overrideBrowserWindowOptions;
  const { x, y, width, height } = options;
  assert.deepEqual({ x, y, width, height }, external.bounds);
  assert.equal(options.fullscreen, true);
  assert.equal(options.frame, false);
  assert.equal(options.show, false);
  assert.equal(options.webPreferences.preload, undefined);
  assert.equal(editor.getBounds().x, 0);
  const audience = new desktop.BrowserWindow(options);
  editor.webContents.emit("did-create-window", audience, { url, options });
  audience.emit("ready-to-show");
  assert.equal(audience.shownInactive, true);
  assert.equal(audience.focused, 0);
  assert.equal(desktop.hasAudienceDisplay(audience), false);
  assert.throws(
    () => desktop.invokeFor(audience, "scislide:read-clipboard"),
    /main window/,
  );
  assert.equal(audience.windowOpenHandler({ url }).action, "deny");
  const canNavigate = (name, destination, isMainFrame) => {
    let allowed = true;
    audience.webContents.emit(name, {
      url: destination,
      isMainFrame,
      preventDefault() {
        allowed = false;
      },
    });
    return allowed;
  };
  for (const event of ["will-frame-navigate", "will-navigate"]) {
    assert.equal(canNavigate(event, url, true), true);
    assert.equal(canNavigate(event, url, false), false);
    assert.equal(canNavigate(event, "scislide://app/", true), false);
  }
  audience.webContents.emit("did-navigate");
  assert.equal(canNavigate("will-navigate", url, true), false);
  desktop.screen.emit("display-removed", {}, { id: 3 });
  assert.equal(audience.destroyed, false);
  desktop.screen.displays = [builtin];
  desktop.screen.emit("display-removed", {}, external);
  assert.equal(audience.destroyed, true);
  assert.equal(desktop.screen.listenerCount("display-removed"), 0);
  assert.equal(editor.destroyed, false);

  desktop.screen.displays = [builtin, external];
  editor.bounds = external.bounds;
  const reversed = editor.windowOpenHandler({
    url,
  }).overrideBrowserWindowOptions;
  assert.equal(reversed.x, builtin.bounds.x);
  assert.equal(reversed.y, builtin.bounds.y);
  const newAudience = () => {
    desktop.screen.displays = [builtin, external];
    const window = new desktop.BrowserWindow(reversed);
    editor.webContents.emit("did-create-window", window, {
      url,
      options: reversed,
    });
    return window;
  };
  const disconnected = newAudience();
  desktop.screen.displays = [builtin];
  desktop.screen.emit("display-removed", {}, external);
  assert.equal(disconnected.destroyed, true);
  const mirrored = newAudience();
  desktop.screen.displays = [builtin, { ...external, bounds: builtin.bounds }];
  desktop.screen.emit("display-metrics-changed", {}, external, ["bounds"]);
  assert.equal(mirrored.destroyed, true);
  assert.equal(desktop.screen.listenerCount("display-metrics-changed"), 0);
});

test("AI requests and close cleanup are isolated to the owning editor", async (t) => {
  const desktop = await host(t, { launch: ["A.scislide", "B.scislide"] });
  await desktop.file("A.scislide");
  await desktop.file("B.scislide");
  await desktop.start();
  const hosts = [];
  desktop.injectModules({
    ai: {
      createAiHost() {
        const state = {
          cancelled: [],
          closeCleanups: 0,
          generateAi: async (request) => ({ text: request.prompt }),
          cancelAi: async (id) => state.cancelled.push(id),
          cancelAllAi: async () => state.closeCleanups++,
        };
        hosts.push(state);
        return state;
      },
      validateAiJobId: (id) => id,
      cancelAllAi: async () => {},
    },
  });
  const [windowA, windowB] = desktop.windows;
  for (const window of [windowA, windowB])
    await desktop.invokeFor(window, "scislide:generate-ai", [
      {
        jobId: "same-renderer-id",
        provider: "codex",
        prompt: "Test",
        slideCount: 1,
      },
    ]);
  assert.equal(hosts.length, 2);
  await desktop.invokeFor(windowA, "scislide:cancel-ai", ["same-renderer-id"]);
  assert.deepEqual(hosts[0].cancelled, ["same-renderer-id"]);
  assert.deepEqual(hosts[1].cancelled, []);
  windowA.close();
  await flush();
  assert.equal(hosts[0].closeCleanups, 1);
  assert.equal(hosts[1].closeCleanups, 0);
  assert.equal(windowB.destroyed, false);
  windowB.close();
  await flush();
  assert.equal(hosts[1].closeCleanups, 1);
});

test("Local LaTeX cancellation and close cleanup cannot cancel another editor's job", async (t) => {
  const desktop = await host(t, { launch: ["A.scislide", "B.scislide"] });
  await desktop.file("A.scislide");
  await desktop.file("B.scislide");
  await desktop.start();
  const pending = new Map();
  const cancelled = [];
  desktop.injectModules({
    tex: {
      compileTex: ({ jobId }) =>
        new Promise((resolve) => pending.set(jobId, resolve)),
      cancelCompile: (jobId) => {
        cancelled.push(jobId);
        pending.get(jobId)?.({ cancelled: true });
      },
    },
  });
  const [windowA, windowB] = desktop.windows;
  const request = (jobId) => ({
    jobId,
    source: "x=1",
    preamble: "",
    engine: "latex",
    fontSize: 48,
    color: "#000000",
    displayMode: true,
  });
  const compilingA = desktop.invokeFor(windowA, "scislide:compile-tex", [
    request("window-a"),
  ]);
  const compilingB = desktop.invokeFor(windowB, "scislide:compile-tex", [
    request("window-b"),
  ]);
  await flush();
  await desktop.invokeFor(windowB, "scislide:cancel-compile", ["window-a"]);
  assert.deepEqual(cancelled, []);
  windowA.close();
  await flush();
  await compilingA;
  assert.deepEqual(cancelled, ["window-a"]);
  assert.equal(windowB.destroyed, false);
  await desktop.invokeFor(windowB, "scislide:cancel-compile", ["window-b"]);
  await compilingB;
  assert.deepEqual(cancelled, ["window-a", "window-b"]);
});

test("a second instance opens files in separate editors and focuses an already open document", async (t) => {
  const desktop = await host(t);
  const first = await desktop.file("First deck.scislide");
  const second = await desktop.file("SECOND.SCISLIDE");
  await desktop.start();
  desktop.app.emit(
    "second-instance",
    {},
    ["scislide", "First deck.scislide", pathToFileURL(second).href],
    desktop.directory,
  );
  await desktop.waitForDocumentOpens();
  assert.equal(desktop.windows.length, 3);
  const [original, firstWindow, secondWindow] = desktop.windows;
  assert.equal(
    await desktop.invokeFor(original, "scislide:take-open-document"),
    null,
  );
  const firstOpened = await desktop.invokeFor(
    firstWindow,
    "scislide:take-open-document",
  );
  const secondOpened = await desktop.invokeFor(
    secondWindow,
    "scislide:take-open-document",
  );
  assert.equal(firstOpened.path, first);
  assert.equal(secondOpened.path, second);
  await desktop.invokeFor(firstWindow, "scislide:accept-open-document", [
    first,
  ]);
  await desktop.invokeFor(secondWindow, "scislide:accept-open-document", [
    second,
  ]);
  desktop.app.emit(
    "second-instance",
    {},
    ["scislide", "First deck.scislide"],
    desktop.directory,
  );
  await desktop.waitForDocumentOpens();
  assert.equal(desktop.windows.length, 3);
  assert.ok(firstWindow.restored > 0);
  assert.ok(firstWindow.focused > 0);
});

test("Finder events survive cold startup and reopen a closed macOS editor", async (t) => {
  const desktop = await host(t, { platform: "darwin" });
  const first = await desktop.file("Finder.scislide");
  const event = {
    preventDefault() {
      this.prevented = true;
    },
  };
  desktop.app.emit("open-file", event, first);
  assert.equal(event.prevented, true);
  assert.equal(desktop.windows.length, 0);
  await desktop.start();
  assert.equal(
    (await desktop.invoke("scislide:take-open-document")).path,
    first,
  );
  const old = desktop.windows[0];
  old.destroyed = true;
  old.emit("closed");
  desktop.app.emit("open-file", event, first);
  await desktop.waitForDocumentOpens();
  assert.equal(desktop.windows.length, 2);
  assert.equal(
    (await desktop.invoke("scislide:take-open-document")).path,
    first,
  );
});

test("file arguments are filtered, documents remain validated, and presenter frames cannot consume requests", async (t) => {
  const desktop = await host(t, {
    packaged: false,
    launch: [
      "bad.txt",
      "--ignore.scislide",
      "file://%bad",
      "bad.scislide",
      "good.scislide",
    ],
  });
  await desktop.file("bad.scislide", Buffer.from("not a presentation"));
  const good = await desktop.file("good.scislide");
  await desktop.start();
  assert.equal(desktop.windows.length, 2);
  const [badWindow, goodWindow] = desktop.windows;
  assert.throws(
    () =>
      desktop.invokeFor(
        badWindow,
        "scislide:take-open-document",
        [],
        "scislide://app/#presenter",
      ),
    /main editor/,
  );
  await assert.rejects(
    desktop.invokeFor(badWindow, "scislide:take-open-document"),
    /archive/,
  );
  assert.equal(
    (await desktop.invokeFor(goodWindow, "scislide:take-open-document")).path,
    good,
  );
  assert.equal(
    await desktop.invokeFor(badWindow, "scislide:take-open-document"),
    null,
  );
  assert.equal(
    await desktop.invokeFor(goodWindow, "scislide:take-open-document"),
    null,
  );
});

test("the preload exposes only its assigned workspace and does not leak notification events", async () => {
  const source = await readFile(
    new URL("../desktop/preload.cjs", import.meta.url),
    "utf8",
  );
  for (const [argv, expected] of [
    [undefined, undefined],
    [[], undefined],
    [["electron", "--scislide-workspace-other=ignored"], undefined],
    [["electron", "--scislide-workspace=main"], "main"],
    [["electron", "--scislide-workspace=window-123"], "window-123"],
  ]) {
    const ipcRenderer = new EventEmitter();
    ipcRenderer.invoke = async () => null;
    let api;
    vm.runInNewContext(source, {
      require: () => ({
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld: (_name, value) => {
            api = value;
          },
        },
      }),
      process: { platform: "linux", ...(argv ? { argv } : {}) },
    });
    assert.equal(api.workspaceId, expected);
    assert.equal(api.argv, undefined);
    let received;
    const unsubscribe = api.onOpenDocument((...args) => {
      received = args;
    });
    ipcRenderer.emit("scislide:document-requested", { private: "IPC event" });
    assert.deepEqual(received, []);
    unsubscribe();
    assert.equal(ipcRenderer.listenerCount("scislide:document-requested"), 0);
  }
});

test("the preload forwards document notifications without exposing the IPC event", async () => {
  const ipcRenderer = new EventEmitter();
  const invokes = [];
  ipcRenderer.invoke = (...args) => {
    invokes.push(args);
    return Promise.resolve(null);
  };
  let api;
  vm.runInNewContext(
    await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    {
      require: () => ({
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld: (_name, value) => {
            api = value;
          },
        },
      }),
      process: { platform: "linux" },
    },
  );
  let received;
  const unsubscribe = api.onOpenDocument((...args) => {
    received = args;
  });
  ipcRenderer.emit("scislide:document-requested", { sender: "private" });
  assert.deepEqual(received, []);
  await api.takeOpenDocument();
  assert.deepEqual(invokes, [["scislide:take-open-document"]]);
  unsubscribe();
  assert.equal(ipcRenderer.listenerCount("scislide:document-requested"), 0);
});

test("the preload forwards validated document acceptance and close confirmation without IPC events", async () => {
  const ipcRenderer = new EventEmitter();
  const invokes = [];
  ipcRenderer.invoke = (...args) => {
    invokes.push(args);
    return Promise.resolve();
  };
  let api;
  vm.runInNewContext(
    await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"),
    {
      require: () => ({
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld: (_name, value) => {
            api = value;
          },
        },
      }),
      process: { platform: "linux" },
    },
  );
  let received;
  const unsubscribe = api.onCloseDocument((...args) => {
    received = args;
  });
  ipcRenderer.emit("scislide:close-document-requested", { private: true });
  assert.deepEqual(received, []);
  await api.acceptOpenDocument("/known.scislide");
  await api.confirmCloseDocument();
  unsubscribe();
  assert.equal(
    ipcRenderer.listenerCount("scislide:close-document-requested"),
    0,
  );
  assert.deepEqual(invokes, [
    ["scislide:watch-close-document", true],
    ["scislide:accept-open-document", "/known.scislide"],
    ["scislide:confirm-close-document"],
    ["scislide:watch-close-document", false],
  ]);
});

test("the desktop clipboard bridge restricts formats and returns fixed text, HTML, and PNG values", async (t) => {
  const desktop = await host(t);
  await desktop.start();
  await desktop.invoke("scislide:write-clipboard", [
    { text: "Equation x", html: "<span>x</span>" },
  ]);
  let result = await desktop.invoke("scislide:read-clipboard");
  assert.equal(result.text, "Equation x");
  assert.equal(result.html, "<span>x</span>");
  assert.equal(result.png, undefined);
  desktop.clipboardState.png = Buffer.from([137, 80, 78, 71]);
  result = await desktop.invoke("scislide:read-clipboard");
  assert.deepEqual([...result.png], [137, 80, 78, 71]);
  assert.throws(
    () =>
      desktop.invoke("scislide:write-clipboard", [
        { text: "x", html: "", format: "arbitrary" },
      ]),
    /Clipboard text/,
  );
  assert.throws(
    () => desktop.invoke("scislide:write-clipboard", [{ text: 1, html: "" }]),
    /Clipboard text/,
  );
  assert.throws(
    () =>
      desktop.invoke(
        "scislide:read-clipboard",
        [],
        "scislide://app/#presenter",
      ),
    /main editor/,
  );
});
