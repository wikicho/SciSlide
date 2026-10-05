const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const {
  buildMenuTemplate,
  dispatchMenuCommand,
  protectTextComposition,
} = require("./menu-commands.cjs");
const {
  parseDevUrl,
  isTrustedPage,
  isPresenterPage,
  allowsFullscreen,
  isAllowedRequest,
  validateSaveDocument,
  validateSaveExport,
  validateCompile,
  resolveAsset,
  suggestedName,
} = require("./host-utils.cjs");

for (const platform of ["darwin", "linux", "win32"]) {
  test(`native ${platform} menus dispatch platform-specific editor commands`, () => {
    const sent = [];
    const template = buildMenuTemplate(platform, (command) =>
      sent.push(command),
    );
    const items = template.flatMap((menu) => menu.submenu ?? []);
    const primary = platform === "darwin" ? "Command" : "Control";
    const expected = [
      ["New presentation", "N", "new"],
      ["Open…", "O", "open"],
      ["Save", "S", "save"],
      ["Save As…", "Shift+S", "saveAs"],
      ["Export PDF…", "Alt+P", "exportPdf"],
      ["Export slide SVG…", "Alt+S", "exportSvg"],
      ["Undo", "Z", "undo"],
      ["Redo", platform === "win32" ? "Y" : "Shift+Z", "redo"],
      ["Cut", "X", "cut"],
      ["Copy", "C", "copy"],
      ["Paste", "V", "paste"],
      ["Select all", "A", "selectAll"],
      ["Duplicate selection or slide", "D", "duplicate"],
      ["Group", "G", "group"],
      ["Ungroup", "Shift+G", "ungroup"],
      ["Present", "Enter", "present"],
      ["Keyboard shortcuts", "Shift+/", "showShortcuts"],
    ];
    for (const [label, keys, command] of expected) {
      const item = items.find((candidate) => candidate.label === label);
      assert.equal(item?.accelerator, `${primary}+${keys}`, label);
      item.click();
      assert.equal(sent.at(-1), command);
    }
    assert.equal(template[0].role === "appMenu", platform === "darwin");
    assert.equal(
      items.some((item) => item.role === "reload"),
      false,
    );
    assert.equal(
      buildMenuTemplate(platform, () => {}, { development: true })
        .flatMap((menu) => menu.submenu ?? [])
        .some((item) => item.role === "reload"),
      true,
    );
  });
}

const focusDocument = new JSDOM("<!doctype html>").window.document;

function menuWindow({
  editing = false,
  inputType,
  modal = false,
  busy = false,
  loading = false,
  fullscreen = false,
  fail = false,
} = {}) {
  const calls = [];
  const activeElement = inputType
    ? focusDocument.createElement("input")
    : {
        matches: (selector) => editing && selector === "input",
        closest() {
          return editing ? this : null;
        },
        isContentEditable: false,
        type: "text",
      };
  if (inputType) activeElement.type = inputType;
  const context = {
    document: {
      activeElement,
      fullscreenElement: fullscreen ? {} : null,
      querySelectorAll: (selector) =>
        (modal && selector.includes('[role="dialog"]')) ||
        (busy && selector.includes('.app-shell[aria-busy="true"]')) ||
        (loading && selector.includes(".recovery-loading"))
          ? [{ getClientRects: () => [{}] }]
          : [],
      documentElement: {
        requestFullscreen: () => {
          calls.push(["fullscreen"]);
          return Promise.resolve();
        },
      },
    },
  };
  const contents = {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    executeJavaScript: async (script, gesture) => {
      calls.push(["script", gesture]);
      if (fail) throw new Error("Renderer unavailable");
      return await vm.runInNewContext(script, context);
    },
    send: (...args) => calls.push(["send", ...args]),
  };
  for (const command of ["cut", "copy", "paste", "selectAll", "undo", "redo"])
    contents[command] = () => calls.push([command]);
  return { contents, calls };
}

test("native Edit commands preserve text editing and use the internal clipboard on the canvas", async () => {
  for (const command of ["cut", "copy", "paste", "selectAll", "undo", "redo"]) {
    const field = menuWindow({ editing: true });
    await dispatchMenuCommand(field.contents, command);
    assert.deepEqual(field.calls, [["script", undefined], [command]]);
    const canvas = menuWindow();
    await dispatchMenuCommand(canvas.contents, command);
    assert.deepEqual(canvas.calls, [
      ["script", undefined],
      ["send", "scislide:command", command],
    ]);
  }
});

