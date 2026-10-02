/** Installed TeX compilation. Every untrusted TeX job requires OS isolation. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_PREAMBLE_BYTES = 32 * 1024;
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_CACHE_ENTRIES = 12;
const TEMPLATE_REVISION = "scislide-local-tex-1";
const jobs = new Map();
const cache = new Map();
let detection;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const cleanVersion = (text) =>
  text
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()
    .slice(0, 240) || "unknown";
const within = (candidate, root) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

async function executable(name) {
  const directories =
    process.platform === "win32"
      ? (process.env.PATH || "").split(path.delimiter)
      : [
          "/usr/bin",
          "/bin",
          "/usr/local/bin",
          ...(process.platform === "darwin" ? ["/Library/TeX/texbin"] : []),
          ...(process.env.PATH || "").split(path.delimiter),
        ];
  for (const directory of [...new Set(directories.filter(Boolean))]) {
    const filename = path.resolve(
      directory,
      process.platform === "win32" ? `${name}.exe` : name,
    );
    try {
      await access(filename, constants.X_OK);
      return filename;
    } catch {
      /* Try the next installed binary. */
    }
  }
  return undefined;
}

function run(command, args, { cwd, env, job, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env || { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (job) job.child = child;
    let output = "";
    let bytes = 0;
    let failure;
    const stop = (reason) => {
      failure ||= reason;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* The process may already have exited. */
      }
    };
    const timer = setTimeout(
      () => stop(new Error("Local LaTeX exceeded its 20-second time limit.")),
      timeout,
    );
    const collect = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES)
        stop(new Error("Local LaTeX produced too much diagnostic output."));
      else output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (job) job.child = undefined;
      if (job?.timedOut)
        reject(new Error("Local LaTeX exceeded its 20-second time limit."));
      else if (job?.cancelled)
        reject(new Error("Local LaTeX compilation was cancelled."));
      else if (failure) reject(failure);
      else resolve({ code, signal, output });
    });
  });
}

async function runtimeMounts() {
  const candidates = [
    "/usr",
    "/bin",
    "/lib",
    "/lib64",
    "/etc/ld.so.cache",
    "/etc/fonts",
    "/etc/texmf",
    "/var/lib/texmf",
    "/var/cache/fontconfig",
  ];
  const mounts = [];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      mounts.push(candidate);
    } catch {
      /* Optional runtime directory. */
    }
  }
  return mounts;
}

function bubblewrapArgs(mounts, directory, command, args) {
  const options = [
    "--unshare-all",
    "--unshare-user",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--disable-userns",
    "--clearenv",
  ];
  for (const mount of mounts) options.push("--ro-bind", mount, mount);
  options.push(
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--size",
    "67108864",
    "--tmpfs",
    "/tmp",
  );
  if (directory) options.push("--bind", directory, "/work", "--chdir", "/work");
  else options.push("--dir", "/work", "--chdir", "/work");
  const environment = {
    PATH: "/usr/bin:/bin:/usr/local/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    HOME: "/work/home",
    TMPDIR: "/tmp",
    TEXMFHOME: "/work/texmf-home",
    TEXMFVAR: "/work/texmf-var",
    TEXMFCONFIG: "/work/texmf-config",
    TEXMFOUTPUT: "/work",
    openin_any: "p",
    openout_any: "p",
    shell_escape: "f",
    MKTEXPK: "0",
    MKTEXTFM: "0",
    MKTEXMF: "0",
    MKTEXFMT: "0",
    FONTCONFIG_FILE: "/etc/fonts/fonts.conf",
    XDG_CACHE_HOME: "/work/cache",
  };
  for (const [key, value] of Object.entries(environment))
    options.push("--setenv", key, value);
  options.push("--", command, ...args);
  return options;
}

