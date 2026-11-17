import { newId } from "./model";
import type { Deck, Slide } from "./model";
import { captureSlideClipboard, pasteSlideClipboard } from "./slide-clipboard";
import type { SlideClipboard } from "./slide-clipboard";
import { validateWorkspaceRecovery } from "./workspace-recovery";

export const USER_LAYOUT_DATABASE = "scislide-user-layouts";
export const USER_LAYOUT_STORAGE_PREFIX = "scislide.user-layout.v1.";
export const MAX_USER_LAYOUTS = 50;
export const MAX_USER_LAYOUT_BYTES = 64 * 1024 * 1024;
export const MAX_USER_LAYOUT_LIBRARY_BYTES = 128 * 1024 * 1024;
export const MAX_USER_LAYOUT_FALLBACK_BYTES = 4 * 1024 * 1024;
const STORE = "layouts";

export interface UserSlideLayout {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  slideSize: Deck["slideSize"];
  snapshot: SlideClipboard;
}
type StoredLayout = {
  id: string;
  updatedAt: string;
  value?: UserSlideLayout;
  deleted?: true;
};
type Records = {
  records: Map<string, StoredLayout>;
  unavailable: number;
  bytes: number;
};
class LayoutCapacityError extends Error {}
let queue: Promise<unknown> = Promise.resolve();

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("User layout data is invalid.");
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)
  )
    throw new Error("User layout ID is invalid.");
  return value;
}
function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("User layout date is invalid.");
  return new Date(value).toISOString();
}
function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
function sourceDeck(
  layout: Pick<UserSlideLayout, "slideSize" | "snapshot">,
): Deck {
  return {
    formatVersion: "0.5.0",
    id: layout.snapshot.content.sourceDeckId,
    title: "User layout preview",
    slideSize: layout.slideSize,
    theme: {
      fontFamily: "Inter",
      equation: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#111827" },
    },
    slides: [
      { ...layout.snapshot.slide, objects: layout.snapshot.content.objects },
    ],
    assets: layout.snapshot.content.assets,
  };
}

/** Saved data receives the same media/SVG/model checks as imported recovery. */
export function validateUserSlideLayout(value: unknown): UserSlideLayout {
  if (bytes(value) > MAX_USER_LAYOUT_BYTES)
    throw new LayoutCapacityError(
      "A user layout must be no larger than 64 MiB.",
    );
  const raw = object(value);
  const id = identifier(raw.id);
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 200)
    throw new Error("Enter a layout name of 1–200 characters.");
  const createdAt = date(raw.createdAt),
    updatedAt = date(raw.updatedAt);
  const snapshot = object(raw.snapshot),
    content = object(snapshot.content);
  const draft = {
    slideSize: object(raw.slideSize) as unknown as Deck["slideSize"],
    snapshot: {
      slide: object(snapshot.slide),
      content,
    } as unknown as SlideClipboard,
  };
  const checked = validateWorkspaceRecovery({
    deck: sourceDeck(draft),
    equationDrafts: [],
    savedAt: updatedAt,
  }).deck;
  const { objects, ...slide } = checked.slides[0];
  return {
    id,
    name: raw.name.trim(),
    createdAt,
    updatedAt,
    slideSize: checked.slideSize,
    snapshot: {
      slide,
      content: { sourceDeckId: checked.id, objects, assets: checked.assets },
    },
  };
}

export function captureUserSlideLayout(
  deck: Deck,
  slide: Slide,
  name: string,
  previous?: UserSlideLayout,
): UserSlideLayout {
  const original = previous ? validateUserSlideLayout(previous) : undefined;
  const now = new Date(
    Math.max(Date.now(), original ? Date.parse(original.updatedAt) + 1 : 0),
  ).toISOString();
  return validateUserSlideLayout({
    id: original?.id ?? newId(),
    name,
    createdAt: original?.createdAt ?? now,
    updatedAt: now,
    slideSize: structuredClone(deck.slideSize),
    snapshot: captureSlideClipboard(deck, slide),
  });
}

