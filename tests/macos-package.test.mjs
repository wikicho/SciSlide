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
import { packageMacos, parseMacosOptions } from "../scripts/package-macos.mjs";
import { publishReleaseEntries } from "../scripts/release-layout.mjs";

const version = "0.6.4.1";
const installer = (arch) => `SciSlide-${version}-macos-${arch}-unsigned.pkg`;
const artifacts = [
  installer("arm64"),
  `${installer("arm64")}.sha256`,
  installer("x64"),
  `${installer("x64")}.sha256`,
  "MACOS-INSTALL.md",
];
const inputs = [
  "dist",
  "dist-cli",
  "desktop",
  "third-party-licenses",
  "examples",
  "node_modules",
  "public",
];

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(
      path.join(await realpath(os.tmpdir()), "scislide-macos-test-"),
    ),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of inputs) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
  await writeFile(
    path.join(root, "desktop/MACOS.md"),
    "Install the unsigned macOS package.\n",
  );
  return root;
}
async function fakeApp(options) {
  const app = path.join(options.out, `SciSlide-darwin-${options.arch}`);
  await mkdir(path.join(app, "SciSlide.app/Contents/Resources"), {
    recursive: true,
  });
  await writeFile(
    path.join(app, "SciSlide.app/Contents/Resources/app.asar"),
    "payload",
  );
  return [app];
}
async function fakeFlat(options) {
  assert.equal(options.identity, null);
  assert.equal(options.install, "/Applications");
  assert.equal(options.implementation, "js");
  await writeFile(
    options.pkg,
    `unsigned installer for ${path.basename(path.dirname(options.app))}`,
  );
}
const dependencies = { packageDesktop: fakeApp, flat: fakeFlat };
const output = (root) => path.join(root, "release", `v${version}`, "macos");
async function contents(directory) {
  return Object.fromEntries(
    await Promise.all(
      artifacts.map(async (name) => [
        name,
        await readFile(path.join(directory, name), "utf8"),
      ]),
    ),
  );
}
async function noTemporaryOutput(directory) {
  assert.ok(
    (await readdir(directory)).every(
      (entry) => !entry.startsWith(".scislide-"),
    ),
  );
}

test("macOS options validate one target and reject duplicate, malformed, or unknown arguments", () => {
  assert.deepEqual(parseMacosOptions([]), {
    arch: "all",
    out: undefined,
    implementation: "js",
    overwrite: false,
    help: false,
  });
  assert.deepEqual(
    parseMacosOptions([
      "--arch=x64",
      "--out",
      "custom output",
      "--implementation=native",
      "--overwrite",
    ]),
    {
      arch: "x64",
      out: "custom output",
      implementation: "native",
      overwrite: true,
      help: false,
    },
  );
  for (const args of [
    ["--arch=arm64", "--arch=x64"],
    ["--out=a", "--out=b"],
    ["--implementation=js", "--implementation=native"],
    ["--overwrite", "--overwrite"],
    ["--arch=ia32"],
    ["--out="],
    ["--out", "--overwrite"],
    ["--out=bad\npath"],
    ["--out=bad\0path"],
    ["--implementation=other"],
    ["--unknown"],
  ])
    assert.throws(() => parseMacosOptions(args));
});

test("both macOS architectures publish only versioned installers, exact checksums, and instructions", async (t) => {
  const root = await fixture(t);
  const appOutputs = [];
  const result = await packageMacos(
    { root },
    {
      ...dependencies,
      packageDesktop: async (options) => {
        assert.equal(options.platform, "darwin");
        assert.equal(options.overwrite, false);
        assert.equal(path.basename(options.out), "apps");
        appOutputs.push(options.out);
        return fakeApp(options);
      },
    },
  );
  assert.deepEqual(result, [
    path.join(output(root), installer("arm64")),
    path.join(output(root), installer("x64")),
  ]);
  assert.deepEqual((await readdir(output(root))).sort(), artifacts.toSorted());
  for (const filename of result) {
    const checksum = createHash("sha256")
      .update(await readFile(filename))
      .digest("hex");
    assert.equal(
      await readFile(`${filename}.sha256`, "utf8"),
      `${checksum}  ${path.basename(filename)}\n`,
    );
  }
  assert.equal(
    await readFile(path.join(output(root), "MACOS-INSTALL.md"), "utf8"),
    await readFile(path.join(root, "desktop/MACOS.md"), "utf8"),
  );
  for (const directory of appOutputs)
    await assert.rejects(lstat(directory), { code: "ENOENT" });
  await noTemporaryOutput(output(root));
});

