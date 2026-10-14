import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MACOS_MEMORY_LIMIT_BYTES,
  MACOS_RESOURCE_WRAPPER,
  macosSandboxEnvironment,
  macosSandboxInvocation,
  macosSandboxProfile,
  prepareMacosSandbox,
  seatbeltQuote,
} from "../desktop/tex-macos.mjs";
import { runTexProcess } from "../desktop/tex-process.mjs";

function run(command, args, { cwd, env, timeout = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* The process already exited. */
      }
    }, timeout);
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (bytes) => {
        const text = bytes.toString("utf8");
        output += text;
        if (stream === child.stdout) stdout += text;
        else stderr += text;
      });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      timedOut
        ? reject(new Error(`Timed out: ${command}`))
        : resolve({ code, signal, output, stdout, stderr });
    });
  });
}

test("Seatbelt path quoting keeps quotes, slashes and policy text inside one literal", () => {
  const injected = '/private/tmp/job "quoted" \\ (allow default)';
  const quoted = seatbeltQuote(injected);
  assert.equal(JSON.parse(quoted), injected);
  assert.ok(quoted.startsWith('"') && quoted.endsWith('"'));
  assert.match(quoted, /\\"quoted\\"/);
  assert.match(quoted, /\\\\/);
  for (const invalid of ["nul\0path", "line\npath", "line\rpath"])
    assert.throws(
      () => seatbeltQuote(invalid),
      /path|control|invalid|character/i,
    );
});

test("macOS job environment uses only private writable homes and disables TeX execution", () => {
  const directory = "/private/tmp/scislide-tex-test";
  const env = macosSandboxEnvironment(directory);
  for (const key of [
    "HOME",
    "TEXMFHOME",
    "TEXMFVAR",
    "TEXMFCONFIG",
    "TEXMFOUTPUT",
    "TMPDIR",
    "XDG_CACHE_HOME",
  ])
    assert.ok(
      env[key] === directory || env[key].startsWith(`${directory}/`),
      `${key}: ${env[key]}`,
    );
  assert.equal(env.openin_any, "p");
  assert.equal(env.openout_any, "p");
  assert.equal(env.shell_escape, "f");
  for (const key of ["MKTEXPK", "MKTEXTFM", "MKTEXMF", "MKTEXFMT"])
    assert.equal(env[key], "0");
  for (const key of [
    "NODE_OPTIONS",
    "DYLD_INSERT_LIBRARIES",
    "TEXINPUTS",
    "BIBINPUTS",
    "OPENAI_API_KEY",
  ])
    assert.equal(Object.hasOwn(env, key), false);
});

