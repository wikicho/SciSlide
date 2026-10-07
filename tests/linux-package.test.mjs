import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  packageLinux,
  parseLinuxOptions,
  verifyLinuxX64,
} from "../scripts/package-linux.mjs";

const run = promisify(execFile);
const linux = process.platform === "linux";
const hasDebTool =
  linux &&
  spawnSync("dpkg-deb", ["--version"], { stdio: "ignore" }).status === 0;
const linuxOnly = { skip: !linux };
const actualDeb = { skip: !hasDebTool };

async function guardRun(command, args) {
  assert.equal(command, "dpkg-deb");
  assert.deepEqual(args, ["--version"]);
  return { stdout: "dpkg-deb test boundary", stderr: "" };
}

function elf(machine = 62, elfClass = 2, byteOrder = 1) {
  const bytes = Buffer.alloc(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, elfClass, byteOrder, 1]);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(machine, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt16LE(64, 52);
  return bytes;
}

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "scislide-linux-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [
    "dist",
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
    JSON.stringify({
      name: "scislide",
      version: "0.3.0",
      description: "Scientific presentation editor",
      author: "SciSlide contributors",
      license: "MIT",
    }),
  );
  await writeFile(path.join(root, "LICENSE"), "MIT license fixture\n");
  await writeFile(
    path.join(root, "desktop/LINUX.md"),
    "Ubuntu / Linux x64 installation instructions\n",
  );
  await writeFile(
    path.join(root, "desktop/linux-icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#286c60"/></svg>',
  );
  return root;
}

async function fakeApp(options, main = elf()) {
  const directory = path.join(options.out, "SciSlide-linux-x64");
  await mkdir(path.join(directory, "resources"), { recursive: true });
  await mkdir(path.join(directory, "examples"), { recursive: true });
  await mkdir(path.join(directory, "locales"), { recursive: true });
  await writeFile(path.join(directory, "scislide"), main, { mode: 0o755 });
  await writeFile(path.join(directory, "chrome-sandbox"), elf(), {
    mode: 0o755,
  });
  await writeFile(
    path.join(directory, "resources/app.asar"),
    "bundled offline app",
  );
  await writeFile(
    path.join(directory, "README.md"),
    "Portable app instructions",
  );
  await writeFile(
    path.join(directory, "examples/example.scislide"),
    "editable example",
  );
  await writeFile(path.join(directory, "locales/en-US.pak"), "locale data", {
    mode: 0o744,
  });
  return [directory];
}

test("Linux arguments target x64 and reject unsupported or ambiguous options", () => {
  const defaults = parseLinuxOptions([]);
  assert.equal(defaults.arch, "x64");
  assert.equal(defaults.out, "release/linux-deb");
  assert.equal(defaults.overwrite, false);
  assert.equal(defaults.help, false);
  const options = parseLinuxOptions([
    "--arch=x64",
    "--out",
    "custom",
    "--overwrite",
  ]);
  assert.equal(options.arch, "x64");
  assert.equal(options.out, "custom");
  assert.equal(options.overwrite, true);
  assert.equal(parseLinuxOptions(["--help"]).help, true);
  for (const args of [
    ["--arch=arm64"],
    ["--arch=ia32"],
    ["--platform=linux"],
    ["--arch=x64", "--arch=x64"],
    ["--out"],
    ["--out="],
    ["--out", "--overwrite"],
    ["--out=bad\npath"],
    ["--unknown"],
  ]) {
    assert.throws(() => parseLinuxOptions(args));
  }
});

test("ELF validation rejects ARM64, 32-bit, big-endian, and malformed executables", async (t) => {
  const root = await fixture(t);
  const filename = path.join(root, "executable");
  await writeFile(filename, elf());
  await verifyLinuxX64(filename);
  const positionIndependent = elf();
  positionIndependent.writeUInt16LE(3, 16);
  await writeFile(filename, positionIndependent);
  await verifyLinuxX64(filename);
  const invalidVersion = elf();
  invalidVersion[6] = 0;
  const relocatable = elf();
  relocatable.writeUInt16LE(1, 16);
  for (const bytes of [
    elf(183),
    elf(3),
    elf(62, 1),
    elf(62, 2, 2),
    invalidVersion,
    relocatable,
    Buffer.from("\x7fELF"),
    Buffer.alloc(64),
  ]) {
    await writeFile(filename, bytes);
    await assert.rejects(verifyLinuxX64(filename));
  }
});

