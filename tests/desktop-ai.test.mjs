import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AI_LIMITS,
  AI_SCHEMA,
  childEnvironment,
  createAiHost,
  generationPrompt,
  parseAiOutput,
  prepareGeminiHome,
  providerCompatibility,
  unwrapNpmShim,
  validateAiRequest,
} from "../desktop/ai.mjs";

const codexHelp =
  "--ignore-user-config --ignore-rules --ephemeral --sandbox --output-schema --json --config --strict-config --skip-git-repo-check --color";
const claudeHelp =
  "--safe-mode --restricted --print --tools --disallowedTools --strict-mcp-config --mcp-config --no-session-persistence --setting-sources --settings --output-format --json-schema";
const geminiHelp =
  "--extensions --allowed-mcp-server-names --output-format --prompt --approval-mode";
const request = (extra = {}) => ({
  jobId: "test-ai-123",
  provider: "codex",
  prompt: "Explain an expanding universe",
  slideCount: 1,
  ...extra,
});
const deck = {
  title: "Expanding universe",
  slides: [
    {
      title: "Hubble expansion",
      bullets: [
        "A larger distance corresponds to a larger recession velocity.",
      ],
      equation: "v=H_0d",
      notes: "A conceptual illustration, not a measurement.",
    },
  ],
};

async function fixture(
  t,
  generation = "normal",
  { providers = ["codex"], environment = {} } = {},
) {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "scislide-ai-test-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = path.join(directory, "fixture-cli.cjs");
  await writeFile(
    script,
    `
    const { spawn } = require('node:child_process');
    const provider = process.argv[2];
    const args = process.argv.slice(3);
    const versions = {codex:'codex-cli 0.160.0', claude:'2.1.300 (Claude Code)', gemini:'0.62.0'};
    const help = ${JSON.stringify({ codex: codexHelp, claude: claudeHelp, gemini: geminiHelp })};
    if (args.includes('--version')) { console.log(versions[provider]); process.exit(0); }
    if (args.includes('--help')) { console.log(help[provider]); process.exit(0); }
    let input = '';
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      const mode = ${JSON.stringify(generation)};
      if (mode === 'wait') { process.stdout.write('waiting\\n'); setInterval(() => {}, 1000); return; }
      if (mode === 'tree') {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
        process.stdout.write('descendant:' + child.pid + '\\n');
        setInterval(() => {}, 1000); return;
      }
      if (mode === 'stdout') { process.stdout.write(Buffer.alloc(${AI_LIMITS.stdout + 1}, 65)); setInterval(() => {}, 1000); return; }
      if (mode === 'stderr') { process.stderr.write(Buffer.alloc(${AI_LIMITS.stderr + 1}, 65)); setInterval(() => {}, 1000); return; }
      if (mode === 'failure') { process.stderr.write('private-diagnostic-marker'); process.exit(2); }
      const deck = ${JSON.stringify(deck)};
      if (provider === 'codex') { console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(deck)}})); console.log(JSON.stringify({type:'turn.completed'})); }
      if (provider === 'claude') console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:deck}));
      if (provider === 'gemini') console.log(JSON.stringify({response:JSON.stringify(deck),stats:{}}));
    });
  `,
  );
  const calls = [];
  const env = {
    ...process.env,
    HOME: directory,
    USERPROFILE: directory,
    ...environment,
  };
  const host = createAiHost({
    temporaryRoot: directory,
    home: directory,
    env,
    resolveCommand: async ({ id }) =>
      providers.includes(id)
        ? { command: process.execPath, prefixArgs: [script, id] }
        : null,
    geminiSystemConfigurationPresent: async () => false,
    spawn: (command, args, options) => {
      const child = spawn(command, args, options);
      const call = { command, args, options, child, input: "", output: "" };
      child.stdout?.on("data", (bytes) => {
        call.output += bytes;
      });
      const originalEnd = child.stdin?.end.bind(child.stdin);
      if (originalEnd)
        child.stdin.end = (input, ...rest) => {
          call.input = String(input);
          return originalEnd(input, ...rest);
        };
      if (args.includes("--output-schema"))
        call.schema = JSON.parse(
          readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"),
        );
      if (options.env.GEMINI_CLI_HOME && args.includes("--prompt"))
        call.geminiSettings = JSON.parse(
          readFileSync(
            path.join(options.env.GEMINI_CLI_HOME, ".gemini/settings.json"),
            "utf8",
          ),
        );
      calls.push(call);
      return child;
    },
  });
  return { directory, host, calls, env, script };
}

