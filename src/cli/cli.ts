import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  buildDeckArchive,
  importFigure,
  MAX_ARCHIVE_BYTES,
  MAX_FIGURE_BYTES,
  readDeckArchive,
  sanitizeSvg,
} from "../lib/persistence";
import { validateDeck, type Deck } from "../lib/model";
import {
  agentSchema,
  applyAgentOperations,
  createAgentDeck,
  inspectDeck,
  validateAgentOperationsInput,
} from "./commands";
import {
  initializeHeadlessDom,
  renderAgentPdf,
  renderAgentSvg,
} from "./render";

const MAX_JSON_BYTES = 160 * 1024 * 1024;
const MAX_OPERATIONS = 1000;
const PROTOCOL_VERSION = 1;
declare const __SCISLIDE_VERSION__: string;
type Output =
  { write(message: string): unknown } | ((message: string) => unknown);
interface Dependencies {
  currentVersion?: string;
  fontsDir: string;
  stdout?: Output;
  stderr?: Output;
  stdin?: AsyncIterable<string | Uint8Array> | string;
}

class CliError extends Error {
  constructor(
    message: string,
    readonly code = "INVALID_ARGUMENT",
    readonly exitCode = 2,
  ) {
    super(message);
  }
}

const commandOptions: Record<string, Record<string, "value" | "boolean">> = {
  schema: {},
  create: {
    title: "value",
    theme: "value",
    layout: "value",
    width: "value",
    height: "value",
    output: "value",
    overwrite: "boolean",
  },
  inspect: { full: "boolean", slide: "value" },
  validate: {},
  apply: {
    ops: "value",
    output: "value",
    "in-place": "boolean",
    overwrite: "boolean",
    "dry-run": "boolean",
    "expect-sha256": "value",
  },
  unpack: { output: "value", overwrite: "boolean" },
  pack: { output: "value", overwrite: "boolean" },
  export: {
    output: "value",
    format: "value",
    slide: "value",
    overwrite: "boolean",
  },
};

export const AGENT_CLI_HELP = `SciSlide agent CLI — no editor window or computer-use automation required.

Usage:
  scislide schema
  scislide create --output talk.scislide [--title TITLE] [--theme scientific] [--layout blank]
  scislide inspect talk.scislide [--full] [--slide ID_OR_NUMBER]
  scislide validate talk.scislide
  scislide apply talk.scislide --ops edits.json --output edited.scislide
  scislide apply talk.scislide --ops - --in-place [--expect-sha256 HASH]
  scislide apply talk.scislide --ops edits.json --dry-run
  scislide unpack talk.scislide --output deck.json
  scislide pack deck.json --output talk.scislide
  scislide export talk.scislide --format svg --slide 1 --output slide.svg
  scislide export talk.scislide --format pdf --output talk.pdf

Prefix a command with --cli to keep even unknown commands headless.
Commands return one JSON result on stdout; failures return JSON on stderr.
Slide numbers start at 1. Stable IDs are also accepted.
--ops - and pack - read JSON from stdin. Output files require --overwrite to replace.
Use schema to discover native objects, layouts and atomic edit operations.
`;

function write(output: Output, message: string) {
  if (typeof output === "function") output(message);
  else output.write(message);
}

function json(output: Output, value: unknown) {
  write(output, `${JSON.stringify(value)}\n`);
}

function parseArguments(args: string[]) {
  const command = args[0];
  if (!Object.hasOwn(commandOptions, command))
    throw new CliError(
      `Unknown command: ${String(command)}. Run scislide schema or --help.`,
    );
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let index = 1; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      if (argument.startsWith("-") && argument !== "-")
        throw new CliError(`Unknown option: ${argument}`);
      positional.push(argument);
      continue;
    }
    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(argument);
    if (!match || !Object.hasOwn(commandOptions[command], match[1]))
      throw new CliError(`Unknown ${command} option: ${argument}`);
    const [, name, inline] = match;
    if (Object.hasOwn(options, name))
      throw new CliError(`Duplicate option: --${name}`);
    if (commandOptions[command][name] === "boolean") {
      if (inline !== undefined)
        throw new CliError(`--${name} does not take a value.`);
      options[name] = true;
    } else {
      const value = inline ?? args[++index];
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.startsWith("--") ||
        value.includes("\0")
      )
        throw new CliError(`--${name} requires a value.`);
      options[name] = value;
    }
  }
  const expected = ["schema", "create"].includes(command) ? 0 : 1;
  if (positional.length !== expected)
    throw new CliError(
      `${command} requires ${expected ? "exactly one input file" : "no positional input file"}.`,
    );
  return { command, options, input: positional[0] };
}

