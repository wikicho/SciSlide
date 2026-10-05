import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { packageDesktop } from "./package-desktop.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const inputs = [
  "dist",
  "desktop",
  "third-party-licenses",
  "examples",
  "node_modules",
  "public",
];

// Alternatives cover Debian/Ubuntu releases on either side of the t64 rename.
export const LINUX_DEPENDS = [
  "libc6 (>= 2.25)",
  "libgcc-s1",
  "libglib2.0-0t64 | libglib2.0-0",
  "libnspr4",
  "libnss3",
  "libatk1.0-0t64 | libatk1.0-0",
  "libatk-bridge2.0-0t64 | libatk-bridge2.0-0",
  "libcups2t64 | libcups2",
  "libdbus-1-3",
  "libcairo2",
  "libgtk-3-0t64 | libgtk-3-0",
  "libpango-1.0-0",
  "libx11-6",
  "libxcomposite1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxrandr2",
  "libgbm1",
  "libexpat1",
  "libxcb1",
  "libxkbcommon0",
  "libudev1",
  "libasound2t64 | libasound2",
  "libatspi2.0-0t64 | libatspi2.0-0",
];

export function parseLinuxOptions(args) {
  const options = {
    arch: "x64",
    out: "release",
    overwrite: false,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (["--help", "-h", "--overwrite"].includes(argument)) {
      const name = argument === "-h" ? "--help" : argument;
      if (seen.has(name)) throw new Error(`Duplicate argument: ${argument}`);
      seen.add(name);
      options[name === "--help" ? "help" : "overwrite"] = true;
      continue;
    }
    const match = /^--(arch|out)(?:=(.*))?$/.exec(argument);
    if (!match) throw new Error(`Unknown argument: ${argument}`);
    const [, name, inlineValue] = match;
    if (seen.has(name)) throw new Error(`Duplicate argument: --${name}`);
    seen.add(name);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith("--") || /[\0\r\n]/.test(value))
      throw new Error(`--${name} requires a value.`);
    options[name] = value;
  }
  if (options.arch !== "x64")
    throw new Error("Linux .deb packaging currently supports --arch=x64 only.");
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

