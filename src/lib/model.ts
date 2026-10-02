import { sanitizeLocalEquationSvg } from "./local-equation-svg";
import {
  MAX_EQUATION_SOURCE_CHARACTERS,
  MAX_LOCAL_PREAMBLE_CHARACTERS,
} from "./local-tex-draft";

export type FontSetId = "mathjax-stix2" | "mathjax-fira" | "mathjax-modern";
export type LocalTexEngine = "latex" | "xelatex";
export interface LocalTexRender {
  svg: string;
  width: number;
  height: number;
  inputFingerprint: string;
  profile: {
    engine: string;
    engineVersion: string;
    converterVersion: string;
    dependencies: Array<{ name: string; sha256: string }>;
  };
  warnings: string[];
}
export interface LocalTexConfiguration {
  engine: LocalTexEngine;
  preamble: string;
  render?: LocalTexRender;
}

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface BaseSlideObject {
  id: string;
  type: "text" | "equation" | "figure" | "shape";
  name: string;
  transform: Transform;
  opacity: number;
  visible: boolean;
  locked: boolean;
  metadata: Record<string, unknown>;
}

export interface TextObject extends BaseSlideObject {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
}

export interface EquationObject extends BaseSlideObject {
  type: "equation";
  latex: string;
  style: { fontSetId?: FontSetId; fontSize?: number; color?: string };
  displayMode: boolean;
  description: string;
  renderer?: "mathjax" | "local-latex";
  localTex?: LocalTexConfiguration;
}

export interface FigureObject extends BaseSlideObject {
  type: "figure";
  assetId: string;
  alt: string;
}

export interface ShapeObject extends BaseSlideObject {
  type: "shape";
  shape: "rect" | "ellipse";
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export type SlideObject =
  TextObject | EquationObject | FigureObject | ShapeObject;
export type AnySlideObject = SlideObject;

export interface Slide {
  id: string;
  title: string;
  background: string;
  notes: string;
  objects: AnySlideObject[];
}

export interface Asset {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface Deck {
  formatVersion: "0.2.0";
  id: string;
  title: string;
  slideSize: { width: number; height: number; unit: "px96" };
  theme: {
    equation: { fontSetId: FontSetId; fontSize: number; color: string };
    fontFamily: string;
  };
  slides: Slide[];
  assets: Asset[];
}

export const FONT_SET_IDS: readonly FontSetId[] = [
  "mathjax-stix2",
  "mathjax-fira",
  "mathjax-modern",
];
export const SUPPORTED_IMAGE_MIMES = [
  "image/svg+xml",
  "image/png",
  "image/jpeg",
] as const;

export function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export function createBlankSlide(): Slide {
  return {
    id: newId(),
    title: "Untitled slide",
    background: "#ffffff",
    notes: "",
    objects: [],
  };
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, at: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${at} must be an object.`);
  return value as UnknownRecord;
}

function string(
  value: unknown,
  at: string,
  max = 2000,
): asserts value is string {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${at} must be text shorter than ${max} characters.`);
}

function id(value: unknown, at: string): asserts value is string {
  string(value, at, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value))
    throw new Error(`${at} is not a valid identifier.`);
}

function number(
  value: unknown,
  at: string,
  min = -1_000_000,
  max = 1_000_000,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${at} must be a finite number between ${min} and ${max}.`);
}

function boolean(value: unknown, at: string): asserts value is boolean {
  if (typeof value !== "boolean")
    throw new Error(`${at} must be true or false.`);
}

function color(value: unknown, at: string): asserts value is string {
  string(value, at, 64);
  // An explicit subset is portable across browser SVG and PDF export, with no URL-based paints.
  if (
    !/^(#[\da-fA-F]{3,8}|transparent|none|[a-zA-Z]{1,24}|rgba?\([\d\s.,%]+\))$/.test(
      value,
    )
  )
    throw new Error(`${at} is not a supported color.`);
}

function fontSet(value: unknown, at: string): asserts value is FontSetId {
  if (!FONT_SET_IDS.includes(value as FontSetId))
    throw new Error(`${at} uses an unavailable math font.`);
}

function array(
  value: unknown,
  at: string,
  max: number,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${at} must be a list with at most ${max} items.`);
}

