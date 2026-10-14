// @vitest-environment node
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentCli } from "../src/cli/cli";
import { readDeckArchive } from "../src/lib/persistence";

// Use the genuine converter's ESM entry in Node, as the CLI bundle does.
vi.mock("svg2pdf.js", () => import("svg2pdf.js/dist/svg2pdf.es.js"));

const directories: string[] = [];
const fontsDir = path.resolve("public/fonts");
async function temporary() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "scislide-agent-test-"),
  );
  directories.push(directory);
  return directory;
}
async function command(args: string[], stdin?: string) {
  let output = "";
  let errors = "";
  const code = await runAgentCli(args, {
    fontsDir,
    currentVersion: "1.2.3",
    stdin,
    stdout: (message) => {
      output += message;
    },
    stderr: (message) => {
      errors += message;
    },
  });
  return {
    code,
    output,
    errors,
    result: output ? JSON.parse(output) : null,
    error: errors ? JSON.parse(errors) : null,
  };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("agent CLI native files", () => {
  it("discovers capabilities with structured output and rejects invalid arguments", async () => {
    const schema = await command(["schema"]);
    expect(schema.code).toBe(0);
    expect(schema.result).toMatchObject({
      ok: true,
      command: "schema",
      protocolVersion: 1,
      version: "1.2.3",
    });
    expect(schema.result.cli.commands).toHaveProperty("apply");
    expect(schema.errors).toBe("");
    const bad = await command(["create", "--unknown"]);
    expect(bad.code).toBe(2);
    expect(bad.output).toBe("");
    expect(bad.error.error.code).toBe("INVALID_ARGUMENT");
    expect((await command(["schema", "unexpected"])).code).toBe(2);
    expect(
      (await command(["create", "--output", "x", "--output", "y"])).code,
    ).toBe(2);
  });

  it("creates, inspects, edits, validates and reopens the editor's native archive", async () => {
    const directory = await temporary();
    const original = path.join(directory, "talk.scislide");
    const edited = path.join(directory, "edited.scislide");
    const created = await command([
      "create",
      "--title",
      "Agent research talk",
      "--layout",
      "blank",
      "--output",
      original,
    ]);
    expect(created.code, created.errors).toBe(0);
    const inspection = await command(["inspect", original, "--full"]);
    const deck = inspection.result.deck;
    const slide = deck.slides[0].id;
    expect(deck.title).toBe("Agent research talk");
    const operations = {
      version: 1,
      operations: [
        {
          op: "object.add",
          slide,
          object: {
            id: "body-1",
            type: "text",
            text: "Something about $U(1)$",
            transform: { x: 80, y: 80, width: 600, height: 120 },
          },
        },
        {
          op: "object.add",
          slide,
          object: {
            id: "eq-1",
            type: "equation",
            latex: "E=mc^2",
            transform: { x: 80, y: 240, width: 500, height: 130 },
          },
        },
        {
          op: "slide.add",
          id: "second-slide",
          layout: "blank",
          title: "Discussion",
          notes: "Explain the symmetry.",
        },
      ],
    };
    const applied = await command(
      ["apply", original, "--ops", "-", "--output", edited],
      JSON.stringify(operations),
    );
    expect(applied.code, applied.errors).toBe(0);
    expect(applied.result.results).toHaveLength(3);
    const bytes = await readFile(edited);
    const reopened = await readDeckArchive(
      new Blob([new Uint8Array(bytes).buffer]),
    );
    expect(reopened.slides).toHaveLength(2);
    expect(reopened.slides[0].objects[0]).toMatchObject({
      id: "body-1",
      type: "text",
      text: "Something about $U(1)$",
    });
    expect(reopened.slides[0].objects[1]).toMatchObject({
      id: "eq-1",
      type: "equation",
      latex: "E=mc^2",
    });
    expect((await command(["validate", edited])).result.valid).toBe(true);
    expect(
      (await command(["inspect", edited, "--slide", "second-slide"])).result
        .slide.title,
    ).toBe("Discussion");
    expect((await command(["inspect", edited, "--slide", "0"])).code).toBe(1);
  });

  it("keeps original bytes intact on invalid edits and dry runs", async () => {
    const directory = await temporary();
    const original = path.join(directory, "talk.scislide");
    await command(["create", "--layout", "blank", "--output", original]);
    const before = await readFile(original);
    const bad = await command(
      ["apply", original, "--ops", "-", "--in-place"],
      JSON.stringify([
        { op: "deck.update", patch: { title: "Must not survive" } },
        { op: "slide.remove", slide: 1 },
      ]),
    );
    expect(bad.code).toBe(1);
    expect(await readFile(original)).toEqual(before);
    const dry = await command(
      ["apply", original, "--ops", "-", "--dry-run"],
      JSON.stringify([
        { op: "deck.update", patch: { title: "Preview title" } },
      ]),
    );
    expect(dry.code, dry.errors).toBe(0);
    expect(dry.result.dryRun).toBe(true);
    expect(dry.result.deck.title).toBe("Preview title");
    expect(await readFile(original)).toEqual(before);
    expect(
      (await readdir(directory)).some((filename) =>
        filename.startsWith(".scislide-cli-"),
      ),
    ).toBe(false);
  });

  it("requires explicit replacement and protects freshness and symlink outputs", async () => {
    const directory = await temporary();
    const original = path.join(directory, "talk.scislide");
    await command(["create", "--layout", "blank", "--output", original]);
    const before = await readFile(original);
    const ops = JSON.stringify([
      { op: "deck.update", patch: { title: "Updated" } },
    ]);
    expect(
      (await command(["create", "--output", original])).error.error.code,
    ).toBe("OUTPUT_EXISTS");
    const stale = await command(
      [
        "apply",
        original,
        "--ops",
        "-",
        "--in-place",
        "--expect-sha256",
        "0".repeat(64),
      ],
      ops,
    );
    expect(stale.error.error.code).toBe("INPUT_CHANGED");
    expect(await readFile(original)).toEqual(before);
    const alias = path.join(directory, "alias.scislide");
    await symlink(original, alias);
    expect(
      (await command(["create", "--output", alias, "--overwrite"])).code,
    ).toBe(1);
    expect((await command(["inspect", alias])).code).toBe(1);
    const hash = createHash("sha256").update(before).digest("hex");
    const applied = await command(
      ["apply", original, "--ops", "-", "--in-place", "--expect-sha256", hash],
      ops,
    );
    expect(applied.code, applied.errors).toBe(0);
    expect((await command(["inspect", original])).result.deck.title).toBe(
      "Updated",
    );
    expect(
      (
        await command(
          [
            "apply",
            original,
            "--ops",
            "-",
            "--output",
            original,
            "--overwrite",
          ],
          ops,
        )
      ).code,
    ).toBe(2);
  });

  it("unpacks and packs portable JSON without losing IDs or media", async () => {
    const directory = await temporary();
    const original = path.join(directory, "talk.scislide");
    const jsonFile = path.join(directory, "deck.json");
    const repacked = path.join(directory, "repacked.scislide");
    await command(["create", "--output", original, "--theme", "keynote-white"]);
    expect(
      (await command(["unpack", original, "--output", jsonFile])).code,
    ).toBe(0);
    expect((await command(["pack", jsonFile, "--output", repacked])).code).toBe(
      0,
    );
    const first = (await command(["inspect", original, "--full"])).result.deck;
    expect(
      (await command(["inspect", repacked, "--full"])).result.deck,
    ).toEqual(first);
    const invalid = await command(
      ["pack", "-", "--output", path.join(directory, "invalid.scislide")],
      "not json",
    );
    expect(invalid.error.error.code).toBe("INVALID_JSON");
  });

  it("imports a local figure relative to the operations file and exports real SVG/PDF", async () => {
    const directory = await temporary();
    const original = path.join(directory, "talk.scislide");
    const edited = path.join(directory, "edited.scislide");
    const operations = path.join(directory, "edits.json");
    const svg = path.join(directory, "slide.svg");
    const pdf = path.join(directory, "talk.pdf");
    await command(["create", "--output", original, "--layout", "blank"]);
    await writeFile(
      path.join(directory, "plot.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal"/></svg>',
    );
    await writeFile(
      operations,
      JSON.stringify({
        version: 1,
        operations: [
          { op: "asset.add", file: "plot.svg", id: "plot-asset" },
          {
            op: "object.add",
            slide: 1,
            object: {
              type: "figure",
              id: "figure-1",
              assetId: "plot-asset",
              transform: { x: 80, y: 260, width: 400, height: 200 },
            },
          },
          {
            op: "object.add",
            slide: 1,
            object: {
              type: "text",
              text: "Research $U(1)$",
              transform: { x: 80, y: 80, width: 900, height: 140 },
            },
          },
        ],
      }),
    );
    const applied = await command([
      "apply",
      original,
      "--ops",
      operations,
      "--output",
      edited,
    ]);
    expect(applied.code, applied.errors).toBe(0);
    expect(
      (await command(["export", edited, "--output", svg, "--slide", "1"])).code,
    ).toBe(0);
    const source = await readFile(svg, "utf8");
    expect(source.includes("<svg")).toBe(true);
    expect(source.includes("Research")).toBe(true);
    expect(source.includes('fill="teal"')).toBe(true);
    expect(source.includes("data:font/ttf;base64,")).toBe(true);
    expect(source.includes("http://127.0.0.1")).toBe(false);
    const exported = await command([
      "export",
      edited,
      "--format",
      "pdf",
      "--output",
      pdf,
    ]);
    expect(exported.code, exported.errors).toBe(0);
    expect((await readFile(pdf)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      (
        await command([
          "export",
          edited,
          "--format",
          "pdf",
          "--slide",
          "1",
          "--output",
          pdf,
          "--overwrite",
        ])
      ).code,
    ).toBe(2);
  });

  it("rejects malformed or modified ZIP archives without writing outputs", async () => {
    const directory = await temporary();
    const invalid = path.join(directory, "bad.scislide");
    await writeFile(invalid, "not a ZIP archive");
    const result = await command(["validate", invalid]);
    expect(result.code).toBe(1);
    expect(result.output).toBe("");
    expect(result.error.ok).toBe(false);
    expect(result.error.error.message).toMatch(/ZIP/);
  });

  it("preflights batch versions and all local asset metadata before file IO", async () => {
    const directory = await temporary();
    const original = path.join(directory, "talk.scislide");
    await command(["create", "--layout", "blank", "--output", original]);
    const invalid = [
      { version: 2, operations: [{ op: "asset.add", file: "missing.svg" }] },
      {
        version: 1,
        extra: true,
        operations: [{ op: "asset.add", file: "missing.svg" }],
      },
      {
        version: 1,
        operations: [{ op: "asset.add", file: "missing.svg", id: "bad/id" }],
      },
      {
        version: 1,
        operations: [{ op: "asset.add", file: "missing.svg", name: 12 }],
      },
      {
        version: 1,
        operations: [
          { op: "asset.add", file: "missing.svg" },
          { op: "asset.add", file: "another.svg", name: false },
        ],
      },
      {
        version: 1,
        operations: [
          { op: "asset.add", file: "missing.svg" },
          { op: "unknown.operation" },
        ],
      },
      {
        version: 1,
        operations: [
          { op: "asset.add", file: "missing.svg" },
          {
            op: "object.add",
            slide: 1,
            object: { type: "text", fontSize: "large" },
          },
        ],
      },
    ];
    for (const source of invalid) {
      const result = await command(
        ["apply", original, "--ops", "-", "--dry-run"],
        JSON.stringify(source),
      );
      expect(result.code).toBe(1);
      expect(result.error.error.code).toBe("INVALID_OPERATIONS");
    }
  });
});
