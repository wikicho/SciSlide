import assert from "node:assert/strict";
import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertReleaseVersion,
  defaultAppDirectory,
  defaultArtifactDirectory,
  publishReleaseEntries,
} from "../scripts/release-layout.mjs";

async function fixture(t) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "scislide-release-layout-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "stage"));
  await mkdir(path.join(root, "out"));
  const entries = ["package.zip", "package.zip.sha256", "INSTALL.md"].map(
    (name) => ({
      source: path.join(root, "stage", name),
      destination: path.join(root, "out", name),
      kind: "file",
    }),
  );
  for (const entry of entries)
    await writeFile(entry.source, `new ${path.basename(entry.source)}`);
  return { root, entries };
}

test("default outputs separate versioned installers from extracted working apps", () => {
  const root = path.resolve("project");
  assert.equal(
    defaultArtifactDirectory(root, "0.6.4.1", "win32"),
    path.join(root, "release/v0.6.4.1/windows"),
  );
  assert.equal(
    defaultArtifactDirectory(root, "1.0.0-beta.1", "macos"),
    path.join(root, "release/v1.0.0-beta.1/macos"),
  );
  assert.equal(
    defaultArtifactDirectory(root, "1.0.0", "linux"),
    path.join(root, "release/v1.0.0/linux"),
  );
  assert.equal(
    defaultAppDirectory(root, "0.6.4.1"),
    path.join(root, "release/work/v0.6.4.1"),
  );
  for (const version of [
    "../other",
    "1.0.0/other",
    "1.0",
    "01.0.0",
    "1.0.0\n",
    "",
  ])
    assert.throws(() => assertReleaseVersion(version));
  assert.throws(() => defaultArtifactDirectory(root, "1.0.0", "unknown"));
});

test("publishes a complete installer/checksum/guide set and clears temporary state", async (t) => {
  const { root, entries } = await fixture(t);
  await publishReleaseEntries(entries);
  for (const entry of entries)
    assert.equal(
      await readFile(entry.destination, "utf8"),
      `new ${path.basename(entry.source)}`,
    );
  assert.deepEqual(
    (await readdir(path.join(root, "out"))).sort(),
    entries.map((entry) => path.basename(entry.destination)).sort(),
  );
});

test("preflight collisions preserve every old artifact and all staged sources", async (t) => {
  const { entries } = await fixture(t);
  await writeFile(entries[1].destination, "old checksum");
  await assert.rejects(publishReleaseEntries(entries), /Output already exists/);
  assert.equal(await readFile(entries[1].destination, "utf8"), "old checksum");
  await assert.rejects(readFile(entries[0].destination), { code: "ENOENT" });
  for (const entry of entries) assert.ok(await readFile(entry.source));
});

test("an interrupted overwrite restores the old app, installer, checksum and guide together", async (t) => {
  const { root, entries } = await fixture(t);
  const app = {
    source: path.join(root, "stage", "app"),
    destination: path.join(root, "out", "app"),
    kind: "directory",
  };
  await mkdir(app.source);
  await mkdir(app.destination);
  await writeFile(path.join(app.source, "payload"), "new app");
  await writeFile(path.join(app.destination, "payload"), "old app");
  for (const entry of entries)
    await writeFile(
      entry.destination,
      `old ${path.basename(entry.destination)}`,
    );
  await assert.rejects(
    publishReleaseEntries(
      [app, ...entries],
      { overwrite: true },
      {
        rename: (source, destination) => {
          if (
            source === entries[1].source &&
            destination === entries[1].destination
          )
            throw new Error("interrupted checksum move");
          return rename(source, destination);
        },
      },
    ),
    /interrupted checksum move/,
  );
  assert.equal(
    await readFile(path.join(app.destination, "payload"), "utf8"),
    "old app",
  );
  assert.equal(
    await readFile(path.join(app.source, "payload"), "utf8"),
    "new app",
  );
  for (const entry of entries) {
    assert.equal(
      await readFile(entry.destination, "utf8"),
      `old ${path.basename(entry.destination)}`,
    );
    assert.equal(
      await readFile(entry.source, "utf8"),
      `new ${path.basename(entry.source)}`,
    );
  }
  assert.ok(
    (await readdir(path.join(root, "out"))).every(
      (name) => !name.startsWith(".scislide-"),
    ),
  );
});

test("a later collision rolls back new outputs without overwriting the foreign file", async (t) => {
  const { entries } = await fixture(t);
  await assert.rejects(
    publishReleaseEntries(
      entries,
      {},
      {
        rename: async (source, destination) => {
          await rename(source, destination);
          if (source === entries[0].source)
            await writeFile(
              entries[1].destination,
              "arrived during publication",
            );
        },
      },
    ),
    /Output already exists|Output changed/,
  );
  await assert.rejects(readFile(entries[0].destination), { code: "ENOENT" });
  assert.ok(await readFile(entries[0].source));
  assert.equal(
    await readFile(entries[1].destination, "utf8"),
    "arrived during publication",
  );
});

