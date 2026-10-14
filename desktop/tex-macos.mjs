/** A fail-closed macOS Seatbelt worker for installed system TeX. */
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path/posix";

export const MACOS_MEMORY_LIMIT_BYTES = 805306368;
export const MACOS_RESOURCE_WRAPPER =
  'ulimit -S -t 15 && ulimit -H -t 15 && ulimit -S -f 32768 && ulimit -H -f 32768 && ulimit -S -n 128 && ulimit -H -n 128 && ulimit -S -c 0 && ulimit -H -c 0 || exit 125; exec "$@"';
const executableKeys = new Set(["latex", "xelatex", "converter", "kpsewhich"]);
const shells = ["/bin/sh", "/bin/bash"]; // macOS /bin/sh execs the selected system bash variant.
const baseReadPaths = [
  "/System/Library",
  "/System/Volumes/Preboot/Cryptexes/OS/usr/lib",
  "/System/Volumes/Preboot/Cryptexes/OS/System/Library",
  "/usr/lib",
  "/usr/share",
  "/bin",
  "/Library/Fonts",
  "/Library/TeX",
  "/Network/Library/Fonts",
  "/private/etc/fonts",
  "/private/etc/localtime",
  "/private/var/db/timezone",
  "/private/var/select/sh",
  "/dev/null",
  "/dev/random",
  "/dev/urandom",
];
const within = (filename, root) =>
  filename === root || filename.startsWith(`${root}${path.sep}`);

/** SBPL strings are quoted independently of shell arguments. */
export function seatbeltQuote(value) {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(
      "Sandbox paths must be absolute and contain no control characters.",
    );
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function macosSandboxProfile({
  readRoots,
  writeDirectory,
  executables,
}) {
  const read = [...new Set(readRoots)];
  const commands = [...new Set([...shells, ...executables])];
  return [
    "(version 1)",
    "(deny default)",
    "(allow sysctl-read)",
    "(allow file-read-metadata (vnode-type DIRECTORY))",
    '(allow file-read* (literal "/") (literal "/private/var/select/sh"))', // dyld and the system shell inspect these fixed paths.
    `(allow file-read* ${read.map((root) => `(subpath ${seatbeltQuote(root)})`).join(" ")} (subpath ${seatbeltQuote(writeDirectory)}))`,
    `(allow file-write* (subpath ${seatbeltQuote(writeDirectory)}) (literal "/dev/null"))`,
    `(allow process-exec ${commands.map((command) => `(literal ${seatbeltQuote(command)})`).join(" ")})`,
    // process-fork, network, Mach services, user preferences and all other rights remain denied.
  ].join("\n");
}

export function macosSandboxEnvironment(directory) {
  return {
    PATH: "/Library/TeX/texbin:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    HOME: path.join(directory, "home"),
    TMPDIR: path.join(directory, "tmp"),
    TEXMFHOME: path.join(directory, "texmf-home"),
    TEXMFVAR: path.join(directory, "texmf-var"),
    TEXMFCONFIG: path.join(directory, "texmf-config"),
    TEXMFOUTPUT: directory,
    TEXMFCACHE: path.join(directory, "cache"),
    XDG_CACHE_HOME: path.join(directory, "cache"),
    openin_any: "p",
    openout_any: "p",
    shell_escape: "f",
    MKTEXPK: "0",
    MKTEXTFM: "0",
    MKTEXMF: "0",
    MKTEXFMT: "0",
  };
}

function texTree(filename) {
  const texlive = /^\/usr\/local\/texlive\/(\d{4}(?:basic)?)\//.exec(filename);
  if (texlive) return `/usr/local/texlive/${texlive[1]}`;
  // Homebrew installations use a fixed, root-owned package tree, never a user home.
  const homebrew =
    /^\/(?:opt\/homebrew|usr\/local)\/Cellar\/(?:texlive|basictex|mactex|dvisvgm)\/[^/]+\//.exec(
      filename,
    );
  if (homebrew) return homebrew[0].slice(0, -1);
  return undefined;
}

