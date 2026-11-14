import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  organizeRelease,
  planReleaseOrganization,
  rollbackReleaseOrganization,
} from "../scripts/organize-release.mjs";

const execute = promisify(execFile);
const date = "2026-11-14";
async function fixture(t) {
  const root = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "scislide-release-organization-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "release/linux-deb/v0.6.4.1/SciSlide-linux-x64/resources/app.asar":
      "current app bytes",
    "release/linux-deb/v0.6.4.1/SciSlide-0.6.4.1-linux-x64.deb":
      "current deb bytes",
    "release/linux-deb/v0.6.4.1/SciSlide-0.6.4.1-linux-x64.deb.sha256":
      "current checksum",
    "release/linux-deb/v0.6.4.1/LINUX-INSTALL.md": "current guide",
    "release/linux-deb/SciSlide-0.6.1-linux-x64.deb": "old public deb",
    "release/linux-deb/pre-release-0.6.1/SciSlide-0.6.1-linux-x64.deb":
      "different earlier local deb",
    "release/macos-pkg/SciSlide-0.6.2-macos-arm64-unsigned.pkg":
      "old mac installer",
    "release/windows-x64/SciSlide-0.6.2-windows-x64-portable.zip":
      "old portable zip",
    "release/SciSlide-linux-x64/resources/app.asar": "root linux old app",
    "release/SciSlide-win32-x64/resources/app.asar": "root windows old app",
    "release/validation/tests.log": "precious validation evidence",
    "release/MACOS-INSTALL.md": "historical mac guide",
    "release/WINDOWS-INSTALL.md": "historical windows guide",
    "release/archive/moves-2026-11-13.json": "[]\n",
    "release/archive/versions/v0.5.3/source.zip": "preserved source",
    "release/archive/builds/older/local.zip": "preserved local build",
    "release/v0.6.3.1/validation/report.json": "old report",
    "release/v0.6.4/linux/SciSlide-0.6.4-linux-x64.deb":
      "existing current version tree",
    "release/personal-notes.txt": "unknown root must stay",
  };
  for (const [filename, source] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await writeFile(path.join(root, filename), source);
  }
  await mkdir(path.join(root, "release/native-macos"));
  return { root, date, files };
}
async function contents(root) {
  const result = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile())
        result[path.relative(root, filename).split(path.sep).join("/")] =
          await readFile(filename, "utf8");
    }
  }
  await walk(root);
  return result;
}
const read = (root, filename) =>
  readFile(path.join(root, "release", filename), "utf8");
function expectedLocation(filename) {
  const current = "release/linux-deb/v0.6.4.1/";
  if (filename.startsWith(`${current}SciSlide-linux-x64/`))
    return filename.replace(current, "release/work/v0.6.4.1/");
  if (filename.startsWith(current))
    return filename.replace(current, "release/v0.6.4.1/linux/");
  if (
    /^release\/(linux-deb|macos-pkg|windows-x64|SciSlide-linux-x64|SciSlide-win32-x64|validation|MACOS-INSTALL.md|WINDOWS-INSTALL.md)(?:\/|$)/.test(
      filename,
    )
  )
    return filename.replace("release/", `release/archive/legacy-${date}/`);
  return filename;
}

test("dry-run reports moves, bytes and unknown roots without writing or moving anything", async (t) => {
  const options = await fixture(t);
  const before = await contents(options.root);
  const result = await organizeRelease(options);
  assert.equal(result.applied, false);
  assert.equal(result.moves[0].from, "linux-deb/v0.6.4.1");
  assert.equal(result.moves[1].to, "work/v0.6.4.1/SciSlide-linux-x64");
  assert.deepEqual(result.unknownRoots, ["personal-notes.txt"]);
  assert.equal(
    result.totals.bytes,
    Object.values(options.files).reduce(
      (sum, value) => sum + Buffer.byteLength(value),
      0,
    ),
  );
  assert.deepEqual(await contents(options.root), before);
});

