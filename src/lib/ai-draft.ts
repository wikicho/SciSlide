import { newId } from "./model";
import type { BaseSlideObject, Deck, Slide, TextObject } from "./model";

export type AIProvider = "codex" | "claude" | "gemini";

export interface AiDraft {
  title: string;
  slides: Array<{
    title: string;
    bullets: string[];
    equation: string;
    notes: string;
  }>;
}

export const MAX_AI_DRAFT_BYTES = 128 * 1024;
export const MAX_AI_CONTEXT_CHARACTERS = 16_000;

const externalEquationCommand =
  /\\(?:documentclass|usepackage|RequirePackage|require|autoload|href|url|style|class|cssId|htmlClass|htmlId|htmlStyle|htmlData|includegraphics|input|include|write\d*|openout|openin|read|catcode|special|directlua|csname)\b/;

function exactRecord(
  value: unknown,
  keys: readonly string[],
  at: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${at} must be an object.`);
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    throw new Error(
      `${at} must contain only these fields: ${keys.join(", ")}.`,
    );
  return record;
}

function plainText(
  value: unknown,
  at: string,
  max: number,
  nonempty = false,
): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${at} must be text with at most ${max} characters.`);
  if (nonempty && !value.trim()) throw new Error(`${at} cannot be empty.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new Error(`${at} contains unsupported control characters.`);
  return value.replace(/\r\n?/g, "\n").trim();
}

/** JSON.parse otherwise silently accepts duplicate keys, including escaped aliases. */
function rejectDuplicateKeys(json: string): void {
  const containers: Array<Set<string> | null> = [];
  for (let index = 0; index < json.length; index++) {
    const character = json[index];
    if (character === "{") containers.push(new Set());
    else if (character === "[") containers.push(null);
    else if (character === "}" || character === "]") containers.pop();
    else if (character === '"') {
      const start = index++;
      while (index < json.length) {
        if (json[index] === "\\") index += 2;
        else if (json[index] === '"') break;
        else index++;
      }
      let next = index + 1;
      while (/\s/.test(json[next] ?? "") && next < json.length) next++;
      if (json[next] === ":") {
        const key = JSON.parse(json.slice(start, index + 1)) as string;
        const keys = containers.at(-1);
        if (keys?.has(key))
          throw new Error(`AI draft contains a duplicate field: ${key}.`);
        keys?.add(key);
      }
    }
  }
}

/** Accept one complete JSON document, optionally surrounded by one JSON code fence. */
export function validateAIDraft(text: string, expectedCount?: number): AiDraft {
  if (
    typeof text !== "string" ||
    text.length > MAX_AI_DRAFT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_AI_DRAFT_BYTES
  )
    throw new Error("AI draft exceeds the 128 KB response limit.");
  if (
    expectedCount !== undefined &&
    (!Number.isInteger(expectedCount) ||
      expectedCount < 1 ||
      expectedCount > 12)
  )
    throw new Error(
      "Requested slide count must be an integer between 1 and 12.",
    );
  let json = text.trim();
  if (json.startsWith("```")) {
    const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```$/.exec(json);
    if (!fenced)
      throw new Error("AI draft must contain one complete JSON document.");
    json = fenced[1].trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("AI draft must contain one complete, valid JSON document.");
  }
  rejectDuplicateKeys(json);
  const draft = exactRecord(parsed, ["title", "slides"], "AI draft");
  const title = plainText(draft.title, "Draft title", 160, true);
  if (
    !Array.isArray(draft.slides) ||
    draft.slides.length < 1 ||
    draft.slides.length > 12
  )
    throw new Error("AI draft must contain between 1 and 12 slides.");
  if (expectedCount !== undefined && draft.slides.length !== expectedCount)
    throw new Error(`AI draft must contain exactly ${expectedCount} slides.`);
  return {
    title,
    slides: draft.slides.map((value, index) => {
      const at = `Slide ${index + 1}`;
      const slide = exactRecord(
        value,
        ["title", "bullets", "equation", "notes"],
        at,
      );
      if (!Array.isArray(slide.bullets) || slide.bullets.length > 6)
        throw new Error(`${at} must contain at most 6 bullet points.`);
      const equation = plainText(slide.equation, `${at} equation`, 2000);
      const command = externalEquationCommand.exec(equation);
      if (
        command ||
        /<\/?[a-z!][^>]*>/i.test(equation) ||
        /\\(?:begin|end)\s*\{document\}/.test(equation)
      )
        throw new Error(
          `${at} equation must use MathJax math only${command ? `; ${command[0]} is not supported` : ""}.`,
        );
      return {
        title: plainText(slide.title, `${at} title`, 160, true),
        bullets: slide.bullets.map((bullet, bulletIndex) =>
          plainText(bullet, `${at} bullet ${bulletIndex + 1}`, 240, true),
        ),
        equation,
        notes: plainText(slide.notes, `${at} notes`, 3000),
      };
    }),
  };
}

/** A conservative, deterministic estimate; no browser, canvas or model-generated layout is needed. */
function lineCount(text: string, width: number, fontSize: number): number {
  const capacity = Math.max(1, Math.floor(width / fontSize / 1.1));
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    let used = 0;
    lines++;
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const length = Array.from(word).reduce(
        (sum, character) => sum + (character.codePointAt(0)! > 0xffff ? 2 : 1),
        0,
      );
      if (used && used + 1 + length <= capacity) used += 1 + length;
      else {
        if (used) lines++;
        lines += Math.floor(Math.max(0, length - 1) / capacity);
        used = ((length - 1) % capacity) + 1;
      }
    }
  }
  return lines;
}

function fitFont(
  texts: string[],
  width: number,
  height: number,
  maximum: number,
  gap: number,
): number {
  for (
    let size = Math.max(4, Math.min(500, maximum));
    ;
    size = Math.max(4, size - 0.5)
  ) {
    const needed =
      texts.reduce(
        (sum, text) => sum + lineCount(text, width, size) * size * 1.3,
        0,
      ) +
      Math.max(0, texts.length - 1) * gap;
    if (needed <= height) return size;
    if (size === 4) break;
  }
  throw new Error(
    "The slide dimensions are too small for this draft's text. Use a larger slide or shorter bullet points.",
  );
}

/** Convert approved content into independent, editable native objects; never import executable output. */
export function createAISlides(
  draft: AiDraft,
  deck: Deck,
  provider: AIProvider,
): Slide[] {
  if (!["codex", "claude", "gemini"].includes(provider))
    throw new Error("Choose a supported AI provider.");
  // Validate again at the document boundary, including drafts passed directly by a caller.
  const approved = validateAIDraft(JSON.stringify(draft));
  const sx = deck.slideSize.width / 1600;
  const sy = deck.slideSize.height / 900;
  const scale = Math.min(sx, sy);
  const x = 96 * sx;
  const width = 1408 * sx;
  const base = (name: string, y: number, height: number): BaseSlideObject => ({
    id: newId(),
    type: "text",
    name,
    transform: { x, y, width, height, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: { ai: { provider } },
  });
  const textObject = (
    name: string,
    text: string,
    y: number,
    height: number,
    fontSize: number,
    fontWeight: number,
  ): TextObject => ({
    ...base(name, y, height),
    type: "text",
    text,
    fontFamily: deck.theme.fontFamily,
    fontSize,
    fontWeight,
    color: deck.theme.equation.color,
    align: "left",
  });
  return approved.slides.map((content) => {
    const titleY = 72 * sy;
    const titleHeight = 150 * sy;
    const titleSize = fitFont(
      [content.title],
      width,
      titleHeight,
      54 * scale,
      0,
    );
    const bodyY = 246 * sy;
    const bodyBottom = (content.equation ? 650 : 804) * sy;
    const gap = 10 * sy;
    const bulletTexts = content.bullets.map((bullet) => `• ${bullet}`);
    const bodySize = fitFont(
      bulletTexts,
      width,
      bodyBottom - bodyY,
      36 * scale,
      gap,
    );
    const slide: Slide = {
      id: newId(),
      title: content.title,
      background: deck.slides[0]?.background ?? "#ffffff",
      notes: content.notes,
      objects: [
        textObject("Title", content.title, titleY, titleHeight, titleSize, 600),
      ],
    };
    let y = bodyY;
    bulletTexts.forEach((bullet, index) => {
      const height = lineCount(bullet, width, bodySize) * bodySize * 1.3;
      slide.objects.push(
        textObject(`Bullet ${index + 1}`, bullet, y, height, bodySize, 400),
      );
      y += height + gap;
    });
    if (content.equation)
      slide.objects.push({
        ...base("Equation", 690 * sy, 114 * sy),
        type: "equation",
        renderer: "mathjax",
        latex: content.equation,
        style: {},
        displayMode: true,
        description: `Equation for ${content.title}`,
      });
    return slide;
  });
}

/** Explicitly opt-in context contains only visible content, never embedded media or compiler configuration. */
export function aiSlideContext(deck: Deck, slide: Slide): string {
  const objects: Array<{ type: "text" | "equation"; content: string }> = [];
  let characters = 0;
  let omitted = false;
  for (const object of slide.objects) {
    if (
      !object.visible ||
      (object.type !== "text" && object.type !== "equation")
    )
      continue;
    const text = object.type === "text" ? object.text : object.latex;
    if (characters >= MAX_AI_CONTEXT_CHARACTERS) {
      omitted = true;
      break;
    }
    const content = text.slice(0, MAX_AI_CONTEXT_CHARACTERS - characters);
    omitted ||= content.length < text.length;
    objects.push({ type: object.type, content });
    characters += content.length;
  }
  const context = JSON.stringify(
    {
      deckTitle: deck.title.slice(0, MAX_AI_CONTEXT_CHARACTERS),
      slideTitle: slide.title.slice(0, MAX_AI_CONTEXT_CHARACTERS),
      notes: slide.notes.slice(0, MAX_AI_CONTEXT_CHARACTERS),
      objects,
      ...(omitted ? { notice: "[Context truncated]" } : {}),
    },
    null,
    2,
  );
  if (context.length <= MAX_AI_CONTEXT_CHARACTERS) return context;
  const marker = "\n[Context truncated]";
  let end = MAX_AI_CONTEXT_CHARACTERS - marker.length;
  if (/[\uD800-\uDBFF]/.test(context[end - 1])) end--;
  return context.slice(0, end) + marker;
}
