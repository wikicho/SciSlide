import { FONT_SET_IDS, newId, validateDeck } from "./model";
import type { Deck, EquationObject, FontSetId, LocalTexEngine } from "./model";
import {
  MAX_EQUATION_SOURCE_CHARACTERS,
  MAX_LOCAL_PREAMBLE_CHARACTERS,
} from "./local-tex-draft";

export const EQUATION_LIBRARY_KEY = "scislide.equation-library.v1";
export const MAX_LIBRARY_ENTRIES = 300;
export const MAX_LIBRARY_BYTES = 8 * 1024 * 1024;

/** Source and settings are reusable; a local compile cache belongs to its slide. */
export interface EquationLibraryEquation {
  latex: string;
  style: EquationObject["style"];
  displayMode: boolean;
  description: string;
  renderer?: "mathjax" | "local-latex";
  localTex?: { engine: LocalTexEngine; preamble: string };
}

export interface EquationLibraryEntry {
  id: string;
  name: string;
  tags: string[];
  equation: EquationLibraryEquation;
  createdAt: string;
  updatedAt: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || value.length > limit)
    throw new Error(`${label} exceeds its text limit.`);
  return value;
}

function date(value: unknown): string {
  const timestamp = text(value, "Equation date", 64);
  if (!Number.isFinite(Date.parse(timestamp)))
    throw new Error("Equation date is invalid.");
  return new Date(timestamp).toISOString();
}

const equationTheme = {
  fontSetId: "mathjax-stix2" as const,
  fontSize: 48,
  color: "#111827",
};