test(
  "the Debian package contains the complete x64 app, launcher, documentation, and matching checksum",
  actualDeb,
  async (t) => {
    const root = await fixture(t);
    let packaged;
    const result = await packageLinux(
      { root },
      {
        packageDesktop: async (options) => {
          packaged = options;
          return fakeApp(options);
        },
      },
    );
    assert.equal(packaged.platform, "linux");
    assert.equal(packaged.arch, "x64");
    assert.equal(packaged.out, path.join(root, "release/linux-deb"));
    assert.equal(packaged.overwrite, false);
    assert.equal(
      result.appFolder,
      path.join(root, "release/linux-deb/SciSlide-linux-x64"),
    );
    assert.equal(path.basename(result.deb), "SciSlide-0.3.0-linux-x64.deb");
    assert.equal(result.checksum, `${result.deb}.sha256`);
    const { stdout: fields } = await run("dpkg-deb", ["--field", result.deb]);
    assert.match(fields, /^Package: scislide$/m);
    assert.match(fields, /^Version: 0\.3\.0$/m);
    assert.match(fields, /^Architecture: amd64$/m);
    const extracted = path.join(root, "extracted");
    await run("dpkg-deb", ["--extract", result.deb, extracted]);
    assert.deepEqual(
      await readFile(path.join(extracted, "opt/scislide/scislide")),
      elf(),
    );
    assert.equal(
      await readFile(
        path.join(extracted, "opt/scislide/resources/app.asar"),
        "utf8",
      ),
      "bundled offline app",
    );
    assert.equal(
      await readFile(
        path.join(extracted, "opt/scislide/examples/example.scislide"),
        "utf8",
      ),
      "editable example",
    );
    assert.equal(
      await readFile(path.join(extracted, "opt/scislide/README.md"), "utf8"),
      "Ubuntu / Linux x64 installation instructions\n",
    );
    assert.equal(
      await readlink(path.join(extracted, "usr/bin/scislide")),
      "/opt/scislide/scislide",
    );
    const launcher = await readFile(
      path.join(extracted, "usr/share/applications/scislide.desktop"),
      "utf8",
    );
    assert.match(launcher, /^Exec=\/usr\/bin\/scislide$/m);
    assert.doesNotMatch(launcher, /%[fFuU]|^MimeType=/m);
    assert.ok(
      (await readFile(path.join(extracted, "usr/share/doc/scislide/README.md")))
        .length,
    );
    assert.ok(
      (await readFile(path.join(extracted, "usr/share/doc/scislide/copyright")))
        .length,
    );
    const { stdout: archive } = await run("dpkg-deb", [
      "--contents",
      result.deb,
    ]);
    assert.match(
      archive,
      /^-rwxr-xr-x\s+root\/root\s+.*\.\/opt\/scislide\/scislide$/m,
    );
    assert.match(
      archive,
      /^-rwsr-xr-x\s+root\/root\s+.*\.\/opt\/scislide\/chrome-sandbox$/m,
    );
    assert.match(
      archive,
      /^-rw-r--r--\s+root\/root\s+.*\.\/opt\/scislide\/locales\/en-US\.pak$/m,
    );
    for (const entry of archive.trim().split("\n")) {
      assert.match(entry, /^\S+\s+root\/root\s+/);
    }
    const hash = createHash("sha256")
      .update(await readFile(result.deb))
      .digest("hex");
    assert.equal(
      await readFile(result.checksum, "utf8"),
      `${hash}  ${path.basename(result.deb)}\n`,
    );
    assert.equal(
      await readFile(
        path.join(root, "release/linux-deb/LINUX-INSTALL.md"),
        "utf8",
      ),
      "Ubuntu / Linux x64 installation instructions\n",
    );
    assert.ok(
      (await readdir(path.join(root, "release/linux-deb"))).every(
        (entry) => !entry.startsWith(".scislide-linux-"),
      ),
    );
  },
);

test(
  "existing artifacts survive both collisions and a failed dpkg replacement build",
  actualDeb,
  async (t) => {
    const root = await fixture(t);
    const first = await packageLinux({ root }, { packageDesktop: fakeApp });
    const originalDeb = await readFile(first.deb);
    const originalChecksum = await readFile(first.checksum);
    let called = false;
    await assert.rejects(
      packageLinux(
        { root },
        {
          packageDesktop: async () => {
            called = true;
          },
        },
      ),
    );
    assert.equal(called, false);
    let failedBuild = false;
    await assert.rejects(
      packageLinux(
        { root, overwrite: true },
        {
          packageDesktop: fakeApp,
          run: async (command, args, options) => {
            if (command === "dpkg-deb" && args.includes("--build")) {
              failedBuild = true;
              throw new Error("dpkg build interrupted");
            }
            return run(command, args, options);
          },
        },
      ),
      /dpkg build interrupted/,
    );
    assert.equal(failedBuild, true);
    assert.deepEqual(await readFile(first.deb), originalDeb);
    assert.deepEqual(await readFile(first.checksum), originalChecksum);
    assert.ok(
      (await readdir(path.join(root, "release/linux-deb"))).every(
        (entry) => !entry.startsWith(".scislide-linux-"),
      ),
    );
  },
);