async function inspectInstallation() {
  const [latex, xelatex, converter, bwrap, prlimit, kpsewhich] =
    await Promise.all(
      ["latex", "xelatex", "dvisvgm", "bwrap", "prlimit", "kpsewhich"].map(
        executable,
      ),
    );
  const mounts = await runtimeMounts();
  const engines = [];
  const paths = { latex, xelatex, converter, bwrap, prlimit, kpsewhich };
  for (const [id, label] of [
    ["latex", "LaTeX (DVI)"],
    ["xelatex", "XeLaTeX (Unicode / system fonts)"],
  ]) {
    if (!paths[id]) continue;
    try {
      const version = await run(paths[id], ["--version"], { timeout: 3_000 });
      if (version.code === 0)
        engines.push({ id, label, version: cleanVersion(version.output) });
    } catch {
      /* A broken executable is not an available engine. */
    }
  }
  let converterInfo;
  if (converter) {
    try {
      const result = await run(converter, ["--version"], { timeout: 3_000 });
      if (result.code === 0)
        converterInfo = { version: cleanVersion(result.output) };
    } catch {
      /* Report an unusable converter below. */
    }
  }
  let sandbox = {
    available: false,
    reason:
      "Local LaTeX currently requires Linux and bubblewrap. MathJax and saved equation previews remain available.",
  };
  if (process.platform === "linux" && bwrap && prlimit) {
    try {
      const result = await run(
        bwrap,
        bubblewrapArgs(mounts, undefined, "/bin/true", []),
        { timeout: 3_000 },
      );
      sandbox =
        result.code === 0
          ? { available: true }
          : {
              available: false,
              reason: `Linux isolation is unavailable: ${result.output.trim().slice(0, 400)}`,
            };
    } catch (error) {
      sandbox = {
        available: false,
        reason: `Linux isolation is unavailable: ${error.message}`,
      };
    }
  } else if (process.platform === "linux") {
    sandbox.reason =
      "Install bubblewrap and util-linux (prlimit) to enable isolated local LaTeX compilation.";
  }
  const packages = [];
  if (kpsewhich) {
    for (const name of [
      "amsmath",
      "amsfonts",
      "amssymb",
      "mathtools",
      "physics",
      "unicode-math",
      "tikz",
      "siunitx",
      "mhchem",
    ]) {
      try {
        const result = await run(kpsewhich, [`${name}.sty`], {
          timeout: 3_000,
        });
        if (result.code === 0 && result.output.trim()) packages.push(name);
      } catch {
        /* Optional package. */
      }
    }
  }
  const available =
    engines.length > 0 && Boolean(converterInfo) && sandbox.available;
  return {
    result: {
      available,
      engines,
      ...(converterInfo ? { converter: converterInfo } : {}),
      packages,
      sandbox,
      ...(!available
        ? {
            message: !engines.length
              ? "Install a TeX distribution with LaTeX or XeLaTeX."
              : !converterInfo
                ? "Install dvisvgm to convert equations into vector SVG."
                : sandbox.reason,
          }
        : {}),
    },
    paths,
    mounts,
  };
}

/** Inspect installed binaries and actually probe the OS sandbox. */
export async function detectTex() {
  detection = await inspectInstallation();
  return structuredClone(detection.result);
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw new Error("Invalid Local LaTeX request.");
  if (
    typeof request.jobId !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(request.jobId)
  )
    throw new Error("Invalid compilation job ID.");
  for (const [key, maximum] of [
    ["source", MAX_SOURCE_BYTES],
    ["preamble", MAX_PREAMBLE_BYTES],
  ]) {
    if (
      typeof request[key] !== "string" ||
      Buffer.byteLength(request[key], "utf8") > maximum ||
      request[key].includes("\0")
    )
      throw new Error(`Invalid or oversized ${key}.`);
  }
  if (!request.source.trim())
    throw new Error("Enter an equation before compiling.");
  if (!["latex", "xelatex"].includes(request.engine))
    throw new Error("Use the LaTeX or XeLaTeX engine.");
  if (
    !Number.isFinite(request.fontSize) ||
    request.fontSize < 4 ||
    request.fontSize > 500
  )
    throw new Error("Equation font size must be between 4 and 500 px.");
  if (
    typeof request.color !== "string" ||
    !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(request.color)
  )
    throw new Error("Use a hexadecimal equation color.");
  if (typeof request.displayMode !== "boolean")
    throw new Error("Invalid equation display mode.");
}

