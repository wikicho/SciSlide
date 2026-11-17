import { jsonMediaByteLength } from "./json-media-size";
import type { Deck } from "./model";
import { validateWorkspaceRecovery } from "./workspace-recovery";
import type {
  RecoveryContext,
  RecoveredEquationDraft,
  WorkspaceRecovery,
} from "./workspace-recovery";

export const RECOVERY_HISTORY_DATABASE = "scislide-document-recoveries";
export const RECOVERY_HISTORY_KEY = "scislide.document-recoveries.v1";
export const RECOVERY_HISTORY_DELETIONS_KEY =
  "scislide.document-recovery-deletions.v1";
export const RECOVERY_HISTORY_ENTRY_PREFIX =
  "scislide.document-recovery.entry.v2.";
export const RECOVERY_HISTORY_DELETION_PREFIX =
  "scislide.document-recovery.deleted.v2.";
export const MAX_DOCUMENT_RECOVERIES = 10;
export const MAX_DOCUMENT_RECOVERY_BYTES = 100 * 1024 * 1024;
const MAX_STORED_BYTES = MAX_DOCUMENT_RECOVERY_BYTES + 4 * 1024 * 1024;
const STORE = "history";
const RECORD = "documents";
class HistoryCapacityError extends Error {}
const capacityMessage =
  "복구 기록은 최대 10개, 합계 100 MiB까지 보관할 수 있습니다. 기존 기록을 직접 삭제하거나 파일로 저장한 뒤 다시 시도해주세요.";

export interface DocumentRecoverySummary {
  id: string;
  deckId: string;
  title: string;
  savedAt: string;
  slideCount: number;
  draftCount: number;
  bytes: number;
}
interface HistoryRecord {
  id: string;
  savedAt: string;
  recovery?: WorkspaceRecovery;
  deleted?: true;
}
interface OpaqueRecord {
  value: unknown;
  id?: string;
  bytes: number;
  key: string;
}
interface Snapshot {
  records: Map<string, HistoryRecord>;
  opaque: OpaqueRecord[];
  writable: boolean;
  unavailable: number;
  unknownBytes: number;
  error?: unknown;
}
interface StoredHistory {
  version: 1;
  records: unknown[];
}
interface Context {
  database: IDBDatabase | null;
  indexed: Snapshot;
  local: Snapshot;
  deletions: Snapshot;
}

let mutations: Promise<unknown> = Promise.resolve();
let lastTimestamp = 0;
let unreadableRecord = 0;
const byteLength = jsonMediaByteLength;