function uniqueId(value: unknown, at: string, identifiers: Set<string>): void {
  id(value, at);
  if (identifiers.has(value))
    throw new Error(`${at} duplicates the identifier “${value}”.`);
  identifiers.add(value);
}

/** Validate before a loaded document can replace the current deck. Unknown metadata is retained. */
export function validateDeck(value: unknown): Deck {
  const deck = record(value, "Document");
  if (deck.formatVersion !== "0.1.0" && deck.formatVersion !== "0.2.0")
    throw new Error(
      `Unsupported SciSlide format: ${String(deck.formatVersion)}. This build reads 0.1.0 and 0.2.0.`,
    );
  const identifiers = new Set<string>();
  uniqueId(deck.id, "Document ID", identifiers);
  string(deck.title, "Document title");
  const size = record(deck.slideSize, "Slide size");
  number(size.width, "Slide width", 100, 20_000);
  number(size.height, "Slide height", 100, 20_000);
  if (size.unit !== "px96") throw new Error("Slide units must be px96.");
  const theme = record(deck.theme, "Theme");
  string(theme.fontFamily, "Text font", 200);
  const equationTheme = record(theme.equation, "Equation theme");
  fontSet(equationTheme.fontSetId, "Equation theme");
  number(equationTheme.fontSize, "Equation font size", 4, 500);
  color(equationTheme.color, "Equation color");
  array(deck.assets, "Assets", 500);
  const assetIds = new Set<string>();
  deck.assets.forEach((value, index) => {
    const asset = record(value, `Asset ${index + 1}`);
    uniqueId(asset.id, "Asset ID", identifiers);
    assetIds.add(asset.id as string);
    string(asset.name, "Asset name");
    if (
      !SUPPORTED_IMAGE_MIMES.includes(
        asset.mime as (typeof SUPPORTED_IMAGE_MIMES)[number],
      )
    )
      throw new Error("Unsupported figure type; use SVG, PNG, or JPEG.");
    string(asset.dataUrl, "Figure content", 32 * 1024 * 1024);
    if (!(asset.dataUrl as string).startsWith(`data:${asset.mime}`))
      throw new Error("Figure content does not match its media type.");
    number(asset.width, "Figure width", 0.01, 100_000);
    number(asset.height, "Figure height", 0.01, 100_000);
  });
  array(deck.slides, "Slides", 1000);
  if (!deck.slides.length)
    throw new Error("A deck must contain at least one slide.");
  let objectCount = 0;
  deck.slides.forEach((value, slideIndex) => {
    const slide = record(value, `Slide ${slideIndex + 1}`);
    uniqueId(slide.id, "Slide ID", identifiers);
    string(slide.title, "Slide title");
    color(slide.background, "Slide background");
    string(slide.notes, "Slide notes", 100_000);
    array(slide.objects, "Slide objects", 1000);
    objectCount += slide.objects.length;
    if (objectCount > 10_000)
      throw new Error("This deck exceeds the 10,000-object limit.");
    slide.objects.forEach((value) => {
      const object = record(value, "Slide object");
      uniqueId(object.id, "Object ID", identifiers);
      string(object.name, "Object name");
      number(object.opacity, "Object opacity", 0, 1);
      boolean(object.visible, "Object visibility");
      boolean(object.locked, "Object lock");
      record(object.metadata, "Object metadata");
      const transform = record(object.transform, "Object transform");
      number(transform.x, "Object x");
      number(transform.y, "Object y");
      number(transform.width, "Object width", 0.01);
      number(transform.height, "Object height", 0.01);
      number(transform.rotation, "Object rotation", -360_000, 360_000);
      switch (object.type) {
        case "text":
          string(object.text, "Text content", 100_000);
          string(object.fontFamily, "Text font", 200);
          number(object.fontSize, "Text size", 4, 500);
          number(object.fontWeight, "Text weight", 100, 1000);
          color(object.color, "Text color");
          if (!["left", "center", "right"].includes(object.align as string))
            throw new Error("Unsupported text alignment.");
          break;
        case "equation": {
          string(
            object.latex,
            "Equation source",
            MAX_EQUATION_SOURCE_CHARACTERS,
          );
          boolean(object.displayMode, "Equation display mode");
          string(object.description, "Equation description", 10_000);
          const style = record(object.style, "Equation style");
          if (style.fontSetId !== undefined)
            fontSet(style.fontSetId, "Equation font");
          if (style.fontSize !== undefined)
            number(style.fontSize, "Equation size", 4, 500);
          if (style.color !== undefined) color(style.color, "Equation color");
          if (
            object.renderer !== undefined &&
            !["mathjax", "local-latex"].includes(object.renderer as string)
          )
            throw new Error("Unsupported equation renderer.");
          if (
            object.renderer === "local-latex" &&
            object.localTex === undefined
          )
            throw new Error("Local LaTeX equation settings are missing.");
          if (object.localTex !== undefined) {
            const local = record(object.localTex, "Local LaTeX settings");
            if (!["latex", "xelatex"].includes(local.engine as string))
              throw new Error("Choose latex or xelatex for Local LaTeX.");
            string(
              local.preamble,
              "Local LaTeX preamble",
              MAX_LOCAL_PREAMBLE_CHARACTERS,
            );
            if (local.render !== undefined) {
              const render = record(local.render, "Local LaTeX render");
              string(render.svg, "Local LaTeX SVG", 2 * 1024 * 1024);
              sanitizeLocalEquationSvg(render.svg);
              number(render.width, "Local LaTeX width", 0.01, 100_000);
              number(render.height, "Local LaTeX height", 0.01, 100_000);
              string(
                render.inputFingerprint,
                "Local LaTeX input fingerprint",
                100_000,
              );
              const profile = record(render.profile, "Local LaTeX profile");
              string(profile.engine, "Local LaTeX engine", 200);
              string(profile.engineVersion, "Local LaTeX engine version", 1000);
              string(
                profile.converterVersion,
                "Local LaTeX converter version",
                1000,
              );
              array(profile.dependencies, "Local LaTeX dependencies", 2000);
              for (const entry of profile.dependencies) {
                const dependency = record(entry, "Local LaTeX dependency");
                string(dependency.name, "Local LaTeX dependency name", 2000);
                if (
                  typeof dependency.sha256 !== "string" ||
                  !/^[a-f0-9]{64}$/.test(dependency.sha256)
                )
                  throw new Error(
                    "A Local LaTeX dependency fingerprint is invalid.",
                  );
              }
              array(render.warnings, "Local LaTeX warnings", 100);
              render.warnings.forEach((warning) =>
                string(warning, "Local LaTeX warning", 2000),
              );
            }
          }
          break;
        }
        case "figure":
          id(object.assetId, "Figure asset reference");
          if (!assetIds.has(object.assetId as string))
            throw new Error(`Missing figure asset: ${String(object.assetId)}.`);
          string(object.alt, "Figure description", 10_000);
          break;
        case "shape":
          if (!["rect", "ellipse"].includes(object.shape as string))
            throw new Error("Unsupported shape.");
          color(object.fill, "Shape fill");
          color(object.stroke, "Shape stroke");
          number(object.strokeWidth, "Shape stroke width", 0, 1000);
          break;
        default:
          throw new Error(`Unsupported slide object: ${String(object.type)}.`);
      }
    });
  });
  const snapshot = JSON.parse(
    JSON.stringify({ ...deck, formatVersion: "0.2.0" }),
  ) as Deck;
  for (const slide of snapshot.slides)
    for (const object of slide.objects) {
      if (object.type === "equation" && object.localTex?.render)
        object.localTex.render.svg = sanitizeLocalEquationSvg(
          object.localTex.render.svg,
        );
    }
  return snapshot;
}