async function validateOutput(root, requested) {
  for (const input of inputs)
    if (isWithin(path.join(root, input), requested))
      throw new Error(
        "The output directory must be outside packaged inputs and node_modules.",
      );
  await mkdir(requested, { recursive: true });
  const output = await realpath(requested);
  for (const input of inputs) {
    const source = await exists(path.join(root, input));
    if (source && isWithin(await realpath(path.join(root, input)), output))
      throw new Error(
        "The output directory must be outside packaged inputs and node_modules.",
      );
  }
  if (isWithin(path.join(output, "SciSlide-linux-x64"), root))
    throw new Error(
      "The output app directory cannot contain the source project.",
    );
  return output;
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

/** Check the actual binary, rather than trusting a folder or artifact name. */
export async function verifyLinuxX64(filename) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Linux executable must be a regular file: ${filename}`);
  const file = await open(filename, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (
      bytesRead !== 64 ||
      header.readUInt32BE(0) !== 0x7f454c46 ||
      header[4] !== 2 ||
      header[5] !== 1 ||
      header[6] !== 1 ||
      ![2, 3].includes(header.readUInt16LE(16)) ||
      header.readUInt16LE(18) !== 62
    )
      throw new Error(`Expected a Linux x64 ELF64 executable: ${filename}`);
  } finally {
    await file.close();
  }
}

// Without an executable set this validates the source without changing it.
// Supplying a set normalizes the newly created installation payload.
async function walkPayload(directory, executables) {
  if (executables) await chmod(directory, 0o755);
  let installedKiB = 1;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        `Packaged Linux app cannot contain symbolic links: ${filename}`,
      );
    if (entry.isDirectory())
      installedKiB += await walkPayload(filename, executables);
    else if (entry.isFile()) {
      const stat = await lstat(filename);
      if (executables)
        await chmod(filename, executables.has(filename) ? 0o755 : 0o644);
      installedKiB += Math.ceil(stat.size / 1024);
    } else throw new Error(`Unsupported packaged file: ${filename}`);
  }
  return installedKiB;
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function packageLinux(options = {}, dependencies = {}) {
  const target = { ...parseLinuxOptions([]), ...options };
  if (target.arch !== "x64")
    throw new Error("Linux .deb packaging currently supports --arch=x64 only.");
  if (typeof target.overwrite !== "boolean")
    throw new Error("overwrite must be a boolean.");
  if (
    typeof target.out !== "string" ||
    !target.out ||
    /[\0\r\n]/.test(target.out)
  )
    throw new Error("out must be a non-empty path.");
  if (process.platform !== "linux")
    throw new Error(
      "Linux .deb packaging requires Linux and dpkg-deb. Use the Linux packaging workflow on other platforms.",
    );
  const root = await realpath(target.root ?? projectRoot);
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(pkg.version))
    throw new Error("The package version must be a safe semantic version.");
  const usage = await readFile(path.join(root, "desktop", "LINUX.md"));
  const icon = await readFile(path.join(root, "desktop", "linux-icon.svg"));
  const execute = dependencies.run ?? run;
  try {
    await execute("dpkg-deb", ["--version"], { maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error(
      "Install dpkg (provides dpkg-deb) to build a Linux .deb package.",
    );
  }
  const output = await validateOutput(root, path.resolve(root, target.out));
  const debName = `SciSlide-${pkg.version}-linux-x64.deb`;
  const names = [debName, `${debName}.sha256`, "LINUX-INSTALL.md"];
  for (const name of names)
    await guardArtifact(path.join(output, name), target.overwrite);
  const stage = await mkdtemp(path.join(output, ".scislide-linux-"));
  try {
    const packageApp = dependencies.packageDesktop ?? packageDesktop;
    const [appFolder, ...extra] = await packageApp({
      root,
      platform: "linux",
      arch: "x64",
      out: output,
      overwrite: target.overwrite,
    });
    if (
      !appFolder ||
      extra.length ||
      path.resolve(appFolder) !== path.join(output, "SciSlide-linux-x64") ||
      (await lstat(appFolder)).isSymbolicLink()
    )
      throw new Error(
        "Packaging did not return the expected single Linux x64 app.",
      );
    await verifyLinuxX64(path.join(appFolder, "scislide"));
    await verifyLinuxX64(path.join(appFolder, "chrome-sandbox"));
    const archive = await exists(path.join(appFolder, "resources", "app.asar"));
    if (!archive?.isFile() || archive.isSymbolicLink() || !archive.size)
      throw new Error("The Linux app is missing its bundled app.asar payload.");
    // Reject every source link before any README write or payload copy.
    await walkPayload(appFolder);
    const tree = path.join(stage, "package");
    const app = path.join(tree, "opt", "scislide");
    await writeFile(path.join(appFolder, "README.md"), usage);
    await mkdir(path.dirname(app), { recursive: true });
    await cp(appFolder, app, { recursive: true, verbatimSymlinks: true });
    await writeFile(path.join(app, "README.md"), usage);
    const applications = path.join(tree, "usr", "share", "applications");
    const icons = path.join(
      tree,
      "usr",
      "share",
      "icons",
      "hicolor",
      "scalable",
      "apps",
    );
    const docs = path.join(tree, "usr", "share", "doc", "scislide");
    const bin = path.join(tree, "usr", "bin");
    for (const directory of [applications, icons, docs, bin])
      await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(applications, "scislide.desktop"),
      [
        "[Desktop Entry]",
        "Version=1.0",
        "Type=Application",
        "Name=SciSlide",
        "Comment=Scientific presentations with editable equations",
        "Exec=/usr/bin/scislide",
        "TryExec=/usr/bin/scislide",
        "Icon=scislide",
        "Terminal=false",
        "Categories=Office;Education;Science;",
        "StartupWMClass=SciSlide",
        "",
      ].join("\n"),
    );
    await writeFile(path.join(icons, "scislide.svg"), icon);
    await writeFile(path.join(docs, "README.md"), usage);
    await writeFile(
      path.join(docs, "copyright"),
      [
        "SciSlide: https://github.com/wikicho/SciSlide",
        "The license for new SciSlide project source has not yet been selected.",
        "Electron/Chromium notices: /opt/scislide/LICENSE and /opt/scislide/LICENSES.chromium.html.",
        "Application dependency and bundled font notices: third-party-licenses/ in /opt/scislide/resources/app.asar.",
        "",
      ].join("\n"),
    );
    const installedSize = await walkPayload(
      tree,
      new Set([
        path.join(app, "scislide"),
        path.join(app, "chrome-sandbox"),
        path.join(app, "chrome_crashpad_handler"),
      ]),
    );
    await chmod(path.join(app, "scislide"), 0o755);
    // Set the bit only on this temporary payload. dpkg-deb records root:root
    // ownership; installation provides Chromium's normal setuid sandbox.
    await chmod(path.join(app, "chrome-sandbox"), 0o4755);
    await symlink("/opt/scislide/scislide", path.join(bin, "scislide"));
    const control = path.join(tree, "DEBIAN");
    await mkdir(control, { mode: 0o755 });
    await writeFile(
      path.join(control, "control"),
      [
        "Package: scislide",
        `Version: ${pkg.version.replace("-", "~")}`,
        "Section: science",
        "Priority: optional",
        "Architecture: amd64",
        "Maintainer: SciSlide contributors <wikicho@users.noreply.github.com>",
        `Installed-Size: ${installedSize + 1}`,
        `Depends: ${LINUX_DEPENDS.join(", ")}`,
        "Recommends: hicolor-icon-theme, xdg-utils",
        "Suggests: bubblewrap (>= 0.9.0), util-linux, dvisvgm, texlive-latex-extra, texlive-xetex",
        "Homepage: https://github.com/wikicho/SciSlide",
        "Description: Scientific presentation editor with editable equations",
        " Create slides with text, figures, equations, shapes and video.",
        " MathJax works offline. Installed LaTeX and supported LLM CLIs are optional.",
        "",
      ].join("\n"),
      { mode: 0o644 },
    );
    await execute(
      "dpkg-deb",
      [
        "--root-owner-group",
        "-Zxz",
        "-z3",
        "--build",
        tree,
        path.join(stage, debName),
      ],
      {
        maxBuffer: 4 * 1024 * 1024,
        // Older dpkg versions safely ignore this optional compression limit.
        env: { ...process.env, DPKG_DEB_THREADS_MAX: "2" },
      },
    );
    const fields = await execute(
      "dpkg-deb",
      [
        "--field",
        path.join(stage, debName),
        "Package",
        "Version",
        "Architecture",
      ],
      { maxBuffer: 1024 * 1024 },
    );
    if (
      !/^Package: scislide$/m.test(fields.stdout) ||
      !/^Architecture: amd64$/m.test(fields.stdout) ||
      !fields.stdout
        .split("\n")
        .includes(`Version: ${pkg.version.replace("-", "~")}`)
    )
      throw new Error(
        "Built package metadata does not match the expected version and amd64 architecture.",
      );
    await writeFile(
      path.join(stage, `${debName}.sha256`),
      `${await sha256(path.join(stage, debName))}  ${debName}\n`,
    );
    await writeFile(path.join(stage, "LINUX-INSTALL.md"), usage);
    // Publish completed artifacts only after build, validation and hashing.
    for (const name of names) {
      const destination = path.join(output, name);
      await guardArtifact(destination, target.overwrite);
      await rename(path.join(stage, name), destination);
    }
    return {
      appFolder,
      deb: path.join(output, debName),
      checksum: path.join(output, `${debName}.sha256`),
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
    const options = parseLinuxOptions(process.argv.slice(2));
    if (options.help)
      console.log(
        "Usage: node scripts/package-linux.mjs [--arch=x64] [--out=release] [--overwrite]\nBuild the editor first (pnpm build). Creates an amd64 .deb, SHA-256 checksum, desktop launcher and Linux instructions. Requires Linux and dpkg-deb.",
      );
    else {
      const result = await packageLinux(options);
      console.log(`Linux x64 app: ${result.appFolder}`);
      console.log(`Ubuntu/Debian package: ${result.deb}`);
      console.log(`SHA-256: ${result.checksum}`);
    }
  } catch (error) {
    console.error(`Linux packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