function validateId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
  )
    throw new Error("복구 기록 ID가 올바르지 않습니다.");
  return value;
}
function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Recovery history date is invalid.");
  return new Date(value).toISOString();
}
function choose(
  previous: HistoryRecord | undefined,
  candidate: HistoryRecord,
): HistoryRecord {
  if (
    !previous ||
    Date.parse(candidate.savedAt) > Date.parse(previous.savedAt) ||
    (candidate.savedAt === previous.savedAt && candidate.deleted)
  )
    return candidate;
  return previous;
}
function empty(): Snapshot {
  return {
    records: new Map(),
    opaque: [],
    writable: true,
    unavailable: 0,
    unknownBytes: 0,
  };
}
function failed(error: unknown, unknownBytes = 0): Snapshot {
  return { ...empty(), writable: false, unavailable: 1, unknownBytes, error };
}
function parseSnapshot(value: unknown, deletions = false): Snapshot {
  if (value === undefined) return empty();
  let bytes = 0;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Recovery history is invalid.");
    const raw = value as StoredHistory;
    if (raw.version !== 1 || !Array.isArray(raw.records))
      throw new Error("Recovery history format is invalid.");
    const snapshot = empty();
    for (const entry of raw.records) {
      let id: string | undefined;
      try {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          throw new Error("Recovery entry is invalid.");
        const record = entry as HistoryRecord;
        id = validateId(record.id);
        const savedAt = date(record.savedAt);
        let checked: HistoryRecord;
        if (record.deleted === true && record.recovery === undefined)
          checked = { id, savedAt, deleted: true };
        else {
          if (deletions || record.deleted !== undefined)
            throw new Error("Recovery entry type is invalid.");
          const recovery = validateWorkspaceRecovery(record.recovery);
          if (savedAt !== recovery.savedAt)
            throw new Error("Recovery entry dates do not match.");
          checked = { id, savedAt, recovery };
        }
        snapshot.records.set(id, choose(snapshot.records.get(id), checked));
      } catch {
        let key = id ? `id:${id}` : `unreadable:${++unreadableRecord}`;
        let size = MAX_DOCUMENT_RECOVERY_BYTES + 1;
        try {
          const serialized = JSON.stringify(entry);
          size = new TextEncoder().encode(serialized).length;
          key = `raw:${serialized}`;
        } catch {
          /* An unserializable IDB record must not hide its valid siblings. */
        }
        snapshot.opaque.push({ value: entry, id, bytes: size, key });
      }
    }
    return snapshot;
  } catch (error) {
    try {
      bytes = byteLength(value);
    } catch {
      bytes = MAX_DOCUMENT_RECOVERY_BYTES + 1;
    }
    return failed(error, bytes);
  }
}
function localSnapshot(key: string, deletions = false): Snapshot {
  try {
    const source = localStorage.getItem(key);
    if (source === null) return empty();
    if (source.length > MAX_STORED_BYTES)
      return failed(new Error(capacityMessage), source.length);
    try {
      return parseSnapshot(JSON.parse(source), deletions);
    } catch (error) {
      return failed(error, new TextEncoder().encode(source).length);
    }
  } catch (error) {
    return failed(error);
  }
}
async function openDatabase(): Promise<IDBDatabase | null> {
  if (!globalThis.indexedDB) return null;
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let blocked = false;
    try {
      request = indexedDB.open(RECOVERY_HISTORY_DATABASE, 1);
    } catch (error) {
      reject(error);
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
    request.onerror = () =>
      reject(
        request.error ?? new Error("Recovery history could not be opened."),
      );
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Recovery history is blocked by another window."));
    };
  });
}
function readIndexed(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(RECORD);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Recovery history could not be read."),
      );
  });
}
/** The read and merge stay inside one readwrite transaction, including across windows. */
function mutateIndexed(
  database: IDBDatabase,
  update: (current: Snapshot) => StoredHistory,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.get(RECORD);
    let prepared = false;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const snapshot = parseSnapshot(request.result);
        store.put(update(snapshot), RECORD);
        prepared = true;
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () =>
      prepared
        ? resolve()
        : reject(
            new Error("Recovery history transaction did not write a snapshot."),
          );
    transaction.onabort = transaction.onerror = () =>
      reject(
        failure ??
          transaction.error ??
          new Error("Recovery history could not be saved."),
      );
  });
}
function mergeSnapshots(snapshots: Snapshot[]): Snapshot {
  const merged = empty();
  for (const snapshot of snapshots) {
    for (const [id, record] of snapshot.records)
      merged.records.set(id, choose(merged.records.get(id), record));
    merged.opaque.push(...snapshot.opaque);
    merged.unavailable += snapshot.unavailable;
    merged.unknownBytes += snapshot.unknownBytes;
    merged.writable &&= snapshot.writable;
    merged.error ??= snapshot.error;
  }
  return merged;
}
function localRecords() {
  const entries = [localSnapshot(RECOVERY_HISTORY_KEY)];
  const deletions = [localSnapshot(RECOVERY_HISTORY_DELETIONS_KEY, true)];
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    );
    for (const key of keys) {
      if (!key) continue;
      const deleted = key.startsWith(RECOVERY_HISTORY_DELETION_PREFIX);
      const prefix = deleted
        ? RECOVERY_HISTORY_DELETION_PREFIX
        : RECOVERY_HISTORY_ENTRY_PREFIX;
      if (!key.startsWith(prefix)) continue;
      let snapshot: Snapshot;
      let source: string | null = null;
      try {
        source = localStorage.getItem(key);
        if (source === null) continue;
        const id = validateId(key.slice(prefix.length));
        if (source.length > MAX_STORED_BYTES)
          throw new HistoryCapacityError(capacityMessage);
        const value = JSON.parse(source);
        if (value?.id !== id)
          throw new Error("Recovery entry ID does not match its storage key.");
        snapshot = parseSnapshot({ version: 1, records: [value] }, deleted);
      } catch (error) {
        snapshot = failed(
          error,
          source === null ? 0 : new TextEncoder().encode(source).length,
        );
      }
      (deleted ? deletions : entries).push(snapshot);
    }
  } catch (error) {
    entries.push(failed(error));
  }
  return {
    local: mergeSnapshots(entries),
    deletions: mergeSnapshots(deletions),
  };
}
async function context(readPrimary = true): Promise<Context> {
  let database: IDBDatabase | null = null;
  let indexed = empty();
  try {
    database = await openDatabase();
    if (database && readPrimary)
      indexed = parseSnapshot(await readIndexed(database));
  } catch (error) {
    indexed = failed(error);
  }
  return { database, indexed, ...localRecords() };
}
function combined(ctx: Context) {
  const records = new Map<string, HistoryRecord>();
  for (const snapshot of [ctx.indexed, ctx.local, ctx.deletions])
    for (const [id, record] of snapshot.records)
      records.set(id, choose(records.get(id), record));
  const unavailable = new Map<string, OpaqueRecord>();
  for (const snapshot of [ctx.indexed, ctx.local, ctx.deletions])
    for (const opaque of snapshot.opaque)
      if (!opaque.id || !records.get(opaque.id)?.deleted)
        unavailable.set(opaque.key, opaque);
  return { records, unavailable };
}
function summary(record: HistoryRecord): DocumentRecoverySummary {
  const recovery = record.recovery!;
  return {
    id: record.id,
    deckId: recovery.deck.id,
    title: recovery.deck.title,
    savedAt: record.savedAt,
    slideCount: recovery.deck.slides.length,
    draftCount: recovery.equationDrafts.length,
    bytes: byteLength(recovery),
  };
}
function nextTimestamp(ctx: Context): string {
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  for (const entry of combined(ctx).records.values())
    lastTimestamp = Math.max(lastTimestamp, Date.parse(entry.savedAt) + 1);
  return new Date(lastTimestamp).toISOString();
}
function assertCapacity(ctx: Context, records: Map<string, HistoryRecord>) {
  const { unavailable } = combined(ctx);
  for (const [key, entry] of unavailable)
    if (entry.id && records.get(entry.id)?.deleted) unavailable.delete(key);
  const live = [...records.values()].filter((entry) => !entry.deleted);
  const bytes =
    live.reduce((sum, entry) => sum + byteLength(entry.recovery), 0) +
    [...unavailable.values()].reduce((sum, entry) => sum + entry.bytes, 0) +
    ctx.indexed.unknownBytes +
    ctx.local.unknownBytes +
    ctx.deletions.unknownBytes;
  const sessions = new Set(live.map((entry) => `id:${entry.id}`));
  for (const entry of unavailable.values())
    sessions.add(entry.id ? `id:${entry.id}` : entry.key);
  if (
    sessions.size > MAX_DOCUMENT_RECOVERIES ||
    bytes > MAX_DOCUMENT_RECOVERY_BYTES
  )
    throw new HistoryCapacityError(capacityMessage);
}
function stored(
  snapshot: Snapshot,
  records: Map<string, HistoryRecord>,
): StoredHistory {
  const opaque = snapshot.opaque
    .filter((entry) => !entry.id || !records.get(entry.id)?.deleted)
    .map((entry) => entry.value);
  const value: StoredHistory = {
    version: 1,
    records: [...records.values(), ...opaque],
  };
  if (byteLength(value) > MAX_STORED_BYTES)
    throw new HistoryCapacityError(capacityMessage);
  return value;
}
function serial<T>(action: () => Promise<T>): Promise<T> {
  const execute = async (): Promise<T> => {
    if (typeof navigator !== "undefined" && navigator.locks)
      return await navigator.locks.request(
        "scislide-document-recoveries",
        action,
      );
    return action();
  };
  const result = mutations.then(execute, execute);
  mutations = result.catch(() => undefined);
  return result;
}

