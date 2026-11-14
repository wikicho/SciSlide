import { FONT_SET_IDS, MAX_VIDEO_BYTES, validateDeck } from "./model";
import type { Deck, FontSetId, LocalTexEngine } from "./model";
import { MAX_FIGURE_BYTES, sanitizeSvg } from "./persistence";
import { assertEquationDocumentLimits } from "./local-tex-draft";

export const WORKSPACE_RECOVERY_KEY = "scislide.workspace-recovery.v2";
export const WORKSPACE_RECOVERY_DATABASE = "scislide-workspace";
export const MAX_WORKSPACE_RECOVERY_BYTES = 100 * 1024 * 1024;
export const MAX_RECOVERED_DRAFTS = 200;
const STORE = "recovery";
const RECORD = "workspace";
const LEGACY_RECOVERY_KEY = "scislide.recovery.v1";

export interface EquationDraft {
  /** True means Apply removes typography overrides and follows document defaults. */
  inheritTypography?: boolean;
  latex: string;
  font: FontSetId;
  size: number;
  color: string;
  renderer: "mathjax" | "local-latex";
  engine: LocalTexEngine;
  preamble: string;
}

export interface RecoveredEquationDraft {
  deckId: string;
  slideId: string;
  equationId: string;
  draft: EquationDraft;
  updatedAt: string;
}

export interface WorkspaceRecovery {
  deck: Deck;
  equationDrafts: RecoveredEquationDraft[];
  savedAt: string;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Workspace recovery date is invalid.");
  return new Date(value).toISOString();
}

export function validateEquationDraft(value: unknown): EquationDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Recovery equation draft is invalid.");
  const draft = value as EquationDraft;
  if (typeof draft.latex !== "string" || typeof draft.preamble !== "string")
    throw new Error("Recovery equation source is invalid.");
  assertEquationDocumentLimits(draft.latex, draft.preamble);
  if (
    (draft.inheritTypography !== undefined &&
      typeof draft.inheritTypography !== "boolean") ||
    !FONT_SET_IDS.includes(draft.font) ||
    !Number.isFinite(draft.size) ||
    draft.size < 4 ||
    draft.size > 500 ||
    typeof draft.color !== "string" ||
    !/^(#[\da-fA-F]{3,8}|transparent|none|[a-zA-Z]{1,24}|rgba?\([\d\s.,%]+\))$/.test(
      draft.color,
    ) ||
    draft.color.length > 64 ||
    !["mathjax", "local-latex"].includes(draft.renderer) ||
    !["latex", "xelatex"].includes(draft.engine)
  )
    throw new Error("Recovery equation settings are invalid.");
  return {
    ...(draft.inheritTypography !== undefined
      ? { inheritTypography: draft.inheritTypography }
      : {}),
    latex: draft.latex,
    font: draft.font,
    size: draft.size,
    color: draft.color,
    renderer: draft.renderer,
    engine: draft.engine,
    preamble: draft.preamble,
  };
}

function sanitizeMedia(deck: Deck): Deck {
  deck.assets = deck.assets.map((asset) => {
    const match = /^data:([^;,]+)([^,]*),([\s\S]*)$/.exec(asset.dataUrl);
    if (!match || match[1] !== asset.mime)
      throw new Error("Recovery media is invalid.");
    let bytes: Uint8Array;
    if (match[2].split(";").includes("base64")) {
      if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(match[3]) || match[3].length % 4)
        throw new Error("Recovery media contains invalid base64.");
      const binary = atob(match[3]);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } else bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
    if (
      bytes.length >
      (asset.mime.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_FIGURE_BYTES)
    )
      throw new Error("Recovery media exceeds the supported size limit.");
    if (asset.mime !== "image/svg+xml") return asset;
    const clean = new TextEncoder().encode(
      sanitizeSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    let binary = "";
    for (let i = 0; i < clean.length; i += 0x8000)
      binary += String.fromCharCode(...clean.subarray(i, i + 0x8000));
    return { ...asset, dataUrl: `data:image/svg+xml;base64,${btoa(binary)}` };
  });
  return deck;
}

/** All recovery data is treated as imported content. Stale draft references are discarded. */
export function validateWorkspaceRecovery(value: unknown): WorkspaceRecovery {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Workspace recovery is invalid.");
  const raw = value as WorkspaceRecovery;
  const source = JSON.stringify(raw);
  if (new TextEncoder().encode(source).length > MAX_WORKSPACE_RECOVERY_BYTES)
    throw new Error(
      "자동 복구 데이터가 100 MB 한도를 초과했습니다. 파일로 저장해주세요.",
    );
  const deck = sanitizeMedia(validateDeck(raw.deck));
  if (
    !Array.isArray(raw.equationDrafts) ||
    raw.equationDrafts.length > MAX_RECOVERED_DRAFTS
  )
    throw new Error("Workspace recovery has too many equation drafts.");
  const unique = new Map<string, RecoveredEquationDraft>();
  for (const entry of raw.equationDrafts) {
    if (!entry || typeof entry !== "object")
      throw new Error("Equation draft is invalid.");
    const slide = deck.slides.find((item) => item.id === entry.slideId);
    if (
      entry.deckId !== deck.id ||
      !slide?.objects.some(
        (object) =>
          object.id === entry.equationId && object.type === "equation",
      )
    )
      continue;
    const validated = {
      deckId: deck.id,
      slideId: slide.id,
      equationId: entry.equationId,
      draft: validateEquationDraft(entry.draft),
      updatedAt: timestamp(entry.updatedAt),
    };
    const key = `${slide.id}/${entry.equationId}`;
    const previous = unique.get(key);
    if (!previous || validated.updatedAt >= previous.updatedAt)
      unique.set(key, validated);
  }
  const recovery = {
    deck,
    equationDrafts: [...unique.values()],
    savedAt: timestamp(raw.savedAt),
  };
  if (
    new TextEncoder().encode(JSON.stringify(recovery)).length >
    MAX_WORKSPACE_RECOVERY_BYTES
  )
    throw new Error(
      "자동 복구 데이터가 100 MB 한도를 초과했습니다. 파일로 저장해주세요.",
    );
  return recovery;
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (!globalThis.indexedDB) return null;
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let blocked = false;
    try {
      request = indexedDB.open(WORKSPACE_RECOVERY_DATABASE, 1);
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError")
        reject(error);
      else resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      // Unavailable/private-mode IndexedDB may still support bounded localStorage.
      if (
        [
          "SecurityError",
          "InvalidStateError",
          "NotSupportedError",
          "UnknownError",
        ].includes(request.error?.name ?? "")
      )
        resolve(null);
      else
        reject(
          request.error ?? new Error("Workspace recovery could not be opened."),
        );
    };
    request.onblocked = () => {
      blocked = true;
      reject(
        new Error("Workspace recovery is blocked by another SciSlide window."),
      );
    };
  });
}

