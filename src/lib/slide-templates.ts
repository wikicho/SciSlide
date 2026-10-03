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

/** Scientific layouts that become ordinary editable objects when inserted. */
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
  {
    id: "section",
    name: "Section divider",
    description: "A bold navy chapter heading with a compact agenda.",
  },
  {
    id: "methods",
    name: "Methods pipeline",
    description: "Three connected steps from inputs to validation.",
  },
  {
    id: "results",
    name: "Results spotlight",
    description: "One large figure, a key metric and its interpretation.",
  },
  {
    id: "closing",
    name: "Takeaways + next steps",
    description: "Three closing ideas, future work and a contact line.",
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

function sectionLayout(theme: Deck["theme"]): Slide {
  const navy = "#132b46";
  const mint = "#75dbc1";
  const white = "#f7fbff";
  const muted = "#b8c9d9";
  return {
    id: newId(),
    title: "Section divider",
    background: navy,
    notes:
      "Replace the section number, chapter heading and three agenda items. The agenda panel is an editable shape behind editable text.",
    objects: [
      rect("Section accent", 96, 84, 72, 6, mint),
      text(
        theme,
        "Section number",
        "02 / SECTION",
        96,
        114,
        940,
        38,
        22,
        mint,
        600,
      ),
      text(
        theme,
        "Chapter heading",
        "Your next\nresearch chapter.",
        96,
        208,
        940,
        244,
        88,
        white,
        600,
      ),
      text(
        theme,
        "Chapter introduction",
        "Introduce the question this section will answer.",
        100,
        492,
        880,
        88,
        30,
        muted,
      ),
      rect("Agenda panel", 1110, 208, 394, 430, "#1d3a56"),
      rect("Agenda accent", 1146, 244, 48, 5, mint),
      text(
        theme,
        "Agenda label",
        "IN THIS SECTION",
        1146,
        282,
        322,
        34,
        20,
        mint,
        600,
      ),
      ...["01  Motivation", "02  Approach", "03  Evidence"].map(
        (value, index) =>
          text(
            theme,
            `Agenda item ${index + 1}`,
            value,
            1146,
            352 + index * 78,
            322,
            48,
            27,
            white,
            500,
          ),
      ),
      rect("Section footer rule", 96, 812, 1408, 2, "#375069"),
      text(
        theme,
        "Section footer",
        "RESEARCH GROUP / PROJECT",
        96,
        838,
        1408,
        28,
        18,
        muted,
        500,
      ),
    ],
  };
}

function methodsLayout(theme: Deck["theme"]): Slide {
  const ink = "#352c24";
  const muted = "#776f61";
  const amber = "#bc7438";
  const steps = [
    ["Inputs", "Describe the data,\nsamples or assumptions."],
    ["Analysis", "Outline the model,\ncomputation or procedure."],
    ["Validation", "Explain the checks,\ncomparisons or criteria."],
  ];
  return {
    id: newId(),
    title: "Methods pipeline",
    background: "#fbf8f1",
    notes:
      "Replace each step with your own workflow. The two arrows are editable vector shapes with explicit left-to-right endpoints; no data or results are supplied.",
    objects: [
      rect("Methods accent", 96, 84, 64, 6, amber),
      text(
        theme,
        "Methods label",
        "METHODS / WORKFLOW",
        96,
        112,
        1408,
        36,
        20,
        amber,
        600,
      ),
      text(
        theme,
        "Methods heading",
        "From inputs to validated results",
        96,
        170,
        1408,
        88,
        60,
        ink,
        600,
      ),
      text(
        theme,
        "Methods introduction",
        "Show the sequence, then explain what each stage contributes.",
        100,
        270,
        1398,
        50,
        28,
        muted,
      ),
      ...steps.flatMap(([label, detail], index) => {
        const x = 96 + index * 488;
        return [
          rect(
            `Step ${index + 1} card`,
            x,
            360,
            432,
            360,
            "#fffefb",
            "#e6ddcf",
          ),
          rect(`Step ${index + 1} accent`, x + 32, 392, 56, 5, amber),
          text(
            theme,
            `Step ${index + 1} number`,
            `0${index + 1}`,
            x + 32,
            421,
            368,
            64,
            44,
            amber,
            500,
          ),
          text(
            theme,
            `Step ${index + 1} label`,
            label,
            x + 32,
            500,
            368,
            48,
            34,
            ink,
            600,
          ),
          text(
            theme,
            `Step ${index + 1} description`,
            detail,
            x + 32,
            573,
            368,
            108,
            26,
            muted,
          ),
        ];
      }),
      ...[544, 1032].map((x, index): ShapeObject => ({
        ...base(`Pipeline arrow ${index + 1}`, x, 529, 32, 12),
        type: "shape",
        shape: "arrow",
        fill: "none",
        stroke: amber,
        strokeWidth: 3,
        strokeStyle: "solid",
        line: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
        startArrow: false,
        endArrow: true,
      })),
      text(
        theme,
        "Workflow caption",
        "Caption / Summarize what passes between the three steps.",
        100,
        756,
        1398,
        46,
        24,
        muted,
      ),
      rect("Methods footer rule", 96, 824, 1408, 2, "#e6ddcf"),
      text(
        theme,
        "Methods footer",
        "RESEARCH GROUP / PROJECT",
        96,
        848,
        1408,
        28,
        18,
        muted,
        500,
      ),
    ],
  };
}

function resultsLayout(theme: Deck["theme"]): Slide {
  const blue = "#315778";
  const ink = "#1b2b3d";
  const muted = "#677586";
  return {
    id: newId(),
    title: "Results spotlight",
    background: "#ffffff",
    notes:
      "All content is a placeholder, not a scientific result. Use Figure to add your own plot over the editable left panel, then remove the placeholder shape and labels. Replace the value, units, interpretation, caption and takeaway with evidence from your work.",
    objects: [
      rect("Results accent", 96, 84, 64, 6, blue),
      text(
        theme,
        "Results label",
        "RESULTS / SPOTLIGHT",
        96,
        112,
        1408,
        36,
        20,
        blue,
        600,
      ),
      text(
        theme,
        "Results heading",
        "Let the evidence lead",
        96,
        170,
        1408,
        88,
        60,
        ink,
        600,
      ),
      text(
        theme,
        "Results introduction",
        "Pair one clear figure with the result your audience should remember.",
        100,
        270,
        1398,
        50,
        28,
        muted,
      ),
      rect("Main figure placeholder", 96, 350, 920, 370, "#f4f6f8", "#dce1e7"),
      rect("Figure placeholder accent", 522, 448, 68, 4, blue),
      text(
        theme,
        "Main figure label",
        "YOUR FIGURE / PLOT",
        132,
        482,
        848,
        48,
        28,
        ink,
        600,
        "center",
      ),
      text(
        theme,
        "Main figure hint",
        "Add your own evidence here",
        132,
        544,
        848,
        44,
        24,
        muted,
        400,
        "center",
      ),
      text(
        theme,
        "Main figure caption",
        "Caption / Describe the axes, condition and source.",
        100,
        748,
        912,
        58,
        24,
        muted,
      ),
      text(
        theme,
        "Key result label",
        "KEY RESULT",
        1100,
        354,
        404,
        36,
        20,
        blue,
        600,
      ),
      text(
        theme,
        "Key result value",
        "[Insert value]",
        1100,
        408,
        404,
        82,
        52,
        ink,
        600,
      ),
      text(
        theme,
        "Key result units",
        "[Units / uncertainty]",
        1100,
        500,
        404,
        42,
        24,
        muted,
      ),
      text(
        theme,
        "Interpretation label",
        "INTERPRETATION",
        1100,
        582,
        404,
        34,
        19,
        blue,
        600,
      ),
      text(
        theme,
        "Result interpretation",
        "[Explain what the\nmeasurement shows.]",
        1100,
        632,
        404,
        84,
        26,
        ink,
      ),
      rect("Result takeaway card", 1080, 746, 424, 64, blue),
      text(
        theme,
        "Result takeaway",
        "[Add a concise takeaway.]",
        1108,
        761,
        368,
        36,
        21,
        "#ffffff",
        500,
      ),
      rect("Results footer rule", 96, 830, 1408, 2, "#dce1e7"),
      text(
        theme,
        "Results footer",
        "RESEARCH GROUP / PROJECT",
        96,
        850,
        1408,
        28,
        18,
        muted,
        500,
      ),
    ],
  };
}

function closingLayout(theme: Deck["theme"]): Slide {
  const green = "#3d836c";
  const ink = "#17382f";
  const muted = "#587268";
  const takeaways = [
    [
      "State your central finding",
      "[Add one sentence supported by your evidence.]",
    ],
    [
      "Explain why it matters",
      "[Connect the finding to your original question.]",
    ],
    [
      "Leave a clear final message",
      "[Name the idea your audience should remember.]",
    ],
  ];
  return {
    id: newId(),
    title: "Takeaways + next steps",
    background: "#eef7f1",
    notes:
      "Replace the three takeaways with supported conclusions. Fill in the next-step prompts and your contact details. Each number, text box and panel remains editable.",
    objects: [
      rect("Closing accent", 96, 84, 64, 6, green),
      text(
        theme,
        "Closing label",
        "CONCLUSIONS / WHAT COMES NEXT",
        96,
        112,
        1408,
        36,
        20,
        green,
        600,
      ),
      text(
        theme,
        "Closing heading",
        "What to remember",
        96,
        170,
        1408,
        88,
        64,
        ink,
        600,
      ),
      text(
        theme,
        "Closing introduction",
        "Leave the audience with three ideas and a next step.",
        100,
        270,
        1398,
        50,
        28,
        muted,
      ),
      ...takeaways.flatMap(([title, detail], index) => {
        const y = 366 + index * 140;
        return [
          text(
            theme,
            `Takeaway ${index + 1} number`,
            `0${index + 1}`,
            100,
            y,
            72,
            60,
            42,
            green,
            500,
          ),
          text(
            theme,
            `Takeaway ${index + 1} heading`,
            title,
            204,
            y,
            790,
            46,
            30,
            ink,
            600,
          ),
          text(
            theme,
            `Takeaway ${index + 1} detail`,
            detail,
            204,
            y + 56,
            790,
            64,
            24,
            muted,
          ),
        ];
      }),
      rect("Next steps panel", 1060, 352, 444, 415, "#173e39"),
      rect("Next steps accent", 1096, 392, 52, 5, "#83d9bb"),
      text(
        theme,
        "Next steps label",
        "NEXT STEPS",
        1096,
        429,
        372,
        38,
        23,
        "#83d9bb",
        600,
      ),
      text(
        theme,
        "Next step priority",
        "[Priority or open question]",
        1096,
        488,
        372,
        66,
        26,
        "#f4fff9",
        500,
      ),
      text(
        theme,
        "Next step plan",
        "[Planned test or follow-up]",
        1096,
        572,
        372,
        66,
        26,
        "#f4fff9",
        500,
      ),
      text(
        theme,
        "Next steps hint",
        "Make the path forward\nspecific and actionable.",
        1096,
        678,
        372,
        66,
        23,
        "#b5d5c8",
      ),
      rect("Contact divider", 96, 802, 1408, 2, "#c8e0d3"),
      text(
        theme,
        "Closing contact",
        "Your name · your.email@example.org · Project / Lab",
        100,
        830,
        1398,
        36,
        22,
        ink,
        500,
      ),
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
    case "section":
      return sectionLayout(theme);
    case "methods":
      return methodsLayout(theme);
    case "results":
      return resultsLayout(theme);
    case "closing":
      return closingLayout(theme);
    default:
      throw new Error(`Unknown slide template: ${String(id)}.`);
  }
}
