import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const platforms = new Set(["darwin", "linux", "win32"]);
const architectures = new Set(["arm64", "x64"]);

const unixResolveLauncher = `scislide_launcher=$0
case "$scislide_launcher" in
  */*) ;;
  *) scislide_launcher=$(command -v "$scislide_launcher") ;;
esac
while [ -L "$scislide_launcher" ]; do
  scislide_dir=$(CDPATH= cd -P -- "$(dirname "$scislide_launcher")" && pwd)
  scislide_link=$(readlink "$scislide_launcher")
  case "$scislide_link" in
    /*) scislide_launcher=$scislide_link ;;
    *) scislide_launcher=$scislide_dir/$scislide_link ;;
  esac
done
scislide_dir=$(CDPATH= cd -P -- "$(dirname "$scislide_launcher")" && pwd)
`;

function unixLaunchBody(binary, entry) {
  return `scislide_binary=${binary}
scislide_entry=${entry}
case "\${1:-}" in
  schema|create|inspect|validate|apply|unpack|pack|export)
    ELECTRON_RUN_AS_NODE=1 exec "$scislide_binary" "$scislide_entry" "$@"
    ;;
esac
for scislide_argument in "$@"; do
  case "$scislide_argument" in
    --update|--check-update|--help|-h|--version|--cli)
      ELECTRON_RUN_AS_NODE=1 exec "$scislide_binary" "$scislide_entry" "$@"
      ;;
  esac
done
exec "$scislide_binary" "$@"
`;
}

/** The system command enters Node mode only for explicit CLI requests. */
export function linuxInstalledLauncher() {
  return `#!/bin/sh
set -eu
${unixLaunchBody('"/opt/scislide/scislide"', '"/opt/scislide/resources/scislide-cli/desktop/update-cli.mjs"')}`;
}

function unixPortableLauncher(platform, installed = false) {
  const binary =
    platform === "darwin"
      ? installed
        ? '"$scislide_dir/../../../MacOS/scislide"'
        : '"$scislide_dir/../SciSlide.app/Contents/MacOS/scislide"'
      : '"$scislide_dir/../scislide"';
  const entry =
    platform === "darwin"
      ? installed
        ? '"$scislide_dir/../desktop/update-cli.mjs"'
        : '"$scislide_dir/../SciSlide.app/Contents/Resources/scislide-cli/desktop/update-cli.mjs"'
      : '"$scislide_dir/../resources/scislide-cli/desktop/update-cli.mjs"';
  return `#!/bin/sh
set -eu
${unixResolveLauncher}${unixLaunchBody(binary, entry)}`;
}

const windowsLauncher = [
  "@echo off",
  "setlocal EnableExtensions DisableDelayedExpansion",
  'set "scislide_dir=%~dp0"',
  'set "scislide_cli="',
  ...[
    "schema",
    "create",
    "inspect",
    "validate",
    "apply",
    "unpack",
    "pack",
    "export",
  ].map((command) => `if "%~1"=="${command}" set "scislide_cli=1"`),
  "if defined scislide_cli goto scislide_launch",
  ":scislide_scan",
  'if "%~1"=="" goto scislide_empty_argument',
  'if "%~1"=="--update" set "scislide_cli=1"',
  'if "%~1"=="--check-update" set "scislide_cli=1"',
  'if "%~1"=="--help" set "scislide_cli=1"',
  'if "%~1"=="-h" set "scislide_cli=1"',
  'if "%~1"=="--version" set "scislide_cli=1"',
  'if "%~1"=="--cli" set "scislide_cli=1"',
  "if defined scislide_cli goto scislide_launch",
  "shift",
  "goto scislide_scan",
  ":scislide_empty_argument",
  'if "%1"=="" goto scislide_launch',
  "shift",
  "goto scislide_scan",
  ":scislide_launch",
  "if not defined scislide_cli goto scislide_gui",
  'set "ELECTRON_RUN_AS_NODE=1"',
  '"%scislide_dir%..\\scislide.exe" "%scislide_dir%..\\resources\\scislide-cli\\desktop\\update-cli.mjs" %*',
  "exit /b %errorlevel%",
  ":scislide_gui",
  'start "" /wait "%scislide_dir%..\\scislide.exe" %*',
  "exit /b %errorlevel%",
  "",
].join("\r\n");