test("AI IPC rejects executable controls, invalid job IDs and oversized input", () => {
  assert.deepEqual(validateAiRequest(request()), { ...request(), context: "" });
  for (const invalid of [
    request({ command: "/bin/sh" }),
    request({ args: ["-c", "anything"] }),
    request({ jobId: "../outside" }),
    request({ jobId: "-1" }),
    request({ provider: "shell" }),
    request({ prompt: " " }),
    request({ prompt: "a".repeat(AI_LIMITS.prompt + 1) }),
    request({ prompt: "topic\0" }),
    request({ slideCount: 0 }),
    request({ slideCount: 13 }),
    request({ slideCount: 1.5 }),
    request({ context: "a".repeat(AI_LIMITS.context + 1) }),
    request({ context: {} }),
    null,
  ])
    assert.throws(() => validateAiRequest(invalid));
});

test("the content schema requires every field and input escapes CLI file references", () => {
  const value = validateAiRequest(
    request({
      prompt: "--dangerous $(echo) @/private/file",
      context: "Use @someone's paper",
    }),
  );
  const prompt = generationPrompt(value);
  assert.equal(prompt.includes("@"), false);
  assert.equal(prompt.includes("\\u0040/private/file"), true);
  const input = JSON.parse(prompt.split("Presentation input: ")[1]);
  assert.equal(input.request, value.prompt);
  assert.equal(input.context, value.context);
  assert.equal(AI_SCHEMA.additionalProperties, false);
  assert.deepEqual(AI_SCHEMA.required, ["title", "slides"]);
  assert.deepEqual(AI_SCHEMA.properties.slides.items.required, [
    "title",
    "bullets",
    "equation",
    "notes",
  ]);
  assert.equal(AI_SCHEMA.properties.slides.items.additionalProperties, false);
});

test("providers fail closed without reviewed CLI controls", () => {
  assert.equal(
    providerCompatibility("codex", "codex-cli 0.160.0", codexHelp).restriction,
    "read-only",
  );
  assert.equal(
    providerCompatibility("codex", "codex-cli 0.159.0", codexHelp).available,
    false,
  );
  assert.equal(
    providerCompatibility("codex", "codex-cli 0.161.0", codexHelp).available,
    false,
  );
  assert.equal(
    providerCompatibility("codex", "codex-cli 0.160.0", "--json").available,
    false,
  );
  assert.equal(
    providerCompatibility("claude", "2.1.300", claudeHelp).restriction,
    "no-tools",
  );
  assert.equal(
    providerCompatibility(
      "claude",
      "2.1.300",
      claudeHelp.replace("--disallowedTools", ""),
    ).available,
    false,
  );
  assert.equal(
    providerCompatibility("gemini", "0.62.0", geminiHelp).restriction,
    "no-tools",
  );
  assert.equal(
    providerCompatibility("gemini", "0.63.0", geminiHelp).available,
    false,
  );
});

test("CLI detection probes only version/help and removes its private directory", async (t) => {
  const { directory, host, calls } = await fixture(t);
  const result = await host.detectAi();
  assert.equal(
    result.providers[0].available,
    true,
    JSON.stringify(calls.map(({ args, output }) => ({ args, output }))),
  );
  assert.equal(result.providers[1].available, false);
  assert.match(result.providers[1].reason, /not found/);
  assert.equal(
    result.providers.some((provider) => "launcher" in provider),
    false,
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.args.slice(2)),
    [["--version"], ["exec", "--help"]],
  );
  assert.equal(
    (await readdir(directory)).some((entry) =>
      entry.startsWith("scislide-ai-detect-"),
    ),
    false,
  );
});

