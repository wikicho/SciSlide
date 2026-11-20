import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Chromium selects Ozone before Electron loads the application's main process.
// The installed, portable and development launchers use the same GUI arguments.
export const linuxDisplayArguments = `if [ -n "\${DISPLAY:-}" ] && { [ -n "\${WAYLAND_DISPLAY:-}" ] || [ "\${XDG_SESSION_TYPE:-}" = wayland ]; }; then
  scislide_backend=\${ELECTRON_OZONE_PLATFORM_HINT:-x11}
  for scislide_argument in "$@"; do
    case "$scislide_argument" in
      --ozone-platform|--ozone-platform=*) scislide_backend=; break ;;
      --ozone-platform-hint=*) scislide_backend=\${scislide_argument#*=} ;;
      --ozone-platform-hint) scislide_backend= ;;
    esac
  done
  case "$scislide_backend" in
    x11|wayland) set -- "--ozone-platform=$scislide_backend" "$@" ;;
  esac
fi
`;

export function spawnDesktop(binary, args, options) {
  if (process.platform === "linux")
    return spawn(
      "sh",
      ["-c", linuxDisplayArguments + 'exec "$0" "$@"', binary, ...args],
      options,
    );
  return spawn(binary, args, options);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { default: electron } = await import("electron");
  const child = spawnDesktop(electron, [".", ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => child.kill(signal));
}