function value(
  options: Record<string, string | boolean>,
  key: string,
): string | undefined {
  return typeof options[key] === "string"
    ? (options[key] as string)
    : undefined;
}

function required(
  options: Record<string, string | boolean>,
  key: string,
): string {
  const result = value(options, key);
  if (!result) throw new CliError(`--${key} is required.`);
  return result;
}

function finiteOption(
  options: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const source = value(options, key);
  if (source === undefined) return undefined;
  const result = Number(source);
  if (!Number.isFinite(result))
    throw new CliError(`--${key} must be a finite number.`);
  return result;
}

async function readFileBytes(filename: string, limit: number) {
  const absolute = path.resolve(filename);
  const named = await lstat(absolute);
  if (!named.isFile() || named.isSymbolicLink())
    throw new CliError(
      "Choose a regular input file, not a symlink or directory.",
      "INVALID_INPUT",
      1,
    );
  if (!named.size || named.size > limit)
    throw new CliError(
      `The input file must contain 1 to ${limit} bytes.`,
      "SIZE_LIMIT",
      1,
    );
  const file = await open(
    absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await file.stat();
    if (before.ino !== named.ino || before.dev !== named.dev)
      throw new CliError(
        "The input file changed while being opened.",
        "INPUT_CHANGED",
        1,
      );
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      total += chunk.length;
      if (total > limit)
        throw new CliError(
          "The input grew beyond its size limit.",
          "SIZE_LIMIT",
          1,
        );
      chunks.push(Buffer.from(chunk));
    }
    const after = await file.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new CliError(
        "The input file changed while being read.",
        "INPUT_CHANGED",
        1,
      );
    const bytes = Buffer.concat(chunks);
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      path: absolute,
    };
  } finally {
    await file.close();
  }
}

async function readJson(filename: string, stdin: Dependencies["stdin"]) {
  let bytes: Buffer;
  if (filename === "-") {
    const chunks: Buffer[] = [];
    let total = 0;
    const source =
      typeof stdin === "string" ? [stdin] : (stdin ?? process.stdin);
    for await (const chunk of source) {
      const data = Buffer.from(chunk);
      total += data.length;
      if (total > MAX_JSON_BYTES)
        throw new CliError(
          "JSON input exceeds the 160 MB limit.",
          "SIZE_LIMIT",
          1,
        );
      chunks.push(data);
    }
    bytes = Buffer.concat(chunks);
  } else bytes = (await readFileBytes(filename, MAX_JSON_BYTES)).bytes;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CliError("Input must be valid UTF-8 JSON.", "INVALID_JSON", 1);
  }
}

