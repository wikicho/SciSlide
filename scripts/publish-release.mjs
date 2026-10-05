import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFile,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const trustedRepository = "wikicho/SciSlide";
const require = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function digest(filename) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

async function checkHeader(filename, kind) {
  const file = await open(filename, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (kind === "pkg")
      require(header.subarray(0, 4).toString() ===
        "xar!", `Invalid macOS installer: ${filename}`);
    else if (kind === "deb")
      require(header.subarray(0, 8).toString() ===
        "!<arch>\n", `Invalid Debian archive: ${filename}`);
    else if (kind === "zip")
      require(header.subarray(0, 4).toString("hex") ===
        "504b0304", `Invalid portable ZIP: ${filename}`);
    else {
      require(bytesRead === 64 &&
        header.toString("ascii", 0, 2) ===
          "MZ", `Invalid Windows executable: ${filename}`);
      const offset = header.readUInt32LE(60);
      require(offset >= 64 &&
        offset <=
          (await file.stat()).size -
            26, `Invalid Windows PE offset: ${filename}`);
      const pe = Buffer.alloc(26);
      const result = await file.read(pe, 0, pe.length, offset);
      require(result.bytesRead === pe.length &&
        pe.readUInt32LE(0) === 0x00004550 &&
        pe.readUInt16LE(4) === 0x8664 &&
        pe.readUInt16LE(20) >= 2 &&
        pe.readUInt16LE(24) ===
          0x020b, `Windows installer must be AMD64/x64 PE32+: ${filename}`);
    }
  } finally {
    await file.close();
  }
}

/** Verify the complete flat artifact set, independently of uploaded checksums. */
export async function verifyReleaseFiles({
  root = projectRoot,
  directory,
  version,
}) {
  require(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(
    version,
  ), "Invalid release version");
  const binaries = new Map([
    [`SciSlide-${version}-macos-arm64-unsigned.pkg`, "pkg"],
    [`SciSlide-${version}-macos-x64-unsigned.pkg`, "pkg"],
    [`SciSlide-${version}-windows-x64-setup-unsigned.exe`, "exe"],
    [`SciSlide-${version}-windows-x64-portable.zip`, "zip"],
    [`SciSlide-${version}-linux-x64.deb`, "deb"],
  ]);
  const guides = new Map([
    ["MACOS-INSTALL.md", "MACOS.md"],
    ["WINDOWS-INSTALL.md", "WINDOWS.md"],
    ["LINUX-INSTALL.md", "LINUX.md"],
  ]);
  const names = [...binaries.keys()]
    .flatMap((name) => [name, `${name}.sha256`])
    .concat([...guides.keys()]);
  require(JSON.stringify((await readdir(directory)).sort()) ===
    JSON.stringify(
      names.sort(),
    ), "Release must contain exactly the 13 expected files");
  const files = new Map();
  for (const name of names) {
    const filename = path.join(directory, name);
    const stat = await lstat(filename);
    require(stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0, `Release asset must be a nonempty regular file: ${name}`);
    files.set(name, { size: stat.size, digest: await digest(filename) });
  }
  for (const [name, kind] of binaries) {
    await checkHeader(path.join(directory, name), kind);
    require((await readFile(path.join(directory, `${name}.sha256`), "utf8")) ===
      `${files.get(name).digest.slice(7)}  ${name}\n`, `Checksum mismatch: ${name}`);
  }
  for (const [name, source] of guides) {
    require(files.get(name).digest ===
      (await digest(
        path.join(root, "desktop", source),
      )), `Installation guide differs from source: ${name}`);
  }
  return files;
}

function githubApi(repo, token) {
  return async (resource, { method = "GET", body, missing = false } = {}) => {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/${resource}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (missing && response.status === 404) return null;
    require(response.ok, `GitHub API request failed (${response.status}) for ${resource}`);
    return response.json();
  };
}

