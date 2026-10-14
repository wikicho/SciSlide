import { DEFAULT_PAGE_NUMBERS, newId, validateDeck } from "../lib/model";
import type {
  Asset,
  Deck,
  EquationObject,
  Slide,
  SlideObject,
} from "../lib/model";
import {
  createThemeDeck,
  createThemedSlide,
  DECK_THEMES,
  getDeckTheme,
  getDeckThemeId,
} from "../lib/deck-themes";
import type { DeckSlideLayoutId, DeckThemeId } from "../lib/deck-themes";
import { SLIDE_TEMPLATES } from "../lib/slide-templates";
import { KEYNOTE_WHITE_LAYOUTS } from "../lib/keynote-white-layouts";
import { sanitizeLocalEquationSvg } from "../lib/local-equation-svg";
import { agentSchema } from "./schema";

export { agentSchema } from "./schema";

type RecordValue = Record<string, unknown>;
export type AgentSlideSelector =
  string | number | { id: string } | { index: number };
export interface AgentOperationResult {
  op: string;
  slideId?: string;
  objectId?: string;
  assetId?: string;
  index?: number;
  objectIds?: string[];
}
export interface CreateAgentDeckOptions {
  title?: string;
  theme?: DeckThemeId;
  layout?: DeckSlideLayoutId;
  width?: number;
  height?: number;
}

const MAX_OPERATIONS = 1000;
const layouts = new Set<string>(
  [...SLIDE_TEMPLATES, ...KEYNOTE_WHITE_LAYOUTS].map((layout) => layout.id),
);
const themes = new Set<string>(DECK_THEMES.map((theme) => theme.id));
const baseObjectKeys = [
  "id",
  "type",
  "name",
  "transform",
  "opacity",
  "visible",
  "locked",
  "groupId",
  "metadata",
  "build",
];
const objectKeys = {
  text: ["text", "fontFamily", "fontSize", "fontWeight", "color", "align"],
  equation: [
    "latex",
    "style",
    "displayMode",
    "description",
    "renderer",
    "localTex",
  ],
  shape: [
    "shape",
    "fill",
    "stroke",
    "strokeWidth",
    "strokeStyle",
    "line",
    "startArrow",
    "endArrow",
  ],
  figure: ["assetId", "alt", "crop"],
  video: ["assetId", "alt", "autoplay", "loop", "muted", "controls"],
} as const;