export function isUserSlideLayoutCompatible(
  layout: UserSlideLayout,
  deck: Deck,
): boolean {
  return (
    layout.slideSize.width === deck.slideSize.width &&
    layout.slideSize.height === deck.slideSize.height &&
    layout.slideSize.unit === deck.slideSize.unit
  );
}

export function userSlideLayoutPreviewDeck(layout: UserSlideLayout): Deck {
  return sourceDeck(validateUserSlideLayout(layout));
}

/** The caller can wrap this single insertion in its ordinary Undo transaction. */
export function instantiateUserSlideLayout(
  deck: Deck,
  afterSlideId: string,
  value: UserSlideLayout,
): Slide {
  const layout = validateUserSlideLayout(value);
  if (!isUserSlideLayoutCompatible(layout, deck))
    throw new Error(
      "This layout has a different page size. Open a document with matching dimensions to use it.",
    );
  const next = structuredClone(deck);
  const originalAssets = next.assets;
  // Each insertion receives independent registry IDs, as well as fresh objects/groups.
  next.assets = [];
  const inserted = pasteSlideClipboard(next, afterSlideId, layout.snapshot);
  next.assets = [...originalAssets, ...next.assets];
  const checked = validateWorkspaceRecovery({
    deck: next,
    equationDrafts: [],
    savedAt: new Date().toISOString(),
  }).deck;
  deck.slides = checked.slides;
  deck.assets = checked.assets;
  return deck.slides.find((slide) => slide.id === inserted.id)!;
}

function parseRecords(values: unknown[]): Records {
  const result: Records = { records: new Map(), unavailable: 0, bytes: 0 };
  for (const value of values) {
    try {
      const raw = object(value),
        id = identifier(raw.id),
        updatedAt = date(raw.updatedAt);
      const record: StoredLayout =
        raw.deleted === true && raw.value === undefined
          ? { id, updatedAt, deleted: true }
          : { id, updatedAt, value: validateUserSlideLayout(raw.value) };
      if (
        record.value &&
        (record.value.id !== id || record.value.updatedAt !== updatedAt)
      )
        throw new Error("User layout record does not match its value.");
      const previous = result.records.get(id);
      if (
        !previous ||
        updatedAt > previous.updatedAt ||
        (updatedAt === previous.updatedAt && record.deleted)
      )
        result.records.set(id, record);
    } catch {
      result.unavailable += 1;
      try {
        result.bytes += bytes(value);
      } catch {
        result.bytes += MAX_USER_LAYOUT_LIBRARY_BYTES;
      }
    }
  }
  return result;
}
function localValues(): unknown[] {
  if (typeof localStorage === "undefined") return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(USER_LAYOUT_STORAGE_PREFIX)) keys.push(key);
  }
  return keys.map((key) => {
    const source = localStorage.getItem(key);
    try {
      return JSON.parse(source!);
    } catch {
      return { unreadableSource: source };
    }
  });
}
function merge(indexed: unknown[], local: unknown[]): Records {
  return parseRecords([...indexed, ...local]);
}
function capacity(
  state: Records,
  record: StoredLayout,
  limit = MAX_USER_LAYOUT_LIBRARY_BYTES,
) {
  const records = new Map(state.records);
  records.set(record.id, record);
  const live = [...records.values()].filter((item) => !item.deleted);
  if (live.length + state.unavailable > MAX_USER_LAYOUTS)
    throw new LayoutCapacityError(
      "User layouts are limited to 50 saved entries. Remove a saved layout before adding more.",
    );
  if (live.reduce((sum, item) => sum + bytes(item.value), state.bytes) > limit)
    throw new LayoutCapacityError(
      limit === MAX_USER_LAYOUT_FALLBACK_BYTES
        ? "Limited storage is full. User layouts need IndexedDB for larger embedded images. Existing layouts were preserved."
        : "User layouts are limited to 50 entries and 128 MiB. Remove a saved layout before adding more.",
    );
}
async function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    let abandoned = false;
    try {
      request = indexedDB.open(USER_LAYOUT_DATABASE, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => {
      abandoned = true;
      resolve(null);
    };
  });
}
function read(database: IDBDatabase): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function mutate(
  database: IDBDatabase,
  change: (values: unknown[]) => StoredLayout,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE),
      request = store.getAll();
    let failure: unknown;
    request.onsuccess = () => {
      try {
        store.put(change(request.result));
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(failure ?? transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error);
  });
}
function serial<T>(action: () => Promise<T>): Promise<T> {
  const execute = async (): Promise<T> => {
    if (typeof navigator !== "undefined" && navigator.locks)
      return await navigator.locks.request("scislide-user-layouts", action);
    return action();
  };
  const result = queue.then(execute, execute);
  queue = result.catch(() => undefined);
  return result;
}

