const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  parseDevUrl,
  isTrustedPage,
  allowsFullscreen,
  isAllowedRequest,
  validateSaveDocument,
  validateSaveExport,
  validateCompile,
  resolveAsset,
} = require("./host-utils.cjs");

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

test("custom app resource paths reject escaped paths and symlinks outside dist", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "scislide-host-test-"),
  );
  const dist = path.join(temporary, "dist");
  try {
    await fs.mkdir(dist);
    await fs.writeFile(path.join(dist, "index.html"), "<html></html>");
    await fs.writeFile(path.join(temporary, "secret.txt"), "secret");
    await fs.symlink(
      path.join(temporary, "secret.txt"),
      path.join(dist, "leak.txt"),
    );
    assert.equal(
      await resolveAsset("scislide://app/", dist),
      path.join(dist, "index.html"),
    );
    for (const value of [
      "scislide://app/%2e%2e%2fsecret.txt",
      "scislide://app/%5c..%5csecret.txt",
      "scislide://app/leak.txt",
      "file:///etc/passwd",
      "scislide://other/index.html",
    ])
      await assert.rejects(resolveAsset(value, dist));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