async function cliSources(root) {
  const files = {};
  for (const name of ["update-cli.mjs", "update.mjs"]) {
    const filename = path.join(root, "desktop", name);
    const stat = await exists(filename);
    if (!stat?.isFile() || stat.isSymbolicLink())
      throw new Error(
        `Desktop CLI requires a regular source file: desktop/${name}`,
      );
    files[`desktop/${name}`] = await readFile(filename);
  }
  for (const name of ["agent.cjs", "THIRD_PARTY_NOTICES.txt"]) {
    const filename = path.join(root, "dist-cli", name);
    const stat = await exists(filename);
    if (!stat?.isFile() || stat.isSymbolicLink() || !stat.size)
      throw new Error(
        `Desktop CLI requires a nonempty regular agent bundle file: dist-cli/${name}. Build the agent CLI before packaging.`,
      );
    files[name] = await readFile(filename);
  }
  await readCliFonts(path.join(root, "public", "fonts"), files);
  return files;
}

async function readCliFonts(directory, files, relative = "fonts") {
  const stat = await exists(directory);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      "Desktop CLI requires a regular font directory: public/fonts",
    );
  const entries = await readdir(directory, { withFileTypes: true });
  if (!entries.length)
    throw new Error("Desktop CLI requires bundled font files: public/fonts");
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    const key = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await readCliFonts(filename, files, key);
    else if (entry.isFile()) {
      const font = await lstat(filename);
      if (!font.isFile() || font.isSymbolicLink() || !font.size)
        throw new Error(`Desktop CLI requires regular nonempty fonts: ${key}`);
      files[key] = await readFile(filename);
    } else {
      throw new Error(
        `Desktop CLI fonts cannot contain links or special files: ${key}`,
      );
    }
  }
}

async function installCli(app, platform, pkg, files) {
  const resources =
    platform === "darwin"
      ? path.join(app, "SciSlide.app", "Contents", "Resources")
      : path.join(app, "resources");
  const cli = path.join(resources, "scislide-cli");
  await mkdir(path.join(cli, "desktop"), { recursive: true });
  await writeFile(
    path.join(cli, "package.json"),
    JSON.stringify({ name: pkg.name, version: pkg.version }),
  );
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cli, name)), { recursive: true });
    await writeFile(path.join(cli, name), contents);
  }
  const bin = path.join(app, "bin");
  await mkdir(bin, { recursive: true });
  if (platform === "win32") {
    await writeFile(path.join(bin, "scislide.cmd"), windowsLauncher);
  } else {
    const launcher = path.join(bin, "scislide");
    await writeFile(launcher, unixPortableLauncher(platform));
    await chmod(launcher, 0o755);
    if (platform === "darwin") {
      const installed = path.join(cli, "bin", "scislide");
      await mkdir(path.dirname(installed), { recursive: true });
      await writeFile(installed, unixPortableLauncher(platform, true));
      await chmod(installed, 0o755);
    }
  }
}