test("apply separates current installers/work, preserves legacy/evidence and verifies every moved tree", async (t) => {
  const options = await fixture(t);
  const result = await organizeRelease({ ...options, apply: true });
  for (const [filename, source] of Object.entries(options.files))
    assert.equal(
      await readFile(
        path.join(options.root, expectedLocation(filename)),
        "utf8",
      ),
      source,
      filename,
    );
  const journal = JSON.parse(await readFile(result.journal, "utf8"));
  assert.equal(journal.status, "completed");
  assert.ok(
    journal.moves.every(
      (move) =>
        move.status === "verified" &&
        /^[a-f0-9]{64}$/.test(move.fingerprint.sha256),
    ),
  );
  const inventory = JSON.parse(await read(options.root, "inventory.json"));
  assert.equal(inventory.format, "scislide-release-inventory");
  assert.ok(
    inventory.entries.some(
      (entry) => entry.name === "v0.6.4.1/linux/SciSlide-0.6.4.1-linux-x64.deb",
    ),
  );
  assert.ok(
    (await read(options.root, "README.md")).includes(
      "archive/moves-2026-11-13.json",
    ),
  );
  assert.ok(
    (await read(options.root, "README.md")).includes("personal-notes.txt"),
  );
});

test("a same-date rerun is a no-op and does not rewrite metadata or add another journal", async (t) => {
  const options = { ...(await fixture(t)), apply: true };
  await organizeRelease(options);
  const before = await contents(options.root);
  const result = await organizeRelease(options);
  assert.equal(result.unchanged, true);
  assert.equal(result.moves.length, 0);
  assert.deepEqual(await contents(options.root), before);
});

test("rollback previews by default, restores originals exactly, and is itself idempotent", async (t) => {
  const options = await fixture(t);
  const result = await organizeRelease({ ...options, apply: true });
  const before = await contents(options.root);
  const request = { root: options.root, journal: result.journal };
  assert.equal((await rollbackReleaseOrganization(request)).applied, false);
  assert.deepEqual(await contents(options.root), before);
  await rollbackReleaseOrganization({ ...request, apply: true });
  const after = await contents(options.root);
  for (const [filename, source] of Object.entries(options.files))
    assert.equal(after[filename], source);
  assert.equal(after["release/README.md"], undefined);
  assert.equal(after["release/inventory.json"], undefined);
  assert.equal(
    JSON.parse(await readFile(result.journal, "utf8")).status,
    "rolled-back",
  );
  assert.equal(
    (await rollbackReleaseOrganization({ ...request, apply: true })).unchanged,
    true,
  );
});

test("a failed later move automatically rolls back earlier verified moves without losing files", async (t) => {
  const options = await fixture(t);
  let count = 0;
  await assert.rejects(
    organizeRelease(
      { ...options, apply: true },
      {
        rename: async (from, to) => {
          if (++count === 6) throw new Error("Simulated disk failure");
          await rename(from, to);
        },
      },
    ),
    /failed and was rolled back: Simulated disk failure/,
  );
  const after = await contents(options.root);
  for (const [filename, source] of Object.entries(options.files))
    assert.equal(after[filename], source);
  const journals = (
    await readdir(path.join(options.root, "release/archive"))
  ).filter((name) => name.startsWith("organization-"));
  assert.equal(journals.length, 1);
  assert.equal(
    JSON.parse(await read(options.root, `archive/${journals[0]}`)).status,
    "rolled-back",
  );
});

test("a failure between the parent move and raw-app separation restores the nested original", async (t) => {
  const options = await fixture(t);
  let count = 0;
  await assert.rejects(
    organizeRelease(
      { ...options, apply: true },
      {
        rename: async (from, to) => {
          if (++count === 2) throw new Error("App move failed");
          await rename(from, to);
        },
      },
    ),
    /was rolled back/,
  );
  assert.equal(
    await read(
      options.root,
      "linux-deb/v0.6.4.1/SciSlide-linux-x64/resources/app.asar",
    ),
    "current app bytes",
  );
});