test("Codex content uses fixed read-only argv, stdin, bounded output and provider-specific auth", async (t) => {
  const { directory, host, calls } = await fixture(t, "normal", {
    environment: {
      OPENAI_API_KEY: "test-openai",
      ANTHROPIC_API_KEY: "test-anthropic",
      GEMINI_API_KEY: "test-gemini",
      NODE_OPTIONS: "--require /must-not-load",
      GEMINI_CLI_TRUST_WORKSPACE: "true",
    },
  });
  const topic = "--output=/outside ; $(command) @/private/document";
  const result = await host.generateAi(request({ prompt: topic }));
  assert.deepEqual(JSON.parse(result.text), deck);
  const call = calls.find((entry) => entry.args.includes("--output-schema"));
  assert.equal(call.options.shell, false);
  assert.equal(call.args.includes(topic), false);
  assert.equal(call.args[call.args.indexOf("--sandbox") + 1], "read-only");
  assert.ok(call.args.includes('approval_policy="never"'));
  assert.ok(call.args.includes("features.shell_tool=false"));
  assert.ok(call.args.includes("features.hooks=false"));
  assert.ok(call.args.includes("features.plugins=false"));
  assert.ok(call.args.includes("--ignore-user-config"));
  assert.ok(call.args.includes("--strict-config"));
  assert.equal(call.args.at(-1), "-");
  assert.deepEqual(call.schema, AI_SCHEMA);
  assert.equal(call.options.env.OPENAI_API_KEY, "test-openai");
  assert.equal(call.options.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(call.options.env.GEMINI_API_KEY, undefined);
  assert.equal(call.options.env.NODE_OPTIONS, undefined);
  assert.equal(call.options.env.GEMINI_CLI_TRUST_WORKSPACE, undefined);
  assert.equal(call.input.includes("\\u0040/private/document"), true);
  await assert.rejects(access(call.options.cwd), { code: "ENOENT" });
  assert.deepEqual(await readdir(directory), ["fixture-cli.cjs"]);
});

test("Claude generation disables built-in tools, MCP, customizations and transcript persistence", async (t) => {
  const { host, calls } = await fixture(t, "normal", { providers: ["claude"] });
  const result = await host.generateAi(request({ provider: "claude" }));
  assert.deepEqual(JSON.parse(result.text), deck);
  const call = calls.find((entry) => entry.args.includes("--print"));
  assert.equal(call.args[call.args.indexOf("--tools") + 1], "");
  assert.equal(call.args[call.args.indexOf("--disallowedTools") + 1], "mcp__*");
  assert.equal(call.args[call.args.indexOf("--setting-sources") + 1], "");
  for (const flag of [
    "--restricted",
    "--safe-mode",
    "--strict-mcp-config",
    "--no-session-persistence",
  ])
    assert.ok(call.args.includes(flag));
  assert.equal(call.options.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY, "1");
});

test("Gemini uses a private no-tools configuration and sends user text through stdin", async (t) => {
  const { directory, host, calls } = await fixture(t, "normal", {
    providers: ["gemini"],
    environment: {
      GEMINI_API_KEY: "test-only",
      OPENAI_API_KEY: "must-not-forward",
    },
  });
  const result = await host.generateAi(
    request({ provider: "gemini", prompt: "Show @/private/file as a title" }),
  );
  assert.deepEqual(JSON.parse(result.text), deck);
  const call = calls.find((entry) => entry.args.includes("--prompt"));
  assert.equal(call.args[call.args.indexOf("--extensions") + 1], "none");
  assert.equal(
    call.args[call.args.indexOf("--allowed-mcp-server-names") + 1],
    "",
  );
  assert.equal(call.input.includes("@"), false);
  assert.equal(
    call.args.some((argument) => argument.includes("/private/file")),
    false,
  );
  assert.deepEqual(call.geminiSettings.tools.core, []);
  assert.equal(call.geminiSettings.hooksConfig.enabled, false);
  assert.equal(call.geminiSettings.tools.discoveryCommand, "");
  assert.equal(call.options.env.OPENAI_API_KEY, undefined);
  assert.equal(call.options.env.GEMINI_API_KEY, "test-only");
  assert.ok(call.options.env.GEMINI_CLI_HOME.startsWith(directory));
  await assert.rejects(access(call.options.env.GEMINI_CLI_HOME), {
    code: "ENOENT",
  });
});

test("Gemini authentication references preserve original files without copying secret bytes", async (t) => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "scislide-gemini-auth-test-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = path.join(directory, "original", ".gemini");
  const work = path.join(directory, "job");
  await mkdir(original, { recursive: true });
  await mkdir(work);
  await writeFile(
    path.join(original, "oauth_creds.json"),
    "opaque-test-authentication",
  );
  await writeFile(
    path.join(original, "google_accounts.json"),
    "opaque-test-account",
  );
  await writeFile(
    path.join(original, "settings.json"),
    '{"hooks":{"SessionStart":["must-not-load"]}}',
  );
  const result = await prepareGeminiHome(work, {
    environment: { GEMINI_CLI_HOME: path.dirname(original) },
    home: directory,
    platform: process.platform,
  });
  const refs = path.join(result.GEMINI_CLI_HOME, ".gemini");
  assert.equal(
    (await stat(path.join(refs, "oauth_creds.json"))).ino,
    (await stat(path.join(original, "oauth_creds.json"))).ino,
  );
  const settings = JSON.parse(
    await readFile(path.join(refs, "settings.json"), "utf8"),
  );
  assert.equal(settings.hooksConfig.enabled, false);
  assert.equal(JSON.stringify(settings).includes("must-not-load"), false);
  await rm(work, { recursive: true, force: true });
  assert.equal(
    await readFile(path.join(original, "oauth_creds.json"), "utf8"),
    "opaque-test-authentication",
  );
});

