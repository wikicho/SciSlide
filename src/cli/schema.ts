import { DECK_THEMES } from "../lib/deck-themes";
import { SLIDE_TEMPLATES } from "../lib/slide-templates";
import { KEYNOTE_WHITE_LAYOUTS } from "../lib/keynote-white-layouts";

type Schema = Record<string, unknown>;
const object = (
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const text = (maxLength = 2000): Schema => ({ type: "string", maxLength });
const number = (minimum = -1_000_000, maximum = 1_000_000): Schema => ({
  type: "number",
  minimum,
  maximum,
});
const boolean: Schema = { type: "boolean" };
const nullable = (schema: Schema): Schema => ({
  anyOf: [schema, { type: "null" }],
});
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const id: Schema = {
  type: "string",
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
  maxLength: 128,
};
const index: Schema = {
  type: "integer",
  minimum: 1,
  description: "A 1-based position in the current batch's slide/object order.",
};
const color: Schema = {
  ...text(64),
  pattern:
    "^(#[\\da-fA-F]{3,8}|transparent|none|[a-zA-Z]{1,24}|rgba?\\([\\d\\s.,%]+\\))$",
  description:
    "A native portable color: hex, plain color name, transparent, none, rgb(...) or rgba(...). URL paints are rejected.",
};
const fontSet: Schema = {
  enum: ["mathjax-stix2", "mathjax-fira", "mathjax-modern"],
};
const themeIds = DECK_THEMES.map((theme) => theme.id);
const nativeLayouts = [...SLIDE_TEMPLATES, ...KEYNOTE_WHITE_LAYOUTS];
const layout: Schema = {
  enum: nativeLayouts.map((item) => item.id),
  default: "blank",
};
const transform = object({
  x: number(),
  y: number(),
  width: number(0.01),
  height: number(0.01),
  rotation: number(-360_000, 360_000),
});
const style = object({
  fontSetId: nullable(fontSet),
  fontSize: nullable(number(4, 500)),
  color: nullable(color),
});
const point = object({ x: number(0, 1), y: number(0, 1) }, ["x", "y"]);
const build = object(
  {
    step: { type: "integer", minimum: 0, maximum: 100 },
    effect: { enum: ["appear", "fade"] },
    durationMs: number(100, 3000),
  },
  ["step", "effect", "durationMs"],
);
const render = object(
  {
    svg: {
      ...text(2 * 1024 * 1024),
      description:
        "Passive self-contained SVG paths/shapes only. The native SVG validator rejects executable or external content.",
    },
    width: number(0.01, 100_000),
    height: number(0.01, 100_000),
    inputFingerprint: text(100_000),
    profile: object(
      {
        engine: text(200),
        engineVersion: text(1000),
        converterVersion: text(1000),
        dependencies: {
          type: "array",
          maxItems: 2000,
          items: object(
            {
              name: text(2000),
              sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
            },
            ["name", "sha256"],
          ),
        },
      },
      ["engine", "engineVersion", "converterVersion", "dependencies"],
    ),
    warnings: { type: "array", maxItems: 100, items: text(2000) },
  },
  ["svg", "width", "height", "inputFingerprint", "profile", "warnings"],
);
const localTex = object({
  engine: { enum: ["latex", "xelatex"], default: "latex" },
  preamble: { ...text(16_000), default: "" },
  render: nullable(render),
});
const common: Record<string, Schema> = {
  id,
  name: text(),
  transform: {
    ...transform,
    description: "Partial values merge with the existing/default transform.",
    default: { x: 140, y: 250, width: 600, height: 120, rotation: 0 },
  },
  opacity: { ...number(0, 1), default: 1 },
  visible: { ...boolean, default: true },
  locked: { ...boolean, default: false },
  groupId: nullable(id),
  metadata: {
    type: "object",
    additionalProperties: true,
    default: {},
    description:
      "Arbitrary JSON metadata. Supplying this property replaces its value; unrelated edits retain it.",
  },
  build: nullable(build),
};
const specifics: Record<string, Record<string, Schema>> = {
  text: {
    text: { ...text(100_000), default: "" },
    fontFamily: {
      ...text(200),
      description: "Defaults to the deck text font.",
    },
    fontSize: { ...number(4, 500), default: 40 },
    fontWeight: { ...number(100, 1000), default: 400 },
    color: {
      ...color,
      description: "Defaults to the selected theme's ink color.",
    },
    align: { enum: ["left", "center", "right"], default: "left" },
  },
  equation: {
    latex: { ...text(32_000), default: "E=mc^2" },
    style: {
      ...style,
      default: {},
      description:
        "Partial fields merge. null removes an override and inherits the deck default.",
    },
    displayMode: { ...boolean, default: true },
    description: { ...text(10_000), default: "" },
    renderer: { enum: ["mathjax", "local-latex"], default: "mathjax" },
    localTex: nullable(localTex),
  },
  shape: {
    shape: { enum: ["rect", "ellipse", "line", "arrow"], default: "rect" },
    fill: color,
    stroke: color,
    strokeWidth: { ...number(0, 1000), default: 2 },
    strokeStyle: nullable({ enum: ["solid", "dashed", "dotted"] }),
    line: nullable(object({ start: point, end: point }, ["start", "end"])),
    startArrow: nullable(boolean),
    endArrow: nullable(boolean),
  },
  figure: {
    assetId: {
      ...id,
      description: "Must reference an embedded image asset in the final deck.",
    },
    alt: { ...text(10_000), default: "" },
    crop: nullable(
      object(
        {
          x: number(0, 1),
          y: number(0, 1),
          width: number(0.000001, 1),
          height: number(0.000001, 1),
        },
        ["x", "y", "width", "height"],
      ),
    ),
  },
  video: {
    assetId: {
      ...id,
      description:
        "Must reference an embedded MP4/WebM asset in the final deck.",
    },
    alt: { ...text(10_000), default: "" },
    autoplay: { ...boolean, default: false },
    loop: { ...boolean, default: false },
    muted: { ...boolean, default: false },
    controls: { ...boolean, default: true },
  },
};
const objectVariants = Object.entries(specifics).map(([type, properties]) =>
  object({ ...common, type: { const: type }, ...properties }, [
    "type",
    ...(["figure", "video"].includes(type) ? ["assetId"] : []),
  ]),
);
const patchCommon = Object.fromEntries(
  Object.entries(common).filter(([key]) => key !== "id"),
);
const patchVariants = Object.values(specifics).map((properties) =>
  object({ ...patchCommon, ...properties }),
);
const assetProperties = {
  id,
  name: text(),
  mime: {
    enum: [
      "image/svg+xml",
      "image/png",
      "image/jpeg",
      "video/mp4",
      "video/webm",
    ],
  },
  dataUrl: {
    type: "string",
    description:
      "Fully embedded data URL whose MIME matches mime. Videos must be base64, at most 40 MiB. Images at most 32 MiB of source text.",
  },
  width: number(0.01, 100_000),
  height: number(0.01, 100_000),
};
const slideSelector: Schema = {
  oneOf: [id, index, object({ id }, ["id"]), object({ index }, ["index"])],
  description:
    "String selectors are stable native IDs, including numeric-looking IDs. Numeric selectors and {index:N} use 1-based positions.",
};
const pageNumbers = object({
  enabled: boolean,
  position: { enum: ["bottom-left", "bottom-center", "bottom-right"] },
  format: { enum: ["number", "number-total"] },
  startAt: { type: "integer", minimum: 0, maximum: 10_000 },
  hideFirst: boolean,
  fontSize: number(4, 200),
  color,
});
const themePatch = object({
  fontFamily: text(200),
  equation: object({ fontSetId: fontSet, fontSize: number(4, 500), color }),
});
const deckPatch = object({
  title: text(),
  theme: { anyOf: [{ enum: themeIds }, themePatch] },
  pageNumbers: nullable(pageNumbers),
});
const slidePatch = object({
  title: text(),
  notes: text(100_000),
  background: color,
});
const op = (
  name: string,
  properties: Record<string, Schema>,
  required: string[],
): Schema =>
  object({ op: { const: name }, ...properties }, ["op", ...required]);

/** Discoverable JSON Schema plus native catalogs, defaults and atomic examples. */
export const agentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "SciSlide native agent operations, version 1",
  ...object(
    {
      version: { const: 1 },
      operations: { type: "array", maxItems: 1000, items: ref("operation") },
    },
    ["version", "operations"],
  ),
  description:
    "Apply all operations atomically to a native .scislide deck. A bare operations array is also accepted. Unknown fields, invalid references and invalid final native documents reject the entire batch. No code or TeX execution occurs.",
  $defs: {
    slideSelector,
    object: { oneOf: objectVariants },
    objectPatch: { anyOf: patchVariants },
    transform,
    equationStyle: style,
    localTex,
    asset: object(assetProperties, [
      "name",
      "mime",
      "dataUrl",
      "width",
      "height",
    ]),
    operation: {
      oneOf: [
        op("deck.update", { patch: deckPatch }, ["patch"]),
        op(
          "slide.add",
          {
            id,
            layout,
            after: ref("slideSelector"),
            index,
            title: text(),
            notes: text(100_000),
            background: color,
          },
          [],
        ),
        op("slide.update", { slide: ref("slideSelector"), patch: slidePatch }, [
          "slide",
          "patch",
        ]),
        op("slide.remove", { slide: ref("slideSelector") }, ["slide"]),
        op("slide.reorder", { slide: ref("slideSelector"), index }, [
          "slide",
          "index",
        ]),
        op(
          "object.add",
          {
            slide: ref("slideSelector"),
            object: ref("object"),
            index,
            after: id,
          },
          ["slide", "object"],
        ),
        op(
          "object.update",
          { slide: ref("slideSelector"), id, patch: ref("objectPatch") },
          ["slide", "id", "patch"],
        ),
        op("object.remove", { slide: ref("slideSelector"), id }, [
          "slide",
          "id",
        ]),
        op("object.reorder", { slide: ref("slideSelector"), id, index }, [
          "slide",
          "id",
          "index",
        ]),
        op("asset.add", { asset: ref("asset") }, ["asset"]),
        op(
          "asset.update",
          {
            id,
            patch: object(
              Object.fromEntries(
                Object.entries(assetProperties).filter(([key]) => key !== "id"),
              ),
            ),
          },
          ["id", "patch"],
        ),
        op("asset.remove", { id }, ["id"]),
      ],
    },
  },
  "x-scislide": {
    formatVersion: "0.5.0",
    units: "px96",
    limits: {
      operations: 1000,
      slides: 1000,
      assets: 500,
      objectsPerSlide: 1000,
      totalObjects: 10_000,
    },
    create: object({
      title: text(),
      theme: { enum: themeIds, default: "scientific" },
      layout: {
        enum: nativeLayouts.map((item) => item.id),
        description: "Defaults to the selected theme's native starter layout.",
      },
      width: { ...number(100, 20_000), default: 1600 },
      height: { ...number(100, 20_000), default: 900 },
    }),
    themes: DECK_THEMES.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    layouts: nativeLayouts,
    ordering:
      "Insertion index ranges from 1 through length+1; absent index/after appends. after and index cannot be combined. Reorder index is the final 1-based position. Object order is back to front.",
    identifiers:
      "Generated when omitted; globally unique across deck, slide, object, asset and group IDs. Existing IDs and types cannot be changed. An ID cannot be reused later in the same batch.",
    preservation:
      "Unrelated edits retain metadata, embedded assets and local equation renders. Compile-input changes invalidate cached Local LaTeX renders; no compilation is performed.",
    patching:
      "Transform, equation style, localTex, theme equation settings and page numbers merge. Other supplied fields replace their values. null clears optional group/build/crop/shape settings, localTex or pageNumbers; null style fields inherit deck defaults.",
  },
  examples: [
    {
      version: 1,
      operations: [
        {
          op: "deck.update",
          patch: {
            title: "Research talk",
            pageNumbers: { enabled: true, format: "number-total" },
          },
        },
        {
          op: "slide.add",
          id: "results-slide",
          layout: "blank",
          title: "Results",
          after: { index: 1 },
        },
        {
          op: "object.add",
          slide: "results-slide",
          object: {
            id: "results-title",
            type: "text",
            text: "A measured result",
            fontSize: 64,
            transform: { x: 84, y: 76, width: 1432, height: 100 },
          },
        },
        {
          op: "object.add",
          slide: "results-slide",
          object: {
            id: "results-equation",
            type: "equation",
            latex: "E=mc^2",
            transform: { x: 200, y: 300 },
          },
        },
        {
          op: "object.update",
          slide: { id: "results-slide" },
          id: "results-equation",
          patch: { latex: "E^2=p^2c^2+m^2c^4", style: { fontSize: 56 } },
        },
        { op: "slide.reorder", slide: "results-slide", index: 1 },
      ],
    },
  ],
};