function template(request) {
  const color =
    request.color.length === 4
      ? [...request.color.slice(1)].map((c) => `${c}${c}`).join("")
      : request.color.slice(1);
  const size = ((request.fontSize * 72.27) / 96).toFixed(5);
  // AMS display environments provide their own math mode. Other fragments use the requested mode.
  const leadingExpression = request.source.replace(
    /^(?:\s|%[^\r\n]*(?:\r?\n|$))*/,
    "",
  );
  const isDisplayEnvironment =
    /^\s*\\begin\{(?:align\*?|alignat\*?|flalign\*?|gather\*?|multline\*?|equation\*?|displaymath)\}/.test(
      leadingExpression,
    );
  const source = isDisplayEnvironment
    ? request.source
    : `\\(${request.displayMode ? "\\displaystyle " : ""}${request.source}\\)`;
  return `\\documentclass{article}\n\\usepackage{amsmath,amsfonts,amssymb}\n${request.engine === "latex" ? "\\usepackage{lmodern}\n" : ""}\\usepackage{xcolor}\n${request.preamble}\n\\pagestyle{empty}\n\\begin{document}\n\\fontsize{${size}pt}{${(Number(size) * 1.2).toFixed(5)}pt}\\selectfont\n\\color[HTML]{${color}}\n\\noindent ${source}\n\\end{document}\n`;
}

async function sandboxRun(installation, directory, command, args, job) {
  if (job.cancelled) throw new Error("Local LaTeX compilation was cancelled.");
  if (!installation.mounts.some((root) => within(command, root)))
    throw new Error(
      "This TeX installation is outside supported system runtime directories.",
    );
  return run(
    installation.paths.prlimit,
    [
      "--as=805306368",
      "--cpu=15",
      "--fsize=33554432",
      "--nofile=128",
      "--core=0",
      "--",
      installation.paths.bwrap,
      ...bubblewrapArgs(installation.mounts, directory, command, args),
    ],
    { job },
  );
}

