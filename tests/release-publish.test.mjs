import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  publishRelease,
  verifyReleaseFiles,
} from "../scripts/publish-release.mjs";

const version = "0.6.0";
const sha = "a".repeat(40);
const repo = "wikicho/SciSlide";
const execute = promisify(execFile);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scislide-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "publish");
  await mkdir(directory);
  await mkdir(path.join(root, "desktop"));
  await mkdir(path.join(root, "docs", "releases"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
  await writeFile(
    path.join(root, "docs", "releases", `v${version}.md`),
    "# SciSlide release\n\nEditable inline math.\n",
  );
  const exe = Buffer.alloc(90);
  exe.write("MZ");
  exe.writeUInt32LE(64, 60);
  exe.writeUInt32LE(0x00004550, 64);
  exe.writeUInt16LE(0x8664, 68);
  exe.writeUInt16LE(2, 84);
  exe.writeUInt16LE(0x020b, 88);
  const binaries = new Map([
    [
      `SciSlide-${version}-macos-arm64-unsigned.pkg`,
      Buffer.from("xar!macOS arm64 fixture"),
    ],
    [
      `SciSlide-${version}-macos-x64-unsigned.pkg`,
      Buffer.from("xar!macOS x64 fixture"),
    ],
    [`SciSlide-${version}-windows-x64-setup-unsigned.exe`, exe],
    [
      `SciSlide-${version}-windows-x64-portable.zip`,
      Buffer.from("504b030466697874757265", "hex"),
    ],
    [
      `SciSlide-${version}-linux-x64.deb`,
      Buffer.from("!<arch>\nDebian fixture"),
    ],
  ]);
  for (const [name, bytes] of binaries) {
    await writeFile(path.join(directory, name), bytes);
    await writeFile(
      path.join(directory, `${name}.sha256`),
      `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`,
    );
  }
  for (const platform of ["MACOS", "WINDOWS", "LINUX"]) {
    const guide = `${platform} installation guide\n`;
    await writeFile(path.join(root, "desktop", `${platform}.md`), guide);
    await writeFile(path.join(directory, `${platform}-INSTALL.md`), guide);
  }
  return { root, directory, repo, sha, runId: "50" };
}

test("workflow source validation accepts main pushes and requires exact dispatch source SHA", async (t) => {
  const options = await fixture(t);
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const source = workflow.match(
    /node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/,
  )?.[1];
  assert.ok(
    source,
    "Release workflow must validate its source before building",
  );
  const environment = {
    ...process.env,
    GITHUB_REPOSITORY: repo,
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: sha,
    GITHUB_EVENT_NAME: "push",
    EXPECTED_SOURCE_SHA: "",
  };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_TEST_WORKER_ID;
  const validate = (overrides = {}) =>
    execute(process.execPath, ["--input-type=module", "-e", source], {
      cwd: options.root,
      env: { ...environment, ...overrides },
      timeout: 10_000,
    });
  const pushed = await validate();
  assert.ok(
    pushed.stdout.includes(`Preparing SciSlide ${version} from ${sha}`),
  );
  await validate({
    GITHUB_EVENT_NAME: "workflow_dispatch",
    EXPECTED_SOURCE_SHA: sha,
  });
  for (const overrides of [
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
    {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      EXPECTED_SOURCE_SHA: "b".repeat(40),
    },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_REF: "refs/heads/release" },
    { GITHUB_REPOSITORY: "other/SciSlide" },
    { GITHUB_SHA: "invalid" },
  ]) {
    await assert.rejects(
      validate(overrides),
      /Release source must|Dispatch main/,
      JSON.stringify(overrides),
    );
  }
});