export async function listUserSlideLayouts(): Promise<{
  entries: UserSlideLayout[];
  unavailableCount: number;
}> {
  await queue;
  const db = await database();
  let indexed: unknown[] = [],
    failures = 0,
    local: unknown[] = [];
  try {
    if (db)
      try {
        indexed = await read(db);
      } catch {
        failures++;
      }
    try {
      local = localValues();
    } catch {
      failures++;
    }
    const state = merge(indexed, local);
    return {
      entries: [...state.records.values()]
        .flatMap((item) => (item.value && !item.deleted ? [item.value] : []))
        .sort(
          (a, b) =>
            b.updatedAt.localeCompare(a.updatedAt) ||
            a.name.localeCompare(b.name),
        ),
      unavailableCount: state.unavailable + failures,
    };
  } finally {
    db?.close();
  }
}

export function saveUserSlideLayout(
  value: UserSlideLayout,
): Promise<"indexeddb" | "localStorage"> {
  let layout: UserSlideLayout;
  try {
    layout = validateUserSlideLayout(value);
  } catch (error) {
    return Promise.reject(error);
  }
  return serial(async () => {
    const db = await database();
    let previous: unknown[] = [];
    const record = (indexed: unknown[], limit?: number): StoredLayout => {
      previous = indexed;
      let local: unknown[];
      try {
        local = localValues();
      } catch (error) {
        // A disabled localStorage backend must not disable usable IndexedDB.
        if (limit === MAX_USER_LAYOUT_FALLBACK_BYTES) throw error;
        local = [];
      }
      const state = merge(indexed, local);
      const existing = state.records.get(layout.id);
      layout.updatedAt = new Date(
        Math.max(
          Date.now(),
          Date.parse(layout.updatedAt),
          existing ? Date.parse(existing.updatedAt) + 1 : 0,
        ),
      ).toISOString();
      const result = {
        id: layout.id,
        updatedAt: layout.updatedAt,
        value: layout,
      };
      capacity(state, result, limit);
      return result;
    };
    try {
      if (db) {
        try {
          await mutate(db, (values) => record(values));
          return "indexeddb";
        } catch (error) {
          if (error instanceof LayoutCapacityError) throw error;
        }
      }
      const fallback = record(previous, MAX_USER_LAYOUT_FALLBACK_BYTES);
      try {
        localStorage.setItem(
          USER_LAYOUT_STORAGE_PREFIX + layout.id,
          JSON.stringify(fallback),
        );
      } catch {
        throw new Error(
          "Could not save this user layout. Existing saved layouts were preserved. Check available storage.",
        );
      }
      return "localStorage";
    } finally {
      db?.close();
    }
  });
}

export function deleteUserSlideLayout(id: string): Promise<void> {
  try {
    identifier(id);
  } catch (error) {
    return Promise.reject(error);
  }
  return serial(async () => {
    const db = await database();
    let indexed: unknown[] = [];
    try {
      if (db) indexed = await read(db);
      const state = merge(indexed, localValues());
      const previous = state.records.get(id);
      const tombstone: StoredLayout = {
        id,
        updatedAt: new Date(
          Math.max(
            Date.now(),
            previous ? Date.parse(previous.updatedAt) + 1 : 0,
          ),
        ).toISOString(),
        deleted: true,
      };
      // A per-ID tombstone also hides a surviving replica if the IDB write fails.
      localStorage.setItem(
        USER_LAYOUT_STORAGE_PREFIX + id,
        JSON.stringify(tombstone),
      );
      if (db)
        try {
          await mutate(db, () => tombstone);
        } catch {
          /* Durable fallback deletion remains authoritative. */
        }
    } finally {
      db?.close();
    }
  });
}
