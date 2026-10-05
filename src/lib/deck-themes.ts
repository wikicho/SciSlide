import { DEFAULT_PAGE_NUMBERS, newId } from "./model";
import type { Deck, ShapeObject, Slide, TextObject } from "./model";
import { createTemplateSlide, SLIDE_TEMPLATES } from "./slide-templates";
import type { SlideTemplateCategory, SlideTemplateId } from "./slide-templates";
import {
  createKeynoteWhiteSlide,
  KEYNOTE_WHITE_LAYOUTS,
} from "./keynote-white-layouts";
import type { KeynoteWhiteLayoutId } from "./keynote-white-layouts";

export type DeckSlideLayoutId = SlideTemplateId | KeynoteWhiteLayoutId;

export interface DeckSlideLayout {
  id: DeckSlideLayoutId;
  name: string;
  description: string;
  category: SlideTemplateCategory;
}

export interface DeckThemePalette {
  background: string;
  ink: string;
  muted: string;
  accent: string;
  surface: string;
  line: string;
}

export const DECK_THEMES = [
  {
    id: "scientific",
    name: "Scientific",
    description: "Structured, precise, ready for research.",
    detail: "A quiet teal accent, clear hierarchy and room for your evidence.",
    layout: "title",
    palette: {
      background: "#f6f8fa",
      ink: "#17263c",
      muted: "#657489",
      accent: "#26867a",
      surface: "#eaf1f0",
      line: "#d5e4e0",
    },
  },
  {
    id: "minimal-white",
    name: "Minimal White",
    description: "Open space. One clear idea.",
    detail: "Large typography and a clean canvas that lets your ideas lead.",
    layout: "minimal-white",
    palette: {
      background: "#ffffff",
      ink: "#111111",
      muted: "#62626a",
      accent: "#306f73",
      surface: "#f1f3f4",
      line: "#d6d6dc",
    },
  },
  {
    id: "minimal-black",
    name: "Minimal Black",
    description: "Bold contrast, focused attention.",
    detail:
      "A deep black background with crisp type and restrained mint accents.",
    layout: "minimal-black",
    palette: {
      background: "#080808",
      ink: "#f5f5f7",
      muted: "#b8b8be",
      accent: "#95cfc2",
      surface: "#202023",
      line: "#45454a",
    },
  },
  {
    id: "navy",
    name: "Navy",
    description: "A confident stage for your story.",
    detail:
      "Deep blue, cool highlights and generous space for a strong opening.",
    layout: "color-statement",
    palette: {
      background: "#071d47",
      ink: "#ffffff",
      muted: "#bdcce6",
      accent: "#8db1ff",
      surface: "#102b54",
      line: "#355279",
    },
  },
  {
    id: "keynote-white",
    name: "Keynote White",
    description: "Classic white. Bold, clear typography.",
    detail:
      "Fifteen coordinated layouts for titles, photos, key facts and your story.",
    layout: "keynote-white-title",
    palette: {
      background: "#ffffff",
      ink: "#111111",
      muted: "#666666",
      accent: "#111111",
      surface: "#f2f2f2",
      line: "#dedede",
    },
  },
] as const satisfies readonly {
  id: string;
  name: string;
  description: string;
  detail: string;
  layout: DeckSlideLayoutId;
  palette: DeckThemePalette;
}[];

export type DeckThemeId = (typeof DECK_THEMES)[number]["id"];
export type DeckThemeDefinition = (typeof DECK_THEMES)[number];

// The format permits extra theme fields; validation and persistence preserve
// this optional marker, without changing the document version or old decks.
type StarterTheme = Deck["theme"] & { starterThemeId?: DeckThemeId };

const accentColors = new Set([
  "#26867a",
  "#75dbc1",
  "#bc7438",
  "#315778",
  "#3d836c",
  "#6f9cff",
]);
const mutedColors = new Set([
  "#657489",
  "#8290a2",
  "#b8c9d9",
  "#776f61",
  "#677586",
  "#587268",
  "#727278",
  "#b8b8be",
  "#bdcce6",
]);

