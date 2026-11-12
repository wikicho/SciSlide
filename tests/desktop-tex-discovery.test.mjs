import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverTexBinaries,
  texSearchDirectories,
  linuxTexRuntimeMounts,
} from "../desktop/tex-discovery.mjs";
import { bubblewrapArgs } from "../desktop/tex.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scislide-tex-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const installation = path.join(home, "texlive", "2026");
  const bin = path.join(installation, "bin", "x86_64-linux");
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(installation, "texmf-dist"));
  for (const name of ["latex", "xelatex", "dvisvgm", "kpsewhich"])
    await writeFile(path.join(bin, name), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
  return { root, home, installation, bin };
}

test("finds a home TeX Live installation with a file manager's minimal PATH", async (t) => {
  const { home, bin } = await fixture(t);
  const directories = await texSearchDirectories({
    platform: "linux",
    home,
    env: { PATH: "/usr/bin:/bin" },
    texliveRoots: [path.join(home, "texlive")],
  });
  assert.ok(directories.includes(bin));
  const paths = await discoverTexBinaries({
    platform: "linux",
    env: { PATH: "/nonexistent" },
    binDirectory: bin,
    texliveRoots: [],
  });
  assert.equal(paths.latex, path.join(bin, "latex"));
  assert.equal(paths.converter, path.join(bin, "dvisvgm"));
  assert.equal(paths.kpsewhich, path.join(bin, "kpsewhich"));
});

test("an explicitly chosen folder or SCISLIDE_TEX_BIN overrides the inherited PATH", async (t) => {
  const { root, bin } = await fixture(t);
  const other = path.join(root, "other installation with spaces");
  await mkdir(other);
  await writeFile(path.join(other, "latex"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  for (const options of [
    { binDirectory: other },
    { env: { PATH: bin, SCISLIDE_TEX_BIN: other } },
  ]) {
    const paths = await discoverTexBinaries({
      platform: "linux",
      env: { PATH: bin },
      texliveRoots: [],
      ...options,
    });
    assert.equal(paths.latex, path.join(other, "latex"));
    assert.equal(paths.converter, path.join(bin, "dvisvgm"));
  }
  const directories = await texSearchDirectories({
    platform: "linux",
    env: { PATH: ":relative:/usr/bin" },
    texliveRoots: [],
  });
  assert.ok(directories.every(path.isAbsolute));
});

test(
  "the Linux worker mounts a custom distribution and passes its bin path without exposing the user's home",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { home, installation, bin } = await fixture(t);
    const paths = await discoverTexBinaries({
      platform: "linux",
      binDirectory: bin,
      texliveRoots: [],
    });
    const mounts = await linuxTexRuntimeMounts(
      paths,
      async (_command, [argument]) => ({
        code: 0,
        output:
          argument === "--var-value=TEXMFROOT"
            ? `${installation}\n`
            : `${installation}/texmf-dist\n`,
      }),
      { home, systemRoots: [] },
    );
    assert.ok(mounts.includes(installation));
    assert.ok(!mounts.includes(home));
    assert.ok(!mounts.includes(path.dirname(home)));
    const args = bubblewrapArgs(
      mounts,
      "/tmp/job",
      paths.latex,
      ["-no-shell-escape", "equation.tex"],
      paths,
    );
    const bind = args.indexOf(installation);
    assert.equal(args[bind - 1], "--ro-bind");
    assert.equal(args[bind + 1], installation);
    const pathIndex = args.indexOf("PATH");
    assert.ok(args[pathIndex + 1].split(":").includes(bin));
    assert.ok(args.includes("--unshare-all"));
    assert.ok(args.includes("--clearenv"));
  },
);

test(
  "broad or symlinked runtime roots cannot expose home directories",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { root, home, bin } = await fixture(t);
    const linked = path.join(root, "texmf-local");
    await symlink(
      home,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    const paths = await discoverTexBinaries({
      platform: "linux",
      binDirectory: bin,
      texliveRoots: [],
    });
    for (const reported of [home, root, "/", "/opt", linked]) {
      const mounts = await linuxTexRuntimeMounts(
        paths,
        async () => ({ code: 0, output: reported }),
        { home, systemRoots: [] },
      );
      assert.ok(!mounts.includes(reported), reported);
      assert.ok(!mounts.includes(home));
    }
  },
);
