/** Bounded TeX subprocesses, including the macOS resident-memory watchdog. */
import { execFile, spawn } from "node:child_process";

const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

export function runTexProcess(
  command,
  args,
  { cwd, env, job, timeout = TIMEOUT_MS, memoryLimitBytes } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env || { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (job) job.child = child;
    let output = "";
    let bytes = 0;
    let failure;
    let exited = false;
    let memoryTimer;
    let memoryProbe;
    const stop = (reason) => {
      failure ||= reason;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* The process may already have exited. */
      }
    };
    const timer = setTimeout(
      () => stop(new Error("Local LaTeX exceeded its 20-second time limit.")),
      timeout,
    );
    if (process.platform === "darwin" && memoryLimitBytes) {
      // macOS shell address-space limits are not portable across supported hosts.
      // Seatbelt denies fork, so the exec'd worker stays at this PID. Sample
      // its resident memory from the parent and kill the group on overflow.
      const checkMemory = () => {
        if (exited || memoryProbe) return;
        memoryProbe = execFile(
          "/bin/ps",
          ["-o", "rss=", "-p", String(child.pid)],
          { timeout: 1_000, maxBuffer: 4_096, env: { PATH: "/usr/bin:/bin" } },
          (error, output) => {
            memoryProbe = undefined;
            if (exited) return;
            if (error || !/^\s*\d+\s*$/.test(output)) {
              try {
                process.kill(child.pid, 0);
              } catch (status) {
                // ps can observe normal process exit before Node emits exit.
                if (status.code === "ESRCH") return;
              }
              stop(new Error("The macOS LaTeX memory monitor is unavailable."));
            } else if (Number(output.trim()) * 1024 > memoryLimitBytes) {
              stop(new Error("Local LaTeX exceeded its 768 MiB memory limit."));
            }
          },
        );
      };
      child.once("spawn", checkMemory);
      memoryTimer = setInterval(checkMemory, 100);
      memoryTimer.unref();
    }
    const stopMonitoring = () => {
      exited = true;
      clearInterval(memoryTimer);
      memoryProbe?.kill();
    };
    child.once("exit", stopMonitoring);
    const collect = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES)
        stop(new Error("Local LaTeX produced too much diagnostic output."));
      else output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => {
      clearTimeout(timer);
      stopMonitoring();
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      stopMonitoring();
      if (job) job.child = undefined;
      if (job?.timedOut)
        reject(new Error("Local LaTeX exceeded its 20-second time limit."));
      else if (job?.cancelled)
        reject(new Error("Local LaTeX compilation was cancelled."));
      else if (failure) reject(failure);
      else resolve({ code, signal, output });
    });
  });
}