/** Publish only verified artifacts from the current trusted release workflow. */
export async function publishRelease(options, dependencies = {}) {
  const { repo, sha, runId, directory, root = projectRoot, token } = options;
  require(repo === trustedRepository &&
    /^[0-9a-f]{40}$/.test(sha) &&
    /^[1-9][0-9]*$/.test(
      String(runId),
    ), "Unexpected repository, source commit or run ID");
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const version = pkg.version;
  const tag = `v${version}`;
  const files = await verifyReleaseFiles({ root, directory, version });
  const api = dependencies.api ?? githubApi(repo, token);
  const gh =
    dependencies.gh ??
    ((args) => execFileSync("gh", args, { stdio: "inherit" }));
  const run = await api(`actions/runs/${runId}`);
  require(String(run.id) === String(runId) &&
    run.head_sha === sha &&
    run.repository.full_name === repo &&
    run.head_repository.full_name === repo &&
    run.head_branch === "main" &&
    run.event === "workflow_dispatch" &&
    run.name === "SciSlide development release" &&
    run.path ===
      ".github/workflows/release.yml", "Artifacts must come from the trusted release workflow at the requested source commit");
  async function tagCommit() {
    const ref = await api(`git/ref/tags/${encodeURIComponent(tag)}`, {
      missing: true,
    });
    if (!ref) return null;
    let object = ref.object;
    for (let count = 0; object.type === "tag" && count < 5; count++)
      object = (await api(`git/tags/${object.sha}`)).object;
    require(object.type ===
      "commit", "Release tag does not resolve to a commit");
    return object.sha;
  }
  const previousTag = await tagCommit();
  require(!previousTag ||
    previousTag === sha, "Existing tag points to a different source commit");
  let release;
  // List releases to include drafts, which cannot always be retrieved by tag.
  for (let page = 1; !release; page++) {
    const entries = await api(`releases?per_page=100&page=${page}`);
    release = entries.find((entry) => entry.tag_name === tag);
    if (entries.length < 100) break;
  }
  const notes = await readFile(
    path.join(root, "docs", "releases", `${tag}.md`),
    "utf8",
  );
  const body = `${notes.trim()}\n\nBuilt from \`${sha}\`. [Verified build](https://github.com/${repo}/actions/runs/${runId}). All five downloads include matching SHA-256 files; installation guides are attached.\n`;
  if (!release) {
    release = await api("releases", {
      method: "POST",
      body: {
        tag_name: tag,
        target_commitish: sha,
        name: `SciSlide ${version} — development release`,
        body,
        draft: true,
        prerelease: true,
        make_latest: "false",
      },
    });
    require(release?.draft === true, "New release must be a draft");
  }
  require(release?.tag_name === tag &&
    release.target_commitish === sha &&
    release.prerelease ===
      true, "Existing release does not match this development source");
  async function checkedAssets(complete = false) {
    const assets = await api(`releases/${release.id}/assets?per_page=100`);
    require(assets.length <= files.size &&
      assets.every((asset) =>
        files.has(asset.name),
      ), "Release contains unexpected assets");
    const missing = [];
    for (const [name, expected] of files) {
      const matches = assets.filter((asset) => asset.name === name);
      require(matches.length <= 1, `Duplicate release asset: ${name}`);
      if (!matches.length) {
        missing.push(name);
        continue;
      }
      require(matches[0].state === "uploaded" &&
        matches[0].size === expected.size &&
        matches[0].digest ===
          expected.digest, `Existing release asset differs: ${name}`);
    }
    require(!complete || missing.length === 0, "Release upload is incomplete");
    return missing;
  }
  const missing = await checkedAssets();
  require(release.draft ||
    missing.length === 0, "Published release is missing expected assets");
  for (const name of missing)
    gh(["release", "upload", tag, path.join(directory, name), "--repo", repo]);
  await checkedAssets(true);
  const publicationTag = await tagCommit();
  require(!publicationTag ||
    publicationTag === sha, "Release tag changed during upload");
  if (release.draft) {
    const notesDirectory = await mkdtemp(
      path.join(os.tmpdir(), "scislide-release-notes-"),
    );
    try {
      const notesFile = path.join(notesDirectory, "notes.md");
      await writeFile(notesFile, body);
      gh([
        "release",
        "edit",
        tag,
        "--repo",
        repo,
        "--notes-file",
        notesFile,
        "--draft=false",
        "--prerelease",
        "--latest=false",
      ]);
    } finally {
      await rm(notesDirectory, { recursive: true, force: true });
    }
  }
  require((await tagCommit()) ===
    sha, "Published tag does not match the verified source");
  const published = await api(`releases/${release.id}`);
  require(published.tag_name === tag &&
    published.target_commitish === sha &&
    published.draft === false &&
    published.prerelease ===
      true, "Release did not finish publication as the expected development prerelease");
  return {
    tag,
    sha,
    assetCount: files.size,
    url: `https://github.com/${repo}/releases/tag/${tag}`,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    require(process.env.GH_TOKEN, "GH_TOKEN is required");
    const result = await publishRelease({
      repo: process.env.GITHUB_REPOSITORY,
      sha: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      token: process.env.GH_TOKEN,
      directory: path.resolve(process.argv[2] ?? "publish"),
    });
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `Published [${result.tag}](${result.url}) with ${result.assetCount} assets from \`${result.sha}\`.\n`,
      );
    console.log(`Published ${result.url}`);
  } catch (error) {
    console.error(`Release publication failed: ${error.message}`);
    process.exitCode = 1;
  }
}