test("native Present finishes inline text without taking fullscreen or bypassing a modal", async () => {
  for (const options of [
    { editing: true },
    { modal: true },
    { busy: true },
    { loading: true },
    { fullscreen: true },
  ]) {
    const { contents, calls } = menuWindow(options);
    await dispatchMenuCommand(contents, "present");
    assert.deepEqual(calls, [
      ["script", true],
      ["send", "scislide:command", "present"],
    ]);
  }
  const canvas = menuWindow();
  await dispatchMenuCommand(canvas.contents, "present");
  assert.deepEqual(canvas.calls, [
    ["script", true],
    ["fullscreen"],
    ["send", "scislide:command", "present"],
  ]);
  const rejected = menuWindow({ fail: true });
  await dispatchMenuCommand(rejected.contents, "present");
  assert.deepEqual(rejected.calls, [
    ["script", true],
    ["send", "scislide:command", "present"],
  ]);
});

test("native input focus distinguishes editable text from canvas object controls", async () => {
  for (const inputType of [
    "text",
    "number",
    "search",
    "email",
    "password",
    "url",
    "tel",
  ]) {
    const input = menuWindow({ inputType });
    await dispatchMenuCommand(input.contents, "copy");
    await dispatchMenuCommand(input.contents, "present");
    assert.equal(
      input.calls.some(([name]) => name === "copy"),
      true,
      inputType,
    );
    assert.equal(
      input.calls.some(([name]) => name === "fullscreen"),
      false,
      inputType,
    );
  }
  for (const inputType of [
    "checkbox",
    "radio",
    "range",
    "color",
    "file",
    "button",
    "image",
    "submit",
    "reset",
    "hidden",
  ]) {
    const input = menuWindow({ inputType });
    await dispatchMenuCommand(input.contents, "copy");
    await dispatchMenuCommand(input.contents, "present");
    assert.equal(
      input.calls.some(([name]) => name === "copy"),
      false,
      inputType,
    );
    assert.equal(
      input.calls.some(
        ([name, channel, command]) =>
          name === "send" &&
          channel === "scislide:command" &&
          command === "copy",
      ),
      true,
      inputType,
    );
    assert.equal(
      input.calls.some(([name]) => name === "fullscreen"),
      true,
      inputType,
    );
  }
});

test("native menu dispatch rejects unknown commands and destroyed windows", async () => {
  const unavailable = menuWindow({ fail: true });
  await dispatchMenuCommand(unavailable.contents, "cut");
  assert.deepEqual(unavailable.calls, [["script", undefined]]);
  const unknown = menuWindow();
  await dispatchMenuCommand(unknown.contents, "executeShell");
  assert.deepEqual(unknown.calls, []);
  unknown.contents.destroyed = true;
  await dispatchMenuCommand(unknown.contents, "present");
  assert.deepEqual(unknown.calls, []);
});

test("native accelerators do not consume composing text or AltGraph characters", () => {
  const events = new Map();
  const ignored = [];
  protectTextComposition({
    on: (name, callback) => events.set(name, callback),
    setIgnoreMenuShortcuts: (value) => ignored.push(value),
    isDestroyed: () => false,
  });
  const key = (input) => events.get("before-input-event")({}, input);
  key({ key: "Enter", type: "keyDown", isComposing: true });
  key({ key: "Enter", type: "keyUp", isComposing: false });
  key({ key: "AltGraph", type: "keyDown" });
  key({ key: "s", type: "keyDown", control: true, alt: true });
  key({ key: "AltGraph", type: "keyUp" });
  key({ key: "s", type: "keyDown", control: true, alt: true });
  key({ key: "AltGraph", type: "keyDown" });
  events.get("blur")();
  key({ key: "s", type: "keyDown", control: true });
  assert.deepEqual(ignored, [
    true,
    false,
    true,
    true,
    false,
    false,
    true,
    false,
    false,
  ]);
});

test("the sandbox preload forwards every native editor command and rejects unknown events", async () => {
  let api;
  let listener;
  const received = [];
  vm.runInNewContext(
    await fs.readFile(path.join(__dirname, "preload.cjs"), "utf8"),
    {
      process: { platform: "linux" },
      require: () => ({
        contextBridge: {
          exposeInMainWorld: (_name, value) => {
            api = value;
          },
        },
        ipcRenderer: {
          on: (_channel, callback) => {
            listener = callback;
          },
          removeListener: () => {},
        },
      }),
    },
  );
  api.onCommand((command) => received.push(command));
  const template = buildMenuTemplate("linux", (command) =>
    listener({}, command),
  );
  for (const item of template.flatMap((menu) => menu.submenu ?? []))
    if (item.accelerator && item.click) item.click();
  assert.equal(received.length, 17);
  listener({}, "executeShell");
  assert.equal(received.length, 17);
  assert.ok(received.includes("exportSvg"));
  assert.ok(received.includes("showShortcuts"));
});