async function writeFileAtomic(
  filename: string,
  bytes: Uint8Array,
  overwrite: boolean,
  expectedHash?: string,
) {
  const absolute = path.resolve(filename);
  let existing;
  try {
    existing = await lstat(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw new CliError(
      "The output is a symlink or non-file path.",
      "OUTPUT_EXISTS",
      1,
    );
  if (existing && !overwrite)
    throw new CliError(
      "Output already exists. Choose another path or use --overwrite.",
      "OUTPUT_EXISTS",
      1,
    );
  if (
    expectedHash &&
    (!existing ||
      (await readFileBytes(absolute, MAX_JSON_BYTES)).sha256 !== expectedHash)
  )
    throw new CliError(
      "The original file changed before saving. Re-inspect and retry.",
      "INPUT_CHANGED",
      1,
    );
  await mkdir(path.dirname(absolute), { recursive: true });
  const directory = await mkdtemp(
    path.join(path.dirname(absolute), ".scislide-cli-"),
  );
  try {
    await chmod(directory, 0o700);
    const staged = path.join(directory, "output");
    const file = await open(
      staged,
      "wx",
      existing ? existing.mode & 0o777 : 0o600,
    );
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    if (overwrite) {
      let now;
      try {
        now = await lstat(absolute);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (now && (!now.isFile() || now.isSymbolicLink()))
        throw new CliError(
          "The output changed to a non-file path before saving.",
          "OUTPUT_EXISTS",
          1,
        );
      if (
        expectedHash &&
        (!now ||
          (await readFileBytes(absolute, MAX_JSON_BYTES)).sha256 !==
            expectedHash)
      )
        throw new CliError(
          "The original file changed before saving. Re-inspect and retry.",
          "INPUT_CHANGED",
          1,
        );
      await rename(staged, absolute);
    } else await link(staged, absolute);
    return {
      path: absolute,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function slideIndex(deck: Deck, selector: string): number {
  const index = /^\d+$/.test(selector)
    ? Number(selector) - 1
    : deck.slides.findIndex((slide) => slide.id === selector);
  if (!Number.isInteger(index) || index < 0 || index >= deck.slides.length)
    throw new CliError(`Slide not found: ${selector}`, "NOT_FOUND", 1);
  return index;
}

async function loadDeck(filename: string) {
  const input = await readFileBytes(filename, MAX_ARCHIVE_BYTES);
  const deck = await readDeckArchive(
    new Blob([new Uint8Array(input.bytes).buffer]),
  );
  return { ...input, deck };
}

async function archiveBytes(deck: Deck) {
  // Native JSON is an explicit input boundary too; sanitize embedded figures
  // before the source or an exported document can reach a renderer.
  const safe = validateDeck(deck);
  for (const asset of safe.assets) {
    if (asset.mime !== "image/svg+xml") continue;
    const comma = asset.dataUrl.indexOf(",");
    const header = asset.dataUrl.slice(0, comma);
    const payload = asset.dataUrl.slice(comma + 1);
    const source = /;base64$/i.test(header)
      ? new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.from(payload, "base64"),
        )
      : decodeURIComponent(payload);
    asset.dataUrl = `data:image/svg+xml;base64,${Buffer.from(sanitizeSvg(source)).toString("base64")}`;
  }
  const archive = await buildDeckArchive(safe);
  // Reopen through the same editor import boundary before reporting a save.
  await readDeckArchive(archive);
  return new Uint8Array(await archive.arrayBuffer());
}

async function resolveOperations(source: unknown, base: string) {
  const envelope =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : null;
  const operations = Array.isArray(source) ? source : envelope?.operations;
  if (
    !Array.isArray(source) &&
    (!envelope ||
      envelope.version !== 1 ||
      Object.keys(envelope).some(
        (key) => !["version", "operations"].includes(key),
      ))
  )
    throw new CliError(
      "Edit batches require version 1 and only version/operations fields.",
      "INVALID_OPERATIONS",
      1,
    );
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > MAX_OPERATIONS
  )
    throw new CliError(
      "Provide 1 to 1000 edit operations.",
      "INVALID_OPERATIONS",
      1,
    );
  // Validate every shorthand before touching any referenced local file.
  for (const entry of operations) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new CliError(
        "Each edit operation must be an object.",
        "INVALID_OPERATIONS",
        1,
      );
    const operation = entry as Record<string, unknown>;
    if (operation.op !== "asset.add" || !Object.hasOwn(operation, "file"))
      continue;
    if (
      Object.keys(operation).some(
        (key) => !["op", "file", "id", "name"].includes(key),
      ) ||
      typeof operation.file !== "string" ||
      !operation.file.trim() ||
      operation.file.includes("\0")
    )
      throw new CliError(
        "asset.add file shorthand accepts only op, file, id and name.",
        "INVALID_OPERATIONS",
        1,
      );
    if (
      operation.id !== undefined &&
      (typeof operation.id !== "string" ||
        operation.id.length > 128 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(operation.id))
    )
      throw new CliError(
        "asset.add id must be a valid native identifier.",
        "INVALID_OPERATIONS",
        1,
      );
    if (
      operation.name !== undefined &&
      (typeof operation.name !== "string" || operation.name.length > 2000)
    )
      throw new CliError(
        "asset.add name must be text up to 2000 characters.",
        "INVALID_OPERATIONS",
        1,
      );
  }
  const preflight = operations.map((entry, index) => {
    const operation = entry as Record<string, unknown>;
    if (operation.op !== "asset.add" || !Object.hasOwn(operation, "file"))
      return entry;
    return {
      op: "asset.add",
      asset: {
        id: operation.id ?? `file-preflight-${index}`,
        name: operation.name ?? "Local figure",
        mime: "image/png",
        dataUrl: "data:image/png;base64,aA==",
        width: 1,
        height: 1,
      },
    };
  });
  try {
    validateAgentOperationsInput(
      Array.isArray(source)
        ? preflight
        : { ...envelope, operations: preflight },
    );
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : String(error),
      "INVALID_OPERATIONS",
      1,
    );
  }
  const resolved: unknown[] = [];
  for (const entry of operations) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const operation = entry as Record<string, unknown>;
      if (operation.op === "asset.add" && Object.hasOwn(operation, "file")) {
        const filename = path.resolve(base, operation.file as string);
        const { bytes } = await readFileBytes(filename, MAX_FIGURE_BYTES);
        const asset = await importFigure(
          new File([new Uint8Array(bytes).buffer], path.basename(filename)),
        );
        if (operation.id !== undefined) asset.id = operation.id as string;
        if (operation.name !== undefined) asset.name = operation.name as string;
        resolved.push({ op: "asset.add", asset });
        continue;
      }
    }
    resolved.push(entry);
  }
  return Array.isArray(source)
    ? resolved
    : { ...envelope, operations: resolved };
}

