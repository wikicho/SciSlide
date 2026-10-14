import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const UPDATE_REPOSITORY = "wikicho/SciSlide";
export const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_RELEASE_PAGES = 10;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 16 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const DOWNLOAD_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** SemVer with an optional numeric revision; keep numbers as strings for precision. */
export function parseVersion(input) {
  if (typeof input !== "string" || input.length > 256 || /[\r\n]/.test(input))
    return null;
  const match = input.match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (!match) return null;
  const prerelease = match[5]?.split(".") ?? [];
  if (prerelease.some((value) => /^\d+$/.test(value) && /^0\d/.test(value)))
    return null;
  const core = match.slice(1, match[4] === undefined ? 4 : 5).join(".");
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    revision: match[4] ?? "0",
    prerelease,
    build: match[6] ?? "",
    core,
    version: input.replace(/^v/, ""),
  };
}

function decimalCompare(a, b) {
  return a.length !== b.length
    ? Math.sign(a.length - b.length)
    : a === b
      ? 0
      : a > b
        ? 1
        : -1;
}

export function compareVersions(a, b) {
  const left = parseVersion(a),
    right = parseVersion(b);
  requireValue(
    left && right,
    "SciSlide versions must use valid SemVer with an optional numeric revision.",
  );
  for (const key of ["major", "minor", "patch", "revision"]) {
    const difference = decimalCompare(left[key], right[key]);
    if (difference) return difference;
  }
  if (!left.prerelease.length || !right.prerelease.length)
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length
        ? -1
        : 1;
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index++
  ) {
    const l = left.prerelease[index],
      r = right.prerelease[index];
    if (l === undefined || r === undefined)
      return l === r ? 0 : l === undefined ? -1 : 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l),
      rn = /^\d+$/.test(r);
    if (ln && rn) return decimalCompare(l, r);
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

function checkTarget(platform, arch) {
  requireValue(
    (platform === "darwin" && ["arm64", "x64"].includes(arch)) ||
      (["linux", "win32"].includes(platform) && arch === "x64"),
    `No SciSlide installer is available for ${String(platform)}/${String(arch)}. Supported targets: macOS arm64/x64, Windows x64, Linux x64.`,
  );
}

function installerNames(version, platform, arch) {
  checkTarget(platform, arch);
  const stem = `SciSlide-${version}-`;
  if (platform === "darwin")
    return [
      `${stem}macos-${arch}-signed.pkg`,
      `${stem}macos-${arch}.pkg`,
      `${stem}macos-${arch}-unsigned.pkg`,
    ];
  if (platform === "win32")
    return [
      `${stem}windows-x64-setup-signed.exe`,
      `${stem}windows-x64-setup.exe`,
      `${stem}windows-x64-setup-unsigned.exe`,
    ];
  return [`${stem}linux-x64.deb`];
}

function safeBasename(name) {
  requireValue(
    typeof name === "string" &&
      name.length <= 320 &&
      /^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(name) &&
      !name.includes(".."),
    "The release contains an unsafe installer filename.",
  );
  return name;
}

function secureUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("The release contains an invalid download URL.");
  }
  requireValue(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash,
    "SciSlide downloads require an HTTPS URL without credentials, fragments or custom ports.",
  );
  return url;
}