test("macOS policy grants writes only to the job and execution only to exact binaries", () => {
  const directory = '/private/tmp/job "quoted" \\ tree';
  const binaries = ["/usr/bin/kpsewhich", "/bin/sh"];
  const profile = macosSandboxProfile({
    readRoots: ["/System/Library", "/usr/lib", "/usr/share"],
    writeDirectory: directory,
    executables: binaries,
  });
  assert.match(profile, /\(version 1\)/);
  assert.match(profile, /\(deny default\)/);
  assert.ok(profile.includes(seatbeltQuote(directory)));
  for (const binary of binaries)
    assert.ok(profile.includes(seatbeltQuote(binary)));
  assert.doesNotMatch(
    profile,
    /\(allow\s+(?:default|network\S*|process-fork)\b/,
  );
  assert.doesNotMatch(profile, /\(allow\s+process-exec\s+\(subpath/);
  assert.doesNotMatch(
    profile,
    /\(allow\s+file-write\S*\s+\(subpath\s+"\/(?:Users|tmp|private\/tmp)"/,
  );
});

test(
  "macOS sandbox invocation rejects missing jobs and unapproved executables",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "scislide-tex-macos-paths-"),
    );
    try {
      const directory = await realpath(root);
      const command = "/bin/sh";
      const config = {
        sandboxExec: "/usr/bin/sandbox-exec",
        readRoots: ["/usr", "/System"],
        executables: [{ path: command, realpath: await realpath(command) }],
      };
      await assert.rejects(
        macosSandboxInvocation({
          config,
          directory,
          command: "/bin/echo",
          args: ["escape"],
        }),
        /executable|command|allow|approved|configuration/i,
      );
      await assert.rejects(
        macosSandboxInvocation({
          config,
          directory: path.join(directory, "missing"),
          command,
          args: [],
        }),
        /directory|ENOENT|configuration/i,
      );
      const linked = path.join(directory, "linked-job");
      const actual = path.join(directory, "actual-job");
      await mkdir(actual);
      await symlink(actual, linked);
      await assert.rejects(
        macosSandboxInvocation({
          config,
          directory: linked,
          command,
          args: [],
        }),
        /real directory|symlink|symbolic/i,
      );
      const invocation = await macosSandboxInvocation({
        config,
        directory: actual,
        command,
        args: ["-c", "printf safe"],
      });
      assert.equal(invocation.command, config.sandboxExec);
      assert.equal(invocation.cwd, await realpath(actual));
      assert.deepEqual(invocation.args.slice(-3), [
        command,
        "-c",
        "printf safe",
      ]);
      assert.equal(invocation.memoryLimitBytes, MACOS_MEMORY_LIMIT_BYTES);
      assert.equal(
        invocation.env.HOME,
        path.join(await realpath(actual), "home"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("macOS sandbox never enables an installation with an unverified executable", async () => {
  let launches = 0;
  const result = await prepareMacosSandbox({
    executables: { latex: "/definitely-not-a-tex-installation/latex" },
    run: async () => {
      launches++;
      return { code: 0, signal: null, output: "SCISLIDE_CONTAINMENT_OK" };
    },
  });
  assert.equal(result.available, false);
  assert.equal(typeof result.reason, "string");
  assert.equal(result.config, undefined);
  assert.equal(launches, 0);
});

test(
  "approved executable paths cannot be retargeted through a symlink",
  { skip: process.platform === "win32" },
  async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "scislide-tex-macos-retarget-")),
    );
    try {
      const command = path.join(root, "approved-command");
      await symlink("/bin/sh", command);
      const config = {
        sandboxExec: "/usr/bin/sandbox-exec",
        readRoots: ["/usr", "/System"],
        executables: [{ path: command, realpath: await realpath(command) }],
      };
      await rm(command);
      await symlink("/bin/echo", command);
      await assert.rejects(
        macosSandboxInvocation({ config, directory: root, command, args: [] }),
        /verified|allowlist|executable/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

// A small native process avoids a false positive from an interpreter's missing
// imports: each probe reaches the OS operation and reports its exact errno.
const nativeProbeSource = String.raw`
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
static void result(int denied, int error) { printf("{\"denied\":%s,\"errno\":%d}\n", denied ? "true" : "false", error); }
int main(int argc, char **argv) {
  if (argc < 2) return 64;
  if (!strcmp(argv[1], "read") || !strcmp(argv[1], "write")) {
    int fd = open(argv[2], !strcmp(argv[1], "read") ? O_RDONLY : (O_WRONLY | O_CREAT | O_TRUNC), 0600);
    int error = errno;
    if (fd >= 0) { if (!strcmp(argv[1], "write")) write(fd, "PROBE_WRITE", 11); close(fd); }
    result(fd < 0 && (error == EACCES || error == EPERM), error); return 0;
  }
  if (!strcmp(argv[1], "network") || !strcmp(argv[1], "unix")) {
    int local = !strcmp(argv[1], "unix");
    int fd = socket(local ? AF_UNIX : AF_INET, SOCK_STREAM, 0);
    int status = -1;
    if (fd >= 0 && local) { struct sockaddr_un address = {0}; address.sun_family = AF_UNIX; snprintf(address.sun_path, sizeof(address.sun_path), "%s", argv[2]); status = connect(fd, (struct sockaddr *)&address, sizeof(address)); }
    if (fd >= 0 && !local) { struct sockaddr_in address = {0}; address.sin_family = AF_INET; address.sin_port = htons(atoi(argv[2])); address.sin_addr.s_addr = htonl(INADDR_LOOPBACK); status = connect(fd, (struct sockaddr *)&address, sizeof(address)); }
    int error = errno; if (fd >= 0) close(fd); result(status < 0 && (error == EACCES || error == EPERM), error); return 0;
  }
  if (!strcmp(argv[1], "exec")) { execl("/bin/echo", "echo", "UNAPPROVED_EXEC", NULL); int error = errno; result(error == EACCES || error == EPERM, error); return 0; }
  if (!strcmp(argv[1], "fork")) { pid_t pid = fork(); int error = errno; if (!pid) _exit(0); if (pid > 0) waitpid(pid, NULL, 0); result(pid < 0 && (error == EACCES || error == EPERM), error); return 0; }
  if (!strcmp(argv[1], "limits")) {
    struct rlimit cpu, files, descriptors, core;
    getrlimit(RLIMIT_CPU, &cpu); getrlimit(RLIMIT_FSIZE, &files); getrlimit(RLIMIT_NOFILE, &descriptors); getrlimit(RLIMIT_CORE, &core);
    printf("{\"cpu\":%llu,\"fileBytes\":%llu,\"descriptors\":%llu,\"core\":%llu}\n", (unsigned long long)cpu.rlim_cur, (unsigned long long)files.rlim_cur, (unsigned long long)descriptors.rlim_cur, (unsigned long long)core.rlim_cur); return 0;
  }
  if (!strcmp(argv[1], "large-file")) { int fd = open(argv[2], O_WRONLY | O_CREAT | O_TRUNC, 0600); if (fd < 0) return 65; char data[4096] = {0}; for (int i = 0; i < 10240; ++i) if (write(fd, data, sizeof(data)) < 0) return 66; close(fd); return 0; }
  return 64;
}
`;

test(
  "native macOS Seatbelt denies host/home/symlink/network/exec/fork and enforces resource bounds",
  { skip: process.platform !== "darwin" },
  async (context) => {
    try {
      await access("/usr/bin/clang");
    } catch {
      context.skip(
        "Native policy probes require the macOS Command Line Tools C compiler.",
      );
      return;
    }
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "scislide-tex-macos-native-")),
    );
    const home = await mkdtemp(path.join(os.homedir(), ".scislide-tex-test-"));
    const directory = path.join(root, 'job "quoted" \\ tree');
    const executable = path.join(root, "policy-probe");
    const outside = path.join(root, "outside.txt");
    const privateFile = path.join(home, "private.txt");
    const link = path.join(directory, "outside-link");
    let tcpServer, unixServer;
    try {
      await mkdir(directory);
      await writeFile(outside, "HOST_SENTINEL");
      await writeFile(privateFile, "PRIVATE_SENTINEL");
      await symlink(outside, link);
      const source = path.join(root, "policy-probe.c");
      await writeFile(source, nativeProbeSource);
      const compiled = await run("/usr/bin/clang", [source, "-o", executable], {
        timeout: 30_000,
      });
      assert.equal(compiled.code, 0, compiled.output);
      const profile = macosSandboxProfile({
        readRoots: [
          "/System/Library",
          "/usr/lib",
          "/usr/share",
          "/bin",
          "/System/Volumes/Preboot/Cryptexes/OS/usr/lib",
          "/System/Volumes/Preboot/Cryptexes/OS/System/Library",
          executable,
        ],
        writeDirectory: directory,
        executables: ["/bin/sh", executable],
      });
      const invoke = (mode, argument) =>
        run(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            profile,
            "/bin/sh",
            "-c",
            MACOS_RESOURCE_WRAPPER,
            "scislide-tex",
            executable,
            mode,
            ...(argument === undefined ? [] : [argument]),
          ],
          { cwd: directory, env: macosSandboxEnvironment(directory) },
        );
      const check = async (mode, argument, denied = true) => {
        const output = await invoke(mode, argument);
        assert.equal(output.code, 0, output.output);
        const value = JSON.parse(output.stdout);
        assert.equal(value.denied, denied, `${mode}: ${output.output}`);
        return value;
      };
      await check("read", outside);
      await check("read", privateFile);
      await check("read", link);
      let checkedDataAliases = 0;
      for (const filename of [outside, privateFile]) {
        const alias = `/System/Volumes/Data${filename}`;
        try {
          await access(alias);
        } catch (error) {
          if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
          throw error;
        }
        await check("read", alias);
        checkedDataAliases++;
      }
      context.diagnostic(
        `Denied ${checkedDataAliases} existing APFS Data-volume file aliases.`,
      );
      await check("write", outside);
      await check("write", privateFile);
      const ownOutput = path.join(directory, "allowed.txt");
      await check("write", ownOutput, false);
      assert.equal(await readFile(ownOutput, "utf8"), "PROBE_WRITE");
      let tcpConnections = 0;
      tcpServer = net.createServer((socket) => {
        tcpConnections++;
        socket.destroy();
      });
      await new Promise((resolve, reject) => {
        tcpServer.once("error", reject);
        tcpServer.listen(0, "127.0.0.1", resolve);
      });
      await check("network", String(tcpServer.address().port));
      assert.equal(tcpConnections, 0);
      let unixConnections = 0;
      const socketPath = path.join(root, "server.sock");
      unixServer = net.createServer((socket) => {
        unixConnections++;
        socket.destroy();
      });
      await new Promise((resolve, reject) => {
        unixServer.once("error", reject);
        unixServer.listen(socketPath, resolve);
      });
      await check("unix", socketPath);
      assert.equal(unixConnections, 0);
      await check("exec");
      await check("fork");
      const effective = await invoke("limits");
      assert.equal(effective.code, 0, effective.output);
      const limits = JSON.parse(effective.stdout);
      assert.ok(limits.cpu > 0 && limits.cpu <= 15, effective.output);
      assert.ok(
        limits.fileBytes > 0 && limits.fileBytes <= 32 * 1024 * 1024,
        effective.output,
      );
      assert.ok(
        limits.descriptors > 0 && limits.descriptors <= 128,
        effective.output,
      );
      assert.equal(limits.core, 0);
      const largeFile = path.join(directory, "limited.bin");
      const large = await invoke("large-file", largeFile);
      assert.ok(large.code !== 0 || large.signal);
      assert.ok((await stat(largeFile)).size <= limits.fileBytes);
      assert.equal(await readFile(outside, "utf8"), "HOST_SENTINEL");
      assert.equal(await readFile(privateFile, "utf8"), "PRIVATE_SENTINEL");
    } finally {
      for (const server of [tcpServer, unixServer])
        if (server) await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  },
);

test(
  "macOS resident-memory watchdog kills only its worker at a small deterministic bound",
  { skip: process.platform !== "darwin" },
  async () => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    const job = {};
    const pending = runTexProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        env,
        job,
        timeout: 5_000,
        memoryLimitBytes: 1024 * 1024,
      },
    );
    const pid = job.child.pid;
    await assert.rejects(pending, /memory limit/);
    assert.equal(job.child, undefined);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    const ordinary = await runTexProcess(
      process.execPath,
      ["-e", "console.log('ordinary-worker')"],
      {
        env,
        timeout: 5_000,
        memoryLimitBytes: MACOS_MEMORY_LIMIT_BYTES,
      },
    );
    assert.equal(ordinary.code, 0);
    assert.match(ordinary.output, /ordinary-worker/);
  },
);