function record(value: unknown, at: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${at} must be an object.`);
  return value as RecordValue;
}

function keys(value: RecordValue, allowed: readonly string[], at: string) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`${at}.${key} is not supported.`);
}

function jsonValue(value: unknown, at: string, depth = 0): void {
  if (depth > 64) throw new Error(`${at} exceeds the JSON nesting limit.`);
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype)
      throw new Error(`${at} must be an ordinary JSON list.`);
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as unknown as Record<string, PropertyDescriptor>;
    const length = descriptors.length.value as number;
    if (Object.keys(descriptors).length !== length + 1)
      throw new Error(
        `${at} must be a dense JSON list without extra properties.`,
      );
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "length") continue;
      if (
        !/^(0|[1-9]\d*)$/.test(key) ||
        Number(key) >= length ||
        !descriptor.enumerable ||
        descriptor.get ||
        descriptor.set
      )
        throw new Error(`${at}[${key}] must be ordinary JSON data.`);
      jsonValue(descriptor.value, `${at}[${key}]`, depth + 1);
    }
    return;
  }
  if (typeof value === "object" && value) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error(`${at} must contain only JSON values.`);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set)
        throw new Error(`${at}.${key} must be ordinary JSON data.`);
      jsonValue(descriptor.value, `${at}.${key}`, depth + 1);
    }
    return;
  }
  throw new Error(`${at} must contain only JSON values.`);
}

function identifier(value: unknown, at: string): string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  )
    throw new Error(`${at} must be a valid native identifier.`);
  return value;
}

/** Validate our static, discoverable schema without executing user expressions. */
function schemaValue(value: unknown, schema: RecordValue, at: string): void {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const definitions = agentSchema.$defs as Record<string, unknown>;
    schemaValue(
      value,
      record(definitions[name], "Agent schema definition"),
      at,
    );
    return;
  }
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(alternatives)) {
    let matches = 0;
    for (const alternative of alternatives) {
      try {
        schemaValue(value, record(alternative, "Agent schema alternative"), at);
        matches++;
      } catch {
        // A union is valid only when a complete alternative accepts the value.
      }
    }
    if (!matches || (schema.oneOf && matches !== 1))
      throw new Error(`${at} does not match an allowed schema.`);
    return;
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const)
    throw new Error(`${at} must be ${JSON.stringify(schema.const)}.`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    throw new Error(`${at} must be one of ${schema.enum.join(", ")}.`);
  switch (schema.type) {
    case "null":
      if (value !== null) throw new Error(`${at} must be null.`);
      break;
    case "boolean":
      if (typeof value !== "boolean")
        throw new Error(`${at} must be true or false.`);
      break;
    case "string":
      if (typeof value !== "string") throw new Error(`${at} must be text.`);
      if (
        typeof schema.maxLength === "number" &&
        value.length > schema.maxLength
      )
        throw new Error(`${at} exceeds ${schema.maxLength} characters.`);
      if (
        typeof schema.pattern === "string" &&
        !new RegExp(schema.pattern).test(value)
      )
        throw new Error(`${at} has an invalid format.`);
      break;
    case "integer":
    case "number":
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (schema.type === "integer" && !Number.isInteger(value))
      )
        throw new Error(`${at} must be a finite ${schema.type}.`);
      if (
        (typeof schema.minimum === "number" && value < schema.minimum) ||
        (typeof schema.maximum === "number" && value > schema.maximum)
      )
        throw new Error(`${at} is outside its allowed range.`);
      break;
    case "array":
      if (!Array.isArray(value)) throw new Error(`${at} must be a list.`);
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
        throw new Error(`${at} exceeds ${schema.maxItems} items.`);
      if (schema.items)
        value.forEach((item, index) =>
          schemaValue(
            item,
            record(schema.items, "Agent item schema"),
            `${at}[${index}]`,
          ),
        );
      break;
    case "object": {
      const data = record(value, at);
      const properties = schema.properties
        ? record(schema.properties, "Agent property schema")
        : {};
      if (schema.additionalProperties === false)
        keys(data, Object.keys(properties), at);
      if (Array.isArray(schema.required))
        for (const key of schema.required)
          if (!Object.hasOwn(data, key as string))
            throw new Error(`${at}.${String(key)} is required.`);
      for (const [key, item] of Object.entries(data))
        if (Object.hasOwn(properties, key))
          schemaValue(
            item,
            record(properties[key], "Agent property schema"),
            `${at}.${key}`,
          );
      break;
    }
  }
}

function validateOperation(operation: RecordValue) {
  const definition = agentSchema.$defs.operation.oneOf.find((item) => {
    const properties = record(item.properties, "Operation schema properties");
    return (
      record(properties.op, "Operation schema name").const === operation.op
    );
  });
  if (!definition)
    throw new Error(`Unknown agent operation: ${String(operation.op)}.`);
  schemaValue(operation, definition, "Operation");
}

function position(value: unknown, maximum: number, at: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maximum
  )
    throw new Error(
      `${at} must be a 1-based integer between 1 and ${maximum}.`,
    );
  return value - 1;
}

function slideIndex(deck: Deck, selector: unknown): number {
  if (typeof selector === "number")
    return position(selector, deck.slides.length, "Slide index");
  if (typeof selector === "object" && selector !== null) {
    const selected = record(selector, "Slide selector");
    keys(selected, ["id", "index"], "Slide selector");
    if (Object.keys(selected).length !== 1)
      throw new Error("Choose exactly one slide ID or 1-based index.");
    if (Object.hasOwn(selected, "index"))
      return position(selected.index, deck.slides.length, "Slide index");
    selector = selected.id;
  }
  const id = identifier(selector, "Slide ID");
  const found = deck.slides.findIndex((slide) => slide.id === id);
  if (found < 0)
    throw new Error(
      `Slide ID ${JSON.stringify(id)} does not exist. Numeric strings are IDs; use a number for a 1-based index.`,
    );
  return found;
}

function objectIndex(slide: Slide, value: unknown): number {
  const id = identifier(value, "Object ID");
  const found = slide.objects.findIndex((object) => object.id === id);
  if (found < 0)
    throw new Error(
      `Object ID ${JSON.stringify(id)} does not exist on slide ${JSON.stringify(slide.id)}.`,
    );
  return found;
}

function assetIndex(deck: Deck, value: unknown): number {
  const id = identifier(value, "Asset ID");
  const found = deck.assets.findIndex((asset) => asset.id === id);
  if (found < 0)
    throw new Error(`Asset ID ${JSON.stringify(id)} does not exist.`);
  return found;
}

function reservedIds(deck: Deck): Set<string> {
  return new Set([
    deck.id,
    ...deck.assets.map((asset) => asset.id),
    ...deck.slides.flatMap((slide) => [
      slide.id,
      ...slide.objects.flatMap((object) => [
        object.id,
        ...(object.groupId ? [object.groupId] : []),
      ]),
    ]),
  ]);
}

function allocateId(reserved: Set<string>, requested?: unknown): string {
  if (requested !== undefined) {
    const id = identifier(requested, "New ID");
    if (reserved.has(id))
      throw new Error(
        `ID ${JSON.stringify(id)} is already used in this deck or batch.`,
      );
    reserved.add(id);
    return id;
  }
  for (let attempt = 0; attempt < 32; attempt++) {
    const id = newId();
    if (!reserved.has(id)) {
      reserved.add(id);
      return id;
    }
  }
  throw new Error("Could not allocate a globally unique native ID.");
}

function namedTheme(value: unknown): Deck["theme"] {
  if (typeof value !== "string" || !themes.has(value))
    throw new Error(`Unknown native theme: ${String(value)}.`);
  return createThemeDeck(value as DeckThemeId).theme;
}

function template(layout: unknown, deck: Deck): Slide {
  if (typeof layout !== "string" || !layouts.has(layout))
    throw new Error(`Unknown native layout: ${String(layout)}.`);
  const slide = createThemedSlide(layout as DeckSlideLayoutId, deck);
  const scaleX = deck.slideSize.width / 1600,
    scaleY = deck.slideSize.height / 900,
    scale = Math.min(scaleX, scaleY);
  const textSize = (value: number) => Math.min(500, Math.max(4, value * scale));
  for (const object of slide.objects) {
    object.transform.x *= scaleX;
    object.transform.y *= scaleY;
    object.transform.width *= scaleX;
    object.transform.height *= scaleY;
    if (object.type === "text") object.fontSize = textSize(object.fontSize);
    if (object.type === "equation" && object.style.fontSize !== undefined)
      object.style.fontSize = textSize(object.style.fontSize);
    if (object.type === "shape") object.strokeWidth *= scale;
  }
  return slide;
}

function reserveTemplateIds(
  slide: Slide,
  reserved: Set<string>,
  requested?: unknown,
) {
  slide.id = allocateId(
    reserved,
    requested ?? (reserved.has(slide.id) ? undefined : slide.id),
  );
  const objects = new Map<string, string>();
  for (const object of slide.objects) {
    const original = object.id;
    object.id = allocateId(
      reserved,
      reserved.has(original) ? undefined : original,
    );
    objects.set(original, object.id);
  }
  const groups = new Map<string, string>();
  for (const object of slide.objects) {
    if (object.groupId) {
      const original = object.groupId;
      if (!groups.has(original))
        groups.set(
          original,
          allocateId(reserved, reserved.has(original) ? undefined : original),
        );
      object.groupId = groups.get(original);
    }
    const frame = object.metadata.mediaPlaceholderFor;
    if (typeof frame === "string" && objects.has(frame))
      object.metadata.mediaPlaceholderFor = objects.get(frame);
  }
}

/** Native theme/layout constructors, not a second document format. */
export function createAgentDeck(options: CreateAgentDeckOptions = {}): Deck {
  jsonValue(options, "Create options");
  const settings = record(options, "Create options");
  keys(
    settings,
    ["title", "theme", "layout", "width", "height"],
    "Create options",
  );
  const theme = settings.theme ?? "scientific";
  namedTheme(theme);
  const deck = createThemeDeck(theme as DeckThemeId);
  if (settings.title !== undefined) deck.title = settings.title as string;
  if (settings.width !== undefined)
    deck.slideSize.width = settings.width as number;
  if (settings.height !== undefined)
    deck.slideSize.height = settings.height as number;
  // Validate dimensions before generating scaled template geometry.
  validateDeck(deck);
  const layout =
    settings.layout ??
    DECK_THEMES.find((definition) => definition.id === theme)!.layout;
  deck.slides = [template(layout, deck)];
  return validateDeck(deck);
}

function mergeRecord(
  original: unknown,
  patch: unknown,
  allowed: readonly string[],
  at: string,
  deletable: readonly string[] = [],
): RecordValue {
  const update = record(patch, at);
  keys(update, allowed, at);
  const next = { ...record(original, at), ...update };
  for (const key of deletable) if (update[key] === null) delete next[key];
  return next;
}

function checkNestedObjectProperties(value: RecordValue) {
  if (value.transform !== undefined)
    keys(
      record(value.transform, "Object transform"),
      ["x", "y", "width", "height", "rotation"],
      "Object transform",
    );
  if (value.metadata !== undefined) record(value.metadata, "Object metadata");
  if (value.build !== undefined && value.build !== null)
    keys(
      record(value.build, "Object build"),
      ["step", "effect", "durationMs"],
      "Object build",
    );
  if (value.style !== undefined)
    keys(
      record(value.style, "Equation style"),
      ["fontSetId", "fontSize", "color"],
      "Equation style",
    );
  if (value.crop !== undefined && value.crop !== null)
    keys(
      record(value.crop, "Figure crop"),
      ["x", "y", "width", "height"],
      "Figure crop",
    );
  if (value.line !== undefined && value.line !== null) {
    const line = record(value.line, "Line endpoints");
    keys(line, ["start", "end"], "Line endpoints");
    for (const endpoint of ["start", "end"])
      if (line[endpoint] !== undefined)
        keys(
          record(line[endpoint], `Line ${endpoint}`),
          ["x", "y"],
          `Line ${endpoint}`,
        );
  }
  if (value.localTex !== undefined && value.localTex !== null) {
    const local = record(value.localTex, "Local LaTeX settings");
    keys(local, ["engine", "preamble", "render"], "Local LaTeX settings");
    if (local.render !== undefined && local.render !== null) {
      const render = record(local.render, "Local LaTeX render");
      keys(
        render,
        ["svg", "width", "height", "inputFingerprint", "profile", "warnings"],
        "Local LaTeX render",
      );
      sanitizeLocalEquationSvg(render.svg as string);
      if (render.profile !== undefined) {
        const profile = record(render.profile, "Local LaTeX profile");
        keys(
          profile,
          ["engine", "engineVersion", "converterVersion", "dependencies"],
          "Local LaTeX profile",
        );
        if (Array.isArray(profile.dependencies))
          profile.dependencies.forEach((dependency) =>
            keys(
              record(dependency, "Local LaTeX dependency"),
              ["name", "sha256"],
              "Local LaTeX dependency",
            ),
          );
      }
    }
  }
}

function updateObject(object: SlideObject, patch: RecordValue): SlideObject {
  keys(
    patch,
    [
      ...baseObjectKeys.filter((key) => !["id", "type"].includes(key)),
      ...objectKeys[object.type],
    ],
    "Object patch",
  );
  checkNestedObjectProperties(patch);
  const next = { ...object, ...patch } as SlideObject;
  if (patch.transform !== undefined)
    next.transform = mergeRecord(
      object.transform,
      patch.transform,
      ["x", "y", "width", "height", "rotation"],
      "Object transform",
    ) as unknown as SlideObject["transform"];
  for (const key of ["groupId", "build"] as const)
    if (patch[key] === null) delete next[key];
  if (next.type === "equation" && object.type === "equation") {
    if (patch.style !== undefined)
      next.style = mergeRecord(
        object.style,
        patch.style,
        ["fontSetId", "fontSize", "color"],
        "Equation style",
        ["fontSetId", "fontSize", "color"],
      );
    if (patch.localTex === null) delete next.localTex;
    else if (patch.localTex !== undefined)
      next.localTex = mergeRecord(
        object.localTex ?? { engine: "latex", preamble: "" },
        patch.localTex,
        ["engine", "preamble", "render"],
        "Local LaTeX settings",
        ["render"],
      ) as unknown as EquationObject["localTex"];
  }
  if (next.type === "figure" && patch.crop === null) delete next.crop;
  if (next.type === "shape")
    for (const key of [
      "line",
      "strokeStyle",
      "startArrow",
      "endArrow",
    ] as const)
      if (patch[key] === null) delete next[key];
  return next;
}

function defaultObject(
  value: unknown,
  deck: Deck,
  reserved: Set<string>,
): SlideObject {
  const input = record(value, "New object");
  const type = input.type;
  if (typeof type !== "string" || !Object.hasOwn(objectKeys, type))
    throw new Error(`Unsupported object type: ${String(type)}.`);
  keys(
    input,
    [...baseObjectKeys, ...objectKeys[type as keyof typeof objectKeys]],
    "New object",
  );
  checkNestedObjectProperties(input);
  const palette = getDeckTheme(deck)?.palette;
  const base = {
    id: allocateId(reserved, input.id),
    name: type[0].toUpperCase() + type.slice(1),
    transform: { x: 140, y: 250, width: 600, height: 120, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
  };
  let object: SlideObject;
  switch (type) {
    case "text":
      object = {
        ...base,
        type,
        text: "",
        fontFamily: deck.theme.fontFamily,
        fontSize: 40,
        fontWeight: 400,
        color: palette?.ink ?? deck.theme.equation.color,
        align: "left",
      };
      break;
    case "equation":
      object = {
        ...base,
        type,
        latex: "E=mc^2",
        style: {},
        displayMode: true,
        description: "",
        renderer: "mathjax",
      };
      if (input.renderer === "local-latex")
        object.localTex = { engine: "latex", preamble: "" };
      break;
    case "shape":
      object = {
        ...base,
        type,
        shape: "rect",
        fill: palette?.surface ?? "#dcf2eb",
        stroke: palette?.accent ?? "#259f87",
        strokeWidth: 2,
      };
      if (input.shape === "line" || input.shape === "arrow") {
        object.fill = "none";
        object.line = { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } };
        object.endArrow = input.shape === "arrow";
      }
      break;
    case "figure":
      object = { ...base, type, assetId: input.assetId as string, alt: "" };
      break;
    default:
      object = {
        ...base,
        type: "video",
        assetId: input.assetId as string,
        alt: "",
        autoplay: false,
        loop: false,
        muted: false,
        controls: true,
      };
  }
  if (object.type === "figure" || object.type === "video") {
    const asset = deck.assets.find((asset) => asset.id === object.assetId);
    const scale = asset ? Math.min(600 / asset.width, 360 / asset.height) : 1;
    object.transform.width = asset ? asset.width * scale : 600;
    object.transform.height = asset ? asset.height * scale : 360;
  }
  const { id: _id, type: _type, ...patch } = input;
  return updateObject(object, patch);
}

function equationInputs(object: EquationObject, deck: Deck): string {
  return JSON.stringify([
    object.latex,
    object.renderer ?? "mathjax",
    object.localTex?.engine ?? "latex",
    object.localTex?.preamble ?? "",
    object.displayMode,
    object.style.fontSize ?? deck.theme.equation.fontSize,
    object.style.color ?? deck.theme.equation.color,
  ]);
}

function batchOperations(value: unknown): unknown[] {
  jsonValue(value, "Agent batch");
  if (!Array.isArray(value)) {
    const batch = record(value, "Agent batch");
    keys(batch, ["version", "operations"], "Agent batch");
    if (batch.version !== 1) throw new Error("Agent batch version must be 1.");
    value = batch.operations;
  }
  if (!Array.isArray(value) || value.length > MAX_OPERATIONS)
    throw new Error(
      `Agent operations must be a list with at most ${MAX_OPERATIONS} operations.`,
    );
  return value;
}

/** File adapters can preflight all JSON operations before reading imported assets. */
export function validateAgentOperationsInput(value: unknown): void {
  const operations = batchOperations(value);
  operations.forEach((value, index) => {
    let op = "unknown";
    try {
      const operation = record(value, "Operation");
      if (typeof operation.op !== "string")
        throw new Error("Operation.op must name a supported operation.");
      op = operation.op;
      validateOperation(operation);
      if (operation.object !== undefined)
        checkNestedObjectProperties(record(operation.object, "New object"));
      if (op === "object.update")
        checkNestedObjectProperties(record(operation.patch, "Object patch"));
    } catch (error) {
      throw new Error(
        `Operation ${index + 1} (${op}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

/** Work on one validated snapshot; failure never changes the caller's deck. */
export function applyAgentOperations(
  input: Deck,
  operations: unknown,
): { deck: Deck; results: AgentOperationResult[] } {
  const deck = validateDeck(input);
  const reserved = reservedIds(deck);
  const cachedInputs = new Map<string, string>();
  for (const object of deck.slides.flatMap((slide) => slide.objects))
    if (object.type === "equation" && object.localTex?.render)
      cachedInputs.set(object.id, equationInputs(object, deck));
  const results: AgentOperationResult[] = [];
  const batch = batchOperations(operations);
  batch.forEach((value, operationIndex) => {
    let op = "unknown";
    try {
      jsonValue(value, "Operation");
      const operation = structuredClone(record(value, "Operation"));
      if (typeof operation.op !== "string")
        throw new Error("Operation.op must name a supported operation.");
      op = operation.op;
      validateOperation(operation);
      let result: AgentOperationResult = { op };
      switch (op) {
        case "deck.update": {
          keys(operation, ["op", "patch"], op);
          const patch = record(operation.patch, "Deck patch");
          keys(patch, ["title", "theme", "pageNumbers"], "Deck patch");
          if (Object.hasOwn(patch, "title")) deck.title = patch.title as string;
          if (Object.hasOwn(patch, "theme")) {
            if (typeof patch.theme === "string") {
              const native = namedTheme(patch.theme);
              deck.theme = {
                ...deck.theme,
                ...native,
                equation: { ...deck.theme.equation, ...native.equation },
              };
            } else {
              const theme = record(patch.theme, "Theme patch");
              keys(theme, ["fontFamily", "equation"], "Theme patch");
              const equation =
                theme.equation === undefined
                  ? deck.theme.equation
                  : mergeRecord(
                      deck.theme.equation,
                      theme.equation,
                      ["fontSetId", "fontSize", "color"],
                      "Equation theme patch",
                    );
              deck.theme = {
                ...deck.theme,
                ...theme,
                equation,
              } as Deck["theme"];
            }
          }
          if (patch.pageNumbers === null) delete deck.pageNumbers;
          else if (patch.pageNumbers !== undefined)
            deck.pageNumbers = mergeRecord(
              deck.pageNumbers ?? DEFAULT_PAGE_NUMBERS,
              patch.pageNumbers,
              Object.keys(DEFAULT_PAGE_NUMBERS),
              "Page number patch",
            ) as unknown as Deck["pageNumbers"];
          break;
        }
        case "slide.add": {
          keys(
            operation,
            [
              "op",
              "id",
              "layout",
              "after",
              "index",
              "title",
              "notes",
              "background",
            ],
            op,
          );
          if (operation.index !== undefined && operation.after !== undefined)
            throw new Error("Choose slide insertion index or after, not both.");
          const index =
            operation.index !== undefined
              ? position(
                  operation.index,
                  deck.slides.length + 1,
                  "Slide insertion index",
                )
              : operation.after !== undefined
                ? slideIndex(deck, operation.after) + 1
                : deck.slides.length;
          const slide = template(operation.layout ?? "blank", deck);
          reserveTemplateIds(slide, reserved, operation.id);
          for (const key of ["title", "notes", "background"] as const)
            if (Object.hasOwn(operation, key))
              slide[key] = operation[key] as string;
          deck.slides.splice(index, 0, slide);
          result = {
            op,
            slideId: slide.id,
            index: index + 1,
            objectIds: slide.objects.map((object) => object.id),
          };
          break;
        }
        case "slide.update": {
          keys(operation, ["op", "slide", "patch"], op);
          const index = slideIndex(deck, operation.slide);
          const patch = record(operation.patch, "Slide patch");
          keys(patch, ["title", "notes", "background"], "Slide patch");
          deck.slides[index] = { ...deck.slides[index], ...patch } as Slide;
          result = { op, slideId: deck.slides[index].id, index: index + 1 };
          break;
        }
        case "slide.remove": {
          keys(operation, ["op", "slide"], op);
          const index = slideIndex(deck, operation.slide);
          const [slide] = deck.slides.splice(index, 1);
          result = { op, slideId: slide.id, index: index + 1 };
          break;
        }
        case "slide.reorder": {
          keys(operation, ["op", "slide", "index"], op);
          const from = slideIndex(deck, operation.slide);
          const to = position(
            operation.index,
            deck.slides.length,
            "Slide final index",
          );
          const [slide] = deck.slides.splice(from, 1);
          deck.slides.splice(to, 0, slide);
          result = { op, slideId: slide.id, index: to + 1 };
          break;
        }
        case "object.add": {
          keys(operation, ["op", "slide", "object", "after", "index"], op);
          const slide = deck.slides[slideIndex(deck, operation.slide)];
          if (operation.index !== undefined && operation.after !== undefined)
            throw new Error(
              "Choose object insertion index or after, not both.",
            );
          const index =
            operation.index !== undefined
              ? position(
                  operation.index,
                  slide.objects.length + 1,
                  "Object insertion index",
                )
              : operation.after !== undefined
                ? objectIndex(slide, operation.after) + 1
                : slide.objects.length;
          const object = defaultObject(operation.object, deck, reserved);
          if (object.type === "equation" && object.localTex?.render)
            cachedInputs.set(object.id, equationInputs(object, deck));
          slide.objects.splice(index, 0, object);
          result = {
            op,
            slideId: slide.id,
            objectId: object.id,
            index: index + 1,
          };
          break;
        }
        case "object.update": {
          keys(operation, ["op", "slide", "id", "patch"], op);
          const slide = deck.slides[slideIndex(deck, operation.slide)];
          const index = objectIndex(slide, operation.id);
          slide.objects[index] = updateObject(
            slide.objects[index],
            record(operation.patch, "Object patch"),
          );
          result = {
            op,
            slideId: slide.id,
            objectId: slide.objects[index].id,
            index: index + 1,
          };
          break;
        }
        case "object.remove": {
          keys(operation, ["op", "slide", "id"], op);
          const slide = deck.slides[slideIndex(deck, operation.slide)];
          const index = objectIndex(slide, operation.id);
          const [object] = slide.objects.splice(index, 1);
          result = {
            op,
            slideId: slide.id,
            objectId: object.id,
            index: index + 1,
          };
          break;
        }
        case "object.reorder": {
          keys(operation, ["op", "slide", "id", "index"], op);
          const slide = deck.slides[slideIndex(deck, operation.slide)];
          const from = objectIndex(slide, operation.id);
          const to = position(
            operation.index,
            slide.objects.length,
            "Object final index",
          );
          const [object] = slide.objects.splice(from, 1);
          slide.objects.splice(to, 0, object);
          result = {
            op,
            slideId: slide.id,
            objectId: object.id,
            index: to + 1,
          };
          break;
        }
        case "asset.add": {
          keys(operation, ["op", "asset"], op);
          const asset = record(operation.asset, "New asset");
          keys(
            asset,
            ["id", "name", "mime", "dataUrl", "width", "height"],
            "New asset",
          );
          const next = {
            ...asset,
            id: allocateId(reserved, asset.id),
          } as unknown as Asset;
          deck.assets.push(next);
          result = { op, assetId: next.id, index: deck.assets.length };
          break;
        }
        case "asset.update": {
          keys(operation, ["op", "id", "patch"], op);
          const index = assetIndex(deck, operation.id);
          const patch = record(operation.patch, "Asset patch");
          keys(
            patch,
            ["name", "mime", "dataUrl", "width", "height"],
            "Asset patch",
          );
          deck.assets[index] = { ...deck.assets[index], ...patch } as Asset;
          result = { op, assetId: deck.assets[index].id, index: index + 1 };
          break;
        }
        case "asset.remove": {
          keys(operation, ["op", "id"], op);
          const index = assetIndex(deck, operation.id);
          const [asset] = deck.assets.splice(index, 1);
          result = { op, assetId: asset.id, index: index + 1 };
          break;
        }
        default:
          throw new Error(`Unknown agent operation: ${op}.`);
      }
      results.push(result);
    } catch (error) {
      throw new Error(
        `Operation ${operationIndex + 1} (${op}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  for (const object of deck.slides.flatMap((slide) => slide.objects))
    if (
      object.type === "equation" &&
      object.localTex?.render &&
      cachedInputs.has(object.id) &&
      cachedInputs.get(object.id) !== equationInputs(object, deck)
    )
      delete object.localTex.render;
  try {
    return { deck: validateDeck(deck), results };
  } catch (error) {
    throw new Error(
      `Batch produced an invalid native document: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A useful editable-content inventory without echoing embedded media or SVG caches. */
export function inspectDeck(input: Deck) {
  const deck = validateDeck(input);
  return {
    formatVersion: deck.formatVersion,
    id: deck.id,
    title: deck.title,
    slideSize: deck.slideSize,
    theme: deck.theme,
    themeId: getDeckThemeId(deck) ?? null,
    pageNumbers: deck.pageNumbers ?? null,
    slides: deck.slides.map((slide, index) => ({
      ...slide,
      index: index + 1,
      objects: slide.objects.map((object, objectIndex) => {
        if (object.type !== "equation" || !object.localTex?.render)
          return { ...object, index: objectIndex + 1 };
        const { svg, ...render } = object.localTex.render;
        return {
          ...object,
          index: objectIndex + 1,
          localTex: {
            ...object.localTex,
            render: { ...render, svgCharacters: svg.length },
          },
        };
      }),
    })),
    assets: deck.assets.map(({ dataUrl, ...asset }) => ({
      ...asset,
      embedded: true,
      dataUrlCharacters: dataUrl.length,
    })),
  };
}
