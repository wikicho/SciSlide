import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  { platform = "linux", launch = [], packaged = true } = {},
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "scislide-file-open-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = new EventEmitter();
  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
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
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.focused = 0;
      this.restored = 0;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: "scislide://app/" },
        getURL: () => "scislide://app/",
        setWindowOpenHandler() {},
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
    focus() {
      this.focused++;
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
    async loadURL() {}
  }
  const handlers = new Map();
  const saveDialogs = [];
  const openDialogs = [];
  const saveResults = [];
  const openResults = [];
  const clipboardState = { text: "", html: "", png: null };
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
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: {
      defaultSession: Object.assign(new EventEmitter(), {
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
      }),
    },
    Menu: {
      setApplicationMenu() {},
      buildFromTemplate: (template) => template,
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
  vm.runInNewContext(
    mainSource,
    {
      require: (name) => (name === "electron" ? electron : require(name)),
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
    },
    { filename: mainFile },
  );
  return {
    app,
    windows,
    directory,
    saveDialogs,
    openDialogs,
    saveResults,
    openResults,
    clipboardState,
    start: async () => {
      ready();
      await flush();
    },
    invoke: (channel, args = [], frameUrl = "scislide://app/") => {
      const sender = windows.at(-1).webContents;
      sender.mainFrame.url = frameUrl;
      return handlers.get(channel)(
        { sender, senderFrame: sender.mainFrame },
        ...args,
      );
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

test("reading an unaccepted document preserves the current Save destination", async (t) => {
  const desktop = await host(t, { launch: ["A.scislide", "B.scislide"] });
  const originalA = Buffer.from([0x50, 0x4b, 3, 4]);
  const originalB = Buffer.from([0x50, 0x4b, 5, 6]);
  const fileA = await desktop.file("A.scislide", originalA);
  const fileB = await desktop.file("B.scislide", originalB);
  await desktop.start();
  const first = await desktop.invoke("scislide:take-open-document");
  await desktop.invoke("scislide:accept-open-document", [first.path]);
  await desktop.invoke("scislide:take-open-document");
  const bytes = new Uint8Array([0x50, 0x4b, 7, 8]);
  await desktop.invoke("scislide:save-document", [
    { bytes, suggestedName: "A.scislide" },
  ]);
  assert.deepEqual(await readFile(fileA), Buffer.from(bytes));
  assert.deepEqual(await readFile(fileB), originalB);
  await desktop.invoke("scislide:accept-open-document", [fileB]);
  await desktop.invoke("scislide:save-document", [
    { bytes, suggestedName: "B.scislide" },
  ]);
  assert.deepEqual(await readFile(fileB), Buffer.from(bytes));
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

test("the file picker reads a candidate without changing the Save destination", async (t) => {
  const desktop = await host(t);
  const candidate = await desktop.file("candidate.scislide");
  await desktop.start();
  desktop.openResults.push({ canceled: false, filePaths: [candidate] });
  const opened = await desktop.invoke("scislide:open-document");
  assert.equal(opened.path, candidate);
  const request = {
    bytes: new Uint8Array([0x50, 0x4b, 5, 6]),
    suggestedName: "New.scislide",
  };
  assert.equal(await desktop.invoke("scislide:save-document", [request]), null);
  assert.equal(desktop.saveDialogs.length, 1);
  await desktop.invoke("scislide:accept-open-document", [candidate]);
  assert.equal(
    (await desktop.invoke("scislide:save-document", [request])).path,
    candidate,
  );
});

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

test("a second instance resolves file paths against its own cwd, focuses the editor, and retains multiple documents", async (t) => {
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
  await flush();
  assert.equal(desktop.windows.length, 1);
  assert.equal(desktop.windows[0].restored, 1);
  assert.equal(desktop.windows[0].focused, 1);
  assert.ok(
    desktop.windows[0].messages.some(
      ([channel]) => channel === "scislide:document-requested",
    ),
  );
  assert.equal(
    (await desktop.invoke("scislide:take-open-document")).path,
    first,
  );
  assert.equal(
    (await desktop.invoke("scislide:take-open-document")).path,
    second,
  );
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
  await flush();
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
  assert.throws(
    () =>
      desktop.invoke(
        "scislide:take-open-document",
        [],
        "scislide://app/#presenter",
      ),
    /main editor/,
  );
  await assert.rejects(
    desktop.invoke("scislide:take-open-document"),
    /archive/,
  );
  assert.equal(
    (await desktop.invoke("scislide:take-open-document")).path,
    good,
  );
  assert.equal(await desktop.invoke("scislide:take-open-document"), null);
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
