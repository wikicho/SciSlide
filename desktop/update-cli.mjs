import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runUpdateCli } from "./update.mjs";

const require = createRequire(import.meta.url);
const agentCommands = new Set([
  "schema",
  "create",
  "inspect",
  "validate",
  "apply",
  "unpack",
  "pack",
  "export",
]);
const agentHelp = `SciSlide CLI

Agent commands: schema, create, inspect, validate, apply, unpack, pack, export.
Run scislide schema for JSON capabilities, object fields and edit operations.
Use scislide --cli <command> to keep unknown commands headless too.
Example: scislide create --title "Research talk" --output talk.scislide
Example: scislide apply talk.scislide --ops edits.json --output revised.scislide
Example: scislide export revised.scislide --format pdf --output talk.pdf
Agent commands return JSON; --ops - and pack - accept JSON from stdin.
`;

function write(output, message) {
  if (typeof output === "function") output(message);
  else output.write(message);
}

/** The packaged launcher uses Electron's Node mode, without a GUI or extra Node install. */
export async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const metadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const explicitAgent = args[0] === "--cli";
  if (explicitAgent) args = args.slice(1);
  if (args.length === 1 && args[0] === "--version") {
    write(
      stdout,
      `${JSON.stringify({ ok: true, protocolVersion: 1, version: dependencies.currentVersion ?? metadata.version })}\n`,
    );
    return 0;
  }
  if (
    !explicitAgent &&
    args.length === 1 &&
    ["--help", "-h"].includes(args[0])
  ) {
    write(stdout, `${agentHelp}\n`);
    return runUpdateCli(["--help"], { stdout, stderr });
  }
  if (explicitAgent || agentCommands.has(args[0])) {
    try {
      const installed = fileURLToPath(new URL("../agent.cjs", import.meta.url));
      const source = fileURLToPath(
        new URL("../dist-cli/agent.cjs", import.meta.url),
      );
      let bundle;
      try {
        await access(installed);
        bundle = installed;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        bundle = source;
      }
      const { runAgentCli } = require(bundle);
      return await runAgentCli(args.length ? args : ["--help"], {
        currentVersion: metadata.version,
        fontsDir: path.join(path.dirname(bundle), "fonts"),
        stdout,
        stderr,
        ...dependencies,
      });
    } catch (error) {
      write(
        stderr,
        `${JSON.stringify({
          ok: false,
          protocolVersion: 1,
          error: {
            code: "CLI_UNAVAILABLE",
            message:
              error.code === "MODULE_NOT_FOUND"
                ? "Agent CLI bundle is missing. Source checkouts require pnpm build:cli; installed apps require a package containing this feature."
                : error.message || String(error),
          },
        })}\n`,
      );
      return 1;
    }
  }
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