test("one generation can run at a time; cancellation kills and cleans the job", async (t) => {
  const { directory, host, calls } = await fixture(t, "wait");
  const generation = host.generateAi(request());
  const rejection = assert.rejects(generation, /cancelled/);
  await assert.rejects(
    host.generateAi(request({ jobId: "second" })),
    /already running/,
  );
  await host.cancelAi("test-ai-123");
  await rejection;
  assert.equal(
    (await readdir(directory)).some((entry) =>
      entry.startsWith("scislide-ai-"),
    ),
    false,
  );
  assert.ok(
    calls.every(
      (call) => call.child.exitCode !== null || call.child.signalCode !== null,
    ),
  );
  await host.cancelAi("not-running");
});

test("cancelling an active provider kills its descendant process tree", async (t) => {
  const { directory, host, calls } = await fixture(t, "tree");
  const generation = host.generateAi(request());
  const rejection = assert.rejects(generation, /cancelled/);
  let childId;
  try {
    const deadline = Date.now() + 5_000;
    while (!childId && Date.now() < deadline) {
      const call = calls.find((entry) =>
        entry.args.includes("--output-schema"),
      );
      childId = /descendant:(\d+)/.exec(call?.output || "")?.[1];
      if (!childId) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(
      childId,
      "The test provider must start a descendant before cancellation.",
    );
    assert.doesNotThrow(() => process.kill(Number(childId), 0));
    await host.cancelAi("test-ai-123");
    await rejection;
    let alive = true;
    for (let attempt = 0; attempt < 100 && alive; attempt++) {
      try {
        process.kill(Number(childId), 0);
        // Linux containers can retain a killed orphan as a zombie until init
        // reaps it. Such a process is dead and cannot execute any work.
        if (process.platform === "linux") {
          const status = await readFile(`/proc/${childId}/status`, "utf8");
          if (/^State:\s+Z/m.test(status)) alive = false;
        }
      } catch {
        alive = false;
      }
      if (alive) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      alive,
      false,
      "No provider descendant may continue after cancellation.",
    );
    assert.equal(
      (await readdir(directory)).some((entry) =>
        entry.startsWith("scislide-ai-"),
      ),
      false,
    );
  } finally {
    await host.cancelAllAi();
    await rejection;
  }
});

test("Gemini with system configuration stays unavailable without replacing policy", async (t) => {
  const { directory, script, env } = await fixture(t, "normal", {
    providers: ["gemini"],
  });
  const host = createAiHost({
    temporaryRoot: directory,
    home: directory,
    env,
    resolveCommand: async ({ id }) =>
      id === "gemini"
        ? { command: process.execPath, prefixArgs: [script, id] }
        : null,
    geminiSystemConfigurationPresent: async () => true,
  });
  const detected = await host.detectAi();
  assert.equal(detected.providers[2].available, false);
  assert.match(detected.providers[2].reason, /system-managed settings/);
  await assert.rejects(
    host.generateAi(request({ provider: "gemini" })),
    /system-managed settings/,
  );
});

test("output and diagnostic limits kill provider processes without returning diagnostics", async (t) => {
  for (const mode of ["stdout", "stderr", "failure"]) {
    const { directory, host } = await fixture(t, mode);
    await assert.rejects(host.generateAi(request()), (error) => {
      assert.match(
        error.message,
        mode === "failure" ? /exited with code 2/ : /too much/,
      );
      assert.equal(error.message.includes("private-diagnostic-marker"), false);
      return true;
    });
    assert.equal(
      (await readdir(directory)).some((entry) =>
        entry.startsWith("scislide-ai-"),
      ),
      false,
    );
  }
});

test("a provider timeout cleans its private directory", async (t) => {
  const { directory, script, env } = await fixture(t, "wait");
  const host = createAiHost({
    temporaryRoot: directory,
    home: directory,
    env,
    timeout: 120,
    resolveCommand: async ({ id }) => ({
      command: process.execPath,
      prefixArgs: [script, id],
    }),
  });
  await assert.rejects(host.generateAi(request()), /time limit/);
  assert.equal(
    (await readdir(directory)).some((entry) =>
      entry.startsWith("scislide-ai-"),
    ),
    false,
  );
});

test("provider output extracts only final content and rejects tool actions", () => {
  assert.equal(
    parseAiOutput(
      "codex",
      [
        {
          type: "item.completed",
          item: { type: "error", message: "A startup configuration warning" },
        },
        { type: "item.completed", item: { type: "agent_message", text: "{}" } },
        { type: "turn.completed" },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    ),
    "{}",
  );
  assert.throws(
    () =>
      parseAiOutput(
        "codex",
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "{}" },
        }),
      ),
    /no presentation content/,
  );
  assert.throws(
    () =>
      parseAiOutput(
        "codex",
        JSON.stringify({
          type: "item.started",
          item: { type: "command_execution", command: "secret" },
        }),
      ),
    /unsupported tool action/,
  );
  assert.throws(
    () =>
      parseAiOutput(
        "codex",
        JSON.stringify({ type: "turn.failed", error: { message: "secret" } }),
      ),
    /could not finish/,
  );
  assert.throws(
    () =>
      parseAiOutput(
        "claude",
        JSON.stringify({ is_error: true, result: "secret" }),
      ),
    /could not finish/,
  );
  assert.throws(() => parseAiOutput("claude", "not JSON"), /invalid JSON/);
});

