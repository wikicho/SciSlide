// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankSlide, createDemoDeck } from "../src/lib/model";
import type { Deck } from "../src/lib/model";
import { shapeFromDrag } from "../src/lib/drawing";
import {
  validateWorkspaceRecovery,
  WORKSPACE_RECOVERY_KEY,
} from "../src/lib/workspace-recovery";
import type {
  RecoveryContext,
  RecoveredEquationDraft,
} from "../src/lib/workspace-recovery";
import {
  deleteDocumentRecovery,
  listDocumentRecoveries,
  loadDocumentRecovery,
  saveDocumentRecovery,
  MAX_DOCUMENT_RECOVERIES,
  MAX_DOCUMENT_RECOVERY_BYTES,
  RECOVERY_HISTORY_DATABASE,
  RECOVERY_HISTORY_ENTRY_PREFIX,
  RECOVERY_HISTORY_DELETION_PREFIX,
  RECOVERY_HISTORY_KEY,
  RECOVERY_HISTORY_DELETIONS_KEY,
} from "../src/lib/recovery-history";

/** FIFO transactions model IndexedDB's cross-connection readwrite isolation. */
function testIndexedDB() {
  const state = {
    value: undefined as unknown,
    failNextWrite: false,
    failWrites: false,
    failNextRead: false,
    holdNextWrite: false,
    release: undefined as (() => void) | undefined,
    writes: 0,
    commits: 0,
    closed: 0,
    databases: [] as string[],
    compoundWrites: 0,
  };
  const transactions: (() => void)[] = [];
  let active = false;
  const advance = () => {
    active = false;
    if (transactions.length) {
      active = true;
      queueMicrotask(transactions.shift()!);
    }
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    close() {
      state.closed++;
    },
    transaction: (_store: string, mode: string) => {
      let pending: unknown;
      let request: { result?: unknown; onsuccess?: () => void } | undefined;
      let aborted = false;
      let finished = false;
      let put = false;
      const transaction = {
        error: null as DOMException | null,
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        abort: () => {
          aborted = true;
          queueMicrotask(() => {
            if (!finished) {
              finished = true;
              transaction.onabort?.();
              advance();
            }
          });
        },
        objectStore: () => ({
          get: () => {
            request = {};
            return request;
          },
          put: (value: unknown) => {
            state.writes++;
            put = true;
            pending = structuredClone(value);
            return {};
          },
        }),
      };
      transactions.push(() => {
        if (request) {
          request.result =
            state.value === undefined
              ? undefined
              : structuredClone(state.value);
          request.onsuccess?.();
        }
        const finish = () => {
          if (finished || aborted) return;
          finished = true;
          if (
            (mode === "readwrite" &&
              (state.failNextWrite || state.failWrites)) ||
            (mode === "readonly" && state.failNextRead)
          ) {
            state.failNextWrite = false;
            state.failNextRead = false;
            transaction.error = new DOMException(
              "History transaction aborted",
              "QuotaExceededError",
            );
            transaction.onabort?.();
          } else {
            if (mode === "readwrite" && put) {
              state.value = pending;
              state.commits++;
              if (request) state.compoundWrites++;
            }
            transaction.oncomplete?.();
          }
          advance();
        };
        if (mode === "readwrite" && state.holdNextWrite) {
          state.holdNextWrite = false;
          state.release = finish;
        } else queueMicrotask(finish);
      });
      if (!active) advance();
      return transaction;
    },
  };
  const factory = {
    open: (name: string) => {
      state.databases.push(name);
      const request = {
        result: database,
        onsuccess: undefined as (() => void) | undefined,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  return { state, factory: factory as unknown as IDBFactory };
}
function deck(title = "Recovered talk"): Deck {
  return {
    ...createDemoDeck(),
    id: "same-deck",
    title,
    slides: [
      {
        ...createBlankSlide(),
        id: "same-slide",
        objects: [],
        notes: "Keep notes",
      },
    ],
    assets: [],
    pageNumbers: undefined,
  };
}
function entry(id: string, title: string, savedAt: string) {
  return {
    id,
    savedAt,
    recovery: validateWorkspaceRecovery({
      deck: deck(title),
      equationDrafts: [],
      savedAt,
    }),
  };
}
function localDraft(source: Deck): RecoveredEquationDraft {
  const slide = source.slides.find((item) =>
    item.objects.some((object) => object.type === "equation"),
  )!;
  return {
    deckId: source.id,
    slideId: slide.id,
    equationId: slide.objects.find((object) => object.type === "equation")!.id,
    updatedAt: "2026-11-18T00:00:00.000Z",
    draft: {
      latex: "x=unapplied",
      font: "mathjax-fira",
      size: 52,
      color: "#123456",
      renderer: "mathjax",
      engine: "latex",
      preamble: "",
    },
  };
}
const snapshot = (records: unknown[]) => ({ version: 1, records });
async function microtasks() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("document recovery history", () => {
  it.each(["indexeddb", "localStorage"] as const)(
    "round-trips immutable acknowledged-file context and local drafts through history %s",
    async (backend) => {
      const mock = testIndexedDB();
      vi.stubGlobal(
        "indexedDB",
        backend === "indexeddb" ? mock.factory : undefined,
      );
      const source = createDemoDeck(),
        draft = localDraft(source);
      const context: RecoveryContext = {
        file: { name: "저장된 talk.scislide", kind: "saved" },
        sessionId: "stable-session",
      };
      const saving = saveDocumentRecovery(
        "stable-session",
        source,
        [draft],
        context,
      );
      context.file!.name = "Wrong later name.scislide";
      context.file!.kind = "downloaded";
      context.sessionId = "later-session";
      draft.draft.latex = "later unsaved source";
      expect(await saving).toBe(backend);
      const recovered = (await loadDocumentRecovery("stable-session"))!;
      expect(recovered.file).toEqual({
        name: "저장된 talk.scislide",
        kind: "saved",
      });
      expect(recovered.sessionId).toBe("stable-session");
      expect(recovered.deck.slides).toEqual(source.slides);
      expect(recovered.deck.assets).toHaveLength(source.assets.length);
      expect(recovered.equationDrafts[0].draft.latex).toBe("x=unapplied");
      expect(recovered.file).not.toBe(context.file);
      const listing = await listDocumentRecoveries();
      expect(listing.unavailableCount).toBe(0);
      expect(listing.entries).toHaveLength(1);
      expect(listing.entries[0].bytes).toBe(
        new TextEncoder().encode(JSON.stringify(recovered)).length,
      );
      const stored =
        backend === "indexeddb"
          ? (mock.state.value as { records: unknown[] }).records[0]
          : JSON.parse(
              localStorage.getItem(
                RECOVERY_HISTORY_ENTRY_PREFIX + "stable-session",
              )!,
            );
      expect(stored).toMatchObject({
        recovery: { file: recovered.file, sessionId: "stable-session" },
      });
    },
  );

  it.each(["indexeddb", "localStorage"] as const)(
    "loads actual deck and drafts with dirty provenance when optional metadata is damaged in %s",
    async (backend) => {
      const mock = testIndexedDB();
      vi.stubGlobal(
        "indexedDB",
        backend === "indexeddb" ? mock.factory : undefined,
      );
      const source = createDemoDeck(),
        draft = localDraft(source);
      const record = {
        id: "damaged-context",
        savedAt: draft.updatedAt,
        recovery: {
          deck: source,
          equationDrafts: [draft],
          savedAt: draft.updatedAt,
          file: { name: "Saved.scislide", kind: "unknown" },
          sessionId: "not/a/session",
        },
      };
      if (backend === "indexeddb")
        mock.state.value = snapshot([structuredClone(record)]);
      else
        localStorage.setItem(
          RECOVERY_HISTORY_ENTRY_PREFIX + record.id,
          JSON.stringify(record),
        );
      const recovered = (await loadDocumentRecovery(record.id))!;
      expect(recovered.deck.slides).toEqual(source.slides);
      expect(recovered.equationDrafts).toEqual([draft]);
      expect(recovered).not.toHaveProperty("file");
      expect(recovered).not.toHaveProperty("sessionId");
      expect((await listDocumentRecoveries()).unavailableCount).toBe(0);
      const original =
        backend === "indexeddb"
          ? (mock.state.value as { records: unknown[] }).records[0]
          : JSON.parse(
              localStorage.getItem(RECOVERY_HISTORY_ENTRY_PREFIX + record.id)!,
            );
      expect(original).toEqual(record);
    },
  );

  it.each(["indexeddb", "localStorage"] as const)(
    "keeps legacy history calls metadata-free and removes stale acknowledgements on update in %s",
    async (backend) => {
      const mock = testIndexedDB();
      vi.stubGlobal(
        "indexedDB",
        backend === "indexeddb" ? mock.factory : undefined,
      );
      await saveDocumentRecovery("updating-session", deck(), [], {
        file: { name: "Saved.scislide", kind: "opened" },
        sessionId: "updating-session",
      });
      await saveDocumentRecovery(
        "updating-session",
        deck("New unsaved edit"),
        [],
      );
      const recovered = (await loadDocumentRecovery("updating-session"))!;
      expect(recovered.deck.title).toBe("New unsaved edit");
      expect(Object.keys(recovered).sort()).toEqual([
        "deck",
        "equationDrafts",
        "savedAt",
      ]);
      expect(recovered).not.toHaveProperty("file");
      expect(recovered).not.toHaveProperty("sessionId");
    },
  );

  it.each(["indexeddb", "localStorage"] as const)(
    "retains explicit unsaved context instead of a conflicting file acknowledgement in history %s",
    async (backend) => {
      const mock = testIndexedDB();
      vi.stubGlobal(
        "indexedDB",
        backend === "indexeddb" ? mock.factory : undefined,
      );
      const source = createDemoDeck(),
        draft = localDraft(source);
      await saveDocumentRecovery("dirty-session", source, [draft], {
        file: { name: "Older.scislide", kind: "saved" },
        sessionId: "dirty-session",
        unsaved: true,
      });
      const loaded = (await loadDocumentRecovery("dirty-session"))!;
      expect(loaded.unsaved).toBe(true);
      expect(loaded).not.toHaveProperty("file");
      expect(loaded.sessionId).toBe("dirty-session");
      expect(loaded.deck.slides).toEqual(source.slides);
      expect(loaded.equationDrafts).toEqual([draft]);
    },
  );

  it("keeps separate sessions for the same deck ID, updates only one session, and returns useful newest-first summaries", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    await saveDocumentRecovery("session-a", deck("Session A"));
    await saveDocumentRecovery("session-b", deck("Session B"));
    await saveDocumentRecovery("session-a", deck("A updated"));
    const result = await listDocumentRecoveries();
    expect(result.unavailableCount).toBe(0);
    expect(result.entries.map(({ id, title }) => [id, title])).toEqual([
      ["session-a", "A updated"],
      ["session-b", "Session B"],
    ]);
    expect(result.entries[0]).toMatchObject({
      deckId: "same-deck",
      slideCount: 1,
      draftCount: 0,
    });
    const loaded = await loadDocumentRecovery("session-a");
    expect(loaded?.deck.title).toBe("A updated");
    expect(result.entries[0].bytes).toBe(
      new TextEncoder().encode(JSON.stringify(loaded)).length,
    );
    expect(await loadDocumentRecovery("missing-session")).toBeNull();
    expect(
      mock.state.databases.every((name) => name === RECOVERY_HISTORY_DATABASE),
    ).toBe(true);
  });

  it("preserves complete editable media, text/font settings, source relationships, and unapplied equation drafts", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const source = createDemoDeck();
    source.theme.fontFamily = "Nanum Gothic";
    for (const item of source.slides)
      for (const object of item.objects)
        if (object.type === "text" && object.fontFamilySource === "deck")
          object.fontFamily = "Nanum Gothic";
    const slide = source.slides.find((item) =>
      item.objects.some((object) => object.type === "equation"),
    )!;
    const equation = slide.objects.find(
      (object) => object.type === "equation",
    )!;
    const draft: RecoveredEquationDraft = {
      deckId: source.id,
      slideId: slide.id,
      equationId: equation.id,
      updatedAt: "2026-11-14T00:00:00.000Z",
      draft: {
        latex: "x=unapplied",
        font: "mathjax-fira",
        size: 52,
        color: "#123456",
        renderer: "mathjax",
        engine: "latex",
        preamble: "",
        inheritTypography: true,
      },
    };
    localStorage.setItem(
      WORKSPACE_RECOVERY_KEY,
      "current workspace stays separate",
    );
    await saveDocumentRecovery("media-session", source, [draft]);
    const loaded = (await loadDocumentRecovery("media-session"))!;
    expect(loaded.deck.slides).toEqual(source.slides);
    expect(loaded.deck.theme).toEqual(source.theme);
    expect(loaded.equationDrafts).toEqual([draft]);
    expect(
      loaded.deck.assets.map(({ id, name, mime, width, height }) => ({
        id,
        name,
        mime,
        width,
        height,
      })),
    ).toEqual(
      source.assets.map(({ id, name, mime, width, height }) => ({
        id,
        name,
        mime,
        width,
        height,
      })),
    );
    expect(atob(loaded.deck.assets[0].dataUrl.split(",")[1])).toContain("<svg");
    expect((await listDocumentRecoveries()).entries[0].draftCount).toBe(1);
    expect(localStorage.getItem(WORKSPACE_RECOVERY_KEY)).toBe(
      "current workspace stays separate",
    );
  });

  it("compares valid timestamps separately for each ID across IndexedDB and localStorage", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    mock.state.value = snapshot([
      entry("a", "A old", "2026-01-01T00:00:00Z"),
      entry("b", "B latest", "2026-01-04T00:00:00Z"),
    ]);
    localStorage.setItem(
      RECOVERY_HISTORY_KEY,
      JSON.stringify(
        snapshot([
          entry("a", "A latest", "2026-01-03T00:00:00Z"),
          entry("b", "B old", "2026-01-02T00:00:00Z"),
        ]),
      ),
    );
    expect(
      (await listDocumentRecoveries()).entries.map(({ title }) => title),
    ).toEqual(["B latest", "A latest"]);
    expect((await loadDocumentRecovery("a"))?.savedAt).toBe(
      "2026-01-03T00:00:00.000Z",
    );
    expect((await loadDocumentRecovery("b"))?.deck.title).toBe("B latest");
  });

  it("falls back after an IndexedDB write or open failure and keeps a later primary write newer", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    await saveDocumentRecovery("session", deck("IndexedDB old"));
    mock.state.failNextWrite = true;
    expect(await saveDocumentRecovery("session", deck("Fallback newest"))).toBe(
      "localStorage",
    );
    expect((await loadDocumentRecovery("session"))?.deck.title).toBe(
      "Fallback newest",
    );
    expect(await saveDocumentRecovery("session", deck("Primary newest"))).toBe(
      "indexeddb",
    );
    expect((await loadDocumentRecovery("session"))?.deck.title).toBe(
      "Primary newest",
    );
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Unavailable", "SecurityError");
      },
    });
    expect(await saveDocumentRecovery("local-only", deck("Local entry"))).toBe(
      "localStorage",
    );
    expect((await loadDocumentRecovery("local-only"))?.deck.title).toBe(
      "Local entry",
    );
  });

  it("skips individual corrupt records while preserving their bytes and recovering valid replicas", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const bad = {
      id: "broken",
      savedAt: "2026-01-01",
      recovery: { deck: "do not overwrite" },
    };
    mock.state.value = snapshot([
      entry("good", "Good", "2026-01-01T00:00:00Z"),
      bad,
    ]);
    localStorage.setItem(
      RECOVERY_HISTORY_KEY,
      JSON.stringify(
        snapshot([
          { id: "good", savedAt: "2026-01-02", recovery: "corrupt alternate" },
        ]),
      ),
    );
    expect(await listDocumentRecoveries()).toMatchObject({
      entries: [{ id: "good", title: "Good" }],
      unavailableCount: 2,
    });
    expect(await loadDocumentRecovery("broken")).toBeNull();
    await saveDocumentRecovery("new", deck("New history"));
    expect((mock.state.value as { records: unknown[] }).records).toContainEqual(
      bad,
    );
    expect((await listDocumentRecoveries()).entries).toHaveLength(2);
    expect((await listDocumentRecoveries()).unavailableCount).toBe(2);
  });

  it("isolates an unserializable IndexedDB record from valid siblings", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    mock.state.value = snapshot([
      entry("good", "Still recoverable", "2026-01-01T00:00:00Z"),
      { id: "broken", savedAt: "2026-01-01", recovery: { unsupported: 1n } },
    ]);
    expect(await listDocumentRecoveries()).toMatchObject({
      entries: [{ id: "good", title: "Still recoverable" }],
      unavailableCount: 1,
    });
    expect((await loadDocumentRecovery("good"))?.deck.title).toBe(
      "Still recoverable",
    );
    const before = structuredClone(mock.state.value);
    await expect(saveDocumentRecovery("new", deck())).rejects.toThrow(
      "100 MiB",
    );
    expect(mock.state.value).toEqual(before);
  });

  it("preserves an unreadable history container and uses the other backend", async () => {
    const mock = testIndexedDB();
    const damaged = { invalid: "keep this stored object" };
    mock.state.value = structuredClone(damaged);
    vi.stubGlobal("indexedDB", mock.factory);
    expect(await saveDocumentRecovery("fallback", deck())).toBe("localStorage");
    expect(mock.state.value).toEqual(damaged);
    expect(await listDocumentRecoveries()).toMatchObject({
      entries: [{ id: "fallback" }],
      unavailableCount: 1,
    });
    mock.state.value = null;
    expect((await listDocumentRecoveries()).unavailableCount).toBe(1);
    mock.state.failNextRead = true;
    expect((await loadDocumentRecovery("fallback"))?.deck.title).toBe(
      "Recovered talk",
    );
  });

  it("never evicts an existing session at the ten-entry limit, and allows updates and explicit deletion", async () => {
    vi.stubGlobal("indexedDB", undefined);
    for (let count = 0; count < MAX_DOCUMENT_RECOVERIES; count++)
      await saveDocumentRecovery(`session-${count}`, deck(`Talk ${count}`));
    const previous = Object.fromEntries(
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
    );
    await expect(saveDocumentRecovery("eleventh", deck())).rejects.toThrow(
      "최대 10개",
    );
    expect(
      Object.fromEntries(
        Object.keys(localStorage).map((key) => [
          key,
          localStorage.getItem(key),
        ]),
      ),
    ).toEqual(previous);
    await saveDocumentRecovery("session-0", deck("Updated without eviction"));
    expect((await listDocumentRecoveries()).entries).toHaveLength(10);
    await deleteDocumentRecovery("session-1");
    await saveDocumentRecovery("eleventh", deck("Explicitly freed space"));
    const entries = (await listDocumentRecoveries()).entries;
    expect(entries).toHaveLength(10);
    expect(entries.some(({ id }) => id === "session-1")).toBe(false);
    expect(entries.some(({ id }) => id === "eleventh")).toBe(true);
  });

  it.each(["valid", "corrupt-same-id"])(
    "rejects an aggregate over 100 MiB without changing backend data: %s",
    async (variant) => {
      const mock = testIndexedDB();
      vi.stubGlobal("indexedDB", mock.factory);
      const large = deck("Large document");
      const object = shapeFromDrag("rect", { x: 1, y: 1 }, { x: 10, y: 10 });
      object.metadata.large = "가".repeat(18 * 1024 * 1024);
      large.slides[0].objects = [object];
      const savedAt = "2026-01-01T00:00:00.000Z";
      const record = {
        id: "large-primary",
        savedAt,
        recovery: { deck: large, equationDrafts: [], savedAt },
      };
      mock.state.value = snapshot([record]);
      const original = mock.state.value;
      const fallback = JSON.stringify(
        snapshot([
          {
            ...record,
            id: variant === "corrupt-same-id" ? "large-primary" : "large-local",
          },
        ]),
      );
      if (variant === "corrupt-same-id") large.theme.equation.fontSize = -1;
      expect(new TextEncoder().encode(fallback).length * 2).toBeGreaterThan(
        MAX_DOCUMENT_RECOVERY_BYTES,
      );
      const get = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation((key) =>
          key === RECOVERY_HISTORY_KEY ? fallback : null,
        );
      const set = vi.spyOn(Storage.prototype, "setItem");
      await expect(saveDocumentRecovery("extra", deck())).rejects.toThrow(
        "100 MiB",
      );
      expect(mock.state.value).toBe(original);
      expect(set).not.toHaveBeenCalled();
      expect(get).toHaveBeenCalledWith(RECOVERY_HISTORY_KEY);
    },
    30_000,
  );

  it("serializes writes, snapshots before awaiting, and resolves only after an atomic transaction commits", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    mock.state.holdNextWrite = true;
    const source = deck("First request");
    let settled = false;
    const first = saveDocumentRecovery("session", source).then(() => {
      settled = true;
    });
    source.title = "Second request";
    const second = saveDocumentRecovery("session", source);
    source.title = "Unsaved mutation";
    await microtasks();
    expect(settled).toBe(false);
    expect(mock.state.value).toBeUndefined();
    expect(mock.state.writes).toBe(1);
    mock.state.release!();
    await Promise.all([first, second]);
    expect((await loadDocumentRecovery("session"))?.deck.title).toBe(
      "Second request",
    );
    expect(mock.state.commits).toBe(2);
  });

  it("preserves the previous primary and fallback snapshots when both save attempts fail", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    await saveDocumentRecovery("session", deck("Committed"));
    const original = structuredClone(mock.state.value);
    const previousLocal = localStorage.getItem(RECOVERY_HISTORY_KEY);
    mock.state.failWrites = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await expect(
      saveDocumentRecovery("session", deck("Failed revision")),
    ).rejects.toThrow("기존 기록은 유지");
    expect(mock.state.value).toEqual(original);
    expect(localStorage.getItem(RECOVERY_HISTORY_KEY)).toBe(previousLocal);
    expect((await loadDocumentRecovery("session"))?.deck.title).toBe(
      "Committed",
    );
  });

  it("keeps a deletion effective across stale fallback copies, IndexedDB write failure, and backend availability changes", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    await saveDocumentRecovery("remove-me", deck("Primary copy"));
    vi.stubGlobal("indexedDB", undefined);
    await saveDocumentRecovery("remove-me", deck("Fallback copy"));
    const staleLocal = localStorage.getItem(
      RECOVERY_HISTORY_ENTRY_PREFIX + "remove-me",
    );
    vi.stubGlobal("indexedDB", mock.factory);
    mock.state.failWrites = true;
    await deleteDocumentRecovery("remove-me");
    expect(
      localStorage.getItem(RECOVERY_HISTORY_ENTRY_PREFIX + "remove-me")!.length,
    ).toBeLessThan(staleLocal!.length);
    expect(
      localStorage.getItem(RECOVERY_HISTORY_ENTRY_PREFIX + "remove-me"),
    ).not.toContain("Fallback copy");
    expect((await listDocumentRecoveries()).entries).toEqual([]);
    expect(await loadDocumentRecovery("remove-me")).toBeNull();
    vi.stubGlobal("indexedDB", undefined);
    expect((await listDocumentRecoveries()).entries).toEqual([]);
    vi.stubGlobal("indexedDB", mock.factory);
    mock.state.failWrites = false;
    await saveDocumentRecovery("keep-me", deck("Converge backends"));
    localStorage.removeItem(RECOVERY_HISTORY_DELETION_PREFIX + "remove-me");
    expect(
      (await listDocumentRecoveries()).entries.map(({ id }) => id),
    ).toEqual(["keep-me"]);
  });

  it("frees fallback payload space even when a full quota initially prevents allocating the deletion journal", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await saveDocumentRecovery("remove", deck("Fallback occupying storage"));
    const previous = localStorage.getItem(
      RECOVERY_HISTORY_ENTRY_PREFIX + "remove",
    )!;
    const setItem = Storage.prototype.setItem;
    let firstJournalWrite = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      function (key, value) {
        if (
          key === RECOVERY_HISTORY_DELETION_PREFIX + "remove" &&
          firstJournalWrite
        ) {
          firstJournalWrite = false;
          throw new DOMException(
            "Full storage cannot allocate a new key",
            "QuotaExceededError",
          );
        }
        setItem.call(this, key, value);
      },
    );
    await deleteDocumentRecovery("remove");
    expect(
      localStorage.getItem(RECOVERY_HISTORY_ENTRY_PREFIX + "remove")!.length,
    ).toBeLessThan(previous.length);
    expect(
      localStorage.getItem(RECOVERY_HISTORY_ENTRY_PREFIX + "remove"),
    ).not.toContain("Fallback occupying storage");
    expect(
      localStorage.getItem(RECOVERY_HISTORY_DELETION_PREFIX + "remove"),
    ).toContain("remove");
    expect((await listDocumentRecoveries()).entries).toEqual([]);
  });

  it("does not delete a primary recovery when the durable deletion journal cannot be written", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    await saveDocumentRecovery("keep", deck());
    const before = structuredClone(mock.state.value);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    await expect(deleteDocumentRecovery("keep")).rejects.toThrow(
      "기존 복구 기록을 유지",
    );
    expect(mock.state.value).toEqual(before);
    expect((await listDocumentRecoveries()).entries).toHaveLength(1);
  });

  it("sanitizes imported SVGs, validates IDs/settings, and keeps failed writes out of history", async () => {
    vi.stubGlobal("indexedDB", undefined);
    for (const id of [
      "",
      "../unsafe",
      "__proto__",
      "bad\0id",
      "a".repeat(129),
    ]) {
      await expect(saveDocumentRecovery(id, deck())).rejects.toThrow("ID");
      await expect(loadDocumentRecovery(id)).rejects.toThrow("ID");
      await expect(deleteDocumentRecovery(id)).rejects.toThrow("ID");
    }
    expect(localStorage.length).toBe(0);
    const source = createDemoDeck();
    source.assets[0].dataUrl =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><script>bad()</script><path d="M0 0L1 1"/></svg>',
      );
    await saveDocumentRecovery("sanitized", source);
    const loaded = (await loadDocumentRecovery("sanitized"))!;
    expect(atob(loaded.deck.assets[0].dataUrl.split(",")[1])).not.toMatch(
      /script|onload/,
    );
    const corrupt = deck();
    corrupt.theme.equation.fontSize = -1;
    await expect(saveDocumentRecovery("invalid", corrupt)).rejects.toThrow();
    expect(
      (await listDocumentRecoveries()).entries.map(({ id }) => id),
    ).toEqual(["sanitized"]);
  });
  it("preserves the newest corrupt same-ID raw source when saving an unrelated session", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const corrupt = {
      id: "old-session",
      savedAt: "2026-11-14T12:00:00.000Z",
      recovery: {
        deck: { title: "LATEST PRECIOUS RAW SOURCE", bad: true },
        equationDrafts: [],
        savedAt: "2026-11-14T12:00:00.000Z",
      },
    };
    mock.state.value = snapshot([corrupt]);
    const oldLocal = JSON.stringify(
      snapshot([
        entry("old-session", "Old valid replica", "2026-11-13T00:00:00Z"),
      ]),
    );
    localStorage.setItem(RECOVERY_HISTORY_KEY, oldLocal);
    await saveDocumentRecovery("unrelated-session", deck("Another document"));
    expect((mock.state.value as { records: unknown[] }).records).toContainEqual(
      corrupt,
    );
    expect(localStorage.getItem(RECOVERY_HISTORY_KEY)).toBe(oldLocal);
    expect((await loadDocumentRecovery("old-session"))?.deck.title).toBe(
      "Old valid replica",
    );
    expect((await listDocumentRecoveries()).unavailableCount).toBe(1);
    await saveDocumentRecovery("old-session", deck("Updated valid replica"));
    expect((mock.state.value as { records: unknown[] }).records).toContainEqual(
      corrupt,
    );
    await deleteDocumentRecovery("unrelated-session");
    expect((mock.state.value as { records: unknown[] }).records).toContainEqual(
      corrupt,
    );
    await deleteDocumentRecovery("old-session");
    expect(JSON.stringify(mock.state.value)).not.toContain(
      "LATEST PRECIOUS RAW SOURCE",
    );
  });

  it("atomically merges saves from independent module contexts without Web Locks", async () => {
    const apiA =
      await import("../src/lib/recovery-history.ts?history-idb-context-a");
    const apiB =
      await import("../src/lib/recovery-history.ts?history-idb-context-b");
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    expect(navigator.locks).toBeUndefined();
    await Promise.all([
      apiA.saveDocumentRecovery("window-a", deck("Window A")),
      apiB.saveDocumentRecovery("window-b", deck("Window B")),
    ]);
    expect(
      (mock.state.value as { records: { id: string }[] }).records
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["window-a", "window-b"]);
    expect(mock.state.compoundWrites).toBe(2);
    expect((await apiA.loadDocumentRecovery("window-a"))?.deck.title).toBe(
      "Window A",
    );
    expect((await apiB.loadDocumentRecovery("window-b"))?.deck.title).toBe(
      "Window B",
    );
  });

  it("checks the ten-entry limit inside the same cross-context write transaction", async () => {
    const apiA =
      await import("../src/lib/recovery-history.ts?history-cap-context-a");
    const apiB =
      await import("../src/lib/recovery-history.ts?history-cap-context-b");
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    mock.state.value = snapshot(
      Array.from({ length: 9 }, (_, index) =>
        entry(`existing-${index}`, `Talk ${index}`, "2026-01-01T00:00:00Z"),
      ),
    );
    const result = await Promise.allSettled([
      apiA.saveDocumentRecovery("tenth-a", deck("A")),
      apiB.saveDocumentRecovery("tenth-b", deck("B")),
    ]);
    expect(result.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(result.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect((await apiA.listDocumentRecoveries()).entries).toHaveLength(10);
    expect(
      Object.keys(localStorage).filter((key) =>
        key.startsWith(RECOVERY_HISTORY_ENTRY_PREFIX),
      ),
    ).toEqual([]);
  });

  it("preserves a simultaneous unrelated IDB save while deleting another session", async () => {
    const apiA =
      await import("../src/lib/recovery-history.ts?history-delete-context-a");
    const apiB =
      await import("../src/lib/recovery-history.ts?history-delete-context-b");
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    await apiA.saveDocumentRecovery("delete-me", deck("Old document"));
    await Promise.all([
      apiA.saveDocumentRecovery("new-document", deck("New document")),
      apiB.deleteDocumentRecovery("delete-me"),
    ]);
    expect(
      (await apiB.listDocumentRecoveries()).entries.map(({ id }) => id),
    ).toEqual(["new-document"]);
    expect((await apiA.loadDocumentRecovery("new-document"))?.deck.title).toBe(
      "New document",
    );
  });

  it.each(["absent", "failed"])(
    "keeps concurrent fallback saves and deletes independent when IndexedDB is %s",
    async (availability) => {
      const apiA =
        await import("../src/lib/recovery-history.ts?history-local-context-a");
      const apiB =
        await import("../src/lib/recovery-history.ts?history-local-context-b");
      const mock = testIndexedDB();
      mock.state.failWrites = true;
      vi.stubGlobal(
        "indexedDB",
        availability === "absent" ? undefined : mock.factory,
      );
      const legacy = JSON.stringify(
        snapshot([
          entry("legacy-session", "Legacy source", "2026-01-01T00:00:00Z"),
        ]),
      );
      const legacyJournal = JSON.stringify(
        snapshot([
          {
            id: "old-deleted-session",
            savedAt: "2026-01-01T00:00:00Z",
            deleted: true,
          },
        ]),
      );
      localStorage.setItem(RECOVERY_HISTORY_KEY, legacy);
      localStorage.setItem(RECOVERY_HISTORY_DELETIONS_KEY, legacyJournal);
      await Promise.all([
        apiA.saveDocumentRecovery("local-a", deck("Local A")),
        apiB.saveDocumentRecovery("local-b", deck("Local B")),
      ]);
      expect(
        (await apiA.listDocumentRecoveries()).entries
          .map(({ id }) => id)
          .sort(),
      ).toEqual(["legacy-session", "local-a", "local-b"]);
      expect(localStorage.getItem(RECOVERY_HISTORY_KEY)).toBe(legacy);
      expect(localStorage.getItem(RECOVERY_HISTORY_DELETIONS_KEY)).toBe(
        legacyJournal,
      );
      await Promise.all([
        apiA.deleteDocumentRecovery("local-a"),
        apiB.deleteDocumentRecovery("local-b"),
      ]);
      expect(
        (await apiB.listDocumentRecoveries()).entries.map(({ id }) => id),
      ).toEqual(["legacy-session"]);
      expect(
        Object.keys(localStorage)
          .filter((key) => key.startsWith(RECOVERY_HISTORY_DELETION_PREFIX))
          .sort(),
      ).toEqual([
        RECOVERY_HISTORY_DELETION_PREFIX + "local-a",
        RECOVERY_HISTORY_DELETION_PREFIX + "local-b",
      ]);
      expect(localStorage.getItem(RECOVERY_HISTORY_KEY)).toBe(legacy);
      expect(localStorage.getItem(RECOVERY_HISTORY_DELETIONS_KEY)).toBe(
        legacyJournal,
      );
    },
  );
});
