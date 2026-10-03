import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import {
  packageWindows,
  parseWindowsOptions,
  verifyWindowsX64,
} from "../scripts/package-windows.mjs";

function pe(machine = 0x8664, magic = 0x020b) {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 60);
  bytes.writeUInt32LE(0x00004550, 64);
  bytes.writeUInt16LE(machine, 68);
  bytes.writeUInt16LE(2, 84);
  bytes.writeUInt16LE(magic, 88);
  return bytes;
}

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "scislide-windows-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [
    "dist",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules",
  ]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ version: "0.3.0" }),
  );
  await writeFile(
    path.join(root, "desktop/WINDOWS.md"),
    "Windows x64 instructions",
  );
  return root;
}

async function fakeApp(options, executable = pe()) {
  const directory = path.join(options.out, "SciSlide-win32-x64");
  await mkdir(path.join(directory, "resources"), { recursive: true });
  await mkdir(path.join(directory, "examples"), { recursive: true });
  await writeFile(path.join(directory, "scislide.exe"), executable);
  await writeFile(
    path.join(directory, "resources/app.asar"),
    "bundled offline app",
  );
  await writeFile(
    path.join(directory, "README.md"),
    "Windows x64 instructions",
  );
  await writeFile(
    path.join(directory, "examples/example.scislide"),
    "editable example",
  );
  return [directory];
}

test("Windows arguments always target x64 and reject unsupported or ambiguous options", () => {
  assert.equal(parseWindowsOptions([]).arch, "x64");
  assert.deepEqual(
    parseWindowsOptions([
      "--arch=x64",
      "--out",
      "custom",
      "--portable-only",
      "--overwrite",
    ]),
    {
      arch: "x64",
      out: "custom",
      overwrite: true,
      portableOnly: true,
      help: false,
    },
  );
  for (const args of [
    ["--arch=arm64"],
    ["--arch=ia32"],
    ["--platform=win32"],
    ["--arch=x64", "--arch=x64"],
    ["--out"],
    ["--out=bad\npath"],
    ["--portable-only", "--iscc=compiler.exe"],
  ])
    assert.throws(() => parseWindowsOptions(args));
});

test("PE validation rejects x86, ARM64, corrupt headers, and PE32 optional headers", async (t) => {
  const root = await fixture(t);
  const executable = path.join(root, "app.exe");
  await writeFile(executable, pe());
  await verifyWindowsX64(executable);
  for (const bytes of [
    pe(0x014c),
    pe(0xaa64),
    pe(0x8664, 0x010b),
    Buffer.from("MZ"),
    Buffer.alloc(128),
  ]) {
    await writeFile(executable, bytes);
    await assert.rejects(verifyWindowsX64(executable), /Windows PE|AMD64/);
  }
  const badOffset = pe();
  badOffset.writeUInt32LE(0xffffffff, 60);
  await writeFile(executable, badOffset);
  await assert.rejects(
    verifyWindowsX64(executable),
    /Invalid Windows PE header/,
  );
});

test("portable ZIP contains the complete x64 app and matching SHA-256 without requiring a native compiler", async (t) => {
  const root = await fixture(t);
  let packaged;
  const result = await packageWindows(
    { root, portableOnly: true },
    {
      packageDesktop: async (options) => {
        packaged = options;
        return fakeApp(options);
      },
    },
  );
  assert.equal(packaged.platform, "win32");
  assert.equal(packaged.arch, "x64");
  assert.equal(result.installer, null);
  const archive = await readFile(result.portable);
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  const prefix = "SciSlide-win32-x64/";
  assert.deepEqual(
    await zip.file(`${prefix}scislide.exe`).async("nodebuffer"),
    pe(),
  );
  assert.equal(
    await zip.file(`${prefix}resources/app.asar`).async("string"),
    "bundled offline app",
  );
  assert.ok(zip.file(`${prefix}README.md`));
  assert.ok(zip.file(`${prefix}examples/example.scislide`));
  const hash = createHash("sha256").update(archive).digest("hex");
  assert.equal(
    await readFile(`${result.portable}.sha256`, "utf8"),
    `${hash}  ${path.basename(result.portable)}\n`,
  );
  assert.equal(
    await readFile(path.join(root, "release/WINDOWS-INSTALL.md"), "utf8"),
    "Windows x64 instructions",
  );
  assert.ok(
    (await readdir(path.join(root, "release"))).every(
      (entry) => !entry.startsWith(".scislide-windows-"),
    ),
  );
});

test("existing distributions are preserved on collision and on a failed replacement build", async (t) => {
  const root = await fixture(t);
  const first = await packageWindows(
    { root, portableOnly: true },
    { packageDesktop: fakeApp },
  );
  const original = await readFile(first.portable);
  let called = false;
  await assert.rejects(
    packageWindows(
      { root, portableOnly: true },
      {
        packageDesktop: async () => {
          called = true;
        },
      },
    ),
    /Output already exists/,
  );
  assert.equal(called, false);
  await assert.rejects(
    packageWindows(
      { root, portableOnly: true, overwrite: true },
      { packageDesktop: (options) => fakeApp(options, pe(0x014c)) },
    ),
    /AMD64/,
  );
  assert.deepEqual(await readFile(first.portable), original);
  assert.ok(
    (await readdir(path.join(root, "release"))).every(
      (entry) => !entry.startsWith(".scislide-windows-"),
    ),
  );
});

test("packaging refuses input directories and symlink artifact replacements", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    packageWindows({ root, portableOnly: true, out: "dist/output" }),
    /outside packaged inputs/,
  );
  await mkdir(path.join(root, "release"));
  const filename = path.join(
    root,
    "release/SciSlide-0.3.0-windows-x64-portable.zip",
  );
  if (process.platform === "win32") {
    // Junctions are available to an unelevated Windows developer and exercise the same lstat guard.
    await symlink(path.join(root, "dist"), filename, "junction");
  } else {
    await symlink(path.join(root, "package.json"), filename);
  }
  await assert.rejects(
    packageWindows({ root, portableOnly: true, overwrite: true }),
    /non-file or symlink/,
  );
  assert.ok((await lstat(filename)).isSymbolicLink());
  assert.equal(
    JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version,
    "0.3.0",
  );
});

test(
  "native installer requests fail explicitly on other operating systems",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await fixture(t);
    await assert.rejects(packageWindows({ root }), /requires native Windows/);
  },
);