export async function listDocumentRecoveries(): Promise<{
  entries: DocumentRecoverySummary[];
  unavailableCount: number;
}> {
  await mutations;
  const ctx = await context();
  try {
    const { records, unavailable } = combined(ctx);
    const entries = [...records.values()]
      .filter((entry) => !entry.deleted)
      .map(summary)
      .sort(
        (a, b) =>
          Date.parse(b.savedAt) - Date.parse(a.savedAt) ||
          a.id.localeCompare(b.id),
      );
    return {
      entries,
      unavailableCount:
        unavailable.size +
        ctx.indexed.unavailable +
        ctx.local.unavailable +
        ctx.deletions.unavailable,
    };
  } finally {
    ctx.database?.close();
  }
}

export async function loadDocumentRecovery(
  id: string,
): Promise<WorkspaceRecovery | null> {
  validateId(id);
  await mutations;
  const ctx = await context();
  try {
    return combined(ctx).records.get(id)?.recovery ?? null;
  } finally {
    ctx.database?.close();
  }
}

export function saveDocumentRecovery(
  id: string,
  deck: Deck,
  drafts: RecoveredEquationDraft[] = [],
  recoveryContext?: RecoveryContext,
): Promise<"indexeddb" | "localStorage"> {
  let recovery: WorkspaceRecovery;
  try {
    validateId(id);
    recovery = validateWorkspaceRecovery({
      deck,
      equationDrafts: drafts,
      savedAt: new Date().toISOString(),
      file: recoveryContext?.file,
      sessionId: recoveryContext?.sessionId,
      unsaved: recoveryContext?.unsaved,
    });
  } catch (error) {
    return Promise.reject(error);
  }
  return serial(async () => {
    const ctx = await context(false);
    let latest = ctx;
    try {
      const errors: unknown[] = [];
      if (ctx.database && ctx.indexed.writable) {
        try {
          await mutateIndexed(ctx.database, (indexed) => {
            latest = { ...ctx, indexed, ...localRecords() };
            if (!indexed.writable) throw indexed.error;
            const { records } = combined(latest);
            recovery.savedAt = nextTimestamp(latest);
            records.set(id, { id, savedAt: recovery.savedAt, recovery });
            assertCapacity(latest, records);
            return stored(indexed, records);
          });
          return "indexeddb";
        } catch (error) {
          if (error instanceof HistoryCapacityError) throw error;
          errors.push(error);
        }
      } else if (ctx.indexed.error) errors.push(ctx.indexed.error);
      // Different session keys cannot overwrite each other without Web Locks.
      latest = { ...latest, ...localRecords() };
      const { records } = combined(latest);
      recovery.savedAt = nextTimestamp(latest);
      const record = { id, savedAt: recovery.savedAt, recovery };
      records.set(id, record);
      assertCapacity(latest, records);
      try {
        localStorage.setItem(
          RECOVERY_HISTORY_ENTRY_PREFIX + id,
          JSON.stringify(record),
        );
        return "localStorage";
      } catch (error) {
        errors.push(error);
      }
      throw new Error(
        "복구 기록을 저장하지 못했습니다. 기존 기록은 유지됩니다. 저장 공간을 확인하거나 파일로 저장해주세요.",
        { cause: new AggregateError(errors) },
      );
    } finally {
      ctx.database?.close();
    }
  });
}