test("release verification requires all 13 source-matching files and computes their hashes", async (t) => {
  const options = await fixture(t);
  const files = await verifyReleaseFiles({ ...options, version });
  assert.equal(files.size, 13);
  for (const [name, file] of files) {
    const bytes = await readFile(path.join(options.directory, name));
    assert.equal(file.size, bytes.length);
    assert.equal(
      file.digest,
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  }
  await writeFile(path.join(options.directory, "stale-package.pkg"), "stale");
  await assert.rejects(
    verifyReleaseFiles({ ...options, version }),
    /exactly the 13/,
  );
});

test("checksums cannot conceal a wrong Windows architecture and guides must match source", async (t) => {
  const options = await fixture(t);
  const filename = `SciSlide-${version}-windows-x64-setup-unsigned.exe`;
  const bytes = await readFile(path.join(options.directory, filename));
  bytes.writeUInt16LE(0xaa64, 68);
  await writeFile(path.join(options.directory, filename), bytes);
  await writeFile(
    path.join(options.directory, `${filename}.sha256`),
    `${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`,
  );
  await assert.rejects(
    verifyReleaseFiles({ ...options, version }),
    /AMD64\/x64/,
  );
  bytes.writeUInt16LE(0x8664, 68);
  await writeFile(path.join(options.directory, filename), bytes);
  await writeFile(
    path.join(options.directory, `${filename}.sha256`),
    `${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`,
  );
  await writeFile(
    path.join(options.directory, "MACOS-INSTALL.md"),
    "Old guide\n",
  );
  await assert.rejects(
    verifyReleaseFiles({ ...options, version }),
    /guide differs/,
  );
});

test("changed binaries fail their checksum and directories cannot stand in for assets", async (t) => {
  const options = await fixture(t);
  const filename = `SciSlide-${version}-linux-x64.deb`;
  await writeFile(
    path.join(options.directory, filename),
    "!<arch>\nChanged fixture",
  );
  await assert.rejects(
    verifyReleaseFiles({ ...options, version }),
    /Checksum mismatch/,
  );
  await rm(path.join(options.directory, filename));
  await mkdir(path.join(options.directory, filename));
  await assert.rejects(
    verifyReleaseFiles({ ...options, version }),
    /regular file/,
  );
});

async function apiFixture(
  options,
  { existing = false, wrongTag = false, failUpload = false, run = {} } = {},
) {
  const files = await verifyReleaseFiles({ ...options, version });
  let tagSha = wrongTag ? "b".repeat(40) : existing ? sha : null;
  let release = existing
    ? {
        id: 99,
        tag_name: `v${version}`,
        target_commitish: sha,
        prerelease: true,
        draft: true,
      }
    : null;
  const assets = [];
  const commands = [];
  let interrupted = false;
  const api = async (resource, request = {}) => {
    if (resource === "actions/runs/50")
      return {
        id: 50,
        head_sha: sha,
        repository: { full_name: repo },
        head_repository: { full_name: repo },
        head_branch: "main",
        event: "workflow_dispatch",
        name: "SciSlide development release",
        path: ".github/workflows/release.yml",
        ...run,
      };
    if (resource.startsWith("git/ref/tags/"))
      return tagSha ? { object: { type: "commit", sha: tagSha } } : null;
    if (resource.startsWith("releases?")) return release ? [release] : [];
    if (resource === "releases" && request.method === "POST")
      return (release = { id: 99, ...request.body });
    if (resource === "releases/99/assets?per_page=100") return assets;
    if (resource === "releases/99") return release;
    throw new Error(`Unexpected API call: ${resource}`);
  };
  const gh = (args) => {
    commands.push(args);
    assert.ok(!args.includes("--clobber"));
    if (args[1] === "upload") {
      if (failUpload && assets.length === 2 && !interrupted) {
        interrupted = true;
        throw new Error("Interrupted upload");
      }
      const name = path.basename(args[3]);
      assets.push({ name, state: "uploaded", ...files.get(name) });
    } else {
      assert.equal(
        assets.length,
        13,
        "Publication must wait for the full asset set",
      );
      assert.ok(args.includes("--prerelease"));
      assert.ok(args.includes("--latest=false"));
      release.draft = false;
      tagSha = sha;
    }
  };
  return { api, gh, files, assets, commands, release: () => release };
}

test("a draft publishes only after all assets verify, and a rerun makes no changes", async (t) => {
  const options = await fixture(t);
  const mock = await apiFixture(options);
  const result = await publishRelease(options, mock);
  assert.equal(result.assetCount, 13);
  assert.equal(result.tag, "v0.6.0");
  assert.equal(mock.commands.filter((args) => args[1] === "upload").length, 13);
  assert.equal(mock.commands.at(-1)[1], "edit");
  assert.equal((await readdir(options.directory)).length, 13);
  const count = mock.commands.length;
  await publishRelease(options, mock);
  assert.equal(mock.commands.length, count);
});

test("a trusted main push publishes the complete verified prerelease", async (t) => {
  const options = await fixture(t);
  const mock = await apiFixture(options, { run: { event: "push" } });
  const result = await publishRelease(options, mock);
  assert.equal(result.sha, sha);
  assert.equal(result.assetCount, 13);
  assert.equal(mock.release().draft, false);
  assert.equal(mock.release().prerelease, true);
  assert.equal(mock.commands.filter((args) => args[1] === "upload").length, 13);
  assert.equal(mock.commands.at(-1)[1], "edit");
});

test("publication rejects other events and altered push provenance before release writes", async (t) => {
  const options = await fixture(t);
  const invalidRuns = [
    { event: "pull_request" },
    { event: "workflow_run" },
    { event: "schedule" },
    { event: "push", head_branch: "release" },
    { event: "push", repository: { full_name: "other/SciSlide" } },
    { event: "push", head_repository: { full_name: "other/SciSlide" } },
    { event: "push", head_sha: "b".repeat(40) },
    { event: "push", id: 51 },
    { event: "push", name: "Another release workflow" },
    { event: "push", path: ".github/workflows/linux-release.yml" },
  ];
  for (const run of invalidRuns) {
    const mock = await apiFixture(options, { run });
    const calls = [];
    const api = async (...args) => {
      calls.push(args);
      return mock.api(...args);
    };
    await assert.rejects(
      publishRelease(options, { ...mock, api }),
      /trusted release workflow/,
      JSON.stringify(run),
    );
    assert.deepEqual(calls, [["actions/runs/50"]]);
    assert.equal(mock.commands.length, 0);
    assert.equal(mock.release(), null);
  }
});

test("publication refuses wrong tags and mismatched existing assets without overwriting", async (t) => {
  const options = await fixture(t);
  const wrong = await apiFixture(options, { wrongTag: true });
  await assert.rejects(
    publishRelease(options, wrong),
    /different source commit/,
  );
  assert.equal(wrong.commands.length, 0);
  const mismatch = await apiFixture(options, { existing: true });
  const [name, file] = [...mismatch.files.entries()][0];
  mismatch.assets.push({
    name,
    state: "uploaded",
    size: file.size,
    digest: "sha256:" + "b".repeat(64),
  });
  await assert.rejects(publishRelease(options, mismatch), /asset differs/);
  assert.equal(mismatch.commands.length, 0);
});

test("an interrupted upload leaves the release draft and can resume safely", async (t) => {
  const options = await fixture(t);
  const mock = await apiFixture(options, { failUpload: true });
  await assert.rejects(publishRelease(options, mock), /Interrupted upload/);
  assert.equal(mock.release().draft, true);
  assert.equal(mock.assets.length, 2);
  assert.ok(mock.commands.every((args) => args[1] === "upload"));
  const uploaded = mock.assets.map((asset) => asset.name);
  await publishRelease(options, mock);
  assert.equal(mock.release().draft, false);
  assert.equal(mock.assets.length, 13);
  for (const name of uploaded) {
    assert.equal(
      mock.commands.filter(
        (args) => args[1] === "upload" && path.basename(args[3]) === name,
      ).length,
      1,
    );
  }
});