test(
  "packaging refuses outputs inside every packaged source directory",
  linuxOnly,
  async (t) => {
    const root = await fixture(t);
    let called = false;
    for (const out of [
      "dist/output",
      "desktop/output",
      "third-party-licenses/output",
      "examples/output",
      "node_modules/output",
      "public/output",
    ]) {
      await assert.rejects(
        packageLinux(
          { root, out },
          {
            run: guardRun,
            packageDesktop: async () => {
              called = true;
            },
          },
        ),
      );
    }
    assert.equal(called, false);
  },
);

test(
  "artifact symlinks cannot replace or modify their targets",
  linuxOnly,
  async (t) => {
    const root = await fixture(t);
    await mkdir(path.join(root, "release/linux-deb"), { recursive: true });
    const source = path.join(root, "package.json");
    const original = await readFile(source);
    let called = false;
    for (const name of [
      "SciSlide-0.3.0-linux-x64.deb",
      "SciSlide-0.3.0-linux-x64.deb.sha256",
      "LINUX-INSTALL.md",
    ]) {
      const filename = path.join(root, "release/linux-deb", name);
      await symlink(source, filename);
      await assert.rejects(
        packageLinux(
          { root, overwrite: true },
          {
            run: guardRun,
            packageDesktop: async (options) => {
              called = true;
              return fakeApp(options);
            },
          },
        ),
      );
      assert.ok((await lstat(filename)).isSymbolicLink());
      assert.deepEqual(await readFile(source), original);
      await rm(filename);
    }
    assert.equal(called, false);
  },
);

test(
  "input app symlinks and non-x64 binaries are rejected without modifying link targets",
  linuxOnly,
  async (t) => {
    const root = await fixture(t);
    let archiveBuilt = false;
    let appsCreated = 0;
    const dependencies = {
      run: async (command, args) => {
        if (command === "dpkg-deb" && args.includes("--build"))
          archiveBuilt = true;
        return guardRun(command, args);
      },
    };
    await assert.rejects(
      packageLinux(
        { root },
        {
          ...dependencies,
          packageDesktop: async (options) => {
            appsCreated += 1;
            return fakeApp(options, elf(183));
          },
        },
      ),
    );
    await rm(path.join(root, "release/linux-deb/SciSlide-linux-x64"), {
      recursive: true,
      force: true,
    });
    await assert.rejects(
      packageLinux(
        { root },
        {
          ...dependencies,
          packageDesktop: async (options) => {
            appsCreated += 1;
            const apps = await fakeApp(options);
            await symlink(
              path.join(root, "package.json"),
              path.join(apps[0], "linked.json"),
            );
            return apps;
          },
        },
      ),
    );
    await rm(path.join(root, "release/linux-deb/SciSlide-linux-x64"), {
      recursive: true,
      force: true,
    });
    const external = path.join(root, "keep-external-readme.md");
    const keep = Buffer.from(
      "Existing external document — preserve verbatim.\n",
    );
    await writeFile(external, keep);
    await assert.rejects(
      packageLinux(
        { root },
        {
          ...dependencies,
          packageDesktop: async (options) => {
            appsCreated += 1;
            const apps = await fakeApp(options);
            const readme = path.join(apps[0], "README.md");
            await rm(readme);
            await symlink(external, readme);
            return apps;
          },
        },
      ),
    );
    assert.deepEqual(await readFile(external), keep);
    assert.equal(appsCreated, 3);
    assert.equal(archiveBuilt, false);
    await assert.rejects(
      lstat(path.join(root, "release/linux-deb/SciSlide-0.3.0-linux-x64.deb")),
      {
        code: "ENOENT",
      },
    );
  },
);

test(
  "native Debian packaging fails explicitly on non-Linux hosts",
  { skip: linux },
  async (t) => {
    const root = await fixture(t);
    await assert.rejects(packageLinux({ root }));
  },
);