function luminance(color: string): number {
  const value = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return 0;
  const [r, g, b] = [0, 2, 4].map((index) => {
    const channel = parseInt(value.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first: string, second: string): number {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function textBackground(object: TextObject, slide: Slide): string {
  let background = slide.background;
  const t = object.transform;
  for (const candidate of slide.objects) {
    if (candidate.id === object.id) break;
    if (
      candidate.type !== "shape" ||
      candidate.shape !== "rect" ||
      candidate.fill === "none" ||
      candidate.transform.rotation !== 0
    )
      continue;
    const panel = candidate.transform;
    if (
      panel.x <= t.x &&
      panel.y <= t.y &&
      panel.x + panel.width >= t.x + t.width &&
      panel.y + panel.height >= t.y + t.height
    )
      background = candidate.fill;
  }
  return background;
}

function themeShape(object: ShapeObject, palette: DeckThemePalette): void {
  const accent = accentColors.has(object.fill.toLowerCase());
  if (object.fill !== "none") {
    const rule = Math.min(object.transform.width, object.transform.height) <= 7;
    object.fill = accent
      ? palette.accent
      : rule
        ? palette.line
        : palette.surface;
  }
  if (object.stroke !== "none")
    object.stroke = accentColors.has(object.stroke.toLowerCase())
      ? palette.accent
      : palette.line;
}

function applyPalette(slide: Slide, palette: DeckThemePalette): Slide {
  slide.background = palette.background;
  for (const object of slide.objects)
    if (object.type === "shape") themeShape(object, palette);
  for (const object of slide.objects) {
    if (object.type !== "text") continue;
    const original = object.color.toLowerCase();
    let color = accentColors.has(original)
      ? palette.accent
      : mutedColors.has(original)
        ? palette.muted
        : palette.ink;
    const background = textBackground(object, slide);
    // An inverse label on an accent panel still needs to read clearly.
    if (contrast(color, background) < 4.5)
      color = [palette.ink, "#ffffff", "#111111"].sort(
        (a, b) => contrast(b, background) - contrast(a, background),
      )[0];
    object.color = color;
  }
  return slide;
}

/** Only explicitly chosen themes are applied to future slides. Imported decks
 * retain the layout palette they had before the starter chooser existed. */
export function getDeckTheme(deck: Deck): DeckThemeDefinition | undefined {
  const id = (deck.theme as StarterTheme).starterThemeId;
  return DECK_THEMES.find((theme) => theme.id === id);
}

export function getDeckThemeId(deck: Deck): DeckThemeId | undefined {
  return getDeckTheme(deck)?.id;
}

/** A theme can offer its own coordinated masters while older decks retain the
 * complete original layout catalog. Blank slides are available in either. */
export function getDeckLayouts(deck: Deck): readonly DeckSlideLayout[] {
  return getDeckThemeId(deck) === "keynote-white"
    ? [SLIDE_TEMPLATES[0], ...KEYNOTE_WHITE_LAYOUTS]
    : SLIDE_TEMPLATES;
}

export function createThemedSlide(id: DeckSlideLayoutId, deck: Deck): Slide {
  const keynoteLayout = KEYNOTE_WHITE_LAYOUTS.find(
    (layout) => layout.id === id,
  );
  if (keynoteLayout)
    return createKeynoteWhiteSlide(keynoteLayout.id, deck.theme);
  const slide = createTemplateSlide(id as SlideTemplateId, deck.theme);
  const theme = getDeckTheme(deck);
  return theme ? applyPalette(slide, theme.palette) : slide;
}

/** A new presentation has one editable title slide and no demo assets. */
export function createThemeDeck(id: DeckThemeId): Deck {
  const definition = DECK_THEMES.find((theme) => theme.id === id);
  if (!definition)
    throw new Error(`Unknown presentation theme: ${String(id)}.`);
  const theme: StarterTheme = {
    starterThemeId: id,
    fontFamily: "Inter",
    equation: {
      fontSetId: "mathjax-stix2",
      fontSize: 48,
      color: definition.palette.ink,
    },
  };
  const deck: Deck = {
    formatVersion: "0.5.0",
    id: newId(),
    title: "Untitled presentation",
    slideSize: { width: 1600, height: 900, unit: "px96" },
    theme,
    pageNumbers: {
      ...DEFAULT_PAGE_NUMBERS,
      hideFirst: true,
      color: definition.palette.muted,
    },
    slides: [],
    assets: [],
  };
  deck.slides = [createThemedSlide(definition.layout, deck)];
  return deck;
}
