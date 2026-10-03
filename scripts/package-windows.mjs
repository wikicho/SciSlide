import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import JSZip from "jszip";
import { packageDesktop } from "./package-desktop.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);

export function parseWindowsOptions(args) {
  const options = {
    arch: "x64",
    out: "release",
    overwrite: false,
    portableOnly: false,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (["--overwrite", "--portable-only"].includes(argument)) {
      if (seen.has(argument))
        throw new Error(`Duplicate argument: ${argument}`);
      seen.add(argument);
      options[argument === "--overwrite" ? "overwrite" : "portableOnly"] = true;
      continue;
    }
    const match = /^--(arch|out|iscc)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Unknown argument: ${argument}`);
    const [, name, inlineValue] = match;
    if (seen.has(name)) throw new Error(`Duplicate argument: --${name}`);
    seen.add(name);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith("--") || /[\0\r\n]/.test(value)) {
      throw new Error(`--${name} requires a value.`);
    }
    options[name] = value;
  }
  if (options.arch !== "x64") {
    throw new Error("Windows packaging currently supports --arch=x64 only.");
  }
  if (options.portableOnly && options.iscc) {
    throw new Error("--iscc cannot be combined with --portable-only.");
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

async function exists(filename) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function validateOutput(root, requestedOutput) {
  const inputs = [
    "dist",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules",
  ];
  for (const input of inputs) {
    if (isWithin(path.join(root, input), requestedOutput)) {
      throw new Error(
        "The output directory must be outside packaged inputs and node_modules.",
      );
    }
  }
  await mkdir(requestedOutput, { recursive: true });
  const output = await realpath(requestedOutput);
  for (const input of inputs) {
    if (isWithin(await realpath(path.join(root, input)), output)) {
      throw new Error(
        "The output directory must be outside packaged inputs and node_modules.",
      );
    }
  }
  if (isWithin(path.join(output, "SciSlide-win32-x64"), root)) {
    throw new Error(
      "The output app directory cannot contain the source project.",
    );
  }
  return output;
}

async function guardArtifact(filename, overwrite) {
  const stat = await exists(filename);
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Refusing to replace a non-file or symlink: ${filename}`);
  }
  if (!overwrite) {
    throw new Error(
      `Output already exists: ${filename}. Choose another --out folder or pass --overwrite.`,
    );
  }
}

// Check both the PE machine and optional-header magic, rather than trusting a filename.
export async function verifyWindowsX64(filename) {
  const file = await open(filename, "r");
  try {
    const stat = await file.stat();
    const dos = Buffer.alloc(64);
    const { bytesRead } = await file.read(dos, 0, dos.length, 0);
    if (bytesRead !== dos.length || dos.toString("ascii", 0, 2) !== "MZ") {
      throw new Error(`Not a Windows PE executable: ${filename}`);
    }
    const offset = dos.readUInt32LE(60);
    if (offset < 64 || offset > stat.size - 26) {
      throw new Error(`Invalid Windows PE header: ${filename}`);
    }
    const pe = Buffer.alloc(26);
    const header = await file.read(pe, 0, pe.length, offset);
    if (
      header.bytesRead !== pe.length ||
      pe.readUInt32LE(0) !== 0x00004550 ||
      pe.readUInt16LE(4) !== 0x8664 ||
      pe.readUInt16LE(20) < 2 ||
      pe.readUInt16LE(24) !== 0x020b
    ) {
      throw new Error(`Expected an AMD64/x64 PE32+ executable: ${filename}`);
    }
  } finally {
    await file.close();
  }
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function portableZip(appFolder, filename) {
  const zip = new JSZip();
  const base = path.basename(appFolder);
  async function add(directory, relative = "") {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name, "en"),
    );
    for (const entry of entries) {
      const source = path.join(directory, entry.name);
      const target = `${base}/${relative}${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Portable Windows apps cannot contain symbolic links: ${source}`,
        );
      }
      if (entry.isDirectory()) {
        zip.folder(target);
        await add(source, `${relative}${entry.name}/`);
      } else if (entry.isFile()) {
        zip.file(target, createReadStream(source), { binary: true });
      } else {
        throw new Error(`Unsupported packaged file: ${source}`);
      }
    }
  }
  await add(appFolder);
  const file = await open(filename, "wx");
  try {
    await pipeline(
      zip.generateNodeStream({
        type: "nodebuffer",
        streamFiles: true,
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
        platform: "DOS",
      }),
      file.createWriteStream(),
    );
  } finally {
    await file.close();
  }
}