async function canonicalExisting(filename, executable = false) {
  seatbeltQuote(filename);
  if (executable) await access(filename, constants.X_OK);
  const canonical = await realpath(filename);
  seatbeltQuote(canonical);
  if (executable && !(await stat(canonical)).isFile())
    throw new Error("Sandbox executable must be a regular file.");
  return canonical;
}

function trustedReadRoot(filename) {
  const fixed = [
    "/System/Library",
    "/System/Volumes/Preboot/Cryptexes/OS/usr/lib",
    "/System/Volumes/Preboot/Cryptexes/OS/System/Library",
    "/usr/lib",
    "/usr/share",
    "/bin",
    "/Library/Fonts",
    "/Library/TeX",
    "/Network/Library/Fonts",
    "/private/etc/fonts",
    "/private/var/db/timezone",
  ];
  return (
    fixed.some((root) => within(filename, root)) ||
    [
      "/private/etc/localtime",
      "/private/var/select/sh",
      "/dev/null",
      "/dev/random",
      "/dev/urandom",
    ].includes(filename) ||
    /^\/usr\/local\/texlive\/(?:\d{4}(?:basic)?|texmf-local)(?:\/|$)/.test(
      filename,
    ) ||
    /^\/(?:opt\/homebrew|usr\/local)\/Cellar\/(?:texlive|basictex|mactex|dvisvgm)\/[^/]+(?:\/|$)/.test(
      filename,
    )
  );
}

async function canonicalReadRoot(filename) {
  const canonical = await canonicalExisting(filename);
  if (!trustedReadRoot(canonical))
    throw new Error(
      `Runtime root resolves outside supported system paths: ${filename}`,
    );
  return canonical;
}

async function canonicalJob(directory, config) {
  seatbeltQuote(directory);
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error("Sandbox work directory must be a real directory.");
  const canonical = await realpath(directory);
  seatbeltQuote(canonical);
  const temporaryRoot = await realpath(os.tmpdir());
  if (!within(canonical, temporaryRoot) || canonical === temporaryRoot)
    throw new Error(
      "Sandbox work must use a unique directory inside the system temporary directory.",
    );
  if (
    config.readRoots.some(
      (root) => within(canonical, root) || within(root, canonical),
    )
  )
    throw new Error(
      "Sandbox work directory overlaps a read-only runtime root.",
    );
  return canonical;
}

export async function macosSandboxInvocation({
  config,
  directory,
  command,
  args,
}) {
  if (
    !config ||
    !Array.isArray(config.executables) ||
    !Array.isArray(args) ||
    args.some((value) => typeof value !== "string" || value.includes("\0"))
  )
    throw new Error("Invalid macOS sandbox invocation.");
  const selected = config.executables.find((entry) => entry.path === command);
  if (
    !selected ||
    (await canonicalExisting(command, true)) !== selected.realpath
  )
    throw new Error(
      "The compiler is outside the verified macOS executable allowlist.",
    );
  const canonical = await canonicalJob(directory, config);
  const profile = macosSandboxProfile({
    readRoots: config.readRoots,
    writeDirectory: canonical,
    executables: config.executables.flatMap((entry) => [
      entry.path,
      entry.realpath,
    ]),
  });
  return {
    command: config.sandboxExec,
    args: [
      "-p",
      profile,
      "/bin/sh",
      "-c",
      MACOS_RESOURCE_WRAPPER,
      "scislide-local-tex",
      command,
      ...args,
    ],
    env: macosSandboxEnvironment(canonical),
    cwd: canonical,
    memoryLimitBytes: MACOS_MEMORY_LIMIT_BYTES,
  };
}

