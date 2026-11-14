import { lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";

export function assertReleaseVersion(version) {
  if (
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(
      version,
    )
  )
    throw new Error(
      "The package version must be a safe semantic version with an optional numeric revision.",
    );
  return version;
}

export function defaultArtifactDirectory(root, version, platform) {
  assertReleaseVersion(version);
  const directory = {
    darwin: "macos",
    macos: "macos",
    win32: "windows",
    windows: "windows",
    linux: "linux",
  }[platform];
  if (!directory) throw new Error("Unsupported release platform.");
  return path.join(root, "release", `v${version}`, directory);
}

export function defaultAppDirectory(root, version) {
  assertReleaseVersion(version);
  return path.join(root, "release", "work", `v${version}`);
}

async function stat(filename) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Never let generated outputs follow a directory link into unrelated data. */
export async function assertNoSymlinkParents(filename) {
  let current = path.resolve(filename);
  while (true) {
    const entry = await stat(current);
    if (entry && (entry.isSymbolicLink() || !entry.isDirectory()))
      throw new Error(
        `Output parent must be a regular directory, not a symlink: ${current}`,
      );
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export async function guardAppDirectory(directory, platform, overwrite) {
  const entry = await stat(directory);
  if (!entry) return null;
  if (entry.isSymbolicLink() || !entry.isDirectory())
    throw new Error(
      `Refusing to replace a non-directory or symlink: ${directory}`,
    );
  if (!overwrite)
    throw new Error(
      `Output already exists: ${directory}. Choose another --out folder or pass --overwrite.`,
    );
  const archive =
    platform === "darwin"
      ? path.join(
          directory,
          "SciSlide.app",
          "Contents",
          "Resources",
          "app.asar",
        )
      : path.join(directory, "resources", "app.asar");
  await assertNoSymlinkParents(path.dirname(archive));
  const payload = await stat(archive);
  if (!payload || !payload.isFile() || payload.isSymbolicLink())
    throw new Error(
      `Refusing to replace an unrecognized app directory: ${directory}`,
    );
  return entry;
}

export async function assertAppDirectoryUnchanged(
  directory,
  platform,
  overwrite,
  original,
) {
  const current = await guardAppDirectory(directory, platform, overwrite);
  if (!sameEntry(original, current))
    throw new Error(`Output app changed while packaging: ${directory}`);
}

function sameEntry(first, second) {
  return (
    (!first && !second) ||
    (first &&
      second &&
      first.dev === second.dev &&
      first.ino === second.ino &&
      first.size === second.size &&
      first.mtimeMs === second.mtimeMs)
  );
}

function overlaps(first, second) {
  const relative = path.relative(first, second);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function validateEntry(entry, overwrite) {
  const source = await stat(entry.source);
  if (
    !source ||
    source.isSymbolicLink() ||
    (entry.kind === "directory" ? !source.isDirectory() : !source.isFile())
  )
    throw new Error(`Invalid staged ${entry.kind}: ${entry.source}`);
  await assertNoSymlinkParents(path.dirname(entry.source));
  await assertNoSymlinkParents(path.dirname(entry.destination));
  const destination = await stat(entry.destination);
  if (
    destination &&
    (destination.isSymbolicLink() ||
      (entry.kind === "directory"
        ? !destination.isDirectory()
        : !destination.isFile()))
  )
    throw new Error(
      `Refusing to replace a non-${entry.kind} or symlink: ${entry.destination}`,
    );
  if (destination && !overwrite)
    throw new Error(
      `Output already exists: ${entry.destination}. Choose another --out folder or pass --overwrite.`,
    );
  if (
    "expectedDestination" in entry &&
    !sameEntry(entry.expectedDestination, destination)
  )
    throw new Error(
      `Output changed while the release was being prepared: ${entry.destination}`,
    );
  return destination;
}

/** Build first, then publish the whole set; restore prior outputs on a failed move. */
export async function publishReleaseEntries(
  entries,
  { overwrite = false } = {},
  dependencies = {},
) {
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    typeof overwrite !== "boolean"
  )
    throw new Error(
      "Release publication requires entries and a boolean overwrite flag.",
    );
  const normalized = entries.map((entry) => {
    if (
      !entry ||
      !["file", "directory"].includes(entry.kind ?? "file") ||
      typeof entry.source !== "string" ||
      typeof entry.destination !== "string" ||
      !path.isAbsolute(entry.source) ||
      !path.isAbsolute(entry.destination) ||
      /[\0\r\n]/.test(entry.source + entry.destination)
    )
      throw new Error(
        "Release publication paths must be absolute regular files or directories.",
      );
    return {
      ...entry,
      kind: entry.kind ?? "file",
      source: path.resolve(entry.source),
      destination: path.resolve(entry.destination),
    };
  });
  for (const [index, entry] of normalized.entries()) {
    for (const source of normalized) {
      if (
        overlaps(source.source, entry.destination) ||
        overlaps(entry.destination, source.source)
      )
        throw new Error(
          "Staged and published release entries must not overlap.",
        );
    }
    for (const other of normalized.slice(0, index)) {
      if (
        overlaps(entry.destination, other.destination) ||
        overlaps(other.destination, entry.destination) ||
        overlaps(entry.source, other.source) ||
        overlaps(other.source, entry.source)
      )
        throw new Error(
          "Release entries must have distinct, non-overlapping paths.",
        );
    }
    entry.original = await validateEntry(entry, overwrite);
  }
  const move = dependencies.rename ?? rename;
  const parents = [
    ...new Set(normalized.map((entry) => path.dirname(entry.destination))),
  ].sort();
  const locks = [];
  const backups = new Map();
  const changed = [];
  let rollbackFailed = false;
  try {
    for (const parent of parents) {
      await assertNoSymlinkParents(parent);
      await mkdir(parent, { recursive: true });
      const lock = path.join(parent, ".scislide-publish.lock");
      try {
        await mkdir(lock);
      } catch (error) {
        if (error.code === "EEXIST")
          throw new Error(
            `Another release publication or unfinished recovery uses ${lock}.`,
            { cause: error },
          );
        throw error;
      }
      locks.push(lock);
      backups.set(
        parent,
        await mkdtemp(path.join(parent, ".scislide-publish-backup-")),
      );
    }
    // Recheck the complete set after locking and before moving any prior file.
    for (const entry of normalized) {
      const current = await validateEntry(entry, overwrite);
      if (!sameEntry(entry.original, current))
        throw new Error(
          `Output changed while the release was being prepared: ${entry.destination}`,
        );
    }
    for (const [index, entry] of normalized.entries()) {
      const current = await validateEntry(entry, overwrite);
      if (!sameEntry(entry.original, current))
        throw new Error(
          `Output changed during release publication: ${entry.destination}`,
        );
      const record = {
        ...entry,
        stagedIdentity: await stat(entry.source),
        installed: false,
        backedUp: false,
        backup: path.join(
          backups.get(path.dirname(entry.destination)),
          String(index),
        ),
      };
      changed.push(record);
      if (current) {
        await move(entry.destination, record.backup);
        record.backedUp = true;
      }
      await move(entry.source, entry.destination);
      record.installed = true;
    }
  } catch (error) {
    const recoveryErrors = [];
    for (const entry of changed.reverse()) {
      try {
        if (entry.installed) {
          if (await stat(entry.source))
            throw new Error(
              `Rollback source is occupied; preserving both files: ${entry.source}`,
            );
          if (!sameEntry(entry.stagedIdentity, await stat(entry.destination)))
            throw new Error(
              `Published output changed; preserving it and the backup: ${entry.destination}`,
            );
          await move(entry.destination, entry.source);
        }
        if (entry.backedUp) {
          if (await stat(entry.destination))
            throw new Error(
              `Rollback destination is occupied; preserving its backup: ${entry.destination}`,
            );
          await move(entry.backup, entry.destination);
        }
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
    }
    if (recoveryErrors.length) {
      rollbackFailed = true;
      throw new AggregateError(
        [error, ...recoveryErrors],
        `Release rollback needs recovery. Preserved backups: ${[...backups.values()].join(", ")}`,
      );
    }
    throw error;
  } finally {
    // Never remove a backup which could be the only remaining previous output.
    if (!rollbackFailed) {
      for (const directory of backups.values())
        await rm(directory, { recursive: true, force: true });
    }
    for (const lock of locks) await rm(lock, { recursive: true, force: true });
  }
}