test("only an exact local presenter page can open a secondary window", () => {
  const token = "9b244a24-6546-491a-a341-fbe6e34c6052";
  assert.equal(isPresenterPage(`scislide://app/#presenter=${token}`), true);
  assert.equal(
    isPresenterPage(
      `http://127.0.0.1:5173/#presenter=${token}`,
      "http://127.0.0.1:5173/",
    ),
    true,
  );
  for (const value of [
    "scislide://app/",
    "scislide://app/#presenter=short",
    `scislide://app/assets/index.html#presenter=${token}`,
    `scislide://app/?url=x#presenter=${token}`,
    `https://example.com/#presenter=${token}`,
  ])
    assert.equal(isPresenterPage(value), false);
});

test("JSON export is limited to bounded equation libraries", () => {
  const request = {
    bytes: new TextEncoder().encode(
      JSON.stringify({
        format: "scislide-equation-library",
        version: 1,
        entries: [],
      }),
    ),
    suggestedName: "equations",
    kind: "json",
  };
  assert.equal(validateSaveExport(request).suggestedName, "equations.json");
  assert.throws(() =>
    validateSaveExport({
      ...request,
      bytes: new TextEncoder().encode('{"other":"data"}'),
    }),
  );
  assert.throws(() =>
    validateSaveExport({
      ...request,
      bytes: new TextEncoder().encode("not JSON"),
    }),
  );
  assert.throws(() =>
    validateSaveExport({
      ...request,
      bytes: new Uint8Array(8 * 1024 * 1024 + 1),
    }),
  );
  assert.throws(() =>
    validateSaveExport({ ...request, path: "/tmp/arbitrary.json" }),
  );
});

test("IPC trusts only the exact main document, with a bounded local development origin", () => {
  assert.equal(isTrustedPage("scislide://app/"), true);
  assert.equal(isTrustedPage("scislide://app/index.html#slide-1"), true);
  for (const value of [
    "scislide://app.evil/",
    "scislide://app:80/",
    "scislide://user@app/",
    "scislide://app/assets/foo.js",
    "https://app/",
    "file:///app/index.html",
  ])
    assert.equal(isTrustedPage(value), false, value);
  assert.equal(parseDevUrl("http://127.0.0.1:5173/"), "http://127.0.0.1:5173/");
  for (const value of [
    "https://127.0.0.1:5173/",
    "http://localhost:5173/",
    "http://127.0.0.1:5174/",
    "http://127.0.0.1:5173/else",
    "http://user@127.0.0.1:5173/",
  ])
    assert.throws(() => parseDevUrl(value));
});

test("renderer requests reject external origins and local file access", () => {
  assert.equal(isAllowedRequest("scislide://app/assets/main.js"), true);
  assert.equal(isAllowedRequest("data:image/png;base64,abc"), true);
  assert.equal(isAllowedRequest("blob:scislide://app/example"), true);
  for (const value of [
    "https://example.com/",
    "file:///etc/passwd",
    "blob:https://example.com/example",
    "ws://127.0.0.1:5173/",
  ])
    assert.equal(isAllowedRequest(value), false, value);
  assert.equal(
    isAllowedRequest("ws://127.0.0.1:5173/", "http://127.0.0.1:5173/"),
    true,
  );
  assert.equal(
    isAllowedRequest("ws://127.0.0.1:5174/", "http://127.0.0.1:5173/"),
    false,
  );
});

test("fullscreen permission only accepts the trusted main document", () => {
  const details = { isMainFrame: true, requestingUrl: "scislide://app/" };
  assert.equal(
    allowsFullscreen("fullscreen", "scislide://app/", details),
    true,
  );
  for (const permission of [
    "automatic-fullscreen",
    "media",
    "notifications",
    "clipboard-read",
    "geolocation",
    "unknown",
  ])
    assert.equal(
      allowsFullscreen(permission, "scislide://app/", details),
      false,
    );
  assert.equal(
    allowsFullscreen("fullscreen", "scislide://app/", {
      ...details,
      isMainFrame: false,
    }),
    false,
  );
  assert.equal(
    allowsFullscreen("fullscreen", "scislide://app/", {
      requestingUrl: "scislide://app/",
    }),
    false,
  );
  assert.equal(
    allowsFullscreen("fullscreen", "scislide://app/", {
      ...details,
      requestingUrl: "https://example.com/",
    }),
    false,
  );
  assert.equal(
    allowsFullscreen("fullscreen", "scislide://app/", {
      ...details,
      requestingUrl: "scislide://app/assets/example.svg",
    }),
    false,
  );
  assert.equal(
    allowsFullscreen("fullscreen", "https://example.com/", details),
    false,
  );
  assert.equal(allowsFullscreen("fullscreen", "scislide://app/", null), false);
  assert.equal(
    allowsFullscreen(
      "fullscreen",
      "http://127.0.0.1:5173/",
      { isMainFrame: true, requestingUrl: "http://127.0.0.1:5173/" },
      "http://127.0.0.1:5173/",
    ),
    true,
  );
});

