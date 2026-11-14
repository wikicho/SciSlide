import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
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
import { publishReleaseEntries } from "../scripts/release-layout.mjs";

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
    await mkdtemp(
      path.join(await realpath(os.tmpdir()), "scislide-windows-test-"),
    ),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [
    "dist",
    "dist-cli",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules",
    "public",
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
  assert.equal(parseWindowsOptions([]).out, undefined);
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
  assert.equal(packaged.overwrite, false);
  assert.equal(path.basename(packaged.out), "apps");
  assert.match(
    path.basename(path.dirname(packaged.out)),
    /^\.scislide-windows-/,
  );
  assert.equal(
    path.dirname(path.dirname(packaged.out)),
    path.join(root, "release/v0.3.0/windows"),
  );
  assert.equal(
    result.appFolder,
    path.join(root, "release/work/v0.3.0/SciSlide-win32-x64"),
  );
  await assert.rejects(lstat(packaged.out), { code: "ENOENT" });
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
    await readFile(
      path.join(root, "release/v0.3.0/windows/WINDOWS-INSTALL.md"),
      "utf8",
    ),
    "Windows x64 instructions",
  );
  assert.ok(
    (await readdir(path.join(root, "release/v0.3.0/windows"))).every(
      (entry) => !entry.startsWith(".scislide-windows-"),
    ),
  );
});

test("portable packaging preserves the four-part application revision", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ version: "0.6.3.1" }),
  );
  const result = await packageWindows(
    { root, portableOnly: true },
    { packageDesktop: fakeApp },
  );
  assert.equal(
    path.basename(result.portable),
    "SciSlide-0.6.3.1-windows-x64-portable.zip",
  );
  for (const version of ["0.6.3.01", "0.6.3.1.2", "0.06.3.1"]) {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version }),
    );
    await assert.rejects(
      packageWindows({ root, portableOnly: true }),
      /safe semantic version/,
    );
  }
});

test("existing distributions are preserved on collision and on a failed replacement build", async (t) => {
  const root = await fixture(t);
  const first = await packageWindows(
    { root, portableOnly: true },
    { packageDesktop: fakeApp },
  );
  const original = await readFile(first.portable);
  const originalApp = await readFile(
    path.join(first.appFolder, "resources/app.asar"),
  );
  const originalExecutable = await readFile(
    path.join(first.appFolder, "scislide.exe"),
  );
  const originalChecksum = await readFile(`${first.portable}.sha256`);
  const originalGuide = await readFile(
    path.join(path.dirname(first.portable), "WINDOWS-INSTALL.md"),
  );
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
      {
        packageDesktop: async (options) => {
          const apps = await fakeApp(options, pe(0x014c));
          await writeFile(
            path.join(apps[0], "resources/app.asar"),
            "failed replacement app",
          );
          return apps;
        },
      },
    ),
    /AMD64/,
  );
  assert.deepEqual(await readFile(first.portable), original);
  assert.deepEqual(
    await readFile(path.join(first.appFolder, "resources/app.asar")),
    originalApp,
  );
  assert.deepEqual(
    await readFile(path.join(first.appFolder, "scislide.exe")),
    originalExecutable,
  );
  assert.deepEqual(
    await readFile(`${first.portable}.sha256`),
    originalChecksum,
  );
  assert.deepEqual(
    await readFile(
      path.join(path.dirname(first.portable), "WINDOWS-INSTALL.md"),
    ),
    originalGuide,
  );
  assert.ok(
    (await readdir(path.join(root, "release/v0.3.0/windows"))).every(
      (entry) => !entry.startsWith(".scislide-windows-"),
    ),
  );
});