function common(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return {
    id: newId(),
    name,
    transform: { x, y, width, height, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
  };
}

function text(
  name: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize = 36,
  color = "#263449",
  fontWeight = 400,
): TextObject {
  return {
    ...common(name, x, y, width, height),
    type: "text",
    text: value,
    fontFamily: "Inter",
    fontSize,
    fontWeight,
    color,
    align: "left",
  };
}

function shape(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): ShapeObject {
  return {
    ...common(name, x, y, width, height),
    type: "shape",
    shape: "rect",
    fill,
    stroke: "none",
    strokeWidth: 0,
  };
}

function equation(
  name: string,
  latex: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize = 45,
): EquationObject {
  return {
    ...common(name, x, y, width, height),
    type: "equation",
    latex,
    displayMode: true,
    style: { fontSize },
    description: name,
  };
}

function spectrumSvg(): string {
  const curve = (peak: number, amplitude: number) =>
    Array.from({ length: 121 }, (_, i) => {
      const x = 74 + i * 3.8;
      const logFrequency = -4 + i / 30;
      const scaled = 10 ** (logFrequency - peak);
      const signal = amplitude * (scaled ** 3 / (1 + scaled ** 2) ** 2);
      const y =
        368 -
        Math.max(
          0,
          Math.min(280, 65 * (Math.log10(Math.max(signal, 0.00001)) + 5)),
        );
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="500" viewBox="0 0 620 500"><rect width="620" height="500" rx="22" fill="#ffffff"/><text x="40" y="46" font-family="Inter,Arial,sans-serif" font-size="20" font-weight="600" fill="#17263c">A possible gravitational-wave signal</text><text x="40" y="73" font-family="Inter,Arial,sans-serif" font-size="13" fill="#768396">Illustrative spectra · arbitrary normalization</text><g stroke="#e5eaf0" stroke-dasharray="4 6">${[120, 200, 280, 360].map((y) => `<path d="M74 ${y}H550"/>`).join("")}${[74, 188, 302, 416, 530].map((x) => `<path d="M${x} 104V368"/>`).join("")}</g><path d="M74 104V368H550" fill="none" stroke="#8895a7" stroke-width="1.5"/><path d="${curve(-1.6, 0.36)}" fill="none" stroke="#26867a" stroke-width="4"/><path d="${curve(-1.0, 0.11)}" fill="none" stroke="#6d78c4" stroke-width="3"/><path d="${curve(-2.2, 0.025)}" fill="none" stroke="#d1a267" stroke-width="3"/><g fill="#657489" font-family="Inter,Arial,sans-serif" font-size="13"><text x="57" y="373" text-anchor="end">10<tspan dy="-5" font-size="9">-5</tspan></text><text x="57" y="285" text-anchor="end">10<tspan dy="-5" font-size="9">-3</tspan></text><text x="57" y="197" text-anchor="end">10<tspan dy="-5" font-size="9">-1</tspan></text><text x="74" y="393" text-anchor="middle">10<tspan dy="-5" font-size="9">-4</tspan></text><text x="188" y="393" text-anchor="middle">10<tspan dy="-5" font-size="9">-3</tspan></text><text x="302" y="393" text-anchor="middle">10<tspan dy="-5" font-size="9">-2</tspan></text><text x="416" y="393" text-anchor="middle">10<tspan dy="-5" font-size="9">-1</tspan></text><text x="530" y="393" text-anchor="middle">1</text><text x="309" y="422" text-anchor="middle">Frequency f [Hz]</text><text transform="translate(23 241) rotate(-90)" text-anchor="middle">Signal amplitude</text></g><g font-family="Inter,Arial,sans-serif" font-size="13"><path d="M82 459H106" stroke="#26867a" stroke-width="4"/><text x="116" y="464" fill="#657489">Benchmark A</text><path d="M260 459H284" stroke="#6d78c4" stroke-width="3"/><text x="294" y="464" fill="#657489">Benchmark B</text><path d="M438 459H462" stroke="#d1a267" stroke-width="3"/><text x="472" y="464" fill="#657489">Benchmark C</text></g></svg>`;
}

/** Original illustrative content; the plot is a demo, not experimental data. */
export function createDemoDeck(): Deck {
  const assetId = newId();
  const asset: Asset = {
    id: assetId,
    name: "illustrative-phase-transition-spectrum.svg",
    mime: "image/svg+xml",
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(spectrumSvg())}`,
    width: 620,
    height: 500,
  };
  const first: Slide = {
    id: newId(),
    title: "A window into the early Universe",
    background: "#f6f8fa",
    notes:
      "This is an illustrative scientific deck. The spectra are synthetic demo curves and are not an experimental prediction. Introduce the phase-transition energy ratio before discussing the spectrum.",
    objects: [
      shape("Teal accent", 100, 108, 52, 6, "#26867a"),
      text(
        "Section label",
        "COSMOLOGY / RESEARCH BRIEF",
        100,
        138,
        780,
        35,
        22,
        "#26867a",
        600,
      ),
      text(
        "Title",
        "A window into the\nearly Universe",
        100,
        208,
        745,
        196,
        69,
        "#17263c",
        600,
      ),
      text(
        "Introduction",
        "First-order phase transitions can leave\na gravitational-wave signature.\n\nThe energy released sets the stage.",
        104,
        440,
        690,
        196,
        32,
        "#657489",
      ),
      equation(
        "Transition strength",
        "\\alpha = \\frac{\\rho_{\\mathrm{vac}}}{\\rho_{\\mathrm{rad}}}",
        112,
        682,
        560,
        110,
        51,
      ),
      {
        ...common("Illustrative spectrum", 876, 218, 640, 516),
        type: "figure",
        assetId,
        alt: "Three illustrative peaked gravitational-wave spectra on logarithmic frequency axes.",
      },
      text(
        "Footer",
        "SCISLIDE  /  SCIENTIFIC PRESENTATIONS",
        104,
        828,
        1100,
        28,
        17,
        "#8290a2",
        500,
      ),
      text("Slide number", "01", 1430, 818, 70, 42, 23, "#657489", 500),
    ],
  };
  const second: Slide = {
    id: newId(),
    title: "Three parameters, one signal",
    background: "#ffffff",
    notes:
      "Define the transition strength alpha, inverse duration beta/H*, and characteristic transition temperature. These formulas show how editable equation objects coexist with explanatory text.",
    objects: [
      shape("Teal accent", 100, 108, 52, 6, "#26867a"),
      text(
        "Section label",
        "THE PHYSICAL PICTURE",
        100,
        138,
        1200,
        35,
        22,
        "#26867a",
        600,
      ),
      text(
        "Title",
        "Three parameters, one signal",
        100,
        212,
        1380,
        95,
        64,
        "#17263c",
        600,
      ),
      text(
        "Subtitle",
        "A compact language for the dynamics of a phase transition.",
        104,
        325,
        1360,
        60,
        31,
        "#657489",
      ),
      shape("Strength card", 100, 436, 438, 316, "#f0f6f5"),
      shape("Duration card", 582, 436, 438, 316, "#f2f3fa"),
      shape("Temperature card", 1064, 436, 438, 316, "#faf5ee"),
      text(
        "Strength label",
        "01   STRENGTH",
        134,
        468,
        375,
        36,
        22,
        "#26867a",
        600,
      ),
      equation(
        "Energy-density ratio",
        "\\alpha = \\frac{\\rho_{\\mathrm{vac}}}{\\rho_{\\mathrm{rad}}}",
        134,
        542,
        368,
        105,
        43,
      ),
      text(
        "Strength description",
        "How much energy is released\ninto the cosmic plasma?",
        134,
        677,
        370,
        66,
        24,
        "#657489",
      ),
      text(
        "Duration label",
        "02   DURATION",
        616,
        468,
        370,
        36,
        22,
        "#6d78c4",
        600,
      ),
      equation(
        "Inverse transition duration",
        "\\frac{\\beta}{H_*}",
        640,
        542,
        310,
        104,
        49,
      ),
      text(
        "Duration description",
        "How rapidly does the\ntransition complete?",
        616,
        677,
        370,
        66,
        24,
        "#657489",
      ),
      text(
        "Temperature label",
        "03   TEMPERATURE",
        1098,
        468,
        370,
        36,
        22,
        "#ae8047",
        600,
      ),
      equation(
        "Characteristic temperature",
        "T_* \\sim 100\\,\\mathrm{GeV}",
        1098,
        556,
        367,
        91,
        38,
      ),
      text(
        "Temperature description",
        "Which energy scale\nsets the characteristic peak?",
        1098,
        677,
        370,
        66,
        24,
        "#657489",
      ),
      text(
        "Footer",
        "SCISLIDE  /  SCIENTIFIC PRESENTATIONS",
        104,
        828,
        1100,
        28,
        17,
        "#8290a2",
        500,
      ),
      text("Slide number", "02", 1430, 818, 70, 42, 23, "#657489", 500),
    ],
  };
  const third: Slide = {
    id: newId(),
    title: "From source to a scientific story",
    background: "#f6f8fa",
    notes:
      "Use this slide to explore the editor. Double-click an equation to edit its LaTeX, choose a mathematical font, import your own scientific figure, then save and reopen a portable .scislide file.",
    objects: [
      shape("Teal accent", 100, 108, 52, 6, "#26867a"),
      text(
        "Section label",
        "YOUR NEXT SCIENTIFIC STORY",
        100,
        138,
        1200,
        35,
        22,
        "#26867a",
        600,
      ),
      text(
        "Title",
        "Keep the science editable.",
        100,
        212,
        1400,
        100,
        65,
        "#17263c",
        600,
      ),
      text(
        "Subtitle",
        "Compose visually. Refine the mathematics. Share a portable deck.",
        104,
        335,
        1380,
        74,
        32,
        "#657489",
      ),
      shape("Summary panel", 100, 465, 1400, 281, "#ffffff"),
      text(
        "Equations title",
        "Native equations",
        140,
        511,
        398,
        49,
        31,
        "#17263c",
        600,
      ),
      text(
        "Equations body",
        "LaTeX source stays editable.\nChoose STIX Two, Fira Math,\nor Latin Modern.",
        140,
        583,
        396,
        120,
        25,
        "#657489",
      ),
      text(
        "Figures title",
        "Scientific figures",
        602,
        511,
        398,
        49,
        31,
        "#17263c",
        600,
      ),
      text(
        "Figures body",
        "Import SVG, PNG, or JPEG.\nArrange figures freely\non your slide.",
        602,
        583,
        394,
        120,
        25,
        "#657489",
      ),
      text(
        "Portability title",
        "Portable by design",
        1064,
        511,
        398,
        49,
        31,
        "#17263c",
        600,
      ),
      text(
        "Portability body",
        "Save source and assets\nin one .scislide file.\nPresent and export PDF.",
        1064,
        583,
        394,
        120,
        25,
        "#657489",
      ),
      text(
        "Footer",
        "SCISLIDE  /  SCIENTIFIC PRESENTATIONS",
        104,
        828,
        1100,
        28,
        17,
        "#8290a2",
        500,
      ),
      text("Slide number", "03", 1430, 818, 70, 42, 23, "#657489", 500),
    ],
  };
  return {
    formatVersion: "0.2.0",
    id: newId(),
    title: "Signals from the early Universe",
    slideSize: { width: 1600, height: 900, unit: "px96" },
    theme: {
      fontFamily: "Inter",
      equation: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#17263c" },
    },
    slides: [first, second, third],
    assets: [asset],
  };
}