function assetUrl(input, tag, name) {
  const url = secureUrl(input);
  requireValue(
    url.hostname === "github.com" &&
      !url.search &&
      url.pathname ===
        `/wikicho/SciSlide/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
    "The installer download URL is outside the official wikicho/SciSlide release.",
  );
  return url.href;
}

function metadataAsset(asset, tag, maximum) {
  const name = safeBasename(asset.name);
  requireValue(
    Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maximum,
    `Release asset ${name} has an invalid or excessive declared size.`,
  );
  return {
    name,
    size: asset.size,
    url: assetUrl(asset.browser_download_url ?? asset.url, tag, name),
    ...(asset.digest !== undefined ? { digest: asset.digest } : {}),
  };
}

function sha256Digest(digest) {
  if (digest === undefined || digest === null) return null;
  requireValue(typeof digest === "string", "Invalid GitHub asset digest.");
  if (!/^sha256:/i.test(digest)) return null;
  requireValue(
    /^sha256:[\da-f]{64}$/i.test(digest),
    "Invalid GitHub SHA-256 asset digest.",
  );
  return digest.slice(7).toLowerCase();
}

function releaseVersions(tag) {
  const parsed = parseVersion(tag);
  if (!parsed) return [];
  // Linux's publisher suffix names a build of the same package version, not
  // a new installed application version. Do not repeatedly offer 0.6.2 as an update.
  const publisher = parsed.version.match(/^(.*)-linux-dev\.[1-9]\d*$/);
  return publisher && parseVersion(publisher[1])
    ? [publisher[1]]
    : [parsed.version];
}

/** Select the highest version tag that actually ships this target's installer. */
export function selectUpdateRelease(
  releases,
  {
    currentVersion,
    platform = process.platform,
    arch = process.arch,
    includePrereleases = true,
  } = {},
) {
  requireValue(
    parseVersion(currentVersion),
    "The installed SciSlide version is not valid SemVer with an optional numeric revision.",
  );
  checkTarget(platform, arch);
  requireValue(
    Array.isArray(releases),
    "GitHub returned an invalid release list.",
  );
  const eligible = releases
    .filter(
      (release) =>
        release &&
        release.draft === false &&
        parseVersion(release.tag_name) &&
        (includePrereleases ||
          (release.prerelease === false &&
            !parseVersion(release.tag_name).prerelease.length)),
    )
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  for (const release of eligible) {
    requireValue(
      Array.isArray(release.assets),
      "GitHub returned invalid release assets.",
    );
    for (const version of releaseVersions(release.tag_name)) {
      const names = installerNames(version, platform, arch);
      const name = names.find((candidate) =>
        release.assets.some((asset) => asset?.name === candidate),
      );
      if (!name) continue;
      const matches = release.assets.filter((asset) => asset?.name === name);
      requireValue(
        matches.length === 1,
        `The release has duplicate installer assets named ${name}.`,
      );
      const asset = metadataAsset(
        matches[0],
        release.tag_name,
        MAX_INSTALLER_BYTES,
      );
      const checksums = release.assets.filter(
        (candidate) => candidate?.name === `${name}.sha256`,
      );
      requireValue(
        checksums.length <= 1,
        `The release has duplicate checksum assets for ${name}.`,
      );
      const checksum = checksums.length
        ? metadataAsset(checksums[0], release.tag_name, MAX_CHECKSUM_BYTES)
        : null;
      requireValue(
        checksum || sha256Digest(asset.digest),
        `Release installer ${name} has no SHA-256 checksum.`,
      );
      // Validate a supplied digest even if a sidecar is also present.
      sha256Digest(asset.digest);
      return {
        status:
          compareVersions(version, currentVersion) > 0
            ? "available"
            : "current",
        currentVersion,
        latestVersion: version,
        platform,
        arch,
        release: {
          tagName: release.tag_name,
          url: `https://github.com/${UPDATE_REPOSITORY}/releases/tag/${encodeURIComponent(release.tag_name)}`,
          prerelease: release.prerelease === true,
        },
        asset,
        checksum,
      };
    }
  }
  throw new Error(
    `No compatible ${platform}/${arch} installer was found in ${includePrereleases ? "published" : "stable"} SciSlide releases.`,
  );
}

function cancelBody(response) {
  try {
    void response?.body?.cancel().catch(() => {});
  } catch {
    // A locked or already-closed stream does not need a second cancellation.
  }
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}

async function request(
  url,
  { fetch, metadata = false, timeout = REQUEST_TIMEOUT_MS },
  consume,
) {
  requireValue(
    typeof fetch === "function",
    "This runtime does not provide HTTPS fetch.",
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("The SciSlide update request timed out.")),
    timeout,
  );
  let response;
  try {
    let current = secureUrl(url);
    for (let redirects = 0; ; redirects++) {
      if (metadata)
        requireValue(
          current.hostname === "api.github.com" &&
            !current.search.includes("%"),
          "Invalid GitHub release API URL.",
        );
      else
        requireValue(
          DOWNLOAD_HOSTS.has(current.hostname),
          "The update redirects outside the allowed GitHub download hosts.",
        );
      response = await abortable(
        fetch(current.href, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "SciSlide-update-checker",
            Accept: metadata
              ? "application/vnd.github+json"
              : "application/octet-stream",
            ...(metadata ? { "X-GitHub-Api-Version": "2022-11-28" } : {}),
          },
        }),
        controller.signal,
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        cancelBody(response);
        requireValue(
          !metadata && redirects < MAX_REDIRECTS,
          "The update download exceeded the allowed redirect limit.",
        );
        const location = response.headers.get("location");
        requireValue(location, "GitHub sent a redirect without a destination.");
        current = secureUrl(new URL(location, current).href);
        continue;
      }
      requireValue(
        response.ok && response.status === 200,
        response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0"
          ? "GitHub's API rate limit was reached. Try the update check again later."
          : `GitHub update request failed (HTTP ${response.status}).`,
      );
      // Reject a fetch implementation that ignored redirect:"manual".
      if (response.url)
        requireValue(
          response.url === current.href && !response.redirected,
          "The update request followed an unchecked redirect.",
        );
      return await consume(response, controller.signal);
    }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    cancelBody(response);
  }
}

