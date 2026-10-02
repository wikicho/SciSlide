import { createBlankSlide, newId } from "./model";
import type {
  BaseSlideObject,
  Deck,
  EquationObject,
  ShapeObject,
  Slide,
  SlideObject,
  TextObject,
} from "./model";

/** A single scientific starter pack. All layouts become ordinary editable objects. */
export const SLIDE_TEMPLATES = [
  {
    id: "blank",
    name: "Blank",
    description: "An empty canvas for your own layout.",
  },
  {
    id: "title",
    name: "Research title",
    description: "A title, subtitle, author and affiliation.",
  },
  {
    id: "content",
    name: "Key findings",
    description: "Three claims with one clear takeaway.",
  },
  {
    id: "equation",
    name: "Equation + meaning",
    description: "An editable equation with physical interpretation.",
  },
  {
    id: "comparison",
    name: "Figure comparison",
    description: "Two figure placeholders with captions.",
  },
] as const;

export type SlideTemplateId = (typeof SLIDE_TEMPLATES)[number]["id"];

const colors = {
  ink: "#17263c",
  muted: "#657489",
  teal: "#26867a",
  pale: "#f0f6f5",
  line: "#d5e4e0",
  footer: "#8290a2",
};

function base(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): BaseSlideObject {
  return {
    id: newId(),
    type: "shape",
    name,
    transform: { x, y, width, height, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
  };
}

function rect(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = colors.pale,
  stroke = "none",
): ShapeObject {
  return {
    ...base(name, x, y, width, height),
    type: "shape",
    shape: "rect",
    fill,
    stroke,
    strokeWidth: stroke === "none" ? 0 : 2,
  };
}

function text(
  theme: Deck["theme"],
  name: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize = 32,
  color = colors.ink,
  fontWeight = 400,
  align: TextObject["align"] = "left",
): TextObject {
  return {
    ...base(name, x, y, width, height),
    type: "text",
    text: value,
    fontFamily: theme.fontFamily,
    fontSize,
    fontWeight,
    color,
    align,
  };
}

function footer(theme: Deck["theme"]): SlideObject[] {
  return [
    rect("Footer rule", 96, 812, 1408, 2, colors.line),
    text(
      theme,
      "Footer",
      "RESEARCH GROUP / PROJECT",
      96,
      838,
      1150,
      28,
      18,
      colors.footer,
      500,
    ),
  ];
}

function heading(
  theme: Deck["theme"],
  section: string,
  title: string,
  subtitle: string,
): SlideObject[] {
  return [
    rect("Teal accent", 96, 84, 52, 6, colors.teal),
    text(
      theme,
      "Section label",
      section,
      96,
      110,
      1408,
      32,
      20,
      colors.teal,
      600,
    ),
    text(theme, "Title", title, 96, 168, 1408, 86, 60, colors.ink, 600),
    text(theme, "Subtitle", subtitle, 100, 264, 1398, 48, 28, colors.muted),
  ];
}

function titleLayout(theme: Deck["theme"]): Slide {
  return {
    id: newId(),
    title: "Research title",
    background: "#f6f8fa",
    notes:
      "Replace the title, subtitle, author and affiliation with your own research details.",
    objects: [
      rect("Title accent", 100, 114, 64, 7, colors.teal),
      rect("Right accent", 1430, 114, 7, 622, colors.line),
      text(
        theme,
        "Talk label",
        "RESEARCH TALK / SEMINAR",
        100,
        151,
        1200,
        36,
        22,
        colors.teal,
        600,
      ),
      text(
        theme,
        "Research title",
        "Your research,\nclearly presented.",
        100,
        250,
        1220,
        218,
        80,
        colors.ink,
        600,
      ),
      text(
        theme,
        "Research subtitle",
        "A concise statement of your question and contribution.",
        104,
        512,
        1200,
        90,
        32,
        colors.muted,
      ),
      text(
        theme,
        "Author",
        "Your name · Collaborators",
        104,
        657,
        1200,
        45,
        28,
        colors.ink,
        500,
      ),
      text(
        theme,
        "Affiliation and date",
        "Institution / Research group · Conference / Date",
        104,
        709,
        1200,
        40,
        24,
        colors.muted,
      ),
      ...footer(theme),
    ],
  };
}

function contentLayout(theme: Deck["theme"]): Slide {
  const claims = [
    [
      "State the main observation",
      "Describe the evidence in one or two short sentences.",
    ],
    [
      "Explain what changed",
      "Connect the result to a model, method or baseline.",
    ],
    [
      "Make the implication clear",
      "Tell the audience why this finding matters.",
    ],
  ];
  return {
    id: newId(),
    title: "Key findings",
    background: "#ffffff",
    notes:
      "Replace the three numbered claims and the takeaway. Each text box and card is independently editable.",
    objects: [
      ...heading(
        theme,
        "RESULTS / KEY FINDINGS",
        "The central result",
        "Give the audience a concise guide to your evidence.",
      ),
      ...claims.flatMap(([claim, detail], index) => {
        const y = 355 + index * 145;
        return [
          text(
            theme,
            `Finding ${index + 1} marker`,
            `0${index + 1}`,
            100,
            y,
            72,
            48,
            28,
            colors.teal,
            600,
          ),
          text(
            theme,
            `Finding ${index + 1} title`,
            claim,
            200,
            y,
            780,
            50,
            32,
            colors.ink,
            600,
          ),
          text(
            theme,
            `Finding ${index + 1} detail`,
            detail,
            200,
            y + 58,
            780,
            72,
            26,
            colors.muted,
          ),
        ];
      }),
      rect("Takeaway card", 1060, 350, 444, 412),
      rect("Takeaway accent", 1096, 391, 48, 5, colors.teal),
      text(
        theme,
        "Takeaway label",
        "KEY TAKEAWAY",
        1096,
        430,
        370,
        42,
        22,
        colors.teal,
        600,
      ),
      text(
        theme,
        "Takeaway",
        "One sentence\nyour audience\nshould remember.",
        1096,
        497,
        370,
        182,
        36,
        colors.ink,
        500,
      ),
      ...footer(theme),
    ],
  };
}

function equationLayout(theme: Deck["theme"]): Slide {
  const equation: EquationObject = {
    ...base("Core equation", 422, 410, 980, 120),
    type: "equation",
    renderer: "mathjax",
    latex: "E^2 = p^2 c^2 + m^2 c^4",
    displayMode: true,
    // Font and color inherit the deck; this size belongs to the starter layout.
    style: { fontSize: 64 },
    description: "Editable example: the relativistic energy-momentum relation",
  };
  return {
    id: newId(),
    title: "Equation + meaning",
    background: "#ffffff",
    notes:
      "The energy-momentum relation is an example. Replace the editable equation, notation and interpretation for your own subject.",
    objects: [
      ...heading(
        theme,
        "MODEL / CORE EQUATION",
        "The equation behind the result",
        "Introduce the relation, then explain its physical meaning.",
      ),
      rect("Equation panel", 96, 350, 1408, 216),
      text(
        theme,
        "Equation label",
        "ENERGY–MOMENTUM RELATION",
        130,
        372,
        1300,
        34,
        18,
        colors.teal,
        600,
      ),
      equation,
      text(
        theme,
        "Notation label",
        "NOTATION",
        100,
        621,
        580,
        34,
        20,
        colors.teal,
        600,
      ),
      text(
        theme,
        "Notation",
        "E: energy · p: momentum\nm: rest mass · c: speed of light",
        100,
        672,
        615,
        84,
        27,
        colors.muted,
      ),
      rect("Interpretation divider", 756, 621, 2, 138, colors.line),
      text(
        theme,
        "Interpretation label",
        "PHYSICAL MEANING",
        806,
        621,
        650,
        34,
        20,
        colors.teal,
        600,
      ),
      text(
        theme,
        "Interpretation",
        "Energy combines motion and rest mass.\nAt zero momentum, it reduces to E = mc².",
        806,
        672,
        660,
        92,
        27,
        colors.ink,
      ),
      ...footer(theme),
    ],
  };
}

function comparisonLayout(theme: Deck["theme"]): Slide {
  return {
    id: newId(),
    title: "Figure comparison",
    background: "#ffffff",
    notes:
      "The figure areas are editable shapes and text, not imported assets. Add your SVG, PNG or JPEG using Figure, place it over a placeholder, and remove the placeholder objects when ready.",
    objects: [
      ...heading(
        theme,
        "RESULTS / COMPARISON",
        "Compare the evidence",
        "Use the same axes and scale so the difference is easy to see.",
      ),
      ...["A", "B"].flatMap((label, index) => {
        const x = 96 + index * 736;
        return [
          rect(
            `Figure ${label} placeholder`,
            x,
            350,
            672,
            326,
            "#f6f8fa",
            colors.line,
          ),
          rect(`Figure ${label} accent`, x + 302, 444, 68, 4, colors.teal),
          text(
            theme,
            `Figure ${label} placeholder label`,
            `FIGURE ${label}`,
            x + 36,
            470,
            600,
            45,
            25,
            colors.ink,
            600,
            "center",
          ),
          text(
            theme,
            `Figure ${label} placeholder hint`,
            "Add your plot or diagram here",
            x + 36,
            530,
            600,
            44,
            23,
            colors.muted,
            400,
            "center",
          ),
          text(
            theme,
            `Figure ${label} caption`,
            index === 0
              ? "A  /  Baseline or reference"
              : "B  /  Your result or alternative",
            x + 2,
            704,
            668,
            44,
            27,
            colors.ink,
            600,
          ),
          text(
            theme,
            `Figure ${label} explanation`,
            "Describe the condition and the key observation.",
            x + 2,
            750,
            668,
            50,
            24,
            colors.muted,
          ),
        ];
      }),
      ...footer(theme),
    ],
  };
}

/** Generate independent object IDs each time; templates never retain deck data. */
export function createTemplateSlide(
  id: SlideTemplateId,
  theme: Deck["theme"],
): Slide {
  switch (id) {
    case "blank":
      return createBlankSlide();
    case "title":
      return titleLayout(theme);
    case "content":
      return contentLayout(theme);
    case "equation":
      return equationLayout(theme);
    case "comparison":
      return comparisonLayout(theme);
    default:
      throw new Error(`Unknown slide template: ${String(id)}.`);
  }
}