async function dependencies(installation, directory, recorder, job) {
  const found = new Map();
  let totalBytes = 0;
  async function include(filename) {
    let resolved;
    try {
      resolved = await realpath(filename);
    } catch {
      return;
    }
    if (
      !installation.mounts.some((root) => within(resolved, root)) ||
      found.has(resolved)
    )
      return;
    const info = await stat(resolved);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) return;
    totalBytes += info.size;
    if (totalBytes > 128 * 1024 * 1024)
      throw new Error("Local LaTeX dependencies exceeded the recording limit.");
    found.set(resolved, {
      filename: resolved,
      name: resolved.replace(/^\//, ""),
      sha256: sha256(await readFile(resolved)),
    });
  }
  for (const entry of recorder.split(/\r?\n/)) {
    if (!entry.startsWith("INPUT ")) continue;
    const filename = entry.slice(6);
    if (path.isAbsolute(filename)) await include(filename);
  }
  if (installation.engine === "xelatex") {
    // XeTeX's recorder omits native font files, but XDV embeds their resolved paths.
    // Only mounted system files can become dependency records.
    const xdv = await readFile(path.join(directory, "equation.xdv"));
    for (const match of xdv
      .toString("utf8")
      .matchAll(/\/(?:usr|var|opt)\/[^\x00-\x1f]*?\.(?:otf|ttf|ttc|pfb)/g))
      await include(match[0]);
  }
  for (const filename of [
    installation.paths[installation.engine],
    installation.paths.converter,
  ])
    if (filename) await include(filename);
  // DVI glyph outlines are resolved by dvisvgm, after TeX's recorder closes.
  // Record the selected system font map and the installed outlines for each metric font.
  const fontNames = [...found.keys()]
    .filter((filename) => filename.endsWith(".tfm"))
    .map((filename) => path.basename(filename, ".tfm"));
  if (installation.paths.kpsewhich) {
    const names = [
      "psfonts.map",
      ...fontNames.flatMap((name) => [
        `${name}.pfb`,
        `${name}.otf`,
        `${name}.ttf`,
      ]),
    ];
    const result = await sandboxRun(
      installation,
      directory,
      installation.paths.kpsewhich,
      names,
      job,
    );
    for (const filename of result.output.trim().split(/\r?\n/))
      if (path.isAbsolute(filename)) await include(filename);
    const mappedFiles = new Set();
    for (const [filename, dependency] of found) {
      if (!dependency.name.endsWith("/psfonts.map")) continue;
      const map = await readFile(filename, "utf8");
      for (const line of map.split(/\r?\n/)) {
        if (!fontNames.includes(line.trim().split(/\s+/)[0])) continue;
        for (const match of line.matchAll(
          /[<\[]+([^\s<>\[\]"]+\.(?:pfb|pfa|enc|otf|ttf|ttc))/g,
        ))
          mappedFiles.add(match[1]);
      }
    }
    if (mappedFiles.size) {
      const mapped = await sandboxRun(
        installation,
        directory,
        installation.paths.kpsewhich,
        [...mappedFiles],
        job,
      );
      for (const filename of mapped.output.trim().split(/\r?\n/))
        if (path.isAbsolute(filename)) await include(filename);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function cacheStillValid(entry) {
  try {
    for (const dependency of entry.dependencies)
      if (sha256(await readFile(dependency.filename)) !== dependency.sha256)
        return false;
    return true;
  } catch {
    return false;
  }
}

function normalizedSvg(source, fingerprint) {
  // Do not rely on converter special-handler switches as a security boundary:
  // behavior varies by dvisvgm version. Validate output again in the renderer.
  let svg = source
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const forbidden = svg.match(
    /<!|<(?:script|foreignObject|image|iframe|object|embed|style|text|animate|set)\b|\son[a-z]+\s*=|url\(\s*['"]?(?:javascript|data|https?|file):/i,
  );
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES || forbidden)
    throw new Error(
      `Local LaTeX output is not a passive vector equation${forbidden ? ` (${forbidden[0]})` : ""}.`,
    );
  if (!/^<svg\s/.test(svg) || !/<\/svg>\s*$/.test(svg))
    throw new Error("The converter did not produce valid SVG.");
  const root = svg.match(/^<svg\b[^>]*>/)?.[0];
  const dimension = (name) => {
    const value = root?.match(
      new RegExp(`\\b${name}=['"]([\\d.+-]+)(pt|bp|px)?['"]`),
    );
    if (!value) throw new Error("The vector equation has no size.");
    const number =
      Number(value[1]) * (value[2] === "pt" || value[2] === "bp" ? 96 / 72 : 1);
    if (!Number.isFinite(number) || number <= 0 || number > 50_000)
      throw new Error("The vector equation size is outside supported limits.");
    return number;
  };
  const width = dimension("width");
  const height = dimension("height");
  const prefix = `tex-${fingerprint.slice(0, 24)}-`;
  const ids = new Map(
    [...svg.matchAll(/\bid=['"]([^'"]+)['"]/g)].map((match) => [
      match[1],
      `${prefix}${match[1]}`,
    ]),
  );
  svg = svg.replace(
    /\bid=(['"])([^'"]+)\1/g,
    (_match, quote, id) => `id=${quote}${ids.get(id)}${quote}`,
  );
  svg = svg.replace(
    /\b((?:xlink:)?href)=(['"])([^'"]+)\2/g,
    (_match, attribute, quote, target) => {
      if (!target.startsWith("#") || !ids.has(target.slice(1)))
        throw new Error(
          "The vector equation contains an external or missing reference.",
        );
      return `${attribute}=${quote}#${ids.get(target.slice(1))}${quote}`;
    },
  );
  svg = svg.replace(/url\(\s*#([^\s)]+)\s*\)/g, (_match, id) => {
    if (!ids.has(id))
      throw new Error(
        "The vector equation contains a missing paint reference.",
      );
    return `url(#${ids.get(id)})`;
  });
  svg = svg.replace(/^<svg\b[^>]*>/, (tag) =>
    tag
      .replace(/\bwidth=['"][^'"]*['"]/, `width="${width}"`)
      .replace(/\bheight=['"][^'"]*['"]/, `height="${height}"`),
  );
  return { svg, width, height };
}

/** Compile an equation using installed system packages, inside a fresh Linux sandbox. */
export async function compileTex(request) {
  validateRequest(request);
  if (jobs.has(request.jobId))
    throw new Error("This compilation job is already running.");
  if (jobs.size >= 2)
    throw new Error(
      "Two Local LaTeX jobs are already running. Try again after one finishes.",
    );
  const job = { cancelled: false, child: undefined };
  jobs.set(request.jobId, job);
  const deadline = setTimeout(() => {
    job.timedOut = true;
    cancelCompile(request.jobId);
  }, TIMEOUT_MS);
  let directory;
  try {
    detection ||= await inspectInstallation();
    const installation = detection;
    if (!installation.result.available)
      throw new Error(
        installation.result.message || "Local LaTeX is unavailable.",
      );
    const engine = installation.result.engines.find(
      (candidate) => candidate.id === request.engine,
    );
    if (!engine) throw new Error(`${request.engine} is not installed.`);
    const compiler = { ...installation, engine: request.engine };
    const key = sha256(
      JSON.stringify({
        ...request,
        jobId: undefined,
        template: TEMPLATE_REVISION,
        engineVersion: engine.version,
        converterVersion: installation.result.converter.version,
      }),
    );
    const cached = cache.get(key);
    if (cached && (await cacheStillValid(cached))) {
      if (job.cancelled)
        throw new Error("Local LaTeX compilation was cancelled.");
      cache.delete(key);
      cache.set(key, cached);
      return structuredClone(cached.result);
    }
    directory = await mkdtemp(path.join(os.tmpdir(), "scislide-tex-"));
    for (const name of [
      "home",
      "texmf-home",
      "texmf-var",
      "texmf-config",
      "cache",
    ])
      await mkdir(path.join(directory, name));
    await writeFile(path.join(directory, "equation.tex"), template(request), {
      mode: 0o600,
    });
    const latex = await sandboxRun(
      compiler,
      directory,
      installation.paths[request.engine],
      [
        "-no-shell-escape",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        "-recorder",
        ...(request.engine === "xelatex" ? ["-no-pdf"] : []),
        "equation.tex",
      ],
      job,
    );
    if (latex.code !== 0)
      throw new Error(
        `Local LaTeX could not compile this equation.\n${latex.output.slice(-3500)}`,
      );
    if (job.cancelled)
      throw new Error("Local LaTeX compilation was cancelled.");
    const conversion = await sandboxRun(
      compiler,
      directory,
      installation.paths.converter,
      [
        "--no-fonts=1",
        "--no-mktexmf",
        "--no-specials=ps,dvisvgm,html,pdf",
        "--exact-bbox",
        "--bbox=min",
        "--page=1",
        "--cache=/work/cache",
        "--output=equation.svg",
        request.engine === "xelatex" ? "equation.xdv" : "equation.dvi",
      ],
      job,
    );
    if (conversion.code !== 0)
      throw new Error(
        `The equation could not be converted into vector SVG.\n${conversion.output.slice(-2500)}`,
      );
    if (/1 of (?:[2-9]|\d{2,}) pages? converted/.test(conversion.output))
      throw new Error("Local LaTeX equations must fit on one page.");
    const recorded = await dependencies(
      compiler,
      directory,
      await readFile(path.join(directory, "equation.fls"), "utf8"),
      job,
    );
    if (job.cancelled)
      throw new Error("Local LaTeX compilation was cancelled.");
    const publicDependencies = recorded.map(({ name, sha256: hash }) => ({
      name,
      sha256: hash,
    }));
    const fingerprint = sha256(
      JSON.stringify({ key, dependencies: publicDependencies }),
    );
    const svgFile = path.join(directory, "equation.svg");
    if ((await stat(svgFile)).size > MAX_SVG_BYTES)
      throw new Error("The equation SVG exceeded the 2 MB limit.");
    const rendered = normalizedSvg(
      await readFile(svgFile, "utf8"),
      fingerprint,
    );
    const warnings = [
      ...latex.output.matchAll(
        /(?:LaTeX|Package [\w-]+|Font) Warning:[\s\S]*?(?=\n\s*\n|$)/g,
      ),
    ]
      .map((match) => match[0].trim().slice(0, 500))
      .slice(0, 12);
    const result = {
      ...rendered,
      fingerprint,
      profile: {
        engine: request.engine,
        engineVersion: engine.version,
        converterVersion: installation.result.converter.version,
        dependencies: publicDependencies,
      },
      warnings,
    };
    cache.set(key, { dependencies: recorded, result });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    return structuredClone(result);
  } finally {
    clearTimeout(deadline);
    jobs.delete(request.jobId);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

/** Cancel only an existing SciSlide compilation process group. */
export function cancelCompile(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.cancelled = true;
  if (job.child?.pid) {
    try {
      if (process.platform !== "win32") process.kill(-job.child.pid, "SIGKILL");
      else job.child.kill("SIGKILL");
    } catch {
      /* It may already have exited. */
    }
  }
  return true;
}