test("colliding versioned or legacy destinations are rejected before any mutation", async (t) => {
  for (const destination of [
    "v0.6.4.1/linux",
    `archive/legacy-${date}/windows-x64`,
  ]) {
    const options = await fixture(t);
    await mkdir(path.join(options.root, "release", destination), {
      recursive: true,
    });
    await writeFile(
      path.join(options.root, "release", destination, "keep.txt"),
      "keep me",
    );
    const before = await contents(options.root);
    await assert.rejects(
      organizeRelease({ ...options, apply: true }),
      /destination already exists/,
    );
    assert.deepEqual(await contents(options.root), before);
  }
});

test("release-root and destination-parent symlinks are rejected without touching their targets", async (t) => {
  for (const linked of ["release", "release/archive"]) {
    const options = await fixture(t);
    const outside = await mkdtemp(
      path.join(await realpath(os.tmpdir()), "scislide-release-outside-"),
    );
    t.after(() => rm(outside, { recursive: true, force: true }));
    await writeFile(path.join(outside, "precious.txt"), "outside data");
    await rm(path.join(options.root, linked), { recursive: true });
    await symlink(
      outside,
      path.join(options.root, linked),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      organizeRelease({ ...options, apply: true }),
      /symlink/,
    );
    assert.deepEqual(await readdir(outside), ["precious.txt"]);
    assert.equal(
      await readFile(path.join(outside, "precious.txt"), "utf8"),
      "outside data",
    );
  }
});

test(
  "artifact-internal links are preserved without traversal",
  { skip: process.platform === "win32" },
  async (t) => {
    const options = await fixture(t);
    const app = path.join(
      options.root,
      "release/linux-deb/v0.6.4.1/SciSlide-linux-x64",
    );
    await symlink("resources", path.join(app, "alias"), "dir");
    const result = await organizeRelease({ ...options, apply: true });
    const journal = JSON.parse(await readFile(result.journal, "utf8"));
    assert.equal(journal.moves[1].fingerprint.symlinks, 1);
    const inventory = JSON.parse(await read(options.root, "inventory.json"));
    assert.ok(
      inventory.entries.some(
        (entry) =>
          entry.name.endsWith("SciSlide-linux-x64/alias") &&
          entry.target === "resources",
      ),
    );
    await rollbackReleaseOrganization({
      root: options.root,
      journal: result.journal,
      apply: true,
    });
  },
);

test("unrecognized README/inventory files are protected from replacement", async (t) => {
  for (const name of ["README.md", "inventory.json"]) {
    const options = await fixture(t);
    await writeFile(
      path.join(options.root, "release", name),
      name === "README.md"
        ? "User authored release guide"
        : '{"user":"inventory"}',
    );
    const before = await contents(options.root);
    await assert.rejects(
      organizeRelease({ ...options, apply: true }),
      /unrecognized generated file/,
    );
    assert.deepEqual(await contents(options.root), before);
  }
});

test("rollback rejects journals outside release and path traversal inside a journal", async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    rollbackReleaseOrganization({
      root: options.root,
      journal: "../outside.json",
      apply: true,
    }),
    /inside the release/,
  );
  const result = await organizeRelease({ ...options, apply: true });
  const journal = JSON.parse(await readFile(result.journal, "utf8"));
  journal.moves[0].to = "../../outside";
  await writeFile(result.journal, JSON.stringify(journal));
  const before = await contents(options.root);
  await assert.rejects(
    rollbackReleaseOrganization({
      root: options.root,
      journal: result.journal,
      apply: true,
    }),
    /inside the release/,
  );
  assert.deepEqual(await contents(options.root), before);
});

test("rollback refuses edited moved content without overwriting it", async (t) => {
  const options = await fixture(t);
  const result = await organizeRelease({ ...options, apply: true });
  const moved = `archive/legacy-${date}/WINDOWS-INSTALL.md`;
  await writeFile(path.join(options.root, "release", moved), "new user edits");
  const before = await contents(options.root);
  await assert.rejects(
    rollbackReleaseOrganization({
      root: options.root,
      journal: result.journal,
      apply: true,
    }),
    /changed since organization/,
  );
  assert.equal(await read(options.root, moved), "new user edits");
  assert.deepEqual(
    await contents(options.root),
    before,
    "every fingerprint must pass before metadata or any move changes",
  );
});

