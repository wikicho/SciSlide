import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runFile = promisify(execFile);
const repository = "wikicho/SciSlide";
const wikiUrl = `https://github.com/${repository}.wiki.git`;

export async function loadPages(directory) {
  if (
    !(await lstat(directory)).isDirectory() ||
    (await lstat(directory)).isSymbolicLink()
  ) {
    throw new Error("Wiki source must be a real directory.");
  }
  const pages = new Map();
  for (const name of (await readdir(directory)).sort()) {
    if (!/^(?:_[A-Za-z]+|[A-Za-z0-9][A-Za-z0-9 _-]*)\.md$/.test(name)) {
      throw new Error(`Unexpected wiki source entry: ${name}`);
    }
    const entry = await lstat(path.join(directory, name));
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Wiki pages must be regular files: ${name}`);
    }
    const content = await readFile(path.join(directory, name), "utf8");
    if (!content.trim() || content.includes("\0")) {
      throw new Error(`Empty or invalid Markdown: ${name}`);
    }
    pages.set(name, content);
  }
  if (!pages.has("Home.md")) throw new Error("Home.md is required.");
  return pages;
}

function withoutFences(content, name) {
  let fence;
  const lines = [];
  for (const line of content.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
      lines.push("");
    } else lines.push(fence ? "" : line);
  }
  if (fence) throw new Error(`Unclosed Markdown fence: ${name}`);
  return lines.join("\n");
}

export function validatePages(pages, existingNames = []) {
  const available = new Set(
    [...pages.keys(), ...existingNames].map((name) =>
      name.replace(/\.md$/i, "").replace(/ /g, "-").toLowerCase(),
    ),
  );
  for (const [name, content] of pages) {
    const markdown = withoutFences(content, name).replace(/`[^`\n]*`/g, "");
    const destinations = [
      ...[
        ...markdown.matchAll(
          /!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g,
        ),
      ].map((match) => match[1].replace(/^<|>$/g, "")),
      ...[...markdown.matchAll(/^ {0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)].map(
        (match) => match[1].replace(/^<|>$/g, ""),
      ),
      ...[...markdown.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) =>
        match[1].split("|").at(-1).trim(),
      ),
    ];
    for (const destination of destinations) {
      if (/^(?:https?:|mailto:|#)/i.test(destination)) continue;
      if (
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination) ||
        destination.startsWith("//")
      ) {
        throw new Error(`Unsupported link in ${name}: ${destination}`);
      }
      let local;
      try {
        local = decodeURIComponent(destination.split(/[?#]/)[0]);
      } catch {
        throw new Error(`Invalid link encoding in ${name}: ${destination}`);
      }
      local = local
        .replace(/^\.\//, "")
        .replace(/\.md$/i, "")
        .replace(/ /g, "-")
        .toLowerCase();
      if (!available.has(local))
        throw new Error(`Broken local link in ${name}: ${destination}`);
    }
  }
}

function cleanGitEnvironment(token) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_") && !["GH_TOKEN", "GITHUB_TOKEN"].includes(key),
    ),
  );
  Object.assign(env, {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: token ? "3" : "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: "/dev/null",
  });
  if (token) {
    env.GIT_CONFIG_KEY_2 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_2 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  return env;
}

async function git(args, cwd, token) {
  try {
    const result = await runFile("git", args, {
      cwd,
      env: cleanGitEnvironment(token),
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    return result.stdout.trim();
  } catch (error) {
    let detail = String(error.stderr || error.message);
    if (token) {
      for (const secret of [
        token,
        Buffer.from(`x-access-token:${token}`).toString("base64"),
      ]) {
        detail = detail.split(secret).join("[redacted]");
      }
    }
    throw new Error(`Git ${args[0]} failed: ${detail.trim()}`);
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== "--validate-only"))
    throw new Error("Use --validate-only or no arguments.");
  const sourceRoot = process.cwd();
  const pages = await loadPages(path.join(sourceRoot, "docs", "wiki"));
  if (args.includes("--validate-only")) {
    validatePages(pages);
    console.log(`Validated ${pages.size} wiki pages.`);
    return;
  }
  const {
    GITHUB_ACTIONS,
    GITHUB_REPOSITORY,
    GITHUB_REF,
    GITHUB_SHA,
    GITHUB_EVENT_NAME,
    GITHUB_TOKEN,
  } = process.env;
  if (
    GITHUB_ACTIONS !== "true" ||
    GITHUB_REPOSITORY !== repository ||
    GITHUB_REF !== "refs/heads/main" ||
    !/^[0-9a-f]{40}$/.test(GITHUB_SHA || "") ||
    !["push", "workflow_dispatch"].includes(GITHUB_EVENT_NAME) ||
    !GITHUB_TOKEN
  )
    throw new Error(
      "Publishing requires the trusted main workflow and its repository token.",
    );
  if ((await git(["rev-parse", "HEAD"], sourceRoot)) !== GITHUB_SHA) {
    throw new Error("Checked-out source does not match the workflow commit.");
  }
  const dirty = await git(
    [
      "status",
      "--porcelain",
      "--",
      "docs/wiki",
      "scripts/publish-wiki.mjs",
      ".github/workflows/wiki.yml",
    ],
    sourceRoot,
  );
  if (dirty)
    throw new Error(
      "Wiki source or publisher differs from the workflow commit.",
    );
  const temp = await mkdtemp(path.join(tmpdir(), "scislide-wiki-"));
  const clone = path.join(temp, "wiki");
  try {
    await git(
      ["clone", "--no-tags", "--single-branch", wikiUrl, clone],
      temp,
      GITHUB_TOKEN,
    );
    const remoteHead = await git(
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      clone,
    );
    if (!remoteHead.startsWith("origin/"))
      throw new Error("The initialized wiki has no default branch.");
    const branch = remoteHead.slice("origin/".length);
    await git(["check-ref-format", "--branch", branch], clone);
    const originalHead = await git(["rev-parse", "HEAD"], clone);
    const existingNames = (await readdir(clone)).filter((name) =>
      name.endsWith(".md"),
    );
    validatePages(pages, existingNames);
    for (const [name, content] of pages) {
      const destination = path.join(clone, name);
      const oldEntry = await lstat(destination).catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (oldEntry && (!oldEntry.isFile() || oldEntry.isSymbolicLink())) {
        throw new Error(`Refusing to replace non-file wiki entry: ${name}`);
      }
      await writeFile(destination, content);
    }
    await git(["add", "--", ...pages.keys()], clone);
    const changed = await git(["diff", "--cached", "--name-only"], clone);
    if (!changed) {
      console.log(
        `Wiki already matches source ${GITHUB_SHA}; no commit needed.`,
      );
      return;
    }
    await git(
      [
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        `Update SciSlide wiki from ${GITHUB_SHA}`,
      ],
      clone,
    );
    const deployedHead = await git(["rev-parse", "HEAD"], clone);
    await git(
      ["merge-base", "--is-ancestor", originalHead, deployedHead],
      clone,
    );
    await git(
      ["push", "origin", `HEAD:refs/heads/${branch}`],
      clone,
      GITHUB_TOKEN,
    );
    const remote = await git(
      ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
      clone,
      GITHUB_TOKEN,
    );
    if (remote.split(/\s+/)[0] !== deployedHead)
      throw new Error("Remote wiki HEAD does not match the pushed commit.");
    const verification = path.join(temp, "verify");
    await git(
      [
        "clone",
        "--no-tags",
        "--single-branch",
        "--branch",
        branch,
        wikiUrl,
        verification,
      ],
      temp,
      GITHUB_TOKEN,
    );
    if ((await git(["rev-parse", "HEAD"], verification)) !== deployedHead) {
      throw new Error(
        "Fresh wiki checkout does not match the published commit.",
      );
    }
    for (const [name, content] of pages) {
      if ((await readFile(path.join(verification, name), "utf8")) !== content) {
        throw new Error(`Published wiki content differs: ${name}`);
      }
    }
    console.log(
      `Published and verified ${pages.size} pages at ${deployedHead} from source ${GITHUB_SHA}.`,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
