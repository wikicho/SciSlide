import { packager } from "@electron/packager";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const stage = path.resolve(root, "../../work/electron-stage");
const output = path.resolve(root, "../scislide-desktop");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = JSON.parse(
  await readFile(path.join(root, "node_modules/electron/package.json"), "utf8"),
).version;
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const name of ["dist", "desktop", "third-party-licenses"])
  await cp(path.join(root, name), path.join(stage, name), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.cjs"),
  });
await writeFile(
  path.join(stage, "package.json"),
  JSON.stringify({
    name: pkg.name,
    productName: "SciSlide",
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    private: true,
  }),
);
const apps = await packager({
  dir: stage,
  out: output,
  name: "SciSlide",
  executableName: "scislide",
  platform: process.platform,
  arch: process.arch,
  electronVersion: version,
  overwrite: true,
  asar: true,
  prune: false,
});
for (const app of apps) {
  await cp(path.join(root, "desktop/USAGE.md"), path.join(app, "README.md"));
  await cp(path.join(root, "examples"), path.join(app, "examples"), {
    recursive: true,
  });
  console.log(`Desktop app: ${app}`);
}
