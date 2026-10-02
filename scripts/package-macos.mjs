import { createReadStream } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { packageDesktop } from "./package-desktop.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function parseOptions(args) {
  const options = {
    arch: "all",
    out: path.join(root, "release"),
    implementation: "js",
    overwrite: false,
  };
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [flag, inlineValue] = argument.split(/=(.*)/s, 2);
    if (!["--arch", "--out", "--implementation"].includes(flag))
      throw new Error(`Unknown argument: ${argument}`);
    const value = inlineValue ?? args[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`A value is required for ${flag}.`);
    options[flag.slice(2)] = value;
  }
  if (!["all", "arm64", "x64"].includes(options.arch))
    throw new Error("--arch must be all, arm64 or x64.");
  if (!["js", "native"].includes(options.implementation))
    throw new Error("--implementation must be js or native.");
  if (options.implementation === "native" && process.platform !== "darwin")
    throw new Error(
      "Native installer packaging requires macOS and Xcode Command Line Tools. Use --implementation=js on this computer.",
    );
  options.out = path.resolve(root, options.out);
  return options;
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function packageMacos(options) {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const architectures =
    options.arch === "all" ? ["arm64", "x64"] : [options.arch];
  const installers = architectures.map((arch) => ({
    arch,
    filename: path.join(
      options.out,
      `SciSlide-${pkg.version}-macos-${arch}-unsigned.pkg`,
    ),
  }));
  for (const { arch, filename } of installers) {
    if (
      !options.overwrite &&
      ((await exists(filename)) ||
        (await exists(path.join(options.out, `SciSlide-darwin-${arch}`))))
    )
      throw new Error(
        `Output already exists for ${arch}. Choose another --out folder or pass --overwrite to rebuild it.`,
      );
  }
  await mkdir(options.out, { recursive: true });
  const { flat } = await import("@electron/osx-sign");
  for (const { arch, filename } of installers) {
    const [appFolder] = await packageDesktop({
      root,
      platform: "darwin",
      arch,
      out: options.out,
      overwrite: options.overwrite,
    });
    if (options.overwrite) await rm(filename, { force: true });
    await flat({
      app: path.join(appFolder, "SciSlide.app"),
      pkg: filename,
      install: "/Applications",
      platform: "darwin",
      identity: null,
      implementation: options.implementation,
    });
    await writeFile(
      `${filename}.sha256`,
      `${await sha256(filename)}  ${path.basename(filename)}\n`,
    );
    console.log(`Unsigned macOS installer: ${filename}`);
  }
  await writeFile(
    path.join(options.out, "MACOS-INSTALL.md"),
    await readFile(path.join(root, "desktop/MACOS.md")),
  );
  return installers.map(({ filename }) => filename);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node scripts/package-macos.mjs [--arch=all|arm64|x64] [--out=release] [--implementation=js|native] [--overwrite]\nBuild the editor first (pnpm build). Default: both architectures, pure-JavaScript unsigned .pkg creation.",
      );
    } else {
      await packageMacos(options);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