async function containmentProbe(config, run) {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), "scislide-macos-isolation-"),
  );
  try {
    const directory = path.join(parent, "work");
    await mkdir(directory, { mode: 0o700 });
    const outside = path.join(parent, "outside-private.txt");
    const escaped = path.join(parent, "outside-written.txt");
    await writeFile(outside, "SciSlide containment canary\n", { mode: 0o600 });
    const canonical = await canonicalJob(directory, config);
    const profile = macosSandboxProfile({
      readRoots: config.readRoots,
      writeDirectory: canonical,
      executables: config.executables.flatMap((entry) => [
        entry.path,
        entry.realpath,
      ]),
    });
    const probe =
      'printf "positive\\n" > "$1/allowed.txt" || exit 31; IFS= read -r value < "$1/allowed.txt" || exit 32; [ "$value" = positive ] || exit 33; if IFS= read -r value < "$2"; then exit 34; fi; if printf outside > "$3"; then exit 35; fi; printf SCISLIDE_CONTAINMENT_OK';
    const result = await run(
      config.sandboxExec,
      [
        "-p",
        profile,
        "/bin/sh",
        "-c",
        MACOS_RESOURCE_WRAPPER,
        "scislide-containment",
        "/bin/sh",
        "-c",
        probe,
        "scislide-probe",
        canonical,
        await realpath(outside),
        escaped,
      ],
      {
        cwd: canonical,
        env: macosSandboxEnvironment(canonical),
        timeout: 3000,
        memoryLimitBytes: MACOS_MEMORY_LIMIT_BYTES,
      },
    );
    if (result.code !== 0 || !result.output.includes("SCISLIDE_CONTAINMENT_OK"))
      throw new Error(
        `Containment checks failed: ${(result.output ?? "").slice(-600)}`,
      );
    if (
      (await readFile(path.join(canonical, "allowed.txt"), "utf8")) !==
      "positive\n"
    )
      throw new Error("Sandbox positive file probe failed.");
    try {
      await lstat(escaped);
      throw new Error("Sandbox wrote outside its work directory.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const dataAlias = `/System/Volumes/Data${await realpath(outside)}`;
    try {
      await access(dataAlias);
      const aliasProbe = await run(
        config.sandboxExec,
        [
          "-p",
          profile,
          "/bin/sh",
          "-c",
          MACOS_RESOURCE_WRAPPER,
          "scislide-alias-probe",
          "/bin/sh",
          "-c",
          'if IFS= read -r value < "$1"; then printf SCISLIDE_ALIAS_READ; exit 42; fi; printf SCISLIDE_ALIAS_DENIED',
          "scislide-alias",
          dataAlias,
        ],
        {
          cwd: canonical,
          env: macosSandboxEnvironment(canonical),
          timeout: 3000,
          memoryLimitBytes: MACOS_MEMORY_LIMIT_BYTES,
        },
      );
      if (
        aliasProbe.code !== 0 ||
        !aliasProbe.output.includes("SCISLIDE_ALIAS_DENIED")
      )
        throw new Error(
          "Sandbox allowed reading through the system data-volume alias.",
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const deniedExec = await run(
      config.sandboxExec,
      [
        "-p",
        profile,
        "/bin/sh",
        "-c",
        MACOS_RESOURCE_WRAPPER,
        "scislide-exec-probe",
        "/bin/echo",
        "SCISLIDE_FORBIDDEN_EXEC",
      ],
      {
        cwd: canonical,
        env: macosSandboxEnvironment(canonical),
        timeout: 3000,
        memoryLimitBytes: MACOS_MEMORY_LIMIT_BYTES,
      },
    );
    if (
      deniedExec.code === 0 ||
      deniedExec.output.includes("SCISLIDE_FORBIDDEN_EXEC")
    )
      throw new Error("Sandbox allowed an external executable.");
    const forkProbe =
      'printf entered > "$1/fork-parent"; ( printf child > "$1/fork-child" ); printf completed > "$1/fork-parent-done"';
    try {
      await run(
        config.sandboxExec,
        [
          "-p",
          profile,
          "/bin/sh",
          "-c",
          MACOS_RESOURCE_WRAPPER,
          "scislide-fork-probe",
          "/bin/sh",
          "-c",
          forkProbe,
          "scislide-fork",
          canonical,
        ],
        {
          cwd: canonical,
          env: macosSandboxEnvironment(canonical),
          timeout: 1000,
          memoryLimitBytes: MACOS_MEMORY_LIMIT_BYTES,
        },
      );
    } catch (error) {
      if (!/time limit|timeout|timed out/i.test(error.message)) throw error;
    }
    if (
      (await readFile(path.join(canonical, "fork-parent"), "utf8")) !==
      "entered"
    )
      throw new Error("Sandbox fork probe did not start.");
    try {
      await lstat(path.join(canonical, "fork-child"));
      throw new Error("Sandbox allowed a child process.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const rss = await run(
      "/bin/ps",
      ["-o", "rss=", "-p", String(process.pid)],
      { timeout: 3000 },
    );
    if (rss.code !== 0 || !/^\s*\d+\s*$/.test(rss.output))
      throw new Error("macOS RSS monitoring is unavailable.");
    const server = net.createServer((socket) => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = String(server.address().port);
      const network =
        'exec 3<>"/dev/tcp/127.0.0.1/$1" || exit 41; printf SCISLIDE_NETWORK_CONNECTED';
      const control = await run(
        "/bin/sh",
        ["-c", network, "scislide-network-control", port],
        {
          cwd: canonical,
          env: macosSandboxEnvironment(canonical),
          timeout: 3000,
        },
      );
      if (
        control.code !== 0 ||
        !control.output.includes("SCISLIDE_NETWORK_CONNECTED")
      )
        throw new Error("Loopback connection control failed.");
      const deniedNetwork = await run(
        config.sandboxExec,
        [
          "-p",
          profile,
          "/bin/sh",
          "-c",
          MACOS_RESOURCE_WRAPPER,
          "scislide-network-probe",
          "/bin/sh",
          "-c",
          network,
          "scislide-network",
          port,
        ],
        {
          cwd: canonical,
          env: macosSandboxEnvironment(canonical),
          timeout: 3000,
          memoryLimitBytes: MACOS_MEMORY_LIMIT_BYTES,
        },
      );
      if (
        deniedNetwork.code === 0 ||
        deniedNetwork.output.includes("SCISLIDE_NETWORK_CONNECTED")
      )
        throw new Error("Sandbox allowed a network connection.");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    for (const entry of config.executables) {
      const invocation = await macosSandboxInvocation({
        config,
        directory: canonical,
        command: entry.path,
        args: ["--version"],
      });
      const version = await run(invocation.command, invocation.args, {
        ...invocation,
        timeout: 3000,
      });
      if (version.code !== 0 || !version.output.trim())
        throw new Error(
          `The ${entry.name} executable cannot run inside the macOS sandbox.`,
        );
    }
    return {
      fileReadWrite: true,
      outsideReadDenied: true,
      outsideWriteDenied: true,
      externalExecDenied: true,
      forkDenied: true,
      networkDenied: true,
      rssMonitorAvailable: true,
      verifiedExecutableVersions: true,
    };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

/** Only a verified native policy can enable local compilation. */
export async function prepareMacosSandbox({ executables, run }) {
  if (process.platform !== "darwin")
    return { available: false, reason: "The macOS sandbox requires macOS." };
  try {
    if (typeof run !== "function")
      throw new Error("A bounded process runner is required.");
    const sandboxExec = await canonicalExisting("/usr/bin/sandbox-exec", true);
    for (const shell of shells) await canonicalExisting(shell, true);
    const readRoots = [];
    for (const candidate of baseReadPaths) {
      try {
        readRoots.push(await canonicalReadRoot(candidate));
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      }
    }
    const commands = [];
    for (const [name, filename] of Object.entries(executables ?? {})) {
      if (!filename || !executableKeys.has(name)) continue;
      const canonical = await canonicalExisting(filename, true);
      const tree = texTree(canonical);
      if (!tree)
        throw new Error(
          `Unsupported system TeX executable location: ${canonical}`,
        );
      readRoots.push(await canonicalReadRoot(tree));
      commands.push({ name, path: filename, realpath: canonical });
    }
    if (!commands.length)
      throw new Error("No supported system TeX executables were found.");
    try {
      readRoots.push(await canonicalReadRoot("/usr/local/texlive/texmf-local"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const config = {
      sandboxExec,
      readRoots: [...new Set(readRoots)],
      executables: commands,
      memoryLimitBytes: MACOS_MEMORY_LIMIT_BYTES,
      memoryLimitMode: "parent-rss-monitor",
    };
    const probes = await containmentProbe(config, run);
    return { available: true, config, probes };
  } catch (error) {
    return {
      available: false,
      reason: `macOS isolation is unavailable: ${error.message}`,
    };
  }
}
