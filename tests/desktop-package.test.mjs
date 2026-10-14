import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
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
    "dist-cli",
    "desktop",
    "third-party-licenses",
    "examples",
    "node_modules/electron",
    "public/fonts",
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
  await writeFile(path.join(root, "desktop/update-cli.mjs"), "// update entry");
  await writeFile(path.join(root, "desktop/update.mjs"), "// updater");
  await writeFile(
    path.join(root, "dist-cli/agent.cjs"),
    "// bundled agent CLI",
  );
  await writeFile(
    path.join(root, "dist-cli/THIRD_PARTY_NOTICES.txt"),
    "bundled dependency and font notices",
  );
  await writeFile(path.join(root, "public/fonts/inter-400.ttf"), "latin font");
  await writeFile(
    path.join(root, "public/fonts/nanum-gothic-400.ttf"),
    "korean font",
  );
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
        await assert.rejects(lstat(path.join(stage, "dist-cli")), {
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
  const cli = path.join(resources, "scislide-cli");
  assert.deepEqual(
    JSON.parse(await readFile(path.join(cli, "package.json"), "utf8")),
    { name: "scislide", version: "0.2.1" },
  );
  assert.deepEqual((await readdir(cli)).sort(), [
    "THIRD_PARTY_NOTICES.txt",
    "agent.cjs",
    "bin",
    "desktop",
    "fonts",
    "package.json",
  ]);
  assert.deepEqual((await readdir(path.join(cli, "desktop"))).sort(), [
    "update-cli.mjs",
    "update.mjs",
  ]);
  assert.equal(
    await readFile(path.join(cli, "agent.cjs"), "utf8"),
    "// bundled agent CLI",
  );
  assert.equal(
    await readFile(path.join(cli, "THIRD_PARTY_NOTICES.txt"), "utf8"),
    "bundled dependency and font notices",
  );
  assert.equal(
    await readFile(path.join(cli, "fonts/inter-400.ttf"), "utf8"),
    "latin font",
  );
  assert.equal(
    await readFile(path.join(cli, "fonts/nanum-gothic-400.ttf"), "utf8"),
    "korean font",
  );
  for (const launcher of [
    path.join(apps[0], "bin/scislide"),
    path.join(cli, "bin/scislide"),
  ]) {
    if (process.platform !== "win32")
      assert.equal((await lstat(launcher)).mode & 0o777, 0o755);
    assert.match(
      await readFile(launcher, "utf8"),
      /ELECTRON_RUN_AS_NODE=1 exec/,
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
  const cli = path.join(apps[0], "resources/scislide-cli");
  assert.deepEqual(
    JSON.parse(await readFile(path.join(cli, "package.json"), "utf8")),
    { name: "scislide", version: "0.2.1" },
  );
  assert.deepEqual((await readdir(cli)).sort(), [
    "THIRD_PARTY_NOTICES.txt",
    "agent.cjs",
    "desktop",
    "fonts",
    "package.json",
  ]);
  const launcher = await readFile(
    path.join(apps[0], "bin/scislide.cmd"),
    "utf8",
  );
  assert.match(launcher, /DisableDelayedExpansion/);
  assert.match(launcher, /set "scislide_dir=%~dp0"/);
  assert.ok(
    launcher.indexOf('set "scislide_dir=%~dp0"') <
      launcher.indexOf("\r\nshift\r\n"),
  );
  assert.match(
    launcher,
    /:scislide_empty_argument\r\nif "%1"=="" goto scislide_launch\r\nshift/,
  );
  assert.match(launcher, /set "ELECTRON_RUN_AS_NODE=1"/);
  for (const command of [
    "schema",
    "create",
    "inspect",
    "validate",
    "apply",
    "unpack",
    "pack",
    "export",
  ]) {
    const check = `if "%~1"=="${command}" set "scislide_cli=1"`;
    assert.ok(launcher.includes(check));
    assert.ok(launcher.indexOf(check) < launcher.indexOf(":scislide_scan"));
  }
  assert.match(launcher, /if "%~1"=="--version" set "scislide_cli=1"/);
  assert.match(launcher, /if "%~1"=="--cli" set "scislide_cli=1"/);
  assert.ok(
    launcher.indexOf("if defined scislide_cli goto scislide_launch") <
      launcher.indexOf(":scislide_scan"),
    "recognized commands skip operand scanning before batch expansion",
  );
  assert.match(
    launcher,
    /"%scislide_dir%\.\.\\scislide\.exe" "%scislide_dir%\.\.\\resources\\scislide-cli\\desktop\\update-cli\.mjs" %\*/,
  );
  assert.match(
    launcher,
    /start "" \/wait "%scislide_dir%\.\.\\scislide\.exe" %\*/,
  );
  assert.match(launcher, /exit \/b %errorlevel%/);
});

test("missing or linked updater sources fail before creating the packaged app", async (t) => {
  const root = await fixture(t);
  let packaged = false;
  const options = { root, platform: "linux", arch: "x64" };
  const dependencies = {
    packager: async () => {
      packaged = true;
      return [];
    },
  };
  await rm(path.join(root, "desktop/update.mjs"));
  await assert.rejects(
    packageDesktop(options, dependencies),
    /Desktop CLI requires a regular source file/,
  );
  assert.equal(packaged, false);
  if (process.platform !== "win32") {
    await symlink(
      path.join(root, "package.json"),
      path.join(root, "desktop/update.mjs"),
    );
    await assert.rejects(
      packageDesktop(options, dependencies),
      /Desktop CLI requires a regular source file/,
    );
    assert.equal(packaged, false);
  }
});

test("the agent bundle and notices must be regular nonempty files before packaging", async (t) => {
  for (const name of ["agent.cjs", "THIRD_PARTY_NOTICES.txt"]) {
    const root = await fixture(t);
    const bundle = path.join(root, "dist-cli", name);
    let packaged = false;
    const check = () =>
      assert.rejects(
        packageDesktop(
          { root, platform: "linux", arch: "x64" },
          {
            packager: async () => {
              packaged = true;
              return [];
            },
          },
        ),
        /nonempty regular agent bundle/,
      );
    await rm(bundle);
    await check();
    await writeFile(bundle, "");
    await check();
    await rm(bundle);
    await mkdir(bundle);
    await check();
    await rm(bundle, { recursive: true });
    if (process.platform !== "win32") {
      await symlink(path.join(root, "package.json"), bundle);
      await check();
    }
    assert.equal(packaged, false);
  }
});

test("external CLI fonts are mandatory and cannot contain symbolic links", async (t) => {
  const root = await fixture(t);
  const fonts = path.join(root, "public/fonts");
  let packaged = false;
  const check = () =>
    assert.rejects(
      packageDesktop(
        { root, platform: "linux", arch: "x64" },
        {
          packager: async () => {
            packaged = true;
            return [];
          },
        },
      ),
      /regular font directory|bundled font files|links or special files/,
    );
  await rm(fonts, { recursive: true });
  await check();
  await mkdir(fonts);
  await check();
  if (process.platform !== "win32") {
    await symlink(
      path.join(root, "package.json"),
      path.join(fonts, "linked.ttf"),
    );
    await check();
    await rm(fonts, { recursive: true });
    await symlink(path.join(root, "desktop"), fonts, "dir");
    await check();
  }
  assert.equal(packaged, false);
});

const shellStub = `#!/bin/sh
printf 'MODE=%s\\n' "\${ELECTRON_RUN_AS_NODE:-gui}"
for scislide_argument in "$@"; do printf 'ARG=%s\\n' "$scislide_argument"; done
exit "\${SCISLIDE_STUB_EXIT:-0}"
`;

for (const platform of ["linux", "darwin"]) {
  test(
    `${platform} launchers run headless without Node, including spaces and symlinks`,
    { skip: process.platform === "win32" },
    async (t) => {
      const root = await fixture(t);
      const [app] = await packageDesktop(
        { root, platform, arch: "x64", out: "release folder with spaces" },
        {
          packager: async (options) => {
            const directory = path.join(
              options.out,
              `SciSlide-${platform}-x64`,
            );
            const contents =
              platform === "darwin"
                ? path.join(directory, "SciSlide.app/Contents")
                : directory;
            const resources = path.join(
              contents,
              platform === "darwin" ? "Resources" : "resources",
            );
            const binary = path.join(
              contents,
              platform === "darwin" ? "MacOS/scislide" : "scislide",
            );
            await mkdir(resources, { recursive: true });
            await mkdir(path.dirname(binary), { recursive: true });
            await writeFile(path.join(resources, "app.asar"), "app");
            await writeFile(binary, shellStub, { mode: 0o755 });
            return [directory];
          },
        },
      );
      const tools = path.join(root, "shell tools without node");
      await mkdir(tools);
      for (const name of ["dirname", "readlink"])
        await symlink(`/usr/bin/${name}`, path.join(tools, name));
      const env = {
        ...process.env,
        PATH: tools,
        DISPLAY: "",
        WAYLAND_DISPLAY: "",
        SCISLIDE_STUB_EXIT: "23",
      };
      delete env.ELECTRON_RUN_AS_NODE;
      assert.notEqual(
        spawnSync("/bin/sh", ["-c", "command -v node"], { env }).status,
        0,
      );
      const portable = path.join(app, "bin/scislide");
      const link = path.join(root, "linked launcher with spaces");
      await symlink(path.relative(root, portable), link);
      const launchers = [portable, link];
      const entry =
        platform === "darwin"
          ? path.join(
              app,
              "SciSlide.app/Contents/Resources/scislide-cli/desktop/update-cli.mjs",
            )
          : path.join(app, "resources/scislide-cli/desktop/update-cli.mjs");
      if (platform === "darwin")
        launchers.push(
          path.join(
            app,
            "SciSlide.app/Contents/Resources/scislide-cli/bin/scislide",
          ),
        );
      for (const launcher of launchers) {
        const args = [
          "an argument with spaces",
          "--check-update",
          "literal;$text",
        ];
        const result = spawnSync(launcher, args, {
          cwd: os.tmpdir(),
          env,
          encoding: "utf8",
        });
        assert.equal(result.status, 23, result.stderr);
        const lines = result.stdout.trimEnd().split("\n");
        assert.equal(lines.shift(), "MODE=1");
        assert.equal(path.resolve(lines.shift().slice(4)), entry);
        assert.deepEqual(
          lines,
          args.map((value) => `ARG=${value}`),
        );
        for (const command of [
          "schema",
          "create",
          "inspect",
          "validate",
          "apply",
          "unpack",
          "pack",
          "export",
          "--version",
          "--cli",
        ]) {
          const commandArgs = [command, "a path with spaces", "literal;$text"];
          const headless = spawnSync(launcher, commandArgs, {
            cwd: os.tmpdir(),
            env,
            encoding: "utf8",
          });
          assert.equal(headless.status, 23, headless.stderr);
          const headlessLines = headless.stdout.trimEnd().split("\n");
          assert.equal(headlessLines.shift(), "MODE=1");
          assert.equal(path.resolve(headlessLines.shift().slice(4)), entry);
          assert.deepEqual(
            headlessLines,
            commandArgs.map((value) => `ARG=${value}`),
          );
        }
        const gui = spawnSync(
          launcher,
          ["--no-sandbox", "a deck with spaces.scislide"],
          { env, encoding: "utf8" },
        );
        assert.equal(gui.status, 23, gui.stderr);
        assert.equal(
          gui.stdout,
          "MODE=gui\nARG=--no-sandbox\nARG=a deck with spaces.scislide\n",
        );
        const ordinary = spawnSync(launcher, ["deck.scislide", "inspect"], {
          env,
          encoding: "utf8",
        });
        assert.equal(ordinary.status, 23, ordinary.stderr);
        assert.equal(
          ordinary.stdout,
          "MODE=gui\nARG=deck.scislide\nARG=inspect\n",
        );
      }
    },
  );
}

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
  await assert.rejects(
    packageDesktop({
      root,
      platform: "linux",
      arch: "x64",
      out: "dist-cli/output",
    }),
    /outside the packaged inputs/,
  );
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
