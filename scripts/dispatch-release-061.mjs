import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const repo = "wikicho/SciSlide";
const tag = "v0.6.1";
const require = (condition, message) => {
  if (!condition) throw new Error(message);
};

function githubApi(token) {
  require(typeof token === "string" &&
    token.length > 0, "GH_TOKEN is required");
  return async (resource, { method = "GET", body, missing = false } = {}) => {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/${resource}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (missing && response.status === 404) return null;
    require(response.ok, `GitHub API request failed (${response.status}) for ${resource}`);
    return response.status === 204 ? null : response.json();
  };
}

/** Dispatch only the user-requested 0.6.1 release, preserving its publication guards. */
export async function dispatchRelease061(options, dependencies = {}) {
  const { repository, ref, sha, root = projectRoot, token } = options;
  require(repository === repo &&
    ref === "refs/heads/main" &&
    /^[0-9a-f]{40}$/.test(
      sha,
    ), "The release bootstrap requires the trusted main repository and an exact source SHA");
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  require(pkg.version ===
    "0.6.1", "This bootstrap can only publish SciSlide 0.6.1");
  require((
    await readFile(path.join(root, "docs", "releases", `${tag}.md`), "utf8")
  ).trim(), "SciSlide 0.6.1 release notes are required");
  const api = dependencies.api ?? githubApi(token);

  async function currentMain() {
    const main = await api("git/ref/heads/main");
    require(main?.object?.type === "commit" &&
      main.object.sha ===
        sha, "Main moved after this source commit; refusing to dispatch a different source");
  }
  await currentMain();

  const releaseTag = await api(`git/ref/tags/${tag}`, { missing: true });
  let tagObject = releaseTag?.object;
  for (let count = 0; tagObject?.type === "tag" && count < 5; count++) {
    require(/^[0-9a-f]{40}$/.test(
      tagObject.sha,
    ), "Invalid annotated release tag");
    tagObject = (await api(`git/tags/${tagObject.sha}`)).object;
  }
  require(!releaseTag ||
    (tagObject?.type === "commit" &&
      tagObject.sha ===
        sha), "Existing 0.6.1 tag points to a different source commit");

  let release;
  for (let page = 1; !release; page++) {
    const entries = await api(`releases?per_page=100&page=${page}`);
    require(Array.isArray(entries), "Invalid release listing");
    release = entries.find((entry) => entry.tag_name === tag);
    if (entries.length < 100) break;
  }
  if (release) {
    require(release.target_commitish === sha &&
      release.prerelease === true &&
      typeof release.draft ===
        "boolean", "Existing 0.6.1 release does not match this development source");
    if (!release.draft) {
      require(tagObject?.sha ===
        sha, "Published 0.6.1 tag does not match this source");
      return {
        state: "already-published",
        sha,
        url: `https://github.com/${repo}/releases/tag/${tag}`,
      };
    }
  }

  const runs = await api(
    `actions/workflows/release.yml/runs?head_sha=${sha}&event=workflow_dispatch&per_page=100`,
  );
  require(Array.isArray(
    runs?.workflow_runs,
  ), "Invalid release workflow run listing");
  const active = runs.workflow_runs.find(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      run.event === "workflow_dispatch" &&
      run.path === ".github/workflows/release.yml" &&
      run.repository?.full_name === repo &&
      run.head_repository?.full_name === repo &&
      run.status !== "completed",
  );
  if (active) {
    require(Number.isSafeInteger(active.id) &&
      active.id > 0, "Invalid active release run ID");
    return {
      state: "already-running",
      sha,
      url: `https://github.com/${repo}/actions/runs/${active.id}`,
    };
  }

  // The release workflow independently checks this SHA again after dispatch.
  await currentMain();
  await api("actions/workflows/release.yml/dispatches", {
    method: "POST",
    body: {
      ref: "main",
      inputs: { source_sha: sha, publish_prerelease: true },
    },
  });
  return {
    state: "dispatched",
    sha,
    url: `https://github.com/${repo}/actions/workflows/release.yml`,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await dispatchRelease061({
      repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA,
      token: process.env.GH_TOKEN,
    });
    const message = `SciSlide 0.6.1: ${result.state} for ${result.sha}. ${result.url}`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