test("rejects linked output files and linked parent directories without touching their target", async (t) => {
  const { root, entries } = await fixture(t);
  const external = path.join(root, "external");
  await writeFile(external, "keep");
  try {
    await symlink(external, entries[0].destination);
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code))
      return t.skip("File symlinks unavailable");
    throw error;
  }
  await assert.rejects(
    publishReleaseEntries(entries, { overwrite: true }),
    /symlink/,
  );
  assert.equal(await readFile(external, "utf8"), "keep");
  await rm(entries[0].destination);
  const linked = path.join(root, "linked");
  await symlink(
    path.join(root, "out"),
    linked,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    publishReleaseEntries([
      { ...entries[0], destination: path.join(linked, "new.zip") },
    ]),
    /symlink/,
  );
});

test("rejects overlapping publication paths and an existing publication lock", async (t) => {
  const { root, entries } = await fixture(t);
  await assert.rejects(
    publishReleaseEntries([
      entries[0],
      { ...entries[1], destination: entries[0].destination },
    ]),
    /distinct/,
  );
  await assert.rejects(
    publishReleaseEntries([{ ...entries[0], destination: entries[0].source }]),
    /overlap/,
  );
  const lock = path.join(root, "out", ".scislide-publish.lock");
  await mkdir(lock);
  await assert.rejects(
    publishReleaseEntries(entries),
    /Another release publication/,
  );
  assert.deepEqual(await readdir(path.join(root, "out")), [
    ".scislide-publish.lock",
  ]);
});

test("keeps backups and reports recovery paths if a rollback itself fails", async (t) => {
  const { root, entries } = await fixture(t);
  for (const entry of entries) await writeFile(entry.destination, "old");
  await assert.rejects(
    publishReleaseEntries(
      entries,
      { overwrite: true },
      {
        rename: (source, destination) => {
          if (
            source === entries[1].source ||
            source.includes(".scislide-publish-backup-")
          )
            throw new Error("disk error");
          return rename(source, destination);
        },
      },
    ),
    /rollback needs recovery/,
  );
  const backup = (await readdir(path.join(root, "out"))).find((name) =>
    name.startsWith(".scislide-publish-backup-"),
  );
  assert.ok(backup);
  assert.ok((await readdir(path.join(root, "out", backup))).length > 0);
});

test("rollback preserves a newly occupied staged source and the old backup", async (t) => {
  const { root, entries } = await fixture(t);
  for (const entry of entries) await writeFile(entry.destination, "old");
  await assert.rejects(
    publishReleaseEntries(
      entries,
      { overwrite: true },
      {
        rename: async (source, destination) => {
          if (source === entries[1].source)
            throw new Error("later publication failed");
          await rename(source, destination);
          if (source === entries[0].source)
            await writeFile(entries[0].source, "foreign source contents");
        },
      },
    ),
    /rollback needs recovery/,
  );
  assert.equal(
    await readFile(entries[0].source, "utf8"),
    "foreign source contents",
  );
  assert.equal(
    await readFile(entries[0].destination, "utf8"),
    "new package.zip",
  );
  const backups = (await readdir(path.join(root, "out"))).filter((name) =>
    name.startsWith(".scislide-publish-backup-"),
  );
  assert.ok(backups.length);
  assert.equal(
    await readFile(path.join(root, "out", backups[0], "0"), "utf8"),
    "old",
  );
});

test("rollback preserves a published path that changed after its move", async (t) => {
  const { entries } = await fixture(t);
  for (const entry of entries) await writeFile(entry.destination, "old");
  await assert.rejects(
    publishReleaseEntries(
      entries,
      { overwrite: true },
      {
        rename: async (source, destination) => {
          if (source === entries[1].source) {
            await writeFile(
              entries[0].destination,
              "foreign published contents",
            );
            throw new Error("later publication failed");
          }
          await rename(source, destination);
        },
      },
    ),
    /rollback needs recovery/,
  );
  assert.equal(
    await readFile(entries[0].destination, "utf8"),
    "foreign published contents",
  );
});

test("an expected destination identity prevents replacing a changed prior generation", async (t) => {
  const { entries } = await fixture(t);
  await writeFile(entries[0].destination, "original");
  const expectedDestination = await lstat(entries[0].destination);
  await rm(entries[0].destination);
  await writeFile(entries[0].destination, "replacement");
  await assert.rejects(
    publishReleaseEntries([{ ...entries[0], expectedDestination }], {
      overwrite: true,
    }),
    /Output changed/,
  );
  assert.equal(await readFile(entries[0].destination, "utf8"), "replacement");
});
