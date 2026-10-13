import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkForUpdate,
  compareVersions,
  downloadUpdate,
  installerCommand,
  MAX_INSTALLER_BYTES,
  MAX_RELEASE_PAGES,
  parseUpdateArgs,
  parseVersion,
  runUpdateCli,
  selectUpdateRelease,
} from "../desktop/update.mjs";

const api = (page = 1) =>
  `https://api.github.com/repos/wikicho/SciSlide/releases?per_page=100&page=${page}`;
const assetUrl = (tag, name) =>
  `https://github.com/wikicho/SciSlide/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const binary = Buffer.from("a small verified SciSlide installer\n");
const current = { currentVersion: "0.6.2", platform: "linux", arch: "x64" };

function release({
  version = "0.6.3",
  tag = `v${version}`,
  prerelease = true,
  draft = false,
  platform = "linux",
  arch = "x64",
  suffix,
  bytes = binary,
  sidecar = true,
  withDigest = true,
} = {}) {
  const ending =
    suffix ??
    (platform === "darwin"
      ? `macos-${arch}-unsigned.pkg`
      : platform === "win32"
        ? "windows-x64-setup-unsigned.exe"
        : "linux-x64.deb");
  const name = `SciSlide-${version}-${ending}`;
  const checksum = `${digest(bytes)}  ${name}\n`;
  return {
    tag_name: tag,
    prerelease,
    draft,
    assets: [
      {
        name,
        size: bytes.length,
        browser_download_url: assetUrl(tag, name),
        ...(withDigest ? { digest: `sha256:${digest(bytes)}` } : {}),
      },
      ...(sidecar
        ? [
            {
              name: `${name}.sha256`,
              size: Buffer.byteLength(checksum),
              browser_download_url: assetUrl(tag, `${name}.sha256`),
            },
          ]
        : []),
    ],
  };
}

function client(releases, routes = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    if (Object.hasOwn(routes, url)) return routes[url](url, options);
    if (url === api()) return new Response(JSON.stringify(releases));
    for (const entry of releases) {
      const asset = entry.assets.find(
        (candidate) => candidate.browser_download_url === url,
      );
      if (!asset) continue;
      if (asset.name.endsWith(".sha256")) {
        const installer = entry.assets.find(
          (candidate) => candidate.name === asset.name.slice(0, -7),
        );
        return new Response(`${digest(binary)}  ${installer.name}\n`);
      }
      return new Response(binary, {
        headers: { "content-length": String(binary.length) },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { fetch, calls };
}

async function directory(t, suffix = "") {
  const root = await mkdtemp(
    path.join(os.tmpdir(), `scislide-update-${suffix}`),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function infoAndClient(options = {}, routes = {}) {
  const entry = release(options);
  const mocked = client([entry], routes);
  const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
  return { entry, info, ...mocked };
}

test("SemVer comparisons preserve release ordering, build equivalence and large numeric precision", () => {
  const ordered = [
    "0.6.3-alpha",
    "0.6.3-alpha.1",
    "0.6.3-alpha.beta",
    "0.6.3-beta",
    "0.6.3-beta.2",
    "0.6.3-beta.11",
    "0.6.3-rc.1",
    "0.6.3",
    "0.10.0",
    "1.0.0",
  ];
  for (let index = 1; index < ordered.length; index++)
    assert.equal(compareVersions(ordered[index - 1], ordered[index]), -1);
  assert.equal(compareVersions("v1.2.3+build.a", "1.2.3+build.b"), 0);
  assert.equal(
    compareVersions("9007199254740993.0.0", "9007199254740992.0.0"),
    1,
  );
  assert.equal(
    compareVersions("1.0.0-dev.9007199254740993", "1.0.0-dev.9007199254740992"),
    1,
  );
  assert.equal(parseVersion("v0.6.2-linux-dev.3").core, "0.6.2");
  for (const invalid of [
    "",
    "0.6",
    "01.2.3",
    "1.2.3-beta.01",
    "v1.2.3/evil",
    "1.2.3-",
    "1.2.3+",
    "1.2.3\n",
  ])
    assert.equal(parseVersion(invalid), null);
  assert.throws(() => compareVersions("broken", "1.2.3"), /SemVer/);
});

test("selects the newest compatible published tag instead of /releases/latest or API order", () => {
  const entries = [
    release({ version: "0.6.3" }),
    release({ version: "0.6.5", platform: "darwin" }),
    release({ version: "0.6.4" }),
    release({ version: "0.6.6", draft: true }),
  ];
  const info = selectUpdateRelease(entries, current);
  assert.equal(info.status, "available");
  assert.equal(info.latestVersion, "0.6.4");
  assert.equal(info.release.prerelease, true);
  assert.equal(info.asset.name, "SciSlide-0.6.4-linux-x64.deb");
});

test("publisher Linux suffixes represent their package version and never redownload the same core version", () => {
  const entry = release({ version: "0.6.2", tag: "v0.6.2-linux-dev.3" });
  assert.equal(selectUpdateRelease([entry], current).status, "current");
  const upgrade = selectUpdateRelease([entry], {
    ...current,
    currentVersion: "0.6.1",
  });
  assert.equal(upgrade.status, "available");
  assert.equal(upgrade.latestVersion, "0.6.2");
  assert.equal(upgrade.release.tagName, "v0.6.2-linux-dev.3");
  assert.equal(
    selectUpdateRelease([entry], { ...current, currentVersion: "0.7.0" })
      .status,
    "current",
  );
  const beta = release({
    version: "0.7.0-beta.1",
    tag: "v0.7.0-beta.1-linux-dev.3",
  });
  assert.equal(
    selectUpdateRelease([beta], current).latestVersion,
    "0.7.0-beta.1",
  );
  assert.equal(
    selectUpdateRelease([beta], { ...current, currentVersion: "0.7.0-beta.1" })
      .status,
    "current",
  );
});

test("defaults to development builds, --stable filters both release flags and semantic prerelease tags", () => {
  const entries = [
    release({ version: "0.6.5" }),
    release({ version: "0.6.6-beta.1", prerelease: false }),
    release({ version: "0.6.4", prerelease: false }),
  ];
  assert.equal(
    selectUpdateRelease(entries, current).latestVersion,
    "0.6.6-beta.1",
  );
  assert.equal(
    selectUpdateRelease(entries, { ...current, includePrereleases: false })
      .latestVersion,
    "0.6.4",
  );
  assert.throws(
    () =>
      selectUpdateRelease([release()], {
        ...current,
        includePrereleases: false,
      }),
    /stable.*SciSlide/,
  );
});

test("Mac architecture matches exactly and a signed installer is preferred over unsigned", () => {
  const unsigned = release({ platform: "darwin", arch: "arm64" });
  const signed = release({
    platform: "darwin",
    arch: "arm64",
    suffix: "macos-arm64-signed.pkg",
  });
  const intel = release({ platform: "darwin", arch: "x64" });
  const combined = {
    ...unsigned,
    assets: [...unsigned.assets, ...intel.assets, ...signed.assets],
  };
  const options = { ...current, platform: "darwin", arch: "arm64" };
  assert.match(
    selectUpdateRelease([combined], options).asset.name,
    /arm64-signed\.pkg$/,
  );
  assert.match(
    selectUpdateRelease([unsigned], options).asset.name,
    /arm64-unsigned\.pkg$/,
  );
  assert.throws(() => selectUpdateRelease([intel], options), /No compatible/);
});

test("Windows downloads the x64 setup installer instead of the portable ZIP", () => {
  const entry = release({ platform: "win32" });
  entry.assets.push({
    ...entry.assets[0],
    name: "SciSlide-0.6.3-windows-x64-portable.zip",
  });
  const result = selectUpdateRelease([entry], {
    ...current,
    platform: "win32",
  });
  assert.match(result.asset.name, /setup-unsigned\.exe$/);
  assert.throws(
    () =>
      selectUpdateRelease([entry], {
        ...current,
        platform: "win32",
        arch: "arm64",
      }),
    /Supported targets/,
  );
});

test("requires a trustworthy checksum, rejects duplicate assets, and refuses malformed installer metadata", () => {
  const noHash = release({ sidecar: false, withDigest: false });
  assert.throws(() => selectUpdateRelease([noHash], current), /no SHA-256/);
  const duplicate = release();
  duplicate.assets.push({ ...duplicate.assets[0] });
  assert.throws(
    () => selectUpdateRelease([duplicate], current),
    /duplicate installer/,
  );
  const oversized = release();
  oversized.assets[0].size = MAX_INSTALLER_BYTES + 1;
  assert.throws(
    () => selectUpdateRelease([oversized], current),
    /declared size/,
  );
  const malformed = release();
  malformed.assets[0].digest = "sha256:nope";
  assert.throws(
    () => selectUpdateRelease([malformed], current),
    /Invalid GitHub SHA-256/,
  );
});

test("initial asset URLs must be the exact release asset in wikicho/SciSlide", () => {
  for (const url of [
    "https://evil.test/SciSlide.deb",
    "https://github.com/another/SciSlide/releases/download/v0.6.3/SciSlide-0.6.3-linux-x64.deb",
    "https://github.com/wikicho/SciSlide/releases/download/v0.6.4/SciSlide-0.6.3-linux-x64.deb",
    `${assetUrl("v0.6.3", "SciSlide-0.6.3-linux-x64.deb")}?anything=1`,
    "http://github.com/wikicho/SciSlide/releases/download/v0.6.3/SciSlide-0.6.3-linux-x64.deb",
  ]) {
    const entry = release();
    entry.assets[0].browser_download_url = url;
    assert.throws(
      () => selectUpdateRelease([entry], current),
      /official|HTTPS/,
    );
  }
});

test("checks use bounded fixed-repo API pagination, even when Link points somewhere else", async () => {
  const first = release({ version: "0.6.3" }),
    second = release({ version: "0.6.4" });
  const mocked = client([], {
    [api()]: () =>
      new Response(JSON.stringify([first]), {
        headers: { link: '<https://evil.test/metadata>; rel="next"' },
      }),
    [api(2)]: () => new Response(JSON.stringify([second])),
  });
  const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
  assert.equal(info.latestVersion, "0.6.4");
  assert.deepEqual(
    mocked.calls.map((call) => call.url),
    [api(), api(2)],
  );
});

test("release history has a hard page limit rather than an unbounded scan", async () => {
  let calls = 0;
  const fetch = async (_url, options) => {
    assert.equal(options.redirect, "manual");
    calls++;
    return new Response(
      JSON.stringify(Array.from({ length: 100 }, () => ({ draft: true }))),
    );
  };
  await assert.rejects(checkForUpdate({ ...current, fetch }), /1,000 releases/);
  assert.equal(calls, MAX_RELEASE_PAGES);
});

test("metadata is size bounded and malformed/rate-limited responses are useful errors", async () => {
  await assert.rejects(
    checkForUpdate({
      ...current,
      fetch: async () => new Response("x".repeat(4 * 1024 * 1024 + 1)),
    }),
    /size limit/,
  );
  await assert.rejects(
    checkForUpdate({ ...current, fetch: async () => new Response("not JSON") }),
    /invalid release JSON/,
  );
  await assert.rejects(
    checkForUpdate({ ...current, fetch: async () => new Response("{}") }),
    /invalid release page/,
  );
  await assert.rejects(
    checkForUpdate({
      ...current,
      fetch: async () =>
        new Response("limited", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    }),
    /rate limit/,
  );
  await assert.rejects(
    checkForUpdate({
      ...current,
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.test" },
        }),
    }),
    /redirect limit/,
  );
});

test("a valid streamed installer is hashed, saved privately and reported without execution", async (t) => {
  const destination = await directory(t);
  const { info, fetch, calls } = await infoAndClient();
  const progress = [];
  const result = await downloadUpdate(info, {
    destination,
    fetch,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.path, path.join(destination, info.asset.name));
  assert.equal(result.sha256, digest(binary));
  assert.equal(result.reused, false);
  assert.deepEqual(await readFile(result.path), binary);
  assert.deepEqual(await readdir(destination), [info.asset.name]);
  if (process.platform !== "win32")
    assert.equal((await lstat(result.path)).mode & 0o777, 0o600);
  assert.deepEqual(progress.at(-1), {
    received: binary.length,
    total: binary.length,
  });
  assert.equal(calls.filter((call) => call.url === info.asset.url).length, 1);
});

test("GitHub SHA-256 digest alone is sufficient when the release has no sidecar", async (t) => {
  const destination = await directory(t);
  const { info, fetch, calls } = await infoAndClient({ sidecar: false });
  assert.equal(info.checksum, null);
  const result = await downloadUpdate(info, { destination, fetch });
  assert.equal(result.sha256, digest(binary));
  assert.deepEqual(
    calls.map((call) => call.url),
    [api(), info.asset.url],
  );
});

test("a matching existing installer is reused without downloading its binary again", async (t) => {
  const destination = await directory(t);
  const { info, fetch, calls } = await infoAndClient();
  await writeFile(path.join(destination, info.asset.name), binary);
  const result = await downloadUpdate(info, { destination, fetch });
  assert.equal(result.reused, true);
  assert.equal(
    calls.some((call) => call.url === info.asset.url),
    false,
  );
  assert.deepEqual(await readdir(destination), [info.asset.name]);
});

test("same-version/current requests refuse downloading before any fetch or directory writes", async (t) => {
  const root = await directory(t);
  const destination = path.join(root, "not-created");
  const entry = release({ version: "0.6.2", tag: "v0.6.2-linux-dev.9" });
  const info = selectUpdateRelease([entry], current);
  await assert.rejects(
    downloadUpdate(info, {
      destination,
      fetch: () => assert.fail("must not fetch"),
    }),
    /no newer/,
  );
  await assert.rejects(lstat(destination), { code: "ENOENT" });
});

test("rejects mismatched sidecar basenames and digest disagreements before creating outputs", async (t) => {
  const root = await directory(t);
  for (const [index, contents] of [
    `${digest(binary)}  other.deb\n`,
    `${digest(binary)}  ../SciSlide-0.6.3-linux-x64.deb\n`,
    `${digest(binary)}  SciSlide-0.6.3-linux-x64.deb\n${digest(binary)}  SciSlide-0.6.3-linux-x64.deb\n`,
    `${"0".repeat(64)}  SciSlide-0.6.3-linux-x64.deb\n`,
  ].entries()) {
    const entry = release();
    entry.assets[1].size = Buffer.byteLength(contents);
    const mocked = client([entry], {
      [entry.assets[1].browser_download_url]: () => new Response(contents),
    });
    const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
    const destination = path.join(root, String(index));
    await assert.rejects(
      downloadUpdate(info, { destination, fetch: mocked.fetch }),
      /checksum|SHA-256/,
    );
    await assert.rejects(lstat(destination), { code: "ENOENT" });
    assert.equal(
      mocked.calls.some((call) => call.url === info.asset.url),
      false,
    );
  }
});

test("checksum size bounds are enforced and output metadata cannot inject file paths", async (t) => {
  const destination = await directory(t);
  const { info } = await infoAndClient();
  await assert.rejects(
    downloadUpdate(
      { ...info, asset: { ...info.asset, name: "../installer.deb" } },
      { destination },
    ),
    /does not match/,
  );
  await assert.rejects(
    downloadUpdate(info, {
      destination,
      fetch: async () => new Response("x".repeat(16 * 1024 + 1)),
    }),
    /size limit/,
  );
  assert.deepEqual(await readdir(destination), []);
});

test("approved GitHub CDN redirects are manually followed before verification", async (t) => {
  const destination = await directory(t);
  const entry = release({ sidecar: false });
  const initial = entry.assets[0].browser_download_url;
  const cdn =
    "https://release-assets.githubusercontent.com/github-production-release-asset/123/file?token=temporary";
  const mocked = client([entry], {
    [initial]: () =>
      new Response(null, { status: 302, headers: { location: cdn } }),
    [cdn]: () => new Response(binary),
  });
  const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
  const result = await downloadUpdate(info, {
    destination,
    fetch: mocked.fetch,
  });
  assert.deepEqual(await readFile(result.path), binary);
  assert.deepEqual(
    mocked.calls.map((call) => call.url),
    [api(), initial, cdn],
  );
});

test("unsafe redirect destinations are rejected before fetching them and leave no partial file", async (t) => {
  const root = await directory(t);
  for (const [index, redirect] of [
    "https://github.com.evil.test/payload",
    "https://evil.test/payload",
    "http://release-assets.githubusercontent.com/payload",
    "https://user:password@release-assets.githubusercontent.com/payload",
    "https://release-assets.githubusercontent.com:444/payload",
    "https://release-assets.githubusercontent.com/payload#fragment",
  ].entries()) {
    const entry = release({ sidecar: false });
    const initial = entry.assets[0].browser_download_url;
    const mocked = client([entry], {
      [initial]: () =>
        new Response(null, { status: 302, headers: { location: redirect } }),
    });
    const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
    const destination = path.join(root, String(index));
    await assert.rejects(
      downloadUpdate(info, { destination, fetch: mocked.fetch }),
      /allowed GitHub|HTTPS/,
    );
    assert.deepEqual(
      mocked.calls.map((call) => call.url),
      [api(), initial],
    );
    assert.deepEqual(await readdir(destination), []);
  }
});

test("redirect loops and fetch implementations that auto-follow redirects are rejected", async (t) => {
  const destination = await directory(t);
  const entry = release({ sidecar: false });
  const initial = entry.assets[0].browser_download_url;
  const mocked = client([entry], {
    [initial]: () =>
      new Response(null, { status: 302, headers: { location: initial } }),
  });
  const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
  await assert.rejects(
    downloadUpdate(info, { destination, fetch: mocked.fetch }),
    /redirect limit/,
  );
  assert.equal(mocked.calls.length, 7);
  assert.deepEqual(await readdir(destination), []);
  await assert.rejects(
    downloadUpdate(info, {
      destination,
      fetch: async () => {
        const response = new Response(binary);
        Object.defineProperties(response, {
          url: { value: "https://evil.test/payload" },
          redirected: { value: true },
        });
        return response;
      },
    }),
    /unchecked redirect/,
  );
  assert.deepEqual(await readdir(destination), []);
});

test("tampering, truncated and oversized streams never publish an installer", async (t) => {
  const root = await directory(t);
  const bodies = [
    Buffer.alloc(binary.length, 120),
    binary.subarray(0, -1),
    Buffer.concat([binary, Buffer.from("extra")]),
  ];
  for (const [index, body] of bodies.entries()) {
    const entry = release({ sidecar: false });
    const mocked = client([entry], {
      [entry.assets[0].browser_download_url]: () => new Response(body),
    });
    const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
    const destination = path.join(root, String(index));
    await assert.rejects(
      downloadUpdate(info, { destination, fetch: mocked.fetch }),
      /SHA-256|incomplete|declared size/,
    );
    assert.deepEqual(await readdir(destination), []);
  }
});

test("a size header mismatch or unexpected compression fails before saving bytes", async (t) => {
  const root = await directory(t);
  for (const [index, headers] of [
    { "content-length": String(binary.length + 1) },
    { "content-length": "invalid" },
    { "content-length": String(MAX_INSTALLER_BYTES + 1) },
    { "content-encoding": "gzip" },
  ].entries()) {
    const entry = release({ sidecar: false });
    const mocked = client([entry], {
      [entry.assets[0].browser_download_url]: () =>
        new Response(binary, { headers }),
    });
    const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
    const destination = path.join(root, String(index));
    await assert.rejects(
      downloadUpdate(info, { destination, fetch: mocked.fetch }),
      /size|length|compression/,
    );
    assert.deepEqual(await readdir(destination), []);
  }
});

test("a stream failing after its first chunk removes its private stage and keeps unrelated files", async (t) => {
  const destination = await directory(t);
  await writeFile(path.join(destination, "keep.txt"), "unrelated");
  const entry = release({ sidecar: false });
  const mocked = client([entry], {
    [entry.assets[0].browser_download_url]: () => {
      let chunks = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (chunks++ === 0) controller.enqueue(binary.subarray(0, 8));
            else
              controller.error(
                new Error("Connection reset during installer download"),
              );
          },
        }),
      );
    },
  });
  const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
  await assert.rejects(
    downloadUpdate(info, { destination, fetch: mocked.fetch }),
    /Connection reset/,
  );
  assert.deepEqual(await readdir(destination), ["keep.txt"]);
  assert.equal(
    await readFile(path.join(destination, "keep.txt"), "utf8"),
    "unrelated",
  );
});

test("conflicting existing files and symlinks are never overwritten or followed", async (t) => {
  const root = await directory(t);
  const { info, fetch, calls } = await infoAndClient({ sidecar: false });
  const conflicting = path.join(root, info.asset.name);
  const original = Buffer.alloc(binary.length, 90);
  await writeFile(conflicting, original);
  await assert.rejects(
    downloadUpdate(info, { destination: root, fetch }),
    /different SHA-256/,
  );
  assert.deepEqual(await readFile(conflicting), original);
  assert.equal(
    calls.some((call) => call.url === info.asset.url),
    false,
  );
  if (process.platform !== "win32") {
    const directoryWithLink = path.join(root, "links");
    await mkdir(directoryWithLink);
    await symlink(conflicting, path.join(directoryWithLink, info.asset.name));
    await assert.rejects(
      downloadUpdate(info, { destination: directoryWithLink, fetch }),
      /symlink/,
    );
    assert.ok(
      (
        await lstat(path.join(directoryWithLink, info.asset.name))
      ).isSymbolicLink(),
    );
    assert.deepEqual(await readFile(conflicting), original);
  }
});

test("a concurrent destination creation cannot be overwritten during publication", async (t) => {
  const destination = await directory(t);
  const entry = release({ sidecar: false });
  const final = path.join(destination, entry.assets[0].name);
  const original = Buffer.alloc(binary.length, 90);
  const mocked = client([entry], {
    [entry.assets[0].browser_download_url]: async () => {
      await writeFile(final, original, { flag: "wx" });
      return new Response(binary);
    },
  });
  const info = await checkForUpdate({ ...current, fetch: mocked.fetch });
  await assert.rejects(
    downloadUpdate(info, { destination, fetch: mocked.fetch }),
    /different SHA-256/,
  );
  assert.deepEqual(await readFile(final), original);
  assert.deepEqual(await readdir(destination), [info.asset.name]);
});

test("strict CLI arguments reject unknown/duplicate flags before any network or disk use", async () => {
  assert.deepEqual(
    parseUpdateArgs(["--update", "--output", "somewhere", "--stable"]),
    { action: "update", output: "somewhere", stable: true, help: false },
  );
  assert.equal(
    parseUpdateArgs(["--check-update", "--output=somewhere"]).output,
    "somewhere",
  );
  for (const args of [
    [],
    ["--unknown"],
    ["--update", "--update"],
    ["--update", "--check-update"],
    ["--stable", "--stable", "--update"],
    ["--help", "--help"],
    ["--update", "--output"],
    ["--update", "--output="],
    ["--update", "--output", "--stable"],
    ["--update", "--output=a", "--output=b"],
    ["--help", "--unknown"],
  ]) {
    let errors = "";
    assert.equal(
      await runUpdateCli(args, {
        ...current,
        fetch: () => assert.fail("must not fetch"),
        stdout: () => assert.fail("no success output"),
        stderr: (text) => {
          errors += text;
        },
      }),
      2,
    );
    assert.match(errors, /Usage:/);
  }
});

test("--help bypasses networking and --check-update writes no download directories", async (t) => {
  let output = "";
  assert.equal(
    await runUpdateCli(["--help"], {
      fetch: () => assert.fail("must not fetch"),
      stdout: {
        write: (text) => {
          output += text;
        },
      },
    }),
    0,
  );
  assert.match(output, /never installed or executed/);
  output = "";
  assert.equal(
    await runUpdateCli(["-h"], {
      fetch: () => assert.fail("must not fetch"),
      stdout: (text) => {
        output += text;
      },
    }),
    0,
  );
  assert.match(output, /Usage:/);
  assert.throws(() => parseUpdateArgs(["-h", "--help"]), /Duplicate/);
  const root = await directory(t);
  const destination = path.join(root, "not-created");
  const mocked = client([release()]);
  output = "";
  assert.equal(
    await runUpdateCli(["--check-update", `--output=${destination}`], {
      ...current,
      fetch: mocked.fetch,
      stdout: (text) => {
        output += text;
      },
      stderr: () => assert.fail("no error"),
    }),
    0,
  );
  assert.match(output, /Update available: SciSlide 0\.6\.3/);
  assert.deepEqual(
    mocked.calls.map((call) => call.url),
    [api()],
  );
  await assert.rejects(lstat(destination), { code: "ENOENT" });
});

test("CLI downloads print the verified path/hash and correctly quote install paths without running commands", async (t) => {
  const root = await directory(t);
  const destination = path.join(root, "someone's downloads");
  const mocked = client([release()]);
  let output = "",
    errors = "";
  assert.equal(
    await runUpdateCli(["--update", "--output", destination], {
      ...current,
      fetch: mocked.fetch,
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        errors += text;
      },
    }),
    0,
  );
  assert.equal(errors, "");
  assert.match(output, /Saved:/);
  assert.ok(output.includes(`SHA-256: ${digest(binary)}`));
  assert.ok(
    output.includes(
      `Install manually: sudo apt install -- '${path.join(root, "someone")}\'\"\'\"\'s downloads/SciSlide-0.6.3-linux-x64.deb'`,
    ),
  );
  assert.deepEqual(
    await readFile(path.join(destination, "SciSlide-0.6.3-linux-x64.deb")),
    binary,
  );
  assert.equal(
    installerCommand("C:\\someone's downloads\\installer.exe", "win32"),
    "Start-Process -FilePath 'C:\\someone''s downloads\\installer.exe'",
  );
  assert.equal(
    installerCommand("/tmp/someone's.pkg", "darwin"),
    `open '/tmp/someone'"'"'s.pkg'`,
  );
});

test("CLI --update does not redownload a current package, and --stable/no assets report failure", async (t) => {
  const root = await directory(t);
  const destination = path.join(root, "not-created");
  const mocked = client([
    release({ version: "0.6.2", tag: "v0.6.2-linux-dev.4" }),
  ]);
  let output = "",
    errors = "";
  const dependencies = {
    ...current,
    defaultDestination: destination,
    fetch: mocked.fetch,
    stdout: (text) => {
      output += text;
    },
    stderr: (text) => {
      errors += text;
    },
  };
  assert.equal(await runUpdateCli(["--update"], dependencies), 0);
  assert.match(output, /is current/);
  await assert.rejects(lstat(destination), { code: "ENOENT" });
  assert.deepEqual(
    mocked.calls.map((call) => call.url),
    [api()],
  );
  assert.equal(
    await runUpdateCli(["--check-update", "--stable"], dependencies),
    1,
  );
  assert.match(errors, /No compatible.*stable/);
  const empty = client([]);
  assert.equal(
    await runUpdateCli(["--check-update"], {
      ...dependencies,
      fetch: empty.fetch,
    }),
    1,
  );
  assert.match(errors, /No compatible.*published/);
});