async function consumeBytes(response, signal, { maximum, expected, onChunk }) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    requireValue(
      /^\d+$/.test(declared),
      "GitHub sent an invalid download length.",
    );
    const length = Number(declared);
    requireValue(
      Number.isSafeInteger(length) && length <= maximum,
      "The update response exceeds its size limit.",
    );
    if (expected !== undefined)
      requireValue(
        length === expected,
        "The installer response size differs from the GitHub release metadata.",
      );
  }
  if (expected !== undefined)
    requireValue(
      !response.headers.get("content-encoding") ||
        response.headers.get("content-encoding") === "identity",
      "Unexpected compression on a release asset download.",
    );
  requireValue(
    response.body?.getReader,
    "GitHub returned an empty download stream.",
  );
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      requireValue(
        chunk.value instanceof Uint8Array,
        "GitHub returned invalid download bytes.",
      );
      received += chunk.value.byteLength;
      requireValue(
        received <= maximum && (expected === undefined || received <= expected),
        "The update download exceeds its declared size limit.",
      );
      await onChunk(chunk.value, received);
    }
    if (expected !== undefined)
      requireValue(
        received === expected,
        "The update download is incomplete: its size differs from the release metadata.",
      );
    return received;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readSmallResponse(response, signal, maximum, expected) {
  const chunks = [];
  const received = await consumeBytes(response, signal, {
    maximum,
    expected,
    onChunk: (chunk) => chunks.push(Buffer.from(chunk)),
  });
  return { text: Buffer.concat(chunks).toString("utf8"), received };
}

export async function checkForUpdate({
  currentVersion,
  platform = process.platform,
  arch = process.arch,
  fetch = globalThis.fetch,
  includePrereleases = true,
} = {}) {
  requireValue(
    parseVersion(currentVersion),
    "The installed SciSlide version is not valid SemVer with an optional numeric revision.",
  );
  checkTarget(platform, arch);
  const releases = [];
  let total = 0;
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const result = await request(
      `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100&page=${page}`,
      { fetch, metadata: true },
      async (response, signal) => {
        const body = await readSmallResponse(
          response,
          signal,
          Math.min(MAX_METADATA_BYTES, MAX_METADATA_TOTAL_BYTES - total),
        );
        let entries;
        try {
          entries = JSON.parse(body.text);
        } catch {
          throw new Error("GitHub returned invalid release JSON.");
        }
        requireValue(
          Array.isArray(entries) && entries.length <= 100,
          "GitHub returned an invalid release page.",
        );
        total += body.received;
        return {
          entries,
          more:
            entries.length === 100 ||
            /rel="next"/.test(response.headers.get("link") ?? ""),
        };
      },
    );
    releases.push(...result.entries);
    if (!result.more)
      return selectUpdateRelease(releases, {
        currentVersion,
        platform,
        arch,
        includePrereleases,
      });
  }
  throw new Error(
    "GitHub's release history exceeds the update check limit (1,000 releases). Visit the SciSlide release page.",
  );
}

function checkDownloadInfo(info) {
  requireValue(
    info?.status === "available" &&
      compareVersions(info.latestVersion, info.currentVersion) > 0,
    "There is no newer SciSlide version to download.",
  );
  checkTarget(info.platform, info.arch);
  requireValue(
    releaseVersions(info.release?.tagName).includes(info.latestVersion),
    "The release tag does not match the installer version.",
  );
  requireValue(
    installerNames(info.latestVersion, info.platform, info.arch).includes(
      info.asset?.name,
    ),
    "The installer does not match this SciSlide version and platform.",
  );
  const asset = metadataAsset(
    info.asset,
    info.release.tagName,
    MAX_INSTALLER_BYTES,
  );
  let checksum = null;
  if (info.checksum) {
    requireValue(
      info.checksum.name === `${asset.name}.sha256`,
      "The checksum asset does not match the installer filename.",
    );
    checksum = metadataAsset(
      info.checksum,
      info.release.tagName,
      MAX_CHECKSUM_BYTES,
    );
  }
  const digest = sha256Digest(asset.digest);
  requireValue(checksum || digest, "This installer has no SHA-256 checksum.");
  return { asset, checksum, digest };
}

