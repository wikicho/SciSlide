import assert from "node:assert/strict";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  packageDesktop,
  parsePackagingOptions,
} from "../scripts/package-desktop.mjs";

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "scislide-package-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of [
    "dist",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules/electron",
  ]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "scislide",
      version: "0.2.1",
      main: "desktop/main.cjs",
    }),
  );
  await writeFile(
    path.join(root, "node_modules/electron/package.json"),
    JSON.stringify({ version: "44.5.1" }),
  );
  await writeFile(path.join(root, "desktop/main.cjs"), "// host");
  await writeFile(path.join(root, "desktop/host.test.cjs"), "// excluded test");
  await writeFile(path.join(root, "desktop/USAGE.md"), "Linux usage");
  await writeFile(path.join(root, "desktop/MACOS.md"), "Mac usage");
  await writeFile(path.join(root, "desktop/WINDOWS.md"), "Windows usage");
  await writeFile(path.join(root, "dist/index.html"), "renderer");
  await writeFile(
    path.join(root, "third-party-licenses/NOTICE.md"),
    "licenses",
  );
  await writeFile(
    path.join(root, "examples/example.scislide"),
    "editable example",
  );
  return root;
}

test("CLI options select one validated target and preserve current-platform defaults", () => {
  const defaults = { platform: "linux", arch: "x64" };
  assert.deepEqual(parsePackagingOptions([], defaults), {
    ...defaults,
    out: undefined,
    overwrite: false,
    help: false,
  });
  const options = parsePackagingOptions(
    [
      "--platform=darwin",
      "--arch",
      "arm64",
      "--out=release-mac",
      "--overwrite",
    ],
    defaults,
  );
  assert.equal(options.platform, "darwin");
  assert.equal(options.arch, "arm64");
  assert.equal(options.out, "release-mac");
  assert.equal(options.overwrite, true);
  for (const args of [
    ["--platform=../../elsewhere"],
    ["--arch=x64/../arm64"],
    ["--platform=all"],
    ["--arch=universal"],
    ["--out"],
    ["--out="],
    ["--out", "--overwrite"],
    ["--arch=x64", "--arch=arm64"],
    ["--unknown"],
  ]) {
    assert.throws(() => parsePackagingOptions(args, defaults));
  }
});

test("Mac package carries portable and installed usage/examples, metadata, and staged dependencies", async (t) => {
  const root = await fixture(t);
  let stage;
  const apps = await packageDesktop(
    { root, platform: "darwin", arch: "arm64" },
    {
      packager: async (options) => {
        stage = options.dir;
        assert.equal(options.out, path.join(root, "release"));
        assert.equal(options.appBundleId, "com.scislide.app");
        assert.equal(
          options.appCategoryType,
          "public.app-category.productivity",
        );
        assert.equal(options.executableName, "scislide");
        assert.equal(options.asar, true);
        assert.equal(options.prune, false);
        assert.equal(options.electronVersion, "44.5.1");
        assert.equal(
          await readFile(path.join(stage, "dist/index.html"), "utf8"),
          "renderer",
        );
        assert.equal(
          await readFile(
            path.join(stage, "third-party-licenses/NOTICE.md"),
            "utf8",
          ),
          "licenses",
        );
        await assert.rejects(lstat(path.join(stage, "desktop/host.test.cjs")), {
          code: "ENOENT",
        });
        const pkg = JSON.parse(
          await readFile(path.join(stage, "package.json"), "utf8"),
        );
        assert.equal(pkg.version, "0.2.1");
        assert.equal(pkg.main, "desktop/main.cjs");
        const app = path.join(options.out, "SciSlide-darwin-arm64");
        await mkdir(path.join(app, "SciSlide.app/Contents/Resources"), {
          recursive: true,
        });
        await cp(
          path.join(stage, "package.json"),
          path.join(app, "SciSlide.app/Contents/Resources/app.asar"),
        );
        return [app];
      },
    },
  );
  await assert.rejects(lstat(stage), { code: "ENOENT" });
  const resources = path.join(apps[0], "SciSlide.app/Contents/Resources");
  for (const base of [apps[0], resources]) {
    assert.equal(
      await readFile(path.join(base, "README.md"), "utf8"),
      "Mac usage",
    );
    assert.equal(
      await readFile(path.join(base, "examples/example.scislide"), "utf8"),
      "editable example",
    );
  }
});

test("A failed packaging call cleans only its unique temporary stage", async (t) => {
  const root = await fixture(t);
  const unrelated = path.join(root, "keep.txt");
  await writeFile(unrelated, "keep");
  let stage;
  await assert.rejects(
    packageDesktop(
      { root, platform: "linux", arch: "x64" },
      {
        packager: async (options) => {
          stage = options.dir;
          throw new Error("packaging interrupted");
        },
      },
    ),
    /packaging interrupted/,
  );
  await assert.rejects(lstat(stage), { code: "ENOENT" });
  assert.equal(await readFile(unrelated, "utf8"), "keep");
});

test("Windows x64 package carries Windows instructions and editable examples", async (t) => {
  const root = await fixture(t);
  let stage;
  const apps = await packageDesktop(
    { root, platform: "win32", arch: "x64" },
    {
      packager: async (options) => {
        stage = options.dir;
        assert.equal(options.platform, "win32");
        assert.equal(options.arch, "x64");
        const app = path.join(options.out, "SciSlide-win32-x64");
        await mkdir(path.join(app, "resources"), { recursive: true });
        await cp(
          path.join(stage, "package.json"),
          path.join(app, "resources/app.asar"),
        );
        return [app];
      },
    },
  );
  await assert.rejects(lstat(stage), { code: "ENOENT" });
  assert.equal(
    await readFile(path.join(apps[0], "README.md"), "utf8"),
    "Windows usage",
  );
  assert.equal(
    await readFile(path.join(apps[0], "examples/example.scislide"), "utf8"),
    "editable example",
  );
});

test("Existing unrecognized app directories and symlinks cannot be overwritten", async (t) => {
  const root = await fixture(t);
  const out = path.join(root, "release");
  const app = path.join(out, "SciSlide-linux-x64");
  await mkdir(app, { recursive: true });
  await writeFile(path.join(app, "keep.txt"), "keep");
  await assert.rejects(
    packageDesktop({ root, platform: "linux", arch: "x64" }),
    /Output already exists/,
  );
  await assert.rejects(
    packageDesktop({ root, platform: "linux", arch: "x64", overwrite: true }),
    /unrecognized app directory/,
  );
  assert.equal(await readFile(path.join(app, "keep.txt"), "utf8"), "keep");
  await rm(app, { recursive: true });
  const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(path.join(root, "dist"), app, directoryLinkType);
  await assert.rejects(
    packageDesktop({ root, platform: "linux", arch: "x64", overwrite: true }),
    /non-directory or symlink/,
  );
  await symlink(
    path.join(root, "dist"),
    path.join(root, "output-link"),
    directoryLinkType,
  );
  await assert.rejects(
    packageDesktop({
      root,
      platform: "linux",
      arch: "x64",
      out: "output-link",
    }),
    /outside the packaged inputs/,
  );
});
