import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { runCli } from "./update-cli.mjs";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const entry = fileURLToPath(new URL("./update-cli.mjs", import.meta.url));
// A CLI subprocess must not inherit Node's test-runner output transport.
const childEnvironment = { ...process.env, DISPLAY: "", WAYLAND_DISPLAY: "" };
delete childEnvironment.NODE_TEST_CONTEXT;
delete childEnvironment.NODE_TEST_WORKER_ID;
const metadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const version = metadata.version;
const installer = `SciSlide-${version}-linux-x64.deb`;
const release = {
  tag_name: `v${version}`,
  draft: false,
  prerelease: true,
  assets: [
    {
      name: installer,
      size: 4,
      digest: `sha256:${"a".repeat(64)}`,
      browser_download_url: `https://github.com/wikicho/SciSlide/releases/download/v${version}/${installer}`,
    },
  ],
};

test("CLI entry reads the installed version and keeps a current build unchanged", async () => {
  const output = [];
  const errors = [];
  const requests = [];
  const exitCode = await runCli(["--update"], {
    platform: "linux",
    arch: "x64",
    stdout: (message) => output.push(message),
    stderr: (message) => errors.push(message),
    fetch: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify([release]));
    },
  });
  assert.equal(exitCode, 0);
  assert.match(
    output.join(""),
    new RegExp(`SciSlide ${version.replaceAll(".", "\\.")} is current`),
  );
  assert.equal(errors.length, 0);
  assert.deepEqual(requests, [
    "https://api.github.com/repos/wikicho/SciSlide/releases?per_page=100&page=1",
  ]);
});

test("CLI entry checks a newer release without creating an output directory", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "scislide-entry-"));
  const destination = path.join(temporary, "must not exist");
  const output = [];
  try {
    const exitCode = await runCli(["--check-update"], {
      currentVersion: "0.0.0",
      platform: "linux",
      arch: "x64",
      defaultDestination: destination,
      stdout: { write: (message) => output.push(message) },
      stderr: { write: (message) => assert.fail(message) },
      fetch: async () => new Response(JSON.stringify([release])),
    });
    assert.equal(exitCode, 0);
    assert.match(output.join(""), /Update available:/);
    assert.ok(output.join("").includes(installer));
    await assert.rejects(readFile(destination), { code: "ENOENT" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("standalone CLI help exits successfully without a GUI or network", async () => {
  const { stdout, stderr } = await run(process.execPath, [entry, "--help"], {
    env: childEnvironment,
    timeout: 10_000,
  });
  assert.match(stdout, /Usage: scislide --update/);
  assert.match(stdout, /never installed or executed automatically/);
  assert.equal(stderr, "");
});

test("standalone CLI rejects invalid flags with exit code 2", async () => {
  await assert.rejects(
    run(process.execPath, [entry, "--update", "--unknown"], {
      env: childEnvironment,
      timeout: 10_000,
    }),
    (error) => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /Unknown update argument: --unknown/);
      return true;
    },
  );
});

for (const isPackaged of [true, false]) {
  test(`direct ${isPackaged ? "packaged" : "development"} update runs independently of the editor`, async () => {
    const args = ["--check-update", "--stable"];
    const invocations = [];
    let completed;
    const exit = new Promise((resolve) => (completed = resolve));
    const electron = {
      app: {
        isPackaged,
        setName() {},
        enableSandbox() {},
        getVersion: () => "1.2.3",
        getPath: () => "/temporary downloads",
        requestSingleInstanceLock: () =>
          assert.fail("CLI must not take the editor lock"),
        whenReady: () => assert.fail("CLI must not start the editor lifecycle"),
        exit: completed,
      },
      protocol: { registerSchemesAsPrivileged() {} },
      BrowserWindow: class {
        constructor() {
          assert.fail("CLI must not open a window");
        }
      },
    };
    const source = await readFile(
      new URL("./main.cjs", import.meta.url),
      "utf8",
    );
    // Stub the module-loading boundary while executing the actual host startup.
    const context = vm.createContext({
      require: (name) => (name === "electron" ? electron : require(name)),
      process: {
        platform: "linux",
        env: {},
        argv: ["scislide", ...(isPackaged ? [] : ["."]), ...args],
      },
      __dirname: path.dirname(entry),
      URL,
      console,
      testImport: async (url) => {
        assert.equal(url, new URL("./update-cli.mjs", import.meta.url).href);
        return {
          runCli: async (receivedArgs, options) => {
            invocations.push({ args: [...receivedArgs], options });
            return 2;
          },
        };
      },
    });
    vm.runInContext(source.replaceAll("import(", "testImport("), context);
    assert.equal(await exit, 2);
    assert.equal(invocations.length, 1);
    assert.deepEqual(invocations[0].args, args);
    assert.equal(invocations[0].options.currentVersion, "1.2.3");
    assert.equal(
      invocations[0].options.defaultDestination,
      path.join("/temporary downloads", "SciSlide-updates"),
    );
  });
}
