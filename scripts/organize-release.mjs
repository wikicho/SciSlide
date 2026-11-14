import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const INDEX_MARKER = "<!-- scislide-release-index:v1 -->";
const JOURNAL_FORMAT = "scislide-release-organization";
const INVENTORY_FORMAT = "scislide-release-inventory";
const LOCK_FORMAT = "scislide-release-organization-lock";
const legacyNames = [
  "SciSlide-linux-x64",
  "SciSlide-win32-x64",
  "linux-deb",
  "macos-pkg",
  "windows-x64",
  "native-macos",
  "validation",
  "MACOS-INSTALL.md",
  "WINDOWS-INSTALL.md",
  "LINUX-INSTALL.md",
];
const versionDirectory = /^v\d+\.\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?$/;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const relative = (root, filename) =>
  path.relative(root, filename).split(path.sep).join("/");
const digest = (source) => createHash("sha256").update(source).digest("hex");
async function exists(filename) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function requireWithin(root, filename) {
  const part = path.relative(root, filename);
  if (
    !part ||
    part === ".." ||
    part.startsWith(`..${path.sep}`) ||
    path.isAbsolute(part)
  )
    throw new Error(`Path must be inside the release directory: ${filename}`);
}
async function context(options = {}) {
  const root = path.resolve(options.root ?? projectRoot);
  if ((await realpath(root)) !== root || !(await lstat(root)).isDirectory())
    throw new Error(
      "The repository root must be a real directory without symlink ancestors.",
    );
  const release = path.join(root, "release");
  const stat = await exists(release);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
    throw new Error(
      "The release root must be a real directory, not a symlink.",
    );
  const date = options.date ?? today();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error("Use a valid YYYY-MM-DD organization date.");
  return { root, release, date };
}
/** Refuse links along mutation paths; links inside an artifact are never followed. */
async function safePath(ctx, filename) {
  requireWithin(ctx.release, filename);
  const components = path.relative(ctx.root, filename).split(path.sep);
  let current = ctx.root;
  for (const component of components) {
    current = path.join(current, component);
    const stat = await exists(current);
    if (!stat) continue;
    if (stat.isSymbolicLink())
      throw new Error(`Refusing a symlink in an organization path: ${current}`);
    if (current !== filename && !stat.isDirectory())
      throw new Error(`Path ancestor is not a directory: ${current}`);
  }
}
async function parents(ctx, filename, created = []) {
  await safePath(ctx, filename);
  const parts = path
    .relative(ctx.release, path.dirname(filename))
    .split(path.sep)
    .filter(Boolean);
  let current = ctx.release;
  if (!(await exists(current))) {
    await mkdir(current);
    created.push(current);
  }
  for (const part of parts) {
    current = path.join(current, part);
    if (!(await exists(current))) {
      await mkdir(current);
      created.push(current);
    }
  }
  await safePath(ctx, filename);
}
async function atomicWrite(ctx, filename, source, created = []) {
  await parents(ctx, filename, created);
  const temporary = path.join(
    path.dirname(filename),
    `.scislide-organize-${randomUUID()}.tmp`,
  );
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(source);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, filename);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
async function acquireLock(ctx, created = []) {
  const filename = path.join(ctx.release, ".organization.lock");
  await parents(ctx, filename, created);
  const lock = JSON.stringify({
    format: LOCK_FORMAT,
    root: ctx.root,
    pid: process.pid,
    nonce: randomUUID(),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(filename, "wx", 0o600);
      try {
        await file.writeFile(lock);
        await file.sync();
      } finally {
        await file.close();
      }
      return async () => {
        if ((await readFile(filename, "utf8").catch(() => null)) === lock)
          await unlink(filename);
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existing;
      try {
        if ((await lstat(filename)).size > 4096)
          throw new Error("Invalid lock");
        existing = JSON.parse(await readFile(filename, "utf8"));
      } catch {
        throw new Error(
          "An unrecognized release organization lock exists; inspect it before continuing.",
        );
      }
      if (
        existing.format !== LOCK_FORMAT ||
        existing.root !== ctx.root ||
        !Number.isSafeInteger(existing.pid) ||
        existing.pid < 1
      )
        throw new Error(
          "An unrecognized release organization lock exists; inspect it before continuing.",
        );
      try {
        process.kill(existing.pid, 0);
      } catch (probe) {
        if (probe.code === "ESRCH") {
          await unlink(filename);
          continue;
        }
      }
      throw new Error("Another release organization is already running.");
    }
  }
  throw new Error("Could not acquire the release organization lock.");
}
async function walk(filename, visit, base = filename) {
  const stat = await lstat(filename);
  const name = relative(base, filename) || ".";
  if (stat.isSymbolicLink()) {
    const { readlink } = await import("node:fs/promises");
    await visit(
      {
        name,
        type: "symlink",
        target: await readlink(filename),
        size: 0,
        mode: stat.mode & 0o7777,
      },
      filename,
    );
  } else if (stat.isDirectory()) {
    await visit(
      { name, type: "directory", size: 0, mode: stat.mode & 0o7777 },
      filename,
    );
    for (const child of (await readdir(filename)).sort())
      await walk(path.join(filename, child), visit, base);
  } else if (stat.isFile()) {
    await visit(
      { name, type: "file", size: stat.size, mode: stat.mode & 0o7777 },
      filename,
    );
  } else throw new Error(`Unsupported filesystem entry: ${filename}`);
}
function fingerprintEntries(entries) {
  const hash = createHash("sha256");
  let files = 0,
    bytes = 0,
    symlinks = 0;
  for (const entry of [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (entry.type === "file") {
      files++;
      bytes += entry.size;
    } else if (entry.type === "symlink") symlinks++;
    hash.update(JSON.stringify(entry));
  }
  return { sha256: hash.digest("hex"), files, bytes, symlinks };
}
async function hashedEntry(entry, filename) {
  if (entry.type !== "file") return entry;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return { ...entry, sha256: hash.digest("hex") };
}
async function fingerprint(filename) {
  const entries = [];
  await walk(filename, async (entry, absolute) =>
    entries.push(await hashedEntry(entry, absolute)),
  );
  return fingerprintEntries(entries);
}
async function inventory(ctx) {
  const entries = [];
  if (await exists(ctx.release))
    await walk(ctx.release, async (entry) => {
      if (
        entry.name !== "inventory.json" &&
        entry.name !== ".organization.lock" &&
        !/^archive\/organization-[^/]+\.json$/.test(entry.name) &&
        !entry.name.startsWith(".scislide-organize-")
      )
        entries.push(entry);
    });
  return {
    format: INVENTORY_FORMAT,
    version: 1,
    generatedAt: new Date().toISOString(),
    totals: {
      files: entries.filter((entry) => entry.type === "file").length,
      bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      symlinks: entries.filter((entry) => entry.type === "symlink").length,
    },
    entries,
  };
}

export async function planReleaseOrganization(options = {}) {
  const ctx = await context(options);
  const moves = [];
  const oldLinux = path.join(ctx.release, "linux-deb/v0.6.4.1");
  const newLinux = path.join(ctx.release, "v0.6.4.1/linux");
  await safePath(ctx, oldLinux);
  await safePath(ctx, newLinux);
  const add = async (from, to, inspect = from) => {
    await safePath(ctx, from);
    await safePath(ctx, to);
    await safePath(ctx, inspect);
    if (!(await exists(inspect))) return;
    if (await exists(to))
      throw new Error(`Organization destination already exists: ${to}`);
    moves.push({
      from: relative(ctx.release, from),
      to: relative(ctx.release, to),
    });
  };
  const migratingLinux = !!(await exists(oldLinux));
  if (migratingLinux) await add(oldLinux, newLinux);
  await add(
    path.join(newLinux, "SciSlide-linux-x64"),
    path.join(ctx.release, "work/v0.6.4.1/SciSlide-linux-x64"),
    path.join(migratingLinux ? oldLinux : newLinux, "SciSlide-linux-x64"),
  );
  for (const name of legacyNames)
    await add(
      path.join(ctx.release, name),
      path.join(ctx.release, "archive", `legacy-${ctx.date}`, name),
    );
  const known = new Set([
    ...legacyNames,
    "archive",
    "work",
    "README.md",
    "inventory.json",
    ".organization.lock",
  ]);
  const unknownRoots = (await exists(ctx.release))
    ? (await readdir(ctx.release))
        .filter((name) => !known.has(name) && !versionDirectory.test(name))
        .sort()
    : [];
  const current = await inventory(ctx);
  return {
    date: ctx.date,
    release: ctx.release,
    moves,
    unknownRoots,
    totals: current.totals,
  };
}

function indexText(ctx, plan) {
  return `${INDEX_MARKER}\n# Local release outputs\n\nThis generated index describes local files; it does not certify publication or installed-app validation.\n\n- \`v<version>/<linux|macos|windows>/\`: installers, portable archives, matching checksums and platform guides.\n- \`work/v<version>/SciSlide-<platform>-<arch>/\`: generated unpacked applications and packaging work.\n- \`archive/legacy-${ctx.date}/\`: preserved older root outputs at their original relative paths.\n- \`archive/builds/\` and \`archive/versions/\`: existing historical snapshots, retained unchanged.\n- \`inventory.json\`: local file sizes and symlink inventory; symlinks are recorded without following their targets.\n\nThe existing \`archive/moves-2026-11-13.json\` records the earlier reorganization. Validation scripts, screenshots, logs, source archives, metadata and prior installation guides are retained with their original groups. Identical version labels can represent different source commits or uncommitted builds; no artifacts are deleted or deduplicated by name. The existing \`v0.6.3.1\` and \`v0.6.4\` directories remain in place. A version directory can contain partial or older local builds and is not a claim that it matches the current working tree.\n\nRun \`node scripts/organize-release.mjs\` from the repository for a dry run; use \`--apply\` to move the listed paths. Each applied run writes an \`archive/organization-*.json\` journal with source/destination SHA-256 tree checks. To undo one, first preview \`node scripts/organize-release.mjs --rollback=archive/<journal>.json\`, then add \`--apply\`. Conflicting paths, changed moved artifacts and symlink ancestors are rejected. Generated index/inventory files are restored on rollback; artifact contents are never deleted.\n\nUnknown root entries left untouched: ${plan.unknownRoots.length ? plan.unknownRoots.map((name) => `\`${name.replaceAll("`", "\\`")}\``).join(", ") : "none"}.\n`;
}
async function readGenerated(ctx, name) {
  const filename = path.join(ctx.release, name);
  await safePath(ctx, filename);
  if (!(await exists(filename))) return null;
  const source = await readFile(filename, "utf8");
  if (
    name === "README.md"
      ? !source.startsWith(INDEX_MARKER)
      : JSON.parse(source).format !== INVENTORY_FORMAT
  )
    throw new Error(
      `Refusing to replace an unrecognized generated file: ${filename}`,
    );
  return source;
}
async function journalPath(ctx) {
  for (let count = 1; count < 10000; count++) {
    const filename = path.join(
      ctx.release,
      "archive",
      `organization-${ctx.date}${count === 1 ? "" : `-${count}`}.json`,
    );
    await safePath(ctx, filename);
    if (!(await exists(filename))) return filename;
  }
  throw new Error("Too many organization journals for this date.");
}
async function storeJournal(ctx, filename, journal) {
  await atomicWrite(
    ctx,
    filename,
    `${JSON.stringify(journal, null, 2)}\n`,
    journal.createdDirectories,
  );
}
/** Simulate reverse moves first: a parent digest includes children moved later. */
async function preflightRestore(ctx, journal) {
  for (const [name, output] of Object.entries(journal.outputs)) {
    const target = path.join(ctx.release, name);
    await safePath(ctx, target);
    const current = (await exists(target))
      ? await readFile(target, "utf8")
      : null;
    if (
      current !== output.before &&
      (current === null || digest(current) !== output.afterHash)
    )
      throw new Error(`Generated output changed since organization: ${target}`);
  }
  const virtual = new Map();
  for (const move of journal.moves) {
    if (!move.fingerprint) continue;
    for (const name of [move.from, move.to]) {
      const filename = path.join(ctx.release, name);
      await safePath(ctx, filename);
      if (!(await exists(filename))) continue;
      await walk(filename, async (entry, absolute) => {
        if (!virtual.has(absolute))
          virtual.set(absolute, await hashedEntry(entry, absolute));
      });
    }
  }
  const subtree = (filename) =>
    [...virtual.entries()].filter(
      ([absolute]) =>
        absolute === filename || absolute.startsWith(`${filename}${path.sep}`),
    );
  const matches = (filename, expected) =>
    fingerprintEntries(
      subtree(filename).map(([absolute, entry]) => ({
        ...entry,
        name: relative(filename, absolute) || ".",
      })),
    ).sha256 === expected.sha256;
  const alreadyRestored = new Set();
  const virtualMove = (from, to) => {
    for (const [absolute, entry] of subtree(from)) {
      virtual.delete(absolute);
      virtual.set(path.join(to, path.relative(from, absolute)), entry);
    }
  };
  // Normalize any already-restored paths back to the fully moved state in
  // memory. This also handles a child carried back inside a restored parent
  // when a process stopped between its rename and journal update.
  for (const move of journal.moves) {
    if (!move.fingerprint) continue;
    const from = path.join(ctx.release, move.from),
      to = path.join(ctx.release, move.to);
    const original = virtual.has(from),
      moved = virtual.has(to);
    if (original && !moved) {
      if (!matches(from, move.fingerprint))
        throw new Error(
          `Restored artifact changed since organization: ${move.from}`,
        );
      alreadyRestored.add(move);
      virtualMove(from, to);
    } else if (original || !moved)
      throw new Error(`Rollback source/destination conflict: ${move.from}`);
  }
  for (const move of [...journal.moves].reverse()) {
    if (!move.fingerprint) continue;
    const from = path.join(ctx.release, move.from),
      to = path.join(ctx.release, move.to);
    const original = virtual.has(from),
      moved = virtual.has(to);
    if (original || !moved)
      throw new Error(`Rollback source/destination conflict: ${move.from}`);
    if (!matches(to, move.fingerprint))
      throw new Error(`Moved artifact changed since organization: ${move.to}`);
    virtualMove(to, from);
  }
  return alreadyRestored;
}
async function restore(ctx, filename, journal) {
  const alreadyRestored = await preflightRestore(ctx, journal);
  journal.status = "rolling-back";
  await storeJournal(ctx, filename, journal);
  for (const [name, output] of Object.entries(journal.outputs).reverse()) {
    const target = path.join(ctx.release, name);
    await safePath(ctx, target);
    const current = (await exists(target))
      ? await readFile(target, "utf8")
      : null;
    if (current === output.before) continue;
    if (current === null || digest(current) !== output.afterHash)
      throw new Error(`Generated output changed since organization: ${target}`);
    if (output.before === null)
      await unlink(target); // Only this run's generated metadata, never an artifact.
    else await atomicWrite(ctx, target, output.before);
  }
  for (const move of [...journal.moves].reverse()) {
    if (!move.fingerprint) continue;
    if (alreadyRestored.has(move)) {
      move.status = "rolled-back";
      await storeJournal(ctx, filename, journal);
      continue;
    }
    const from = path.join(ctx.release, move.from),
      to = path.join(ctx.release, move.to);
    await safePath(ctx, from);
    await safePath(ctx, to);
    const original = await exists(from),
      moved = await exists(to);
    if (original || !moved)
      throw new Error(`Rollback source/destination conflict: ${move.from}`);
    if ((await fingerprint(to)).sha256 !== move.fingerprint.sha256)
      throw new Error(`Moved artifact changed since organization: ${move.to}`);
    await parents(ctx, from, journal.createdDirectories);
    await rename(to, from);
    if ((await fingerprint(from)).sha256 !== move.fingerprint.sha256)
      throw new Error(`Rollback verification failed: ${move.from}`);
    move.status = "rolled-back";
    await storeJournal(ctx, filename, journal);
  }
  for (const directory of [...new Set(journal.createdDirectories)].reverse()) {
    if (directory === ctx.release || directory === path.dirname(filename))
      continue;
    await rmdir(directory).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    });
  }
  journal.status = "rolled-back";
  journal.rolledBackAt = new Date().toISOString();
  await storeJournal(ctx, filename, journal);
}

export async function organizeRelease(options = {}, dependencies = {}) {
  const ctx = await context(options);
  const plan = await planReleaseOrganization(options);
  if (!options.apply) return { ...plan, applied: false };
  const before = {
    "README.md": await readGenerated(ctx, "README.md"),
    "inventory.json": await readGenerated(ctx, "inventory.json"),
  };
  if (
    !plan.moves.length &&
    Object.values(before).every((value) => value !== null) &&
    JSON.stringify(JSON.parse(before["inventory.json"]).entries) ===
      JSON.stringify((await inventory(ctx)).entries)
  )
    return { ...plan, applied: true, unchanged: true };
  const created = [];
  const unlock = await acquireLock(ctx, created);
  try {
    const filename = await journalPath(ctx);
    const journal = {
      format: JOURNAL_FORMAT,
      version: 1,
      root: ctx.root,
      release: ctx.release,
      date: ctx.date,
      createdAt: new Date().toISOString(),
      status: "applying",
      moves: plan.moves.map((move) => ({ ...move, status: "planned" })),
      outputs: {},
      createdDirectories: created,
      unknownRoots: plan.unknownRoots,
    };
    await storeJournal(ctx, filename, journal);
    try {
      for (const move of journal.moves) {
        const from = path.join(ctx.release, move.from),
          to = path.join(ctx.release, move.to);
        await safePath(ctx, from);
        await safePath(ctx, to);
        if (await exists(to))
          throw new Error(`Organization destination already exists: ${to}`);
        move.fingerprint = await fingerprint(from);
        move.status = "moving";
        await parents(ctx, to, journal.createdDirectories);
        await storeJournal(ctx, filename, journal);
        await (dependencies.rename ?? rename)(from, to);
        move.status = "moved";
        await storeJournal(ctx, filename, journal);
        if ((await fingerprint(to)).sha256 !== move.fingerprint.sha256)
          throw new Error(`Move verification failed: ${move.to}`);
        move.status = "verified";
        await storeJournal(ctx, filename, journal);
      }
      const outputs = { "README.md": indexText(ctx, plan) };
      for (const name of ["README.md", "inventory.json"]) {
        if (name === "inventory.json")
          outputs[name] = `${JSON.stringify(await inventory(ctx), null, 2)}\n`;
        journal.outputs[name] = {
          before: before[name],
          afterHash: digest(outputs[name]),
        };
        await storeJournal(ctx, filename, journal);
        await atomicWrite(
          ctx,
          path.join(ctx.release, name),
          outputs[name],
          journal.createdDirectories,
        );
      }
      journal.status = "completed";
      journal.completedAt = new Date().toISOString();
      await storeJournal(ctx, filename, journal);
      return {
        ...plan,
        applied: true,
        journal: filename,
        totals: (await inventory(ctx)).totals,
      };
    } catch (error) {
      journal.failure = error.message;
      try {
        await restore(ctx, filename, journal);
      } catch (rollbackError) {
        journal.status = "rollback-failed";
        journal.rollbackFailure = rollbackError.message;
        await storeJournal(ctx, filename, journal).catch(() => undefined);
        throw new AggregateError(
          [error, rollbackError],
          `Organization failed; rollback needs attention. Journal: ${filename}`,
        );
      }
      throw new Error(
        `Organization failed and was rolled back: ${error.message}. Journal: ${filename}`,
        { cause: error },
      );
    }
  } finally {
    await unlock();
  }
}

export async function rollbackReleaseOrganization(options = {}) {
  const ctx = await context(options);
  if (typeof options.journal !== "string" || !options.journal)
    throw new Error("Choose an organization journal to roll back.");
  const filename = path.resolve(ctx.release, options.journal);
  await safePath(ctx, filename);
  const journal = JSON.parse(await readFile(filename, "utf8"));
  if (
    journal.format !== JOURNAL_FORMAT ||
    journal.version !== 1 ||
    journal.root !== ctx.root ||
    journal.release !== ctx.release ||
    !Array.isArray(journal.moves) ||
    !Array.isArray(journal.createdDirectories) ||
    !journal.outputs ||
    typeof journal.outputs !== "object"
  )
    throw new Error(
      "The organization journal does not belong to this repository.",
    );
  if (
    !journal.createdDirectories.every(
      (directory) =>
        typeof directory === "string" &&
        (directory === ctx.release ||
          path.relative(ctx.release, directory) !== ""),
    )
  )
    throw new Error("Invalid journal directories.");
  for (const directory of journal.createdDirectories)
    if (directory !== ctx.release) await safePath(ctx, directory);
  for (const name of Object.keys(journal.outputs))
    if (!["README.md", "inventory.json"].includes(name))
      throw new Error("Invalid generated output in journal.");
  for (const move of journal.moves) {
    if (typeof move.from !== "string" || typeof move.to !== "string")
      throw new Error("Invalid move in journal.");
    await safePath(ctx, path.resolve(ctx.release, move.from));
    await safePath(ctx, path.resolve(ctx.release, move.to));
  }
  if (!options.apply || journal.status === "rolled-back")
    return {
      applied: !!options.apply,
      unchanged: journal.status === "rolled-back",
      journal: filename,
      moves: [...journal.moves]
        .reverse()
        .map(({ from, to }) => ({ from: to, to: from })),
    };
  const unlock = await acquireLock(ctx);
  try {
    await restore(ctx, filename, journal);
    return { applied: true, journal: filename, status: journal.status };
  } finally {
    await unlock();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index++) {
      const arg = process.argv[index];
      if (arg === "--apply") {
        options.apply = true;
        continue;
      }
      if (["--help", "-h"].includes(arg)) {
        options.help = true;
        continue;
      }
      const [flag, inline] = arg.split(/=(.*)/s, 2);
      if (!["--root", "--date", "--rollback"].includes(flag))
        throw new Error(`Unknown option: ${arg}`);
      const value = inline ?? process.argv[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`A value is required for ${flag}.`);
      options[flag === "--rollback" ? "journal" : flag.slice(2)] = value;
    }
    if (options.help)
      console.log(
        "Usage: node scripts/organize-release.mjs [--root=repository] [--date=YYYY-MM-DD] [--apply]\n       node scripts/organize-release.mjs --rollback=archive/organization-YYYY-MM-DD.json [--apply]\nDry-run by default. Moves only; preserves artifact contents and validates paths and SHA-256 tree fingerprints.",
      );
    else
      console.log(
        JSON.stringify(
          await (options.journal
            ? rollbackReleaseOrganization(options)
            : organizeRelease(options)),
          null,
          2,
        ),
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