test("an explicit output path is respected and safe numeric application revisions are retained", async (t) => {
  const root = await fixture(t);
  const result = await packageMacos(
    { root, arch: "x64", out: "custom output" },
    dependencies,
  );
  assert.deepEqual(result, [
    path.join(root, "custom output", installer("x64")),
  ]);
  assert.deepEqual(
    (await readdir(path.join(root, "custom output"))).sort(),
    [
      installer("x64"),
      `${installer("x64")}.sha256`,
      "MACOS-INSTALL.md",
    ].toSorted(),
  );
  for (const invalid of [
    "0.6.4.01",
    "0.6.4.1.2",
    "../outside",
    "1.0.0\ninvalid",
  ]) {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: invalid }),
    );
    await assert.rejects(
      packageMacos({ root }, dependencies),
      /safe semantic version/,
    );
  }
  await assert.rejects(
    packageMacos({ root, overwrite: "yes" }, dependencies),
    /boolean/,
  );
  await assert.rejects(
    packageMacos({ root, out: "bad\npath" }, dependencies),
    /non-empty path/,
  );
});

test("every final artifact collision is checked before creating an app", async (t) => {
  const root = await fixture(t);
  const destination = output(root);
  await mkdir(destination, { recursive: true });
  for (const name of artifacts) {
    await writeFile(path.join(destination, name), "existing output");
    let built = false;
    await assert.rejects(
      packageMacos(
        { root },
        {
          ...dependencies,
          packageDesktop: async () => {
            built = true;
          },
        },
      ),
      /Output already exists/,
    );
    assert.equal(built, false);
    assert.equal(
      await readFile(path.join(destination, name), "utf8"),
      "existing output",
    );
    await rm(path.join(destination, name));
  }
});

test("installer, checksum, and instruction links or directories are rejected without modifying their targets", async (t) => {
  const root = await fixture(t);
  const destination = output(root);
  await mkdir(destination, { recursive: true });
  const original = await readFile(path.join(root, "package.json"));
  for (const name of artifacts) {
    const file = path.join(destination, name);
    await symlink(
      path.join(root, process.platform === "win32" ? "dist" : "package.json"),
      file,
      process.platform === "win32" ? "junction" : "file",
    );
    for (const overwrite of [false, true])
      await assert.rejects(
        packageMacos({ root, overwrite }, dependencies),
        /non-file or symlink/,
      );
    assert.ok((await lstat(file)).isSymbolicLink());
    assert.deepEqual(await readFile(path.join(root, "package.json")), original);
    await rm(file);
    await mkdir(file);
    await assert.rejects(
      packageMacos({ root, overwrite: true }, dependencies),
      /non-file or symlink/,
    );
    await rm(file, { recursive: true });
  }
});

test("output cannot enter packaged inputs, including aliases and symbolic link parents", async (t) => {
  const root = await fixture(t);
  for (const input of inputs) {
    const destination = path.join(root, input, "generated-output");
    await assert.rejects(
      packageMacos({ root, out: destination }, dependencies),
      /outside packaged inputs/,
    );
    await assert.rejects(lstat(destination), { code: "ENOENT" });
  }
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(
    path.join(root, "dist"),
    path.join(root, "output-link"),
    linkType,
  );
  await assert.rejects(
    packageMacos({ root, out: "output-link" }, dependencies),
    /symlink/,
  );
  await assert.rejects(
    packageMacos({ root, out: "output-link/child" }, dependencies),
    /symlink/,
  );
  await assert.rejects(lstat(path.join(root, "dist/child")), {
    code: "ENOENT",
  });
});