/** Only explicit deletion may remove an opaque raw replica of this session. */
function compactLocalDeleted(id: string, tombstone: HistoryRecord): boolean {
  let compacted = false;
  const entryKey = RECOVERY_HISTORY_ENTRY_PREFIX + id;
  if (localStorage.getItem(entryKey) !== null) {
    localStorage.setItem(entryKey, JSON.stringify(tombstone));
    compacted = true;
  }
  const legacy = localSnapshot(RECOVERY_HISTORY_KEY);
  if (
    legacy.writable &&
    (legacy.records.has(id) || legacy.opaque.some((entry) => entry.id === id))
  ) {
    legacy.records.set(id, tombstone);
    localStorage.setItem(
      RECOVERY_HISTORY_KEY,
      JSON.stringify(stored(legacy, legacy.records)),
    );
    compacted = true;
  }
  return compacted;
}
function persistLocalDeletion(id: string, tombstone: HistoryRecord) {
  const key = RECOVERY_HISTORY_DELETION_PREFIX + id;
  const value = JSON.stringify(tombstone);
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    try {
      if (!compactLocalDeleted(id, tombstone)) throw error;
    } catch {
      throw new Error(
        "삭제 기록을 저장하지 못해 기존 복구 기록을 유지했습니다.",
        { cause: error },
      );
    }
    try {
      localStorage.setItem(key, value);
    } catch {
      /* The compacted session record already holds its durable tombstone. */
    }
  }
  try {
    compactLocalDeleted(id, tombstone);
  } catch {
    /* The independent per-session deletion key remains authoritative. */
  }
}

export function deleteDocumentRecovery(id: string): Promise<void> {
  try {
    validateId(id);
  } catch (error) {
    return Promise.reject(error);
  }
  return serial(async () => {
    const ctx = await context();
    try {
      let tombstone: HistoryRecord = {
        id,
        savedAt: nextTimestamp(ctx),
        deleted: true,
      };
      // Each session gets its own deletion key, so simultaneous deletions in
      // separate windows do not replace a shared journal with stale contents.
      persistLocalDeletion(id, tombstone);
      if (ctx.database && ctx.indexed.writable) {
        try {
          await mutateIndexed(ctx.database, (indexed) => {
            const latest = { ...ctx, indexed, ...localRecords() };
            if (!indexed.writable) throw indexed.error;
            const { records } = combined(latest);
            tombstone = { id, savedAt: nextTimestamp(latest), deleted: true };
            persistLocalDeletion(id, tombstone);
            records.set(id, tombstone);
            return stored(indexed, records);
          });
        } catch {
          /* The durable per-session deletion key already hides stale replicas. */
        }
      }
    } finally {
      ctx.database?.close();
    }
  });
}
