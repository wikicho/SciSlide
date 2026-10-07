import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dispatchRelease061 } from "../scripts/dispatch-release-061.mjs";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const repository = "wikicho/SciSlide";

async function fixture(
  t,
  { version = "0.6.1", release, tagSha, active, moveMain = false } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scislide-dispatch-061-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs", "releases"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
  await writeFile(
    path.join(root, "docs", "releases", "v0.6.1.md"),
    "# SciSlide 0.6.1\n",
  );
  const calls = [];
  let mainReads = 0;
  const api = async (resource, options = {}) => {
    calls.push({ resource, ...options });
    if (resource === "git/ref/heads/main") {
      mainReads++;
      return {
        object: {
          type: "commit",
          sha: moveMain && mainReads > 1 ? otherSha : sha,
        },
      };
    }
    if (resource === "git/ref/tags/v0.6.1") {
      assert.equal(options.missing, true);
      return tagSha ? { object: { type: "commit", sha: tagSha } } : null;
    }
    if (resource === "releases?per_page=100&page=1")
      return release ? [release] : [];
    if (resource.startsWith("actions/workflows/release.yml/runs?")) {
      return { workflow_runs: active ? [active] : [] };
    }
    if (resource === "actions/workflows/release.yml/dispatches") return null;
    assert.fail(`Unexpected API request: ${resource}`);
  };
  return {
    options: { root, repository, ref: "refs/heads/main", sha },
    api,
    calls,
  };
}

test("dispatches only release.yml on main with the exact source and publication enabled", async (t) => {
  const { options, api, calls } = await fixture(t);
  assert.equal(
    (await dispatchRelease061(options, { api })).state,
    "dispatched",
  );
  assert.equal(
    calls.filter((call) => call.resource === "git/ref/heads/main").length,
    2,
  );
  assert.deepEqual(
    calls.filter((call) => call.method === "POST"),
    [
      {
        resource: "actions/workflows/release.yml/dispatches",
        method: "POST",
        body: {
          ref: "main",
          inputs: { source_sha: sha, publish_prerelease: true },
        },
      },
    ],
  );
});

test("refuses moved main immediately before dispatch", async (t) => {
  const { options, api, calls } = await fixture(t, { moveMain: true });
  await assert.rejects(dispatchRelease061(options, { api }), /Main moved/);
  assert.equal(
    calls.some((call) => call.method === "POST"),
    false,
  );
});

test("rejects other versions, repositories, branches and invalid SHAs before any API call", async (t) => {
  const wrongVersion = await fixture(t, { version: "0.6.2" });
  await assert.rejects(
    dispatchRelease061(wrongVersion.options, { api: wrongVersion.api }),
    /only publish SciSlide 0.6.1/,
  );
  assert.equal(wrongVersion.calls.length, 0);
  const { options, api, calls } = await fixture(t);
  for (const patch of [
    { repository: "other/SciSlide" },
    { ref: "refs/heads/topic" },
    { sha: "main" },
  ]) {
    await assert.rejects(
      dispatchRelease061({ ...options, ...patch }, { api }),
      /trusted main/,
    );
  }
  assert.equal(calls.length, 0);
});

test("never overwrites an existing tag or release for another source", async (t) => {
  for (const existing of [
    { tagSha: otherSha },
    {
      release: {
        tag_name: "v0.6.1",
        target_commitish: otherSha,
        prerelease: true,
        draft: true,
      },
    },
    {
      release: {
        tag_name: "v0.6.1",
        target_commitish: sha,
        prerelease: false,
        draft: false,
      },
    },
  ]) {
    const { options, api, calls } = await fixture(t, existing);
    await assert.rejects(
      dispatchRelease061(options, { api }),
      /Existing 0.6.1/,
    );
    assert.equal(
      calls.some((call) => call.method === "POST"),
      false,
    );
  }
});

test("already-published release for the same immutable source is a no-op", async (t) => {
  const { options, api, calls } = await fixture(t, {
    tagSha: sha,
    release: {
      tag_name: "v0.6.1",
      target_commitish: sha,
      prerelease: true,
      draft: false,
    },
  });
  assert.equal(
    (await dispatchRelease061(options, { api })).state,
    "already-published",
  );
  assert.equal(
    calls.some((call) => call.method === "POST"),
    false,
  );
});

test("matching drafts may resume through the existing publisher", async (t) => {
  const { options, api } = await fixture(t, {
    tagSha: sha,
    release: {
      tag_name: "v0.6.1",
      target_commitish: sha,
      prerelease: true,
      draft: true,
    },
  });
  assert.equal(
    (await dispatchRelease061(options, { api })).state,
    "dispatched",
  );
});

test("does not duplicate a trusted active dispatch for the same source", async (t) => {
  const { options, api, calls } = await fixture(t, {
    active: {
      id: 52,
      head_sha: sha,
      head_branch: "main",
      event: "workflow_dispatch",
      path: ".github/workflows/release.yml",
      status: "in_progress",
      repository: { full_name: repository },
      head_repository: { full_name: repository },
    },
  });
  const result = await dispatchRelease061(options, { api });
  assert.equal(result.state, "already-running");
  assert.equal(
    result.url,
    "https://github.com/wikicho/SciSlide/actions/runs/52",
  );
  assert.equal(
    calls.some((call) => call.method === "POST"),
    false,
  );
});