async function findCompiler(root, override) {
  if (override) {
    const filename = path.resolve(root, override);
    const stat = await exists(filename);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `Inno Setup compiler must be a regular file: ${filename}`,
      );
    }
    return filename;
  }
  for (const prefix of [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
  ]) {
    if (!prefix) continue;
    const filename = path.join(prefix, "Inno Setup 6", "ISCC.exe");
    if ((await exists(filename))?.isFile()) return filename;
  }
  throw new Error(
    "Install Inno Setup 6.7 or newer, then pass --iscc=C:\\path\\to\\ISCC.exe if it is outside Program Files.",
  );
}

export async function packageWindows(options = {}, dependencies = {}) {
  const target = { ...parseWindowsOptions([]), ...options };
  if (target.arch !== "x64")
    throw new Error("Windows packaging currently supports --arch=x64 only.");
  if (
    typeof target.overwrite !== "boolean" ||
    typeof target.portableOnly !== "boolean"
  ) {
    throw new Error("overwrite and portableOnly must be booleans.");
  }
  if (target.portableOnly && target.iscc)
    throw new Error("--iscc cannot be combined with --portable-only.");
  if (!target.portableOnly && process.platform !== "win32") {
    throw new Error(
      "The Windows installer requires native Windows and Inno Setup 6.7 or newer. Use --portable-only on this computer.",
    );
  }
  const root = await realpath(target.root ?? projectRoot);
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error("The package version must be a safe semantic version.");
  }
  const compiler = target.portableOnly
    ? null
    : await findCompiler(root, target.iscc);
  const output = await validateOutput(root, path.resolve(root, target.out));
  const stem = `SciSlide-${pkg.version}-windows-x64`;
  const portable = `${stem}-portable.zip`;
  const installer = `${stem}-setup-unsigned.exe`;
  const names = [portable, `${portable}.sha256`, "WINDOWS-INSTALL.md"];
  if (!target.portableOnly) names.push(installer, `${installer}.sha256`);
  for (const name of names)
    await guardArtifact(path.join(output, name), target.overwrite);
  const usage = await readFile(path.join(root, "desktop", "WINDOWS.md"));
  const stage = await mkdtemp(path.join(output, ".scislide-windows-"));
  try {
    const packageApp = dependencies.packageDesktop ?? packageDesktop;
    const [appFolder, ...extra] = await packageApp({
      root,
      platform: "win32",
      arch: "x64",
      out: output,
      overwrite: target.overwrite,
    });
    if (
      !appFolder ||
      extra.length ||
      path.resolve(appFolder) !== path.join(output, "SciSlide-win32-x64")
    ) {
      throw new Error(
        "Packaging did not return the expected single Windows x64 app.",
      );
    }
    await verifyWindowsX64(path.join(appFolder, "scislide.exe"));
    const appArchive = await exists(
      path.join(appFolder, "resources", "app.asar"),
    );
    if (!appArchive?.isFile() || appArchive.size === 0) {
      throw new Error(
        "The Windows app is missing its bundled app.asar payload.",
      );
    }
    await portableZip(appFolder, path.join(stage, portable));
    if (compiler) {
      const result = await run(
        compiler,
        [
          "/Qp",
          `/DAppVersion=${pkg.version}`,
          `/DAppSource=${appFolder}`,
          `/DInstallerOutput=${stage}`,
          `/DInstallerName=${path.basename(installer, ".exe")}`,
          path.join(root, "desktop", "windows-installer.iss"),
        ],
        { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      );
      if (result.stdout) console.log(result.stdout.trim());
      if (result.stderr) console.error(result.stderr.trim());
      await verifyWindowsX64(path.join(stage, installer));
    }
    for (const name of [portable, ...(compiler ? [installer] : [])]) {
      await writeFile(
        path.join(stage, `${name}.sha256`),
        `${await sha256(path.join(stage, name))}  ${name}\n`,
      );
    }
    await writeFile(path.join(stage, "WINDOWS-INSTALL.md"), usage);
    // Do not replace earlier archives/checksums until every artifact has been built successfully.
    for (const name of names) {
      const destination = path.join(output, name);
      await guardArtifact(destination, target.overwrite);
      if (target.overwrite) await rm(destination, { force: true });
      await rename(path.join(stage, name), destination);
    }
    return {
      appFolder,
      portable: path.join(output, portable),
      installer: compiler ? path.join(output, installer) : null,
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseWindowsOptions(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node scripts/package-windows.mjs [--arch=x64] [--out=release] [--overwrite] [--portable-only] [--iscc=path/to/ISCC.exe]\nBuild the editor first (pnpm build). Windows creates a portable ZIP and an unsigned per-user installer. Other platforms require --portable-only.",
      );
    } else {
      const result = await packageWindows(options);
      console.log(`Windows x64 app: ${result.appFolder}`);
      console.log(`Portable Windows x64 ZIP: ${result.portable}`);
      if (result.installer)
        console.log(`Unsigned Windows x64 installer: ${result.installer}`);
    }
  } catch (error) {
    console.error(`Windows packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
