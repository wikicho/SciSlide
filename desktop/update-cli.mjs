import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpdateCli } from "./update.mjs";

/** The packaged launcher uses Electron's Node mode, without a GUI or extra Node install. */
export async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const metadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  return runUpdateCli(args, {
    currentVersion: metadata.version,
    defaultDestination: path.join(
      os.homedir(),
      "Downloads",
      "SciSlide-updates",
    ),
    stdout: process.stdout,
    stderr: process.stderr,
    ...dependencies,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await runCli();
  } catch (error) {
    console.error(`SciSlide update failed: ${error.message || error}`);
    process.exitCode = 1;
  }
}