/** Reuse document validation, then discard unknown properties and compiled resources. */
export function validateLibraryEquation(
  value: unknown,
): EquationLibraryEquation {
  const raw = record(value, "Library equation");
  const style = record(raw.style, "Equation style");
  const rawLocal =
    raw.localTex === undefined
      ? undefined
      : record(raw.localTex, "Local LaTeX settings");
  const equation: EquationLibraryEquation = {
    latex: text(raw.latex, "Equation source", MAX_EQUATION_SOURCE_CHARACTERS),
    description: text(raw.description, "Equation description", 10_000),
    displayMode: raw.displayMode as boolean,
    style: {
      ...(style.fontSetId === undefined
        ? {}
        : { fontSetId: style.fontSetId as FontSetId }),
      ...(style.fontSize === undefined
        ? {}
        : { fontSize: style.fontSize as number }),
      ...(style.color === undefined ? {} : { color: style.color as string }),
    },
    ...(raw.renderer === undefined
      ? {}
      : { renderer: raw.renderer as EquationLibraryEquation["renderer"] }),
    ...(rawLocal === undefined
      ? {}
      : {
          localTex: {
            engine: rawLocal.engine as LocalTexEngine,
            preamble: text(
              rawLocal.preamble,
              "Local LaTeX preamble",
              MAX_LOCAL_PREAMBLE_CHARACTERS,
            ),
          },
        }),
  };
  const object = {
    ...equation,
    id: "library-equation",
    type: "equation" as const,
    name: "Library equation",
    transform: { x: 0, y: 0, width: 600, height: 150, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
  };
  validateDeck({
    formatVersion: "0.4.0",
    id: "library-validation",
    title: "Equation library",
    slideSize: { width: 1600, height: 900, unit: "px96" },
    theme: { equation: equationTheme, fontFamily: "Inter" },
    slides: [
      {
        id: "library-slide",
        title: "",
        notes: "",
        background: "#ffffff",
        objects: [object],
      },
    ],
    assets: [],
  });
  return equation;
}

export function validateEquationLibrary(
  value: unknown,
): EquationLibraryEntry[] {
  if (!Array.isArray(value) || value.length > MAX_LIBRARY_ENTRIES)
    throw new Error(
      `수식은 최대 ${MAX_LIBRARY_ENTRIES}개까지 저장할 수 있습니다.`,
    );
  const ids = new Set<string>();
  const entries = value.map((item) => {
    const raw = record(item, "Library entry");
    const id = text(raw.id, "Equation ID", 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || ids.has(id))
      throw new Error("Library equation IDs must be valid and unique.");
    ids.add(id);
    const name = text(raw.name, "Equation name", 200).trim();
    if (!name) throw new Error("수식 이름을 입력해주세요.");
    if (!Array.isArray(raw.tags) || raw.tags.length > 30)
      throw new Error("수식 태그는 최대 30개까지 입력할 수 있습니다.");
    const tags = [
      ...new Set(
        raw.tags
          .map((tag) => text(tag, "Equation tag", 80).trim())
          .filter(Boolean),
      ),
    ];
    return {
      id,
      name,
      tags,
      equation: validateLibraryEquation(raw.equation),
      createdAt: date(raw.createdAt),
      updatedAt: date(raw.updatedAt),
    };
  });
  if (
    new TextEncoder().encode(JSON.stringify(entries)).length > MAX_LIBRARY_BYTES
  )
    throw new Error("수식 라이브러리는 8 MB 이하로 저장해주세요.");
  return entries;
}

export function createEquationLibraryEntry(
  name: string,
  equation: EquationLibraryEquation,
  tags: string[] = [],
): EquationLibraryEntry {
  const now = new Date().toISOString();
  return validateEquationLibrary([
    { id: newId(), name, tags, equation, createdAt: now, updatedAt: now },
  ])[0];
}

export function loadEquationLibrary(): EquationLibraryEntry[] {
  const raw = localStorage.getItem(EQUATION_LIBRARY_KEY);
  return raw ? parseEquationLibrary(raw) : [];
}

/** setItem is atomic: quota errors keep the previous saved library intact. */
export function saveEquationLibrary(entries: EquationLibraryEntry[]): void {
  localStorage.setItem(EQUATION_LIBRARY_KEY, serializeEquationLibrary(entries));
}

export function parseEquationLibrary(source: string): EquationLibraryEntry[] {
  if (new TextEncoder().encode(source).length > MAX_LIBRARY_BYTES)
    throw new Error("수식 라이브러리 파일은 8 MB 이하로 가져와주세요.");
  const parsed = record(JSON.parse(source), "Equation library file");
  if (parsed.format !== "scislide-equation-library" || parsed.version !== 1)
    throw new Error("지원하는 SciSlide 수식 라이브러리 파일이 아닙니다.");
  return validateEquationLibrary(parsed.entries);
}

export function serializeEquationLibrary(
  entries: EquationLibraryEntry[],
): string {
  const source = JSON.stringify(
    {
      format: "scislide-equation-library",
      version: 1,
      entries: validateEquationLibrary(entries),
    },
    null,
    2,
  );
  if (new TextEncoder().encode(source).length > MAX_LIBRARY_BYTES)
    throw new Error("수식 라이브러리는 8 MB 이하로 저장해주세요.");
  return source;
}

export function searchEquationLibrary(
  entries: EquationLibraryEntry[],
  query: string,
): EquationLibraryEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const haystack = [
      entry.name,
      entry.equation.description,
      entry.equation.latex,
      ...entry.tags,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Imports add entries; a colliding ID never overwrites a different saved equation. */
export function mergeEquationLibraries(
  current: EquationLibraryEntry[],
  imported: EquationLibraryEntry[],
): EquationLibraryEntry[] {
  const entries = validateEquationLibrary(current);
  for (const entry of validateEquationLibrary(imported)) {
    // A prior import may have reassigned a colliding ID. Its saved content still
    // identifies the same imported entry on a later import of that file.
    const content = JSON.stringify({ ...entry, id: "" });
    if (entries.some((item) => JSON.stringify({ ...item, id: "" }) === content))
      continue;
    const sameId = entries.find((item) => item.id === entry.id);
    entries.push({ ...entry, id: sameId ? newId() : entry.id });
  }
  return validateEquationLibrary(entries);
}

/** Every insertion gets a new ID and mutable settings, with no links to a saved entry. */
export function createLibraryEquationObject(
  entry: EquationLibraryEntry,
  deck: Deck,
): EquationObject {
  const validated = validateEquationLibrary([entry])[0];
  const equation = validated.equation;
  return {
    ...equation,
    style: { ...equation.style },
    ...(equation.localTex ? { localTex: { ...equation.localTex } } : {}),
    id: newId(),
    type: "equation",
    name: validated.name,
    transform: {
      x: Math.round(deck.slideSize.width * 0.15),
      y: Math.round(deck.slideSize.height * 0.35),
      width: Math.round(deck.slideSize.width * 0.7),
      height: Math.round(deck.slideSize.height * 0.2),
      rotation: 0,
    },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
  };
}

export function isEquationLibraryFont(value: string): value is FontSetId {
  return FONT_SET_IDS.includes(value as FontSetId);
}
