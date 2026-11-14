// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { Asset } from "../src/lib/model";
import {
  getFigureExportDiagnostics,
  getFigureExportWarnings,
} from "../src/lib/figure-export-compatibility";

function asset(contents: string): Asset {
  return {
    id: "figure",
    name: "figure.svg",
    mime: "image/svg+xml",
    width: 400,
    height: 200,
    dataUrl: `data:image/svg+xml,${encodeURIComponent(contents)}`,
  };
}
function svg(contents: string) {
  return asset(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">${contents}</svg>`,
  );
}
function face(format = "woff2", descriptors = "", family = "Plot") {
  const magic = {
    ttf: "\u0000\u0001\u0000\u0000",
    otf: "OTTO",
    woff: "wOFF",
    woff2: "wOF2",
  }[format]!;
  const font = btoa(magic + "\u0000".repeat(8));
  return `@font-face{font-family:"${family}";src:url("data:font/${format};base64,${font}");${descriptors}}`;
}
const codes = (figure: Asset) =>
  getFigureExportDiagnostics(figure).map((diagnostic) => diagnostic.code);

describe("early figure export advice", () => {
  it("leaves raster figures alone and accepts the actual embedded-TTF example without warnings", async () => {
    expect(
      getFigureExportWarnings({
        ...svg(""),
        mime: "image/png",
        dataUrl: "not SVG",
      }),
    ).toEqual([]);
    const example = await readFile(
      new NodeURL(
        "../examples/scientific-equation-template.svg",
        import.meta.url,
      ),
      "utf8",
    );
    expect(getFigureExportWarnings(asset(example))).toEqual([]);
  });

  it.each(["otf", "woff", "woff2"])(
    "reports a used %s font as a PDF-only limitation",
    (format) => {
      const diagnostics = getFigureExportDiagnostics(
        svg(
          `<style>${face(format)}</style><text font-family="Plot">Label</text>`,
        ),
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code: "pdf-font-format",
        formats: ["pdf"],
      });
      expect(diagnostics[0].message).toContain("SVG/PowerPoint");
    },
  );

  it("does not warn just because an unused unsupported face is declared", () => {
    expect(
      getFigureExportWarnings(
        svg(
          `<style>${face("woff2", "font-style:italic;")}</style><text font-family="Inter">Ordinary label</text>`,
        ),
      ),
    ).toEqual([]);
    expect(
      getFigureExportWarnings(
        svg(`<style>${face()}</style><path d="M0 0L10 10"/>`),
      ),
    ).toEqual([]);
  });

  it("ignores non-rendered text but notices a visible child overriding inherited visibility", () => {
    const styles = `<style>${face()}</style>`;
    for (const content of [
      '<defs><text font-family="Plot">Unused label</text></defs>',
      '<g display="none"><text font-family="Plot">Hidden label</text></g>',
      '<g opacity="0"><text font-family="Plot">Transparent label</text></g>',
      '<text visibility="hidden" font-family="Plot">Hidden label</text>',
      '<text fill="none" font-family="Plot">Unpainted label</text>',
      '<text fill-opacity="0" font-family="Plot">Transparent fill</text>',
    ])
      expect(getFigureExportWarnings(svg(styles + content))).toEqual([]);
    expect(
      codes(
        svg(
          styles +
            '<g visibility="hidden"><text visibility="visible" font-family="Plot">Visible label</text></g>',
        ),
      ),
    ).toEqual(["pdf-font-format"]);
    expect(
      codes(
        svg(
          styles +
            '<text fill="none" stroke="#123456" font-family="Plot">Visible outline</text>',
        ),
      ),
    ).toEqual(["pdf-font-format"]);
  });

  it("checks the effective font of local use instances without warning for unused definitions", () => {
    const definition = `<style>${face()}</style><defs><text id="label" font-family="Plot">Referenced label</text></defs>`;
    expect(codes(svg(definition + '<use href="#label"/>'))).toEqual([
      "pdf-font-format",
    ]);
    expect(
      codes(svg(definition + '<use href="#label" display="none"/>')),
    ).toEqual([]);
    const inherited = `<style>${face()}</style><defs><text id="label">Inherited label</text></defs><g font-family="Plot"><use href="#label"/></g>`;
    expect(codes(svg(inherited))).toEqual(["pdf-font-format"]);
  });

  it("resolves flattened class styles, inheritance and inline-style precedence", () => {
    const figure = svg(
      `<style>${face()} .label{font-family:Plot;font-style:italic}</style><g class="label"><text>Slanted label</text><text style="font-family:Inter;font-style:normal">Normal label</text></g>`,
    );
    expect(codes(figure).sort()).toEqual(["pdf-font-format", "pdf-font-style"]);
    expect(
      getFigureExportDiagnostics(figure).every(
        (diagnostic) => diagnostic.formats.join() === "pdf",
      ),
    ).toBe(true);
  });

  it("does not warn for an unused alternate format when a matching normal TTF face exists", () => {
    const figure = svg(
      `<style>${face()}${face("ttf", "font-weight:400;")}</style><text font-family="Plot" font-weight="400">TTF label</text>`,
    );
    expect(getFigureExportWarnings(figure)).toEqual([]);
  });

  it("uses the exporter's exact embedded font weight registration rules", () => {
    expect(
      codes(
        svg(
          `<style>${face("ttf", "font-weight:400;")}</style><text font-family="Plot" font-weight="700">Bold</text>`,
        ),
      ),
    ).toEqual(["pdf-font-weight"]);
    expect(
      codes(
        svg(
          `<style>${face("ttf", "font-weight:400 700;")}</style><text font-family="Plot" font-weight="600">Semibold</text>`,
        ),
      ),
    ).toEqual([]);
    expect(
      codes(
        svg(
          `<style>${face("ttf", "font-style:italic;")}</style><text font-family="Plot">Label</text>`,
        ),
      ),
    ).toEqual(["pdf-font-style"]);
  });

  it("distinguishes supported bundled weights from unavailable fonts and generic weights", () => {
    expect(
      codes(svg('<text font-family="Inter" font-weight="500">Medium</text>')),
    ).toEqual([]);
    expect(
      codes(
        svg('<text font-family="Nanum Gothic" font-weight="600">한글</text>'),
      ),
    ).toEqual([]);
    expect(
      codes(svg('<text font-family="serif" font-weight="500">Medium</text>')),
    ).toEqual(["pdf-font-weight"]);
    expect(codes(svg('<text font-family="Unbundled">Label</text>'))).toEqual([
      "pdf-font-unavailable",
    ]);
  });

  it.each([
    '<defs><filter id="effect"><feGaussianBlur stdDeviation="2"/></filter></defs><rect filter="url(#effect)"/>',
    '<mask id="mask"><rect width="20" height="20"/></mask><rect mask="url(#mask)"/>',
    '<text><textPath href="#curve">Curved text</textPath></text>',
    '<rect style="mix-blend-mode:multiply"/>',
  ])(
    "reports unsupported PDF scene features using the shared export predicates",
    (content) => {
      expect(codes(svg(content))).toContain("pdf-svg-feature");
    },
  );

  it("distinguishes external dependencies and active content that block every export format", () => {
    const figure = svg(
      '<image href="https://example.com/figure.png"/><rect fill="url(https://example.com/paint.svg)"/><script>alert(1)</script>',
    );
    const diagnostics = getFigureExportDiagnostics(figure);
    expect(diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([
      "active-content",
      "external-resource",
    ]);
    expect(
      diagnostics.every((diagnostic) => diagnostic.formats.length === 3),
    ).toBe(true);
  });

  it("rejects malformed SVG and unsupported CSS instead of silently dropping it", () => {
    expect(() => getFigureExportWarnings(asset("<svg>"))).toThrow(
      "not valid SVG",
    );
    expect(() =>
      getFigureExportWarnings(
        svg(
          '<style>@media print{.label{fill:red}}</style><text class="label">Label</text>',
        ),
      ),
    ).toThrow("unsupported stylesheet");
    expect(() =>
      getFigureExportWarnings(
        svg(
          "<style>@font-face{font-family:Plot;src:url(https://example.com/font.ttf)}</style>",
        ),
      ),
    ).toThrow("unsupported stylesheet");
  });
});
