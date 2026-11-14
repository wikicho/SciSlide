import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { packageDesktop } from "./package-desktop.mjs";
import {
  assertReleaseVersion,
  assertNoSymlinkParents,
  defaultArtifactDirectory,
  publishReleaseEntries,
} from "./release-layout.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const inputs = [
  "dist",
  "dist-cli",
  "desktop",
  "third-party-licenses",
  "examples",
  "node_modules",
  "public",
];

export function parseMacosOptions(args) {
  const options = {
    arch: "all",
    out: undefined,
    implementation: "js",
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
      if (seen.has(argument))
        throw new Error(`Duplicate argument: ${argument}`);
      seen.add(argument);
      options.overwrite = true;
      continue;
    }
    const match = /^--(arch|out|implementation)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Unknown argument: ${argument}`);
    const [, name, inlineValue] = match;
    if (seen.has(name)) throw new Error(`Duplicate argument: --${name}`);
    seen.add(name);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith("--") || /[\0\r\n]/.test(value))
      throw new Error(`--${name} requires a value.`);
    options[name] = value;
  }
  validateOptions(options);
  return options;
}

function validateOptions(options) {
  if (!["all", "arm64", "x64"].includes(options.arch))
    throw new Error("--arch must be all, arm64 or x64.");
  if (!["js", "native"].includes(options.implementation))
    throw new Error("--implementation must be js or native.");
  if (typeof options.overwrite !== "boolean")
    throw new Error("overwrite must be a boolean.");
  if (
    options.out !== undefined &&
    (typeof options.out !== "string" ||
      !options.out ||
      /[\0\r\n]/.test(options.out))
  )
    throw new Error("out must be a non-empty path.");
}

async function exists(filename) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
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

async function validateOutput(root, requested) {
  await assertNoSymlinkParents(requested);
  const stat = await exists(requested);
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory()))
    throw new Error(
      "The output directory must be a regular directory, not a symlink.",
    );
  // Resolve the existing ancestor before mkdir, so an alias into an input cannot
  // create even an empty output directory in the protected source tree.
  let ancestor = requested;
  const missing = [];
  while (!(await exists(ancestor))) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const canonical = path.join(await realpath(ancestor), ...missing);
  for (const input of inputs) {
    const source = path.join(root, input);
    const canonicalSource = (await exists(source))
      ? await realpath(source)
      : source;
    if (isWithin(source, requested) || isWithin(canonicalSource, canonical))
      throw new Error(
        "The output directory must be outside packaged inputs and node_modules.",
      );
  }
  await mkdir(canonical, { recursive: true });
  return realpath(canonical);
}

async function guardArtifact(filename, overwrite) {
  const stat = await exists(filename);
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Refusing to replace a non-file or symlink: ${filename}`);
  if (!overwrite)
    throw new Error(
      `Output already exists: ${filename}. Choose another --out folder or pass --overwrite.`,
    );
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function packageMacos(options = {}, dependencies = {}) {
  const target = { ...parseMacosOptions([]), ...options };
  validateOptions(target);
  if (target.implementation === "native" && process.platform !== "darwin")
    throw new Error(
      "Native installer packaging requires macOS and Xcode Command Line Tools. Use --implementation=js on this computer.",
    );
  const root = await realpath(target.root ?? dependencies.root ?? projectRoot);
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assertReleaseVersion(pkg.version);
  const output = await validateOutput(
    root,
    target.out === undefined
      ? defaultArtifactDirectory(root, pkg.version, "macos")
      : path.resolve(root, target.out),
  );
  const architectures =
    target.arch === "all" ? ["arm64", "x64"] : [target.arch];
  const installers = architectures.map((arch) => ({
    arch,
    name: `SciSlide-${pkg.version}-macos-${arch}-unsigned.pkg`,
  }));
  const names = [
    ...installers.flatMap(({ name }) => [name, `${name}.sha256`]),
    "MACOS-INSTALL.md",
  ];
  for (const name of names)
    await guardArtifact(path.join(output, name), target.overwrite);
  const usage = await readFile(path.join(root, "desktop", "MACOS.md"));
  const stage = await mkdtemp(path.join(output, ".scislide-macos-"));
  try {
    const packageApp = dependencies.packageDesktop ?? packageDesktop;
    const flatten =
      dependencies.flat ?? (await import("@electron/osx-sign")).flat;
    const apps = path.join(stage, "apps");
    for (const { arch, name } of installers) {
      const [appFolder, ...extra] = await packageApp({
        root,
        platform: "darwin",
        arch,
        out: apps,
        overwrite: false,
      });
      if (
        !appFolder ||
        extra.length ||
        path.resolve(appFolder) !== path.join(apps, `SciSlide-darwin-${arch}`)
      )
        throw new Error(
          "Packaging did not return the expected single macOS app.",
        );
      const appStat = await exists(appFolder);
      const bundle = path.join(appFolder, "SciSlide.app");
      const bundleStat = await exists(bundle);
      if (
        !appStat?.isDirectory() ||
        appStat.isSymbolicLink() ||
        !bundleStat?.isDirectory() ||
        bundleStat.isSymbolicLink()
      )
        throw new Error("The macOS app must be a regular app directory.");
      const filename = path.join(stage, name);
      await flatten({
        app: bundle,
        pkg: filename,
        install: "/Applications",
        platform: "darwin",
        identity: null,
        implementation: target.implementation,
      });
      const installerStat = await exists(filename);
      if (
        !installerStat?.isFile() ||
        installerStat.isSymbolicLink() ||
        !installerStat.size
      )
        throw new Error(
          "The macOS installer is missing, empty or not a regular file.",
        );
      await writeFile(
        `${filename}.sha256`,
        `${await sha256(filename)}  ${name}\n`,
      );
    }
    await writeFile(path.join(stage, "MACOS-INSTALL.md"), usage);
    const publish = dependencies.publishReleaseEntries ?? publishReleaseEntries;
    await publish(
      names.map((name) => ({
        source: path.join(stage, name),
        destination: path.join(output, name),
        kind: "file",
      })),
      { overwrite: target.overwrite },
    );
    return installers.map(({ name }) => path.join(output, name));
  } finally {
    // App trees are build inputs for .pkg creation, not final release artifacts.
    await rm(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseMacosOptions(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node scripts/package-macos.mjs [--arch=all|arm64|x64] [--out=DIR] [--implementation=js|native] [--overwrite]\nBuild the editor first (pnpm build). Default output: release/vVERSION/macos; both architectures, pure-JavaScript unsigned .pkg creation.",
      );
    } else {
      for (const installer of await packageMacos(options))
        console.log(`Unsigned macOS installer: ${installer}`);
    }
  } catch (error) {
    console.error(`macOS packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