async function expectedChecksum({ asset, checksum, digest }, fetch) {
  if (!checksum) return digest;
  const text = await request(
    checksum.url,
    { fetch },
    async (response, signal) =>
      (
        await readSmallResponse(
          response,
          signal,
          MAX_CHECKSUM_BYTES,
          checksum.size,
        )
      ).text,
  );
  const match = text.match(/^([\da-f]{64}) [ *]([^\r\n]+)(?:\r?\n)?$/i);
  requireValue(
    match && match[2] === asset.name,
    "The SHA-256 file must contain exactly one checksum for this installer filename.",
  );
  const hash = match[1].toLowerCase();
  requireValue(
    !digest || digest === hash,
    "The checksum file disagrees with the GitHub SHA-256 asset digest.",
  );
  return hash;
}

async function matchingFile(filename, expected, size) {
  let initial;
  try {
    initial = await lstat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  requireValue(
    initial.isFile() && !initial.isSymbolicLink(),
    "The destination already contains a symlink or non-file installer path.",
  );
  requireValue(
    initial.size === size,
    "The destination already contains a different installer. Choose another output directory.",
  );
  const file = await open(
    filename,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await file.stat();
    const named = await lstat(filename);
    requireValue(
      named.isFile() &&
        !named.isSymbolicLink() &&
        before.ino === named.ino &&
        before.dev === named.dev,
      "The existing installer changed while being verified.",
    );
    const hash = createHash("sha256");
    let read = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      read += chunk.length;
      requireValue(
        read <= size,
        "The existing installer changed while being verified.",
      );
      hash.update(chunk);
    }
    const after = await file.stat();
    requireValue(
      read === size &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        hash.digest("hex") === expected,
      "The destination already contains an installer with a different SHA-256 hash. Choose another output directory.",
    );
    return true;
  } finally {
    await file.close();
  }
}