test("save requests expose no arbitrary path or write operation", () => {
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);
  const value = validateSaveDocument({
    bytes,
    suggestedName: "../my/deck",
    saveAs: true,
  });
  assert.equal(value.suggestedName, "_my_deck.scislide");
  bytes[0] = 0;
  assert.equal(
    value.bytes[0],
    0x50,
    "validated bytes own an immutable snapshot",
  );
  assert.throws(() =>
    validateSaveDocument({ bytes: new Uint8Array([1]), suggestedName: "x" }),
  );
  assert.throws(() =>
    validateSaveDocument({
      bytes: value.bytes,
      suggestedName: "x",
      path: "/etc/passwd",
    }),
  );
  assert.throws(() =>
    validateSaveDocument({
      bytes: new Uint8Array(64 * 1024 * 1024 + 1),
      suggestedName: "x",
    }),
  );
  assert.equal(
    validateSaveExport({
      bytes: new TextEncoder().encode("%PDF-1.7\n"),
      suggestedName: "deck",
      kind: "pdf",
    }).suggestedName,
    "deck.pdf",
  );
  assert.throws(() =>
    validateSaveExport({
      bytes: new TextEncoder().encode("hello"),
      suggestedName: "deck",
      kind: "pdf",
    }),
  );
  assert.throws(() =>
    validateSaveExport({
      bytes: new TextEncoder().encode("hello"),
      suggestedName: "deck",
      kind: "exe",
    }),
  );
});

test("equation compilation only accepts bounded renderer parameters", () => {
  const valid = {
    jobId: "equation-1",
    source: "x^2",
    preamble: "\\usepackage{amsmath}",
    engine: "latex",
    fontSize: 48,
    color: "#17263c",
    displayMode: true,
  };
  assert.deepEqual(validateCompile(valid), valid);
  for (const changed of [
    { command: "sh" },
    { engine: "pdflatex" },
    { jobId: "../escape" },
    { color: "url(file:///a)" },
    { fontSize: Infinity },
    { displayMode: "true" },
    { source: "x".repeat(65537) },
    { preamble: "x".repeat(32769) },
  ])
    assert.throws(() => validateCompile({ ...valid, ...changed }));
});

test("suggested save names avoid Windows devices and preserve ordinary titles", () => {
  for (const name of [
    "CON",
    "prn",
    "AUX.scislide",
    "nul.tar.gz",
    "COM1",
    "COM9.pdf",
    "LPT1",
    "LPT9.svg",
    "COM¹",
    "COM².scislide",
    "COM³",
    "LPT¹",
    "LPT².pdf",
    "LPT³",
  ]) {
    assert.ok(suggestedName(name, "scislide").startsWith("_"), name);
  }
  assert.equal(suggestedName("NUL.pdf", "pdf"), "_NUL.pdf");
  assert.equal(suggestedName("CON.scislide", "scislide"), "_CON.scislide");
  assert.equal(suggestedName("COM10", "scislide"), "COM10.scislide");
  assert.equal(suggestedName("Conclusion", "pdf"), "Conclusion.pdf");
  assert.equal(
    suggestedName("우주론 발표", "scislide"),
    "우주론 발표.scislide",
  );
});

test("custom app resource paths reject escaped paths outside dist", async () => {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "scislide-host-test-")),
  );
  const dist = path.join(temporary, "dist");
  try {
    await fs.mkdir(dist);
    await fs.writeFile(path.join(dist, "index.html"), "<html></html>");
    await fs.writeFile(path.join(temporary, "secret.txt"), "secret");
    assert.equal(
      await resolveAsset("scislide://app/", dist),
      path.join(dist, "index.html"),
    );
    for (const value of [
      "scislide://app/%2e%2e%2fsecret.txt",
      "scislide://app/%5c..%5csecret.txt",
      "file:///etc/passwd",
      "scislide://other/index.html",
    ])
      await assert.rejects(resolveAsset(value, dist));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("custom app resources reject file symlinks outside dist", async (context) => {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "scislide-host-symlink-test-")),
  );
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const dist = path.join(temporary, "dist");
  await fs.mkdir(dist);
  await fs.writeFile(path.join(temporary, "secret.txt"), "secret");
  try {
    await fs.symlink(
      path.join(temporary, "secret.txt"),
      path.join(dist, "leak.txt"),
      "file",
    );
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      context.skip("This Windows account cannot create file symbolic links.");
      return;
    }
    throw error;
  }
  await assert.rejects(resolveAsset("scislide://app/leak.txt", dist));
});