async function readIndexedRecovery(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(RECORD);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Workspace recovery could not be read."),
      );
  });
}

async function writeIndexedRecovery(
  database: IDBDatabase,
  recovery: WorkspaceRecovery,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(recovery, RECORD);
    // A successful put is insufficient: resolve only after the atomic transaction commits.
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(
        transaction.error ??
          new Error("Workspace recovery could not be saved."),
      );
  });
}

function newestRecovery(
  candidates: WorkspaceRecovery[],
): WorkspaceRecovery | null {
  return candidates.reduce<WorkspaceRecovery | null>(
    (latest, candidate) =>
      !latest || candidate.savedAt > latest.savedAt ? candidate : latest,
    null,
  );
}

function readFallbackRecovery(): WorkspaceRecovery | null {
  const candidates: WorkspaceRecovery[] = [];
  let failure: unknown;
  for (const key of [WORKSPACE_RECOVERY_KEY, LEGACY_RECOVERY_KEY]) {
    try {
      const source = localStorage.getItem(key);
      if (source === null) continue;
      const raw = JSON.parse(source);
      candidates.push(
        validateWorkspaceRecovery(
          key === LEGACY_RECOVERY_KEY
            ? {
                deck: raw.deck,
                equationDrafts: [],
                // Older records without a timestamp have unknown age. Reading
                // them must never make them newer than a dated snapshot.
                savedAt: raw.savedAt ?? new Date(0).toISOString(),
              }
            : raw,
        ),
      );
    } catch (error) {
      failure ??= error;
    }
  }
  const latest = newestRecovery(candidates);
  if (latest) return latest;
  if (failure)
    throw new Error(
      "Saved workspace recovery could not be read. Existing data was preserved.",
      { cause: failure },
    );
  return null;
}

export async function loadWorkspaceRecovery(): Promise<WorkspaceRecovery | null> {
  const candidates: WorkspaceRecovery[] = [];
  let failure: unknown;
  let database: IDBDatabase | null = null;
  let indexedEmpty = false;
  try {
    database = await openDatabase();
    if (database) {
      const raw = await readIndexedRecovery(database);
      indexedEmpty = raw === undefined;
      if (!indexedEmpty) candidates.push(validateWorkspaceRecovery(raw));
    }
  } catch (error) {
    failure = error;
  }
  try {
    const fallback = readFallbackRecovery();
    if (fallback) candidates.push(fallback);
  } catch (error) {
    failure ??= error;
  }
  const latest = newestRecovery(candidates);
  try {
    if (latest) {
      lastSavedAt = Math.max(lastSavedAt, Date.parse(latest.savedAt));
      if (database && indexedEmpty) {
        try {
          await writeIndexedRecovery(database, latest);
        } catch {
          /* A readable local snapshot remains usable if migration fails. */
        }
      }
      return latest;
    }
    if (failure)
      throw new Error(
        "Saved workspace recovery could not be read. Existing data was preserved.",
        { cause: failure },
      );
    return null;
  } finally {
    database?.close();
  }
}

let lastSavedAt = 0;
let saveQueue: Promise<unknown> = Promise.resolve();

/** Serialize writes so a slower previous save can never replace a newer revision. */
export function saveWorkspaceRecovery(
  deck: Deck,
  equationDrafts: RecoveredEquationDraft[] = [],
): Promise<"indexeddb" | "localStorage"> {
  // Clone before awaiting so caller edits cannot change the pending snapshot.
  let recovery: WorkspaceRecovery;
  try {
    // Preserve ordering even for same-millisecond saves or a clock adjustment.
    lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
    recovery = validateWorkspaceRecovery({
      deck,
      equationDrafts,
      savedAt: new Date(lastSavedAt).toISOString(),
    });
  } catch (error) {
    return Promise.reject(error);
  }
  const save = async (): Promise<"indexeddb" | "localStorage"> => {
    const database = await openDatabase();
    if (!database) {
      // Keep the original timestamp even when no equation drafts remain.
      localStorage.setItem(WORKSPACE_RECOVERY_KEY, JSON.stringify(recovery));
      return "localStorage";
    }
    try {
      await writeIndexedRecovery(database, recovery);
      return "indexeddb";
    } finally {
      database.close();
    }
  };
  const result = saveQueue.then(save, save);
  saveQueue = result.catch(() => undefined);
  return result;
}