test("Windows npm command shims resolve only their official package entry without a shell", async (t) => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "scislide-ai-shim-test-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const provider = {
    id: "codex",
    packageName: "@openai/codex",
    entry: "bin/codex.js",
  };
  const root = path.join(directory, "node_modules", "@openai", "codex");
  await mkdir(path.join(root, "bin"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@openai/codex", bin: { codex: "bin/codex.js" } }),
  );
  await writeFile(path.join(root, "bin/codex.js"), "// test fixture");
  const shim = path.join(directory, "codex.cmd");
  await writeFile(
    shim,
    '@ECHO off\nSET dp0=%~dp0\nSET "_prog=node"\n"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
  );
  const launcher = await unwrapNpmShim(shim, provider, process.execPath);
  assert.equal(launcher.command, process.execPath);
  assert.deepEqual(launcher.prefixArgs, [
    await realpath(path.join(root, "bin/codex.js")),
  ]);
  await writeFile(shim, "@ECHO off\ncall powershell -Command anything");
  await assert.rejects(
    unwrapNpmShim(shim, provider, process.execPath),
    /recognized npm/,
  );
  assert.equal(
    childEnvironment(
      {
        NODE_OPTIONS: "--eval",
        OPENAI_API_KEY: "key",
        ANTHROPIC_API_KEY: "other",
      },
      "codex",
    ).ANTHROPIC_API_KEY,
    undefined,
  );
});