test("failure of the second architecture preserves all previous artifacts and removes temporary apps", async (t) => {
  const root = await fixture(t);
  await packageMacos({ root }, dependencies);
  const before = await contents(output(root));
  await writeFile(path.join(output(root), "keep-my-file.txt"), "unrelated");
  let calls = 0;
  await assert.rejects(
    packageMacos(
      { root, overwrite: true },
      {
        ...dependencies,
        flat: async (options) => {
          await writeFile(options.pkg, "replacement installer");
          if (++calls === 2) throw new Error("x64 packaging interrupted");
        },
      },
    ),
    /x64 packaging interrupted/,
  );
  assert.equal(calls, 2);
  assert.deepEqual(await contents(output(root)), before);
  assert.equal(
    await readFile(path.join(output(root), "keep-my-file.txt"), "utf8"),
    "unrelated",
  );
  await noTemporaryOutput(output(root));
});

test("missing, empty, or linked .pkg outputs fail without publishing an installer", async (t) => {
  const root = await fixture(t);
  for (const kind of ["missing", "empty", "symlink"]) {
    await assert.rejects(
      packageMacos(
        { root, arch: "x64" },
        {
          ...dependencies,
          flat: async (options) => {
            if (kind === "empty") await writeFile(options.pkg, "");
            if (kind === "symlink")
              await symlink(
                path.join(
                  root,
                  process.platform === "win32" ? "dist" : "package.json",
                ),
                options.pkg,
                process.platform === "win32" ? "junction" : "file",
              );
          },
        },
      ),
      /missing, empty or not a regular file/,
    );
    assert.deepEqual(await readdir(output(root)), []);
  }
});

test("a late checksum collision leaves the staged installer unpublished", async (t) => {
  const root = await fixture(t);
  const checksum = path.join(output(root), `${installer("x64")}.sha256`);
  await assert.rejects(
    packageMacos(
      { root, arch: "x64" },
      {
        ...dependencies,
        flat: async (options) => {
          await fakeFlat(options);
          await writeFile(checksum, "another build owns this checksum");
        },
      },
    ),
    /Output already exists/,
  );
  assert.deepEqual(await readdir(output(root)), [path.basename(checksum)]);
  assert.equal(
    await readFile(checksum, "utf8"),
    "another build owns this checksum",
  );
});

test("a failed final publication restores the prior installer, checksums, and guide as a complete set", async (t) => {
  const root = await fixture(t);
  await packageMacos({ root }, dependencies);
  const before = await contents(output(root));
  let failed = false;
  await assert.rejects(
    packageMacos(
      { root, overwrite: true },
      {
        ...dependencies,
        flat: async (options) =>
          writeFile(options.pkg, "replacement installer"),
        publishReleaseEntries: (entries, options) =>
          publishReleaseEntries(entries, options, {
            rename: async (source, destination) => {
              if (
                !failed &&
                source.includes(".scislide-macos-") &&
                source.endsWith(".pkg.sha256")
              ) {
                failed = true;
                throw new Error("checksum publish interrupted");
              }
              return rename(source, destination);
            },
          }),
      },
    ),
    /checksum publish interrupted/,
  );
  assert.equal(failed, true);
  assert.deepEqual(await contents(output(root)), before);
  await noTemporaryOutput(output(root));
});

test(
  "native installer creation reports its macOS requirement on other hosts",
  { skip: process.platform === "darwin" },
  async (t) => {
    const root = await fixture(t);
    await assert.rejects(
      packageMacos({ root, implementation: "native" }, dependencies),
      /requires macOS/,
    );
  },
);
