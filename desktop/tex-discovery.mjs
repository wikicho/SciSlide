/** Locate installed TeX without depending on a desktop launcher's PATH. */
import { access, readdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

const within = (filename, root) =>
  filename === root || filename.startsWith(`${root}${path.sep}`);

async function children(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort()
      .reverse()
      .slice(0, 32);
  } catch {
    return [];
  }
}

export async function texSearchDirectories({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  binDirectory = env.SCISLIDE_TEX_BIN,
  texliveRoots = [
    "/usr/local/texlive",
    "/opt/texlive",
    path.join(home, "texlive"),
  ],
} = {}) {
  const directories = [
    binDirectory,
    ...(env.PATH || "").split(platform === "win32" ? ";" : ":"),
  ];
  if (platform !== "win32")
    directories.push("/usr/bin", "/bin", "/usr/local/bin");
  if (platform === "darwin")
    directories.push("/Library/TeX/texbin", "/opt/homebrew/bin");
  if (platform === "linux") {
    directories.push(path.join(home, ".local/bin"));
    for (const root of texliveRoots) {
      const installations = [
        root,
        ...(await children(root)).map((name) => path.join(root, name)),
      ];
      for (const installation of installations) {
        const bin = path.join(installation, "bin");
        for (const name of await children(bin)) {
          if (name.endsWith("-linux")) directories.push(path.join(bin, name));
        }
      }
    }
  }
  // Relative/empty PATH components depend on a file manager's working directory.
  return [
    ...new Set(
      directories.filter(
        (entry) => typeof entry === "string" && path.isAbsolute(entry),
      ),
    ),
  ];
}

export async function discoverTexBinaries(options = {}) {
  const directories = await texSearchDirectories(options);
  const platform = options.platform ?? process.platform;
  async function find(name) {
    for (const directory of directories) {
      const filename = path.join(
        directory,
        platform === "win32" ? `${name}.exe` : name,
      );
      try {
        await access(filename, constants.X_OK);
        if ((await stat(filename)).isFile()) return filename;
      } catch {
        /* Try the next installation. */
      }
    }
  }
  const names = [
    "latex",
    "xelatex",
    "dvisvgm",
    "bwrap",
    "prlimit",
    "kpsewhich",
  ];
  const found = Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, await find(name)])),
  );
  return {
    latex: found.latex,
    xelatex: found.xelatex,
    converter: found.dvisvgm,
    bwrap: found.bwrap,
    prlimit: found.prlimit,
    kpsewhich: found.kpsewhich,
  };
}

export function texProbeEnvironment(paths) {
  return {
    PATH: [
      ...new Set(
        Object.values(paths)
          .filter(Boolean)
          .map((filename) => path.dirname(filename))
          .concat(["/usr/bin", "/bin", "/usr/local/bin"]),
      ),
    ].join(path.delimiter),
    HOME: os.homedir(),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
}

/** Only the selected distribution and TeX runtime trees are added to the worker. */
export async function linuxTexRuntimeMounts(
  paths,
  run,
  {
    home = os.homedir(),
    systemRoots = [
      "/usr",
      "/bin",
      "/lib",
      "/lib64",
      "/etc/ld.so.cache",
      "/etc/fonts",
      "/etc/texmf",
      "/var/lib/texmf",
      "/var/cache/fontconfig",
    ],
  } = {},
) {
  const mounts = [];
  async function include(filename) {
    try {
      await access(filename);
      if (!mounts.some((root) => within(filename, root))) mounts.push(filename);
      const canonical = await realpath(filename);
      if (!mounts.some((root) => within(canonical, root)))
        mounts.push(canonical);
    } catch {
      /* Optional runtime path. */
    }
  }
  for (const root of systemRoots) await include(root);
  const protectedRoots = [
    "/",
    "/home",
    "/Users",
    "/opt",
    "/usr/local",
    "/tmp",
    "/var",
    "/etc",
    home,
  ];
  const narrow = (root) =>
    !protectedRoots.some((protectedRoot) => within(protectedRoot, root));
  if (paths.kpsewhich) {
    for (const variable of [
      "TEXMFROOT",
      "TEXMFDIST",
      "TEXMFLOCAL",
      "TEXMFSYSVAR",
      "TEXMFSYSCONFIG",
    ]) {
      try {
        const result = await run(paths.kpsewhich, [`--var-value=${variable}`], {
          timeout: 3_000,
          env: texProbeEnvironment(paths),
        });
        const root = result.output.trim();
        if (
          result.code !== 0 ||
          !path.isAbsolute(root) ||
          /[\0\r\n]/.test(root)
        )
          continue;
        const canonical = await realpath(root);
        if (
          !narrow(root) ||
          !narrow(canonical) ||
          !(await stat(canonical)).isDirectory()
        )
          continue;
        if (variable === "TEXMFROOT") {
          // TeX Live keeps its binaries and texmf-dist together, including custom/home installs.
          if (!(await stat(path.join(canonical, "texmf-dist"))).isDirectory())
            continue;
          const engine = paths.latex || paths.xelatex;
          if (!engine || !within(await realpath(engine), canonical)) continue;
        } else if (!/^texmf(?:[-.]|$)/.test(path.basename(canonical))) continue;
        await include(root);
      } catch {
        /* Ignore unset variables and unavailable TeX trees. */
      }
    }
  }
  // Standalone converters and symlinked command names may live outside the TeX tree.
  for (const name of ["latex", "xelatex", "converter", "kpsewhich"])
    if (paths[name]) await include(paths[name]);
  return mounts;
}

export function linuxTexPath(paths) {
  return texProbeEnvironment(paths).PATH;
}