/** Download and verify an installer; never install or execute it. */
export async function downloadUpdate(
  info,
  {
    destination = path.join(os.homedir(), "Downloads", "SciSlide-updates"),
    fetch = globalThis.fetch,
    onProgress,
  } = {},
) {
  const metadata = checkDownloadInfo(info);
  requireValue(
    typeof destination === "string" &&
      destination.trim() &&
      !destination.includes("\0"),
    "Choose a valid update output directory.",
  );
  const expected = await expectedChecksum(metadata, fetch);
  await mkdir(path.resolve(destination), { recursive: true, mode: 0o700 });
  const directory = await realpath(path.resolve(destination));
  const filename = path.join(directory, metadata.asset.name);
  const result = (reused) => ({
    path: filename,
    sha256: expected,
    reused,
    version: info.latestVersion,
    platform: info.platform,
    arch: info.arch,
  });
  if (await matchingFile(filename, expected, metadata.asset.size))
    return result(true);
  const temporary = await mkdtemp(path.join(directory, ".scislide-update-"));
  try {
    await chmod(temporary, 0o700);
    const staged = path.join(temporary, metadata.asset.name);
    const file = await open(staged, "wx", 0o600);
    const hash = createHash("sha256");
    try {
      await request(
        metadata.asset.url,
        { fetch, timeout: DOWNLOAD_TIMEOUT_MS },
        async (response, signal) => {
          onProgress?.({ received: 0, total: metadata.asset.size });
          await consumeBytes(response, signal, {
            maximum: MAX_INSTALLER_BYTES,
            expected: metadata.asset.size,
            onChunk: async (chunk, received) => {
              hash.update(chunk);
              let written = 0;
              while (written < chunk.byteLength) {
                const result = await file.write(
                  chunk,
                  written,
                  chunk.byteLength - written,
                );
                requireValue(
                  result.bytesWritten > 0,
                  "The installer could not be written to the output directory.",
                );
                written += result.bytesWritten;
              }
              onProgress?.({ received, total: metadata.asset.size });
            },
          });
        },
      );
      requireValue(
        hash.digest("hex") === expected,
        "The downloaded installer failed SHA-256 verification.",
      );
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      // Same-filesystem hard linking publishes verified bytes atomically and
      // exclusively. Unlike rename, it cannot overwrite a concurrent file.
      await link(staged, filename);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await matchingFile(filename, expected, metadata.asset.size))
        return result(true);
      throw error;
    }
    return result(false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function parseUpdateArgs(args) {
  requireValue(Array.isArray(args), "Update arguments must be a list.");
  const options = {
    action: null,
    output: undefined,
    stable: false,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let key;
    if (arg === "--update" || arg === "--check-update") {
      key = "action";
      requireValue(
        !options.action,
        "Use exactly one of --update or --check-update.",
      );
      options.action = arg.slice(2);
    } else if (arg === "--stable") {
      key = "stable";
      options.stable = true;
    } else if (arg === "--help" || arg === "-h") {
      key = "help";
      options.help = true;
    } else if (
      arg === "--output" ||
      (typeof arg === "string" && arg.startsWith("--output="))
    ) {
      key = "output";
      const value = arg === "--output" ? args[++index] : arg.slice(9);
      requireValue(
        typeof value === "string" &&
          value.trim() &&
          !value.includes("\0") &&
          (arg !== "--output" || !value.startsWith("--")),
        "--output requires a directory.",
      );
      options.output = value;
    } else throw new Error(`Unknown update argument: ${String(arg)}`);
    requireValue(
      !seen.has(key),
      `Duplicate update option: --${key === "action" ? "update/--check-update" : key}`,
    );
    seen.add(key);
  }
  requireValue(
    options.help || options.action,
    "Use --update to download a newer installer, or --check-update to check only.",
  );
  return options;
}

export function installerCommand(filename, platform) {
  if (platform === "win32")
    return `Start-Process -FilePath '${filename.replaceAll("'", "''")}'`;
  const quoted = `'${filename.replaceAll("'", `'"'"'`)}'`;
  return platform === "darwin"
    ? `open ${quoted}`
    : `sudo apt install -- ${quoted}`;
}

function writeOutput(output, message) {
  if (typeof output === "function") output(message);
  else output.write(message);
}

const HELP = `Usage: scislide --update [--output <directory>] [--stable]
       scislide --check-update [--stable]
       scislide --help (or -h)

Check official wikicho/SciSlide GitHub releases for this operating system.
--update downloads a newer installer and verifies its SHA-256 checksum.
--check-update checks only and does not write files.
--output chooses the download directory (default: Downloads/SciSlide-updates).
--stable excludes development prereleases; development builds are included by default.
Downloaded installers are never installed or executed automatically.
`;

export async function runUpdateCli(
  args,
  {
    currentVersion,
    platform = process.platform,
    arch = process.arch,
    defaultDestination = path.join(
      os.homedir(),
      "Downloads",
      "SciSlide-updates",
    ),
    fetch = globalThis.fetch,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  let options;
  try {
    options = parseUpdateArgs(args);
  } catch (error) {
    writeOutput(stderr, `SciSlide update: ${error.message}\n${HELP}`);
    return 2;
  }
  if (options.help) {
    writeOutput(stdout, HELP);
    return 0;
  }
  try {
    const info = await checkForUpdate({
      currentVersion,
      platform,
      arch,
      fetch,
      includePrereleases: !options.stable,
    });
    if (info.status === "current") {
      writeOutput(
        stdout,
        `SciSlide ${currentVersion} is current for ${platform}/${arch}; newest compatible release: ${info.latestVersion}.\n`,
      );
      return 0;
    }
    writeOutput(
      stdout,
      `Update available: SciSlide ${info.latestVersion} (${info.release.tagName}).\n`,
    );
    if (options.action === "check-update") {
      writeOutput(
        stdout,
        `Installer: ${info.asset.name}\nRelease: ${info.release.url}\n`,
      );
      return 0;
    }
    writeOutput(stdout, `Downloading ${info.asset.name}...\n`);
    let lastProgress = 0;
    const result = await downloadUpdate(info, {
      destination: options.output ?? defaultDestination,
      fetch,
      onProgress: ({ received, total }) => {
        const progress = Math.floor((received / total) * 4) * 25;
        if (progress > lastProgress && progress < 100) {
          lastProgress = progress;
          writeOutput(stdout, `Downloaded ${progress}%.\n`);
        }
      },
    });
    writeOutput(
      stdout,
      `${result.reused ? "Verified existing installer" : "Saved"}: ${result.path}\nSHA-256: ${result.sha256}\nInstall manually: ${installerCommand(result.path, platform)}\n`,
    );
    return 0;
  } catch (error) {
    writeOutput(
      stderr,
      `SciSlide update: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