test("packaging refuses input directories and symlink artifact replacements", async (t) => {
  const root = await fixture(t);
  let built = false;
  for (const input of [
    "dist",
    "dist-cli",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules",
    "public",
  ]) {
    const destination = path.join(root, input, "output");
    await assert.rejects(
      packageWindows(
        { root, portableOnly: true, out: destination },
        {
          packageDesktop: async () => {
            built = true;
          },
        },
      ),
      /outside packaged inputs/,
    );
    await assert.rejects(lstat(destination), { code: "ENOENT" });
  }
  assert.equal(built, false);
  await mkdir(path.join(root, "release/v0.3.0/windows"), { recursive: true });
  const filename = path.join(
    root,
    "release/v0.3.0/windows/SciSlide-0.3.0-windows-x64-portable.zip",
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

test("an explicit Windows output keeps the app and completed artifacts at the requested location", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "custom output");
  const result = await packageWindows(
    { root, portableOnly: true, out: "custom output" },
    { packageDesktop: fakeApp },
  );
  assert.equal(result.appFolder, path.join(destination, "SciSlide-win32-x64"));
  assert.equal(
    result.portable,
    path.join(destination, "SciSlide-0.3.0-windows-x64-portable.zip"),
  );
  assert.deepEqual(
    (await readdir(destination)).sort(),
    [
      "SciSlide-win32-x64",
      "SciSlide-0.3.0-windows-x64-portable.zip",
      "SciSlide-0.3.0-windows-x64-portable.zip.sha256",
      "WINDOWS-INSTALL.md",
    ].toSorted(),
  );
  await assert.rejects(lstat(path.join(root, "release")), { code: "ENOENT" });
});

test("a Windows checksum publication failure restores the complete app, ZIP, checksum, and guide", async (t) => {
  const root = await fixture(t);
  const first = await packageWindows(
    { root, portableOnly: true },
    { packageDesktop: fakeApp },
  );
  const guide = path.join(path.dirname(first.portable), "WINDOWS-INSTALL.md");
  const files = [
    first.portable,
    `${first.portable}.sha256`,
    guide,
    path.join(first.appFolder, "resources/app.asar"),
    path.join(first.appFolder, "scislide.exe"),
    path.join(first.appFolder, "README.md"),
  ];
  const original = await Promise.all(files.map((file) => readFile(file)));
  await writeFile(
    path.join(root, "desktop/WINDOWS.md"),
    "Changed Windows instructions",
  );
  let failed = false;
  await assert.rejects(
    packageWindows(
      { root, portableOnly: true, overwrite: true },
      {
        packageDesktop: async (options) => {
          const apps = await fakeApp(options);
          await writeFile(
            path.join(apps[0], "resources/app.asar"),
            "new app payload",
          );
          return apps;
        },
        publishReleaseEntries: (entries, options) =>
          publishReleaseEntries(entries, options, {
            rename: async (source, destination) => {
              if (
                !failed &&
                source.includes(".scislide-windows-") &&
                source.endsWith(".zip.sha256")
              ) {
                failed = true;
                throw new Error("Windows checksum publication interrupted");
              }
              return rename(source, destination);
            },
          }),
      },
    ),
    /Windows checksum publication interrupted/,
  );
  assert.equal(failed, true);
  assert.deepEqual(
    await Promise.all(files.map((file) => readFile(file))),
    original,
  );
  assert.deepEqual(
    (await readdir(path.dirname(first.portable))).sort(),
    [
      path.basename(first.portable),
      `${path.basename(first.portable)}.sha256`,
      "WINDOWS-INSTALL.md",
    ].toSorted(),
  );
  assert.deepEqual(await readdir(path.dirname(first.appFolder)), [
    "SciSlide-win32-x64",
  ]);
});

test("a late Windows sidecar collision publishes neither the app nor the portable ZIP", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "release/v0.3.0/windows");
  const checksum = path.join(
    destination,
    "SciSlide-0.3.0-windows-x64-portable.zip.sha256",
  );
  await assert.rejects(
    packageWindows(
      { root, portableOnly: true },
      {
        packageDesktop: async (options) => {
          const apps = await fakeApp(options);
          await writeFile(checksum, "another build owns this checksum");
          return apps;
        },
      },
    ),
    /Output already exists/,
  );
  assert.deepEqual(await readdir(destination), [path.basename(checksum)]);
  assert.equal(
    await readFile(checksum, "utf8"),
    "another build owns this checksum",
  );
  await assert.rejects(
    lstat(path.join(root, "release/work/v0.3.0/SciSlide-win32-x64")),
    { code: "ENOENT" },
  );
});

test("Windows validates programmatic output paths before building and tolerates absent optional inputs", async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, "dist-cli"), { recursive: true });
  await rm(path.join(root, "public"), { recursive: true });
  for (const out of [null, 12, {}, "", "bad\npath", "bad\0path"]) {
    let built = false;
    await assert.rejects(
      packageWindows(
        { root, portableOnly: true, out },
        {
          packageDesktop: async () => {
            built = true;
          },
        },
      ),
      /out must be a non-empty path/,
    );
    assert.equal(built, false);
    await assert.rejects(lstat(path.join(root, "release")), { code: "ENOENT" });
  }
  const result = await packageWindows(
    { root, portableOnly: true },
    { packageDesktop: fakeApp },
  );
  assert.equal(
    result.appFolder,
    path.join(root, "release/work/v0.3.0/SciSlide-win32-x64"),
  );
});