export async function runAgentCli(
  args: string[],
  dependencies: Dependencies,
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  if (args.includes("--help") || args.includes("-h")) {
    write(stdout, AGENT_CLI_HELP);
    return 0;
  }
  let command = args[0];
  try {
    const parsed = parseArguments(args);
    command = parsed.command;
    const { options, input } = parsed;
    let result: Record<string, unknown>;
    if (command === "schema") {
      result = {
        version: dependencies.currentVersion,
        schema: agentSchema,
        cli: {
          commands: commandOptions,
          protocolVersion: PROTOCOL_VERSION,
          indexing:
            "Slides and insertion positions are 1-based; stable IDs are also accepted.",
          output:
            "One JSON result on stdout. JSON errors on stderr; exit 2 for argument errors, 1 for failed operations.",
          assetFiles: {
            op: "asset.add",
            file: "plot.svg",
            id: "plot-1",
            name: "Optional display name",
          },
          relativeAssetPaths:
            "Resolved relative to the operations file; stdin operations use the current directory.",
          writes:
            "New files by default. --overwrite replaces an output; --in-place explicitly edits the input with a freshness check.",
        },
      };
    } else {
      if (!dependencies.fontsDir)
        throw new Error("The bundled CLI fonts directory is unavailable.");
      await initializeHeadlessDom({ fontsDir: dependencies.fontsDir });
      if (command === "create") {
        const destination = required(options, "output");
        const requested = {
          title: value(options, "title"),
          theme: value(options, "theme") as NonNullable<
            Parameters<typeof createAgentDeck>[0]
          >["theme"],
          layout: value(options, "layout") as NonNullable<
            Parameters<typeof createAgentDeck>[0]
          >["layout"],
          width: finiteOption(options, "width"),
          height: finiteOption(options, "height"),
        };
        const deck = createAgentDeck(
          Object.fromEntries(
            Object.entries(requested).filter(
              ([, option]) => option !== undefined,
            ),
          ),
        );
        result = {
          ...(await writeFileAtomic(
            destination,
            await archiveBytes(deck),
            !!options.overwrite,
          )),
          deck: inspectDeck(deck),
        };
      } else if (command === "pack") {
        const destination = required(options, "output");
        const deck = validateDeck(await readJson(input, dependencies.stdin));
        result = {
          ...(await writeFileAtomic(
            destination,
            await archiveBytes(deck),
            !!options.overwrite,
          )),
          deck: inspectDeck(deck),
        };
      } else {
        const original = await loadDeck(input);
        const { deck } = original;
        if (command === "inspect") {
          const selector = value(options, "slide");
          const index = selector ? slideIndex(deck, selector) : undefined;
          result = {
            path: original.path,
            sha256: original.sha256,
            deck: options.full ? deck : inspectDeck(deck),
            ...(index !== undefined
              ? { slide: deck.slides[index], slideIndex: index + 1 }
              : {}),
          };
        } else if (command === "validate") {
          result = {
            valid: true,
            path: original.path,
            sha256: original.sha256,
            deck: inspectDeck(deck),
          };
        } else if (command === "unpack") {
          const bytes = Buffer.from(`${JSON.stringify(deck, null, 2)}\n`);
          result = await writeFileAtomic(
            required(options, "output"),
            bytes,
            !!options.overwrite,
          );
        } else if (command === "apply") {
          const operationFile = required(options, "ops");
          const expected = value(options, "expect-sha256");
          if (expected && !/^[a-f0-9]{64}$/i.test(expected))
            throw new CliError(
              "--expect-sha256 requires a 64-character SHA-256 hash.",
            );
          if (expected && original.sha256 !== expected.toLowerCase())
            throw new CliError(
              "The input differs from --expect-sha256. Re-inspect and retry.",
              "INPUT_CHANGED",
              1,
            );
          if (options["in-place"] && options.output)
            throw new CliError("Use --in-place or --output, not both.");
          const output = options["in-place"]
            ? original.path
            : value(options, "output");
          if (!output && !options["dry-run"])
            throw new CliError(
              "apply requires --output, --in-place or --dry-run.",
            );
          if (
            !options["in-place"] &&
            output &&
            path.resolve(output) === original.path
          )
            throw new CliError("Use --in-place when editing the input file.");
          const source = await readJson(operationFile, dependencies.stdin);
          const operations = await resolveOperations(
            source,
            operationFile === "-"
              ? process.cwd()
              : path.dirname(path.resolve(operationFile)),
          );
          const applied = applyAgentOperations(deck, operations);
          const bytes = await archiveBytes(applied.deck);
          result = {
            dryRun: !!options["dry-run"],
            inputSha256: original.sha256,
            results: applied.results,
            deck: inspectDeck(applied.deck),
            ...(options["dry-run"]
              ? {}
              : await writeFileAtomic(
                  output!,
                  bytes,
                  !!options.overwrite || !!options["in-place"],
                  options["in-place"] ? original.sha256 : undefined,
                )),
          };
        } else if (command === "export") {
          const output = required(options, "output");
          const format =
            value(options, "format") ??
            path.extname(output).slice(1).toLowerCase();
          if (!["svg", "pdf"].includes(format))
            throw new CliError("--format must be svg or pdf.");
          if (format === "pdf" && options.slide)
            throw new CliError(
              "PDF exports the entire deck; use --slide with SVG.",
            );
          const index = slideIndex(deck, value(options, "slide") ?? "1");
          const bytes =
            format === "svg"
              ? Buffer.from(
                  await renderAgentSvg(deck, index, {
                    fontsDir: dependencies.fontsDir,
                  }),
                )
              : await renderAgentPdf(deck, { fontsDir: dependencies.fontsDir });
          result = {
            ...(await writeFileAtomic(output, bytes, !!options.overwrite)),
            format,
            slides:
              format === "svg"
                ? [index + 1]
                : deck.slides.map((_, index) => index + 1),
          };
        } else throw new CliError("Unsupported command.");
      }
    }
    json(stdout, {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      command,
      ...result,
    });
    return 0;
  } catch (error) {
    json(stderr, {
      ok: false,
      protocolVersion: PROTOCOL_VERSION,
      command,
      error: {
        code:
          error instanceof CliError
            ? error.code
            : ((error as NodeJS.ErrnoException)?.code ?? "OPERATION_FAILED"),
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return error instanceof CliError ? error.exitCode : 1;
  }
}

// The generated bundle is also a standalone Node CLI. Installed packages call
// its exported runner through their bundled Electron runtime.
if (
  typeof require === "function" &&
  typeof module !== "undefined" &&
  require.main === module
) {
  const args = process.argv.slice(2);
  if (args[0] === "--cli") args.shift();
  if (args.length === 1 && args[0] === "--version") {
    json(process.stdout, {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      version: __SCISLIDE_VERSION__,
    });
  } else {
    runAgentCli(args.length ? args : ["--help"], {
      fontsDir: path.join(__dirname, "fonts"),
      currentVersion: __SCISLIDE_VERSION__,
    })
      .then((code) => {
        process.exitCode = code;
      })
      .catch((error) => {
        json(process.stderr, {
          ok: false,
          protocolVersion: PROTOCOL_VERSION,
          error: {
            code: "CLI_FAILED",
            message: String(error.message || error),
          },
        });
        process.exitCode = 1;
      });
  }
}