test("rollback resumes after a rename completed before its journal update", async (t) => {
  const options = await fixture(t);
  const result = await organizeRelease({ ...options, apply: true });
  const journal = JSON.parse(await readFile(result.journal, "utf8"));
  const move = journal.moves.at(-1);
  await rename(
    path.join(options.root, "release", move.to),
    path.join(options.root, "release", move.from),
  );
  journal.status = "rolling-back";
  await writeFile(result.journal, JSON.stringify(journal));
  await rollbackReleaseOrganization({
    root: options.root,
    journal: result.journal,
    apply: true,
  });
  for (const [filename, source] of Object.entries(options.files))
    assert.equal(
      await readFile(path.join(options.root, filename), "utf8"),
      source,
    );
});

test("rollback resumes after all parent and child renames completed but journal completion did not", async (t) => {
  const options = await fixture(t);
  const result = await organizeRelease({ ...options, apply: true });
  const journal = JSON.parse(await readFile(result.journal, "utf8"));
  for (const move of [...journal.moves].reverse()) {
    const from = path.join(options.root, "release", move.from),
      to = path.join(options.root, "release", move.to);
    await mkdir(path.dirname(from), { recursive: true });
    await rename(to, from);
  }
  journal.status = "rolling-back";
  await writeFile(result.journal, JSON.stringify(journal));
  await rollbackReleaseOrganization({
    root: options.root,
    journal: result.journal,
    apply: true,
  });
  for (const [filename, source] of Object.entries(options.files))
    assert.equal(
      await readFile(path.join(options.root, filename), "utf8"),
      source,
    );
});

test("concurrent apply is rejected and cannot undo the other run's completed moves", async (t) => {
  const options = { ...(await fixture(t)), apply: true };
  let start, resume;
  const entered = new Promise((resolve) => {
    start = resolve;
  });
  const paused = new Promise((resolve) => {
    resume = resolve;
  });
  let first = true;
  const running = organizeRelease(options, {
    rename: async (from, to) => {
      if (first) {
        first = false;
        start();
        await paused;
      }
      await rename(from, to);
    },
  });
  await entered;
  try {
    await assert.rejects(organizeRelease(options), /already running/);
  } finally {
    resume();
  }
  const result = await running;
  assert.equal(
    JSON.parse(await readFile(result.journal, "utf8")).status,
    "completed",
  );
  for (const [filename, source] of Object.entries(options.files))
    assert.equal(
      await readFile(
        path.join(options.root, expectedLocation(filename)),
        "utf8",
      ),
      source,
    );
});

test("new versioned outputs refresh inventory while unchanged reruns remain idempotent", async (t) => {
  const options = { ...(await fixture(t)), apply: true };
  await organizeRelease(options);
  const name = "v0.6.4.1/linux/new-output.deb";
  await writeFile(path.join(options.root, "release", name), "new build");
  const refreshed = await organizeRelease(options);
  assert.equal(refreshed.moves.length, 0);
  assert.notEqual(refreshed.unchanged, true);
  assert.ok(
    JSON.parse(await read(options.root, "inventory.json")).entries.some(
      (entry) => entry.name === name,
    ),
  );
  assert.equal((await organizeRelease(options)).unchanged, true);
});

test("CLI is dry-run by default and rejects unsupported flags and invalid dates", async (t) => {
  const options = await fixture(t);
  const script = fileURLToPath(
    new URL("../scripts/organize-release.mjs", import.meta.url),
  );
  const before = await contents(options.root);
  const run = (...args) =>
    execute(process.execPath, [script, `--root=${options.root}`, ...args], {
      env: process.env,
    });
  assert.equal(JSON.parse((await run(`--date=${date}`)).stdout).applied, false);
  for (const args of [["--delete"], ["--date=2026-02-30"], ["--root"]])
    await assert.rejects(run(...args));
  assert.deepEqual(await contents(options.root), before);
});