export function parsePackagingOptions(args, defaults = {}) {
  const options = {
    platform: defaults.platform ?? process.platform,
    arch: defaults.arch ?? process.arch,
    out: defaults.out,
    overwrite: false,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    const match = /^--(platform|arch|out)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Unknown packaging argument: ${argument}`);
    const [, name, inlineValue] = match;
    if (seen.has(name))
      throw new Error(`Duplicate packaging argument: --${name}`);
    seen.add(name);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith("--") || value.includes("\0")) {
      throw new Error(`--${name} requires a value.`);
    }
    options[name] = value;
  }
  if (!platforms.has(options.platform)) {
    throw new Error("--platform must be darwin, linux, or win32.");
  }
  if (!architectures.has(options.arch)) {
    throw new Error("--arch must be arm64 or x64.");
  }
  return options;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function exists(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function packageDesktop(options = {}, dependencies = {}) {
  const root = await realpath(options.root ?? projectRoot);
  const target = parsePackagingOptions([], options);
  target.overwrite = options.overwrite ?? false;
  if (typeof target.overwrite !== "boolean") {
    throw new Error("overwrite must be a boolean.");
  }
  const cliPayload = await cliSources(root);
  const requestedOutput = path.resolve(root, target.out ?? "release");
  for (const input of [
    "dist",
    "dist-cli",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules",
    "public",
  ]) {
    if (isWithin(path.join(root, input), requestedOutput)) {
      throw new Error(
        "The output directory must be outside the packaged inputs and node_modules.",
      );
    }
  }
  await mkdir(requestedOutput, { recursive: true });
  const output = await realpath(requestedOutput);
  for (const input of [
    "dist",
    "dist-cli",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules",
    "public",
  ]) {
    const source = await realpath(path.join(root, input));
    if (isWithin(source, output)) {
      throw new Error(
        "The output directory must be outside the packaged inputs and node_modules.",
      );
    }
  }
  const appDirectory = path.join(
    output,
    `SciSlide-${target.platform}-${target.arch}`,
  );
  if (isWithin(appDirectory, root)) {
    throw new Error(
      "The output app directory cannot contain the source project.",
    );
  }
  const existing = await exists(appDirectory);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error(
        `Refusing to replace a non-directory or symlink: ${appDirectory}`,
      );
    }
    if (!target.overwrite) {
      throw new Error(
        `Output already exists: ${appDirectory}. Use --overwrite to replace this generated app.`,
      );
    }
    const archive =
      target.platform === "darwin"
        ? path.join(
            appDirectory,
            "SciSlide.app",
            "Contents",
            "Resources",
            "app.asar",
          )
        : path.join(appDirectory, "resources", "app.asar");
    if (!(await exists(archive))?.isFile()) {
      throw new Error(
        `Refusing to replace an unrecognized app directory: ${appDirectory}`,
      );
    }
  }

  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const electron = JSON.parse(
    await readFile(
      path.join(root, "node_modules", "electron", "package.json"),
      "utf8",
    ),
  );
  const usage = path.join(
    root,
    "desktop",
    target.platform === "darwin"
      ? "MACOS.md"
      : target.platform === "win32"
        ? "WINDOWS.md"
        : "USAGE.md",
  );
  await readFile(usage, "utf8");
  const stage = await mkdtemp(path.join(os.tmpdir(), "scislide-package-"));
  try {
    // Vite bundles renderer dependencies into dist; the desktop host uses only Electron and Node built-ins.
    for (const name of ["dist", "desktop", "third-party-licenses"]) {
      await cp(path.join(root, name), path.join(stage, name), {
        recursive: true,
        filter: (source) => !/\.test\.(?:cjs|mjs)$/.test(source),
      });
    }
    await writeFile(
      path.join(stage, "package.json"),
      JSON.stringify({
        name: pkg.name,
        productName: "SciSlide",
        version: pkg.version,
        description: pkg.description,
        main: pkg.main,
        private: true,
      }),
    );
    const packageApp =
      dependencies.packager ?? (await import("@electron/packager")).packager;
    const apps = await packageApp({
      dir: stage,
      out: output,
      name: "SciSlide",
      executableName: "scislide",
      platform: target.platform,
      arch: target.arch,
      electronVersion: electron.version,
      appBundleId: "com.scislide.app",
      appCategoryType: "public.app-category.productivity",
      overwrite: target.overwrite,
      asar: true,
      prune: false,
    });
    for (const app of apps) {
      await installCli(app, target.platform, pkg, cliPayload);
      await cp(usage, path.join(app, "README.md"));
      await cp(path.join(root, "examples"), path.join(app, "examples"), {
        recursive: true,
      });
      if (target.platform === "darwin") {
        // A .pkg installs the .app alone, so its usage notes and editable examples also live inside it.
        const resources = path.join(
          app,
          "SciSlide.app",
          "Contents",
          "Resources",
        );
        await cp(usage, path.join(resources, "README.md"));
        await cp(
          path.join(root, "examples"),
          path.join(resources, "examples"),
          { recursive: true },
        );
      }
    }
    return apps;
  } finally {
    // Only remove the unique directory created for this invocation, including on failed packaging.
    await rm(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parsePackagingOptions(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node scripts/package-desktop.mjs [--platform=darwin|linux|win32] [--arch=arm64|x64] [--out=release] [--overwrite]",
      );
      console.log(
        "Defaults to the current platform and architecture. Relative output paths resolve from the project root.",
      );
    } else {
      for (const app of await packageDesktop(options))
        console.log(`Desktop app: ${app}`);
    }
  } catch (error) {
    console.error(`Desktop packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
