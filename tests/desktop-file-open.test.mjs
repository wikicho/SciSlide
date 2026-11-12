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
    async loadURL() {}
  }
  const handlers = new Map();
  const electron = {
    app,
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
    dialog: { showErrorBox: (...args) => assert.fail(args.join(": ")) },
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
  const bytes = new Uint8Array([0x50, 0x4b, 5, 6]);
  await desktop.invoke("scislide:save-document", [
    { bytes, suggestedName: "Renamed.scislide" },
  ]);
  assert.deepEqual(await readFile(filename), Buffer.from(bytes));
  assert.equal(await desktop.invoke("scislide:take-open-document"), null);
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
