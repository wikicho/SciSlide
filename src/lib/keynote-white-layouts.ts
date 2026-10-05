import { newId } from "./model";
import type {
  BaseSlideObject,
  Deck,
  ShapeObject,
  Slide,
  SlideObject,
  TextObject,
} from "./model";

/** Original, editable layouts inspired by the supplied white-theme reference. */
export const KEYNOTE_WHITE_LAYOUTS = [
  {
    id: "keynote-white-title",
    name: "Title",
    description: "A strong opening title, subtitle and author on white.",
    category: "keynote",
  },
  {
    id: "keynote-white-title-photo",
    name: "Title & Photo",
    description: "A full-slide photo with a title at the lower left.",
    category: "keynote",
  },
  {
    id: "keynote-white-title-photo-alternate",
    name: "Title & Photo Alternate",
    description: "A generous right-hand photo beside a compact opening title.",
    category: "keynote",
  },
  {
    id: "keynote-white-title-bullets",
    name: "Title & Bullets",
    description: "A heading, subtitle and simple bullet list.",
    category: "keynote",
  },
  {
    id: "keynote-white-bullets",
    name: "Bullets",
    description: "An uncluttered bullet list with space for the discussion.",
    category: "keynote",
  },
  {
    id: "keynote-white-title-bullets-photo",
    name: "Title, Bullets & Photo",
    description: "A concise list with a large photo in the right column.",
    category: "keynote",
  },
  {
    id: "keynote-white-small-video",
    name: "Title, Bullets & Small Video",
    description: "A small video placeholder beside the main talking points.",
    category: "keynote",
  },
  {
    id: "keynote-white-large-video",
    name: "Title, Bullets & Large Video",
    description: "A large video placeholder beside a short heading and list.",
    category: "keynote",
  },
  {
    id: "keynote-white-section",
    name: "Section",
    description: "One bold section heading with generous white space.",
    category: "keynote",
  },
  {
    id: "keynote-white-title-only",
    name: "Title Only",
    description: "A compact heading and subtitle above an open canvas.",
    category: "keynote",
  },
  {
    id: "keynote-white-agenda",
    name: "Agenda",
    description: "A clear outline for the ideas that follow.",
    category: "keynote",
  },
  {
    id: "keynote-white-statement",
    name: "Statement",
    description: "A single centered statement without distractions.",
    category: "keynote",
  },
  {
    id: "keynote-white-fact",
    name: "Important Fact",
    description: "An oversized number with a short supporting label.",
    category: "keynote",
  },
  {
    id: "keynote-white-quote",
    name: "Quote",
    description: "A prominent quotation and a quiet attribution.",
    category: "keynote",
  },
  {
    id: "keynote-white-three-photos",
    name: "Three Photos",
    description: "One large photo beside two smaller stacked photos.",
    category: "keynote",
  },
] as const;

export type KeynoteWhiteLayoutId = (typeof KEYNOTE_WHITE_LAYOUTS)[number]["id"];

const ink = "#111111";
const muted = "#666666";
const photoFill = "#ededed";
const videoFill = "#242424";
const margin = 84;

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

