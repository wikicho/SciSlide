import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
  const requestedOutput = path.resolve(root, target.out ?? "release");
  for (const input of [
    "dist",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules",
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
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules",
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
