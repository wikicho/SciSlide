import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cancelCompile, compileTex, detectTex } from "../desktop/tex.mjs";

let installed;
before(async () => {
  installed = await detectTex();
  if (process.env.RUN_LOCAL_TEX_TESTS === "1")
    assert.equal(installed.available, true, installed.message);
});

const request = (jobId, overrides = {}) => ({
  jobId,
  source: String.raw`\mathbb{R}\supset\mathbb{Q}\quad\mathfrak{g}\quad\frac{a}{b}`,
  preamble: "",
  engine: "latex",
  fontSize: 40,
  color: "#123456",
  displayMode: true,
  ...overrides,
});
const integration = (context, engine = "latex") => {
  if (
    !installed.available ||
    !installed.engines.some((candidate) => candidate.id === engine)
  ) {
    context.skip(installed.message || `${engine} is not installed.`);
    return false;
  }
  return true;
};

test("reports installed engines separately from actual sandbox availability", () => {
  assert.equal(typeof installed.available, "boolean");
  assert.equal(typeof installed.sandbox.available, "boolean");
  for (const engine of installed.engines) {
    assert.ok(["latex", "xelatex"].includes(engine.id));
    assert.ok(engine.version.length > 0);
  }
  if (installed.available) {
    assert.equal(installed.sandbox.available, true);
    assert.ok(installed.converter.version);
  } else assert.ok(installed.message);
});

test("rejects unsupported engines and unsafe command-shaped input", async () => {
  await assert.rejects(compileTex(request("../job")), /job ID/);
  await assert.rejects(
    compileTex(request("bad-engine", { engine: "lualatex" })),
    /engine/,
  );
  await assert.rejects(
    compileTex(request("bad-color", { color: "red; touch secret" })),
    /hexadecimal/,
  );
  await assert.rejects(
    compileTex(request("too-big", { source: "x".repeat(65_537) })),
    /oversized/,
  );
  await assert.rejects(
    compileTex(request("bad-size", { fontSize: Infinity })),
    /font size/,
  );
  await assert.rejects(
    compileTex(request("bad-preamble", { preamble: "\0" })),
    /preamble/,
  );
});

test("compiles AMS and installed physics into vector paths with dependency hashes", async (context) => {
  if (!integration(context)) return;
  const result = await compileTex(
    request("ams-physics", {
      preamble: String.raw`\usepackage{physics,mathtools}`,
      source: String.raw`\pdv{\psi}{t}=-\frac{i}{\hbar}\hat H\ket{\psi}\quad\psi\in\mathbb{C}^n\quad\mathfrak{g}`,
    }),
  );
  assert.match(result.svg, /<path\b/);
  assert.doesNotMatch(result.svg, /<(?:text|image|script)\b/);
  assert.ok(result.width > 100 && result.height > 20);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.profile.engine, "latex");
  assert.ok(
    result.profile.dependencies.some((dependency) =>
      dependency.name.endsWith("/physics.sty"),
    ),
  );
  assert.ok(
    result.profile.dependencies.some((dependency) =>
      /\.(?:pfb|otf|ttf)$/.test(dependency.name),
    ),
  );
  assert.ok(
    result.profile.dependencies.every((dependency) =>
      /^[0-9a-f]{64}$/.test(dependency.sha256),
    ),
  );
});

test("uses XeLaTeX unicode-math and installed OpenType math fonts", async (context) => {
  if (!integration(context, "xelatex")) return;
  const result = await compileTex(
    request("unicode-math", {
      engine: "xelatex",
      preamble: String.raw`\usepackage{unicode-math}\setmathfont{latinmodern-math.otf}`,
      source: String.raw`\symbb{R}\supset\symbb{Q}\qquad\symfrak{g}\qquad\symbf{\alpha}+\int_0^\infty e^{-x^2}\,dx`,
    }),
  );
  assert.match(result.svg, /<path\b/);
  assert.doesNotMatch(result.svg, /<text\b/);
  assert.ok(
    result.profile.dependencies.some((dependency) =>
      dependency.name.endsWith("/unicode-math.sty"),
    ),
  );
  assert.ok(
    result.profile.dependencies.some((dependency) =>
      dependency.name.endsWith("/latinmodern-math.otf"),
    ),
  );
});

test("honors pixel font size, color, inline mode and cache ownership", async (context) => {
  if (!integration(context)) return;
  const small = await compileTex(
    request("small", { source: "x", fontSize: 24, color: "#789" }),
  );
  const large = await compileTex(
    request("large", { source: "x", fontSize: 48, color: "#789" }),
  );
  assert.ok(Math.abs(large.width / small.width - 2) < 0.02);
  assert.ok(Math.abs(large.height / small.height - 2) < 0.02);
  assert.match(small.svg, /#789|#778899/);
  small.profile.dependencies.length = 0;
  const cached = await compileTex(
    request("cached-small", { source: "x", fontSize: 24, color: "#789" }),
  );
  assert.ok(cached.profile.dependencies.length > 0);
  assert.equal(cached.fingerprint, small.fingerprint);
  const display = await compileTex(
    request("display", { source: String.raw`\frac{1}{2}` }),
  );
  const inline = await compileTex(
    request("inline", { source: String.raw`\frac{1}{2}`, displayMode: false }),
  );
  assert.ok(display.height > inline.height);
});

test("accepts top-level AMS alignment environments", async (context) => {
  if (!integration(context)) return;
  const result = await compileTex(
    request("align", {
      source: String.raw`\begin{align*} a&=b+c\\d&=e+f\end{align*}`,
    }),
  );
  assert.match(result.svg, /<path\b/);
  assert.ok(result.height > 30);
});

test("accepts display environments after preserved leading TeX comments", async (context) => {
  if (!integration(context)) return;
  const source =
    "\n% scientific note\n% another note\n" +
    String.raw`\begin{align*} a&=b+c\\d&=e+f\end{align*}`;
  const result = await compileTex(request("commented-align", { source }));
  assert.match(result.svg, /<path\b/);
  assert.ok(result.height > 30);
});

test("cannot read a host file outside runtime mounts or write outside the job", async (context) => {
  if (!integration(context)) return;
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "scislide-host-secret-"),
  );
  const secretFile = path.join(directory, "private.tex");
  const marker = path.join(directory, "marker");
  await writeFile(secretFile, "HOST_SECRET_SENTINEL");
  try {
    await assert.rejects(
      compileTex(request("read-host", { preamble: `\\input{${secretFile}}` })),
      /could not compile|not reading|not found/i,
    );
    const result = await compileTex(
      request("write-host", {
        preamble: `\\immediate\\write18{touch ${marker}}`,
      }),
    );
    assert.match(result.svg, /<path\b/);
    await assert.rejects(readFile(marker), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects arbitrary active SVG emitted through dvisvgm specials", async (context) => {
  if (!integration(context)) return;
  await assert.rejects(
    compileTex(
      request("raw-special", {
        source: String.raw`x\special{dvisvgm:raw <script>alert(1)</script>}`,
      }),
    ),
    /passive vector/,
  );
});

test("cancels a running isolated process and rejects duplicate job IDs", async (context) => {
  if (!integration(context)) return;
  const compiling = compileTex(
    request("cancelled", { source: String.raw`\loop\iftrue\repeat` }),
  );
  const rejection = assert.rejects(compiling, /cancelled/);
  await assert.rejects(compileTex(request("cancelled")), /already running/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(cancelCompile("cancelled"), true);
  await rejection;
  assert.equal(cancelCompile("cancelled"), false);
  assert.equal(cancelCompile("never-existed"), false);
});