function text(
  theme: Deck["theme"],
  name: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  fontWeight = 400,
  color = ink,
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

function shape(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  kind: ShapeObject["shape"] = "rect",
): ShapeObject {
  return {
    ...base(name, x, y, width, height),
    type: "shape",
    shape: kind,
    fill,
    stroke: "none",
    strokeWidth: 0,
  };
}

/** Replacement can remove only this frame's decorative siblings. */
function decoration<T extends SlideObject>(object: T, frame: ShapeObject): T {
  object.metadata.mediaPlaceholderFor = frame.id;
  return object;
}

function photo(
  theme: Deck["theme"],
  x: number,
  y: number,
  width: number,
  height: number,
  fullSlide = false,
): SlideObject[] {
  const frame = shape("Photo placeholder", x, y, width, height, photoFill);
  frame.metadata.mediaPlaceholder = "photo";
  const labelWidth = Math.min(width - 32, fullSlide ? 520 : 440);
  const labelX = fullSlide
    ? x + width - labelWidth - margin
    : x + (width - labelWidth) / 2;
  return [
    frame,
    decoration(
      text(
        theme,
        "Photo placeholder label",
        "Add a photo",
        labelX,
        y + height / 2 - 24,
        labelWidth,
        56,
        Math.min(30, width / 13),
        400,
        "#8c8c8c",
        "center",
      ),
      frame,
    ),
  ];
}

function video(
  theme: Deck["theme"],
  x: number,
  y: number,
  width: number,
  height: number,
): SlideObject[] {
  const frame = shape("Video placeholder", x, y, width, height, videoFill);
  frame.metadata.mediaPlaceholder = "video";
  const unit = Math.min(width, height);
  return [
    frame,
    decoration(
      shape(
        "Video placeholder avatar head",
        x + width / 2 - unit * 0.13,
        y + height * 0.2,
        unit * 0.26,
        unit * 0.26,
        "#ffffff",
        "ellipse",
      ),
      frame,
    ),
    decoration(
      shape(
        "Video placeholder avatar body",
        x + width / 2 - unit * 0.28,
        y + height * 0.53,
        unit * 0.56,
        unit * 0.3,
        "#ffffff",
        "ellipse",
      ),
      frame,
    ),
    decoration(
      text(
        theme,
        "Video placeholder label",
        "Add a video",
        x + 20,
        y + height - 48,
        width - 40,
        36,
        Math.min(24, unit / 14),
        400,
        "#bcbcbc",
        "center",
      ),
      frame,
    ),
  ];
}

function heading(theme: Deck["theme"], width = 1432): SlideObject[] {
  return [
    text(theme, "Title", "Presentation title", margin, 78, width, 100, 68, 700),
    text(
      theme,
      "Subtitle",
      "A short subtitle",
      margin,
      184,
      width,
      64,
      32,
      400,
      muted,
    ),
  ];
}

function bullets(theme: Deck["theme"], width = 1300, y = 296): TextObject {
  return text(
    theme,
    "Bullet points",
    "• First key point\n• Second key point\n• Third key point",
    margin,
    y,
    width,
    330,
    38,
  );
}

/** Every insertion gets fresh IDs and uses ordinary editable slide objects. */
export function createKeynoteWhiteSlide(
  id: KeynoteWhiteLayoutId,
  theme: Deck["theme"],
): Slide {
  const layout = KEYNOTE_WHITE_LAYOUTS.find((candidate) => candidate.id === id);
  if (!layout) throw new Error(`Unknown Keynote White layout: ${String(id)}.`);
  let objects: SlideObject[];
  switch (id) {
    case "keynote-white-title":
      objects = [
        text(
          theme,
          "Title",
          "Presentation title",
          margin,
          340,
          1432,
          144,
          96,
          700,
        ),
        text(
          theme,
          "Subtitle",
          "A clear idea, beautifully presented.",
          margin,
          498,
          1432,
          76,
          36,
          400,
          muted,
        ),
        text(theme, "Author", "Your name", margin, 784, 1200, 52, 26),
      ];
      break;
    case "keynote-white-title-photo":
      objects = [
        ...photo(theme, 0, 0, 1600, 900, true),
        text(
          theme,
          "Title",
          "Presentation title",
          margin,
          548,
          1432,
          128,
          84,
          700,
        ),
        text(
          theme,
          "Subtitle",
          "A clear idea, beautifully presented.",
          margin,
          690,
          1360,
          72,
          32,
        ),
        text(theme, "Author", "Your name", margin, 792, 1200, 48, 24),
      ];
      break;
    case "keynote-white-title-photo-alternate":
      objects = [
        ...photo(theme, 796, 76, 728, 748),
        text(
          theme,
          "Title",
          "Presentation\ntitle",
          margin,
          324,
          648,
          232,
          76,
          700,
        ),
        text(
          theme,
          "Subtitle",
          "A short subtitle",
          margin,
          568,
          648,
          64,
          30,
          400,
          muted,
        ),
      ];
      break;
    case "keynote-white-title-bullets":
      objects = [...heading(theme), bullets(theme)];
      break;
    case "keynote-white-bullets":
      objects = [bullets(theme, 1380, 312)];
      break;
    case "keynote-white-title-bullets-photo":
      objects = [
        ...photo(theme, 808, 84, 708, 732),
        ...heading(theme, 652),
        bullets(theme, 652),
      ];
      break;
    case "keynote-white-small-video":
      objects = [
        ...video(theme, 1116, 468, 400, 348),
        ...heading(theme, 960),
        bullets(theme, 960),
      ];
      break;
    case "keynote-white-large-video":
      objects = [
        ...video(theme, 824, 232, 692, 584),
        ...heading(theme, 652),
        bullets(theme, 652),
      ];
      break;
    case "keynote-white-section":
      objects = [
        text(
          theme,
          "Section title",
          "Section title",
          margin,
          370,
          1432,
          160,
          96,
          700,
        ),
      ];
      break;
    case "keynote-white-title-only":
      objects = heading(theme);
      break;
    case "keynote-white-agenda":
      objects = [
        text(theme, "Agenda title", "Agenda", margin, 78, 1432, 104, 68, 700),
        text(
          theme,
          "Agenda subtitle",
          "Today’s outline",
          margin,
          188,
          1432,
          60,
          30,
          400,
          muted,
        ),
        text(
          theme,
          "Agenda points",
          "01  The question\n02  Our approach\n03  The result",
          margin,
          300,
          1300,
          320,
          38,
        ),
      ];
      break;
    case "keynote-white-statement":
      objects = [
        text(
          theme,
          "Statement",
          "One clear idea.",
          margin,
          374,
          1432,
          160,
          88,
          700,
          ink,
          "center",
        ),
      ];
      break;
    case "keynote-white-fact":
      objects = [
        text(
          theme,
          "Important fact",
          "100%",
          margin,
          262,
          1432,
          280,
          208,
          700,
          ink,
          "center",
        ),
        text(
          theme,
          "Fact label",
          "One important fact",
          margin,
          564,
          1432,
          72,
          32,
          400,
          muted,
          "center",
        ),
      ];
      break;
    case "keynote-white-quote":
      objects = [
        text(
          theme,
          "Quotation",
          "“A thought worth sharing.”",
          margin,
          342,
          1432,
          190,
          72,
          500,
        ),
        text(
          theme,
          "Attribution",
          "— Author",
          margin,
          722,
          1360,
          60,
          26,
          400,
          muted,
        ),
      ];
      break;
    case "keynote-white-three-photos":
      objects = [
        ...photo(theme, 76, 76, 948, 748),
        ...photo(theme, 1048, 76, 476, 362),
        ...photo(theme, 1048, 462, 476, 362),
      ];
      break;
  }
  return {
    id: newId(),
    title: layout.name,
    background: "#ffffff",
    notes:
      "Replace the sample text with your content. Photo and video frames are editable placeholders for imported media.",
    objects,
  };
}
