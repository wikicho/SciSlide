import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
// Vite already pins esbuild in the lockfile; the CLI shares that build tool.
const { build } = createRequire(require.resolve("vite"))("esbuild");

async function bundleNotices(inputs) {
  const packages = new Map();
  for (const input of Object.keys(inputs)) {
    if (!input.includes("node_modules")) continue;
    let directory = path.dirname(path.resolve(root, input));
    while (directory !== path.dirname(directory)) {
      try {
        const pkg = JSON.parse(
          await readFile(path.join(directory, "package.json"), "utf8"),
        );
        if (pkg.name && pkg.version) {
          packages.set(`${pkg.name}@${pkg.version}`, { directory, pkg });
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      directory = path.dirname(directory);
    }
  }
  const notices = ["SciSlide headless CLI — third-party notices\n"];
  for (const [name, { directory, pkg }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    notices.push(
      `\n${name}\nLicense: ${JSON.stringify(pkg.license ?? pkg.licenses ?? "See package distribution")}\n`,
    );
    const entries = await readdir(directory, { withFileTypes: true });
    const licenses = entries.filter(
      (entry) =>
        entry.isFile() &&
        /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(entry.name),
    );
    if (!licenses.length) {
      // Several MathJax font packages carry the license in a namespaced subdirectory;
      // the repository already ships their complete reviewed license copies.
      const known = {
        "@mathjax/mathjax-fira-font":
          "mathjax-mathjax-fira-font/LICENSE-Apache-2.0",
        "@mathjax/mathjax-stix2-font":
          "mathjax-mathjax-stix2-font/LICENSE-Apache-2.0",
        "@mathjax/mathjax-modern-font":
          "mathjax-mathjax-modern-font/LICENSE-Apache-2.0",
        "@mathjax/mathjax-newcm-font":
          "mathjax-mathjax-modern-font/LICENSE-Apache-2.0",
        saxes: "saxes/LICENSE",
      }[pkg.name];
      if (known)
        notices.push(
          await readFile(
            path.join(root, "third-party-licenses", known),
            "utf8",
          ),
        );
      else {
        const readme = entries.find(
          (entry) => entry.isFile() && /^readme(?:[._-]|$)/i.test(entry.name),
        );
        const text = readme
          ? await readFile(path.join(directory, readme.name), "utf8")
          : "";
        if (!/\blicen[cs]e\b/i.test(text))
          throw new Error(
            `No license notice found for bundled dependency ${name}.`,
          );
        notices.push(`\n${readme.name}\n${text}\n`);
      }
    }
    for (const license of licenses.sort((a, b) => a.name.localeCompare(b.name)))
      notices.push(
        `\n${license.name}\n${await readFile(path.join(directory, license.name), "utf8")}\n`,
      );
  }
  for (const [name, filename] of [
    ["Inter font", "fontsource-inter/LICENSE"],
    ["Nanum Gothic font", "nanum-gothic/OFL.txt"],
  ])
    notices.push(
      `\n${name}\n${await readFile(path.join(root, "third-party-licenses", filename), "utf8")}\n`,
    );
  return notices.join("\n");
}

export async function buildAgentCli({
  outdir = path.join(root, "dist-cli"),
} = {}) {
  await mkdir(outdir, { recursive: true });
  const metadata = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/cli/cli.ts"],
    outfile: path.join(outdir, "agent.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    define: { __SCISLIDE_VERSION__: JSON.stringify(metadata.version) },
    alias: { "svg2pdf.js": require.resolve("svg2pdf.js/dist/svg2pdf.es.js") },
    metafile: true,
    logLevel: "warning",
    plugins: [
      {
        name: "headless-dom",
        setup(builder) {
          builder.onResolve(
            { filter: /^(?:canvas|supports-color|bufferutil|utf-8-validate)$/ },
            ({ path: filename }) => ({
              path: filename,
              namespace: "cli-optional",
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "cli-optional" }, () => ({
            // Each dependency is already a guarded optional require upstream.
            // Keep its normal JS fallback, without loading host native addons.
            contents:
              'throw new Error("Optional native modules are disabled in the SciSlide CLI.");',
            loader: "js",
          }));
          builder.onLoad(
            { filter: /jsdom[/\\]living[/\\]xhr[/\\]XMLHttpRequest-impl\.js$/ },
            async ({ path: filename }) => {
              const source = await readFile(filename, "utf8");
              const worker =
                /require\.resolve\(["']\.\/xhr-sync-worker\.js["']\)/g;
              if (!worker.test(source))
                throw new Error(
                  "The jsdom XHR worker layout changed; review the headless CLI build.",
                );
              // No scripts, remote resources or XMLHttpRequest are enabled in
              // the CLI DOM. Avoid resolving jsdom's unused subprocess worker.
              return { contents: source.replace(worker, "null"), loader: "js" };
            },
          );
          builder.onResolve(
            { filter: /\?raw$/ },
            ({ path: filename, resolveDir }) => ({
              path: path.resolve(resolveDir, filename.slice(0, -4)),
              namespace: "cli-text",
            }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "cli-text" },
            async ({ path: filename }) => ({
              contents: await readFile(filename, "utf8"),
              loader: "text",
            }),
          );
        },
      },
    ],
  });
  const externals = Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports.filter((entry) => entry.external).map((entry) => entry.path),
  );
  const { builtinModules } = await import("node:module");
  const builtins = new Set(
    builtinModules.flatMap((name) => [name, `node:${name}`]),
  );
  if (externals.some((name) => !builtins.has(name)))
    throw new Error(
      `The CLI bundle has an unexpected external dependency: ${externals.join(", ")}`,
    );
  await writeFile(
    path.join(outdir, "THIRD_PARTY_NOTICES.txt"),
    await bundleNotices(result.metafile.inputs),
  );
  await rm(path.join(outdir, "fonts"), { recursive: true, force: true });
  await cp(path.join(root, "public", "fonts"), path.join(outdir, "fonts"), {
    recursive: true,
  });
  await cp(
    path.join(root, "docs", "AGENT_CLI.md"),
    path.join(outdir, "README.md"),
  );
  return {
    bundle: path.join(outdir, "agent.cjs"),
    fonts: path.join(outdir, "fonts"),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await buildAgentCli();
    console.log(`Built agent CLI: ${result.bundle}`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
