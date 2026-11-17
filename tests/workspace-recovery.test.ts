// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoDeck } from "../src/lib/model";
import type { Deck } from "../src/lib/model";
import { saveRecovery } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
  validateWorkspaceRecovery,
  WORKSPACE_RECOVERY_KEY,
} from "../src/lib/workspace-recovery";
import type {
  RecoveryContext,
  RecoveredEquationDraft,
} from "../src/lib/workspace-recovery";

/** Minimal transactional test database: writes become visible only on commit. */
function testIndexedDB() {
  const state: {
    value?: unknown;
    failNextWrite: boolean;
    failNextRead: boolean;
  } = {
    failNextWrite: false,
    failNextRead: false,
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: (_store: string, mode: string) => {
      let pending: unknown;
      let request: { result?: unknown; onsuccess?: () => void } | undefined;
      const transaction = {
        error: null as DOMException | null,
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        objectStore: () => ({
          get: () => {
            request = {};
            return request;
          },
          put: (value: unknown) => {
            pending = structuredClone(value);
            request = {};
            return request;
          },
        }),
      };
      queueMicrotask(() => {
        if (request) {
          request.result =
            state.value === undefined
              ? undefined
              : structuredClone(state.value);
          request.onsuccess?.();
        }
        queueMicrotask(() => {
          if (mode === "readonly" && state.failNextRead) {
            state.failNextRead = false;
            transaction.error = new DOMException(
              "Read unavailable",
              "UnknownError",
            );
            transaction.onabort?.();
          } else if (mode === "readwrite" && state.failNextWrite) {
            state.failNextWrite = false;
            transaction.error = new DOMException(
              "Quota exceeded",
              "QuotaExceededError",
            );
            transaction.onabort?.();
          } else {
            if (mode === "readwrite") state.value = pending;
            transaction.oncomplete?.();
          }
        });
      });
      return transaction;
    },
  };
  const factory = {
    open: () => {
      const request = {
        result: database,
        onsuccess: undefined as (() => void) | undefined,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, state };
}

function unappliedDraft(deck: Deck): RecoveredEquationDraft {
  const slide = deck.slides.find((slide) =>
    slide.objects.some((object) => object.type === "equation"),
  )!;
  const equation = slide.objects.find((object) => object.type === "equation")!;
  return {
    deckId: deck.id,
    slideId: slide.id,
    equationId: equation.id,
    updatedAt: "2026-10-04T12:00:00.000Z",
    draft: {
      latex: String.raw`\alpha + \beta`,
      font: "mathjax-fira",
      size: 52,
      color: "#123456",
      renderer: "local-latex",
      engine: "xelatex",
      preamble: String.raw`\usepackage{unicode-math}`,
    },
  };
}

describe("complete workspace recovery", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["indexeddb", "localStorage"] as const)(
    "round-trips file provenance, stable session, media and local drafts through %s without sharing caller context",
    async (backend) => {
      const mock = testIndexedDB();
      vi.stubGlobal(
        "indexedDB",
        backend === "indexeddb" ? mock.factory : undefined,
      );
      const deck = createDemoDeck(),
        draft = unappliedDraft(deck);
      const context: RecoveryContext = {
        file: { name: "연구 results.scislide", kind: "saved" },
        sessionId: "resumed-session_1",
      };
      const saving = saveWorkspaceRecovery(deck, [draft], context);
      context.file!.name = "Mutated after calling save.scislide";
      context.file!.kind = "opened";
      context.sessionId = "different-session";
      draft.draft.latex = "mutated after save";
      expect(await saving).toBe(backend);
      const loaded = (await loadWorkspaceRecovery())!;
      expect(loaded.file).toEqual({
        name: "연구 results.scislide",
        kind: "saved",
      });
      expect(loaded.sessionId).toBe("resumed-session_1");
      expect(loaded.deck.slides).toEqual(deck.slides);
      expect(loaded.deck.assets).toHaveLength(deck.assets.length);
      expect(loaded.equationDrafts[0].draft.latex).toBe(
        String.raw`\alpha + \beta`,
      );
      expect(loaded.file).not.toBe(context.file);
      const stored =
        backend === "indexeddb"
          ? mock.state.value
          : JSON.parse(localStorage.getItem(WORKSPACE_RECOVERY_KEY)!);
      expect(stored).toMatchObject({
        file: loaded.file,
        sessionId: loaded.sessionId,
      });
      expect(Object.keys(stored as object).sort()).toEqual([
        "deck",
        "equationDrafts",
        "file",
        "savedAt",
        "sessionId",
      ]);
    },
  );

  it.each(["saved", "opened", "downloaded"] as const)(
    "preserves the %s acknowledgement and strips unrelated file metadata",
    (kind) => {
      const deck = createDemoDeck();
      const loaded = validateWorkspaceRecovery({
        deck,
        equationDrafts: [],
        savedAt: "2026-11-18T00:00:00.000Z",
        file: {
          name: "A".repeat(1000),
          kind,
          path: "/untrusted/file",
          mime: "application/x-test",
        },
        sessionId: "a".repeat(128),
      });
      expect(loaded.file).toEqual({ name: "A".repeat(1000), kind });
      expect(loaded.sessionId).toBe("a".repeat(128));
    },
  );

  it.each([
    null,
    [],
    { name: "", kind: "saved" },
    { name: "   ", kind: "saved" },
    { name: "A".repeat(1001), kind: "saved" },
    { name: "nul\0name.scislide", kind: "saved" },
    { name: "Saved.scislide", kind: "not-saved" },
  ])(
    "omits malformed file provenance %j without losing the deck or its local draft",
    (file) => {
      const deck = createDemoDeck(),
        draft = unappliedDraft(deck);
      const recovered = validateWorkspaceRecovery({
        deck,
        equationDrafts: [draft],
        savedAt: draft.updatedAt,
        file,
        sessionId: "valid-session",
      });
      expect(recovered).not.toHaveProperty("file");
      expect(recovered.sessionId).toBe("valid-session");
      expect(recovered.deck.slides).toEqual(deck.slides);
      expect(recovered.equationDrafts).toEqual([draft]);
    },
  );

  it.each([null, 123, "", "_wrong-start", "path/to/file", "a".repeat(129)])(
    "omits malformed session identity %j while retaining valid file provenance",
    (sessionId) => {
      const deck = createDemoDeck();
      const file = { name: "Saved.scislide", kind: "saved" };
      const recovered = validateWorkspaceRecovery({
        deck,
        equationDrafts: [],
        savedAt: "2026-11-18T00:00:00.000Z",
        file,
        sessionId,
      });
      expect(recovered).not.toHaveProperty("sessionId");
      expect(recovered.file).toEqual(file);
      expect(recovered.deck.slides).toEqual(deck.slides);
    },
  );

  it("discards cyclic unknown optional metadata before byte counting so valid work remains recoverable", () => {
    const deck = createDemoDeck(),
      draft = unappliedDraft(deck);
    const file: Record<string, unknown> = {
      name: "Known.scislide",
      kind: "opened",
    };
    file.extra = file;
    const sessionId: Record<string, unknown> = {};
    sessionId.self = sessionId;
    const recovered = validateWorkspaceRecovery({
      deck,
      equationDrafts: [draft],
      savedAt: draft.updatedAt,
      file,
      sessionId,
    });
    expect(recovered.file).toEqual({ name: "Known.scislide", kind: "opened" });
    expect(recovered).not.toHaveProperty("sessionId");
    expect(recovered.equationDrafts).toEqual([draft]);
  });

  it.each(["indexeddb", "localStorage"] as const)(
    "keeps old calls unchanged and replaces acknowledged provenance with dirty state on %s",
    async (backend) => {
      const mock = testIndexedDB();
      vi.stubGlobal(
        "indexedDB",
        backend === "indexeddb" ? mock.factory : undefined,
      );
      const deck = createDemoDeck();
      await saveWorkspaceRecovery(deck, [], {
        file: { name: "Saved.scislide", kind: "saved" },
        sessionId: "session-a",
      });
      await saveWorkspaceRecovery({ ...deck, title: "Unsaved after save" });
      const loaded = (await loadWorkspaceRecovery())!;
      expect(Object.keys(loaded).sort()).toEqual([
        "deck",
        "equationDrafts",
        "savedAt",
      ]);
      expect(loaded.deck.title).toBe("Unsaved after save");
      expect(loaded).not.toHaveProperty("file");
      expect(loaded).not.toHaveProperty("sessionId");
    },
  );

  it.each(["indexeddb", "localStorage"] as const)(
    "preserves an explicit unsaved snapshot and drops conflicting saved provenance in %s",
    async (backend) => {
      const mock = testIndexedDB();
      vi.stubGlobal(
        "indexedDB",
        backend === "indexeddb" ? mock.factory : undefined,
      );
      const deck = createDemoDeck(),
        draft = unappliedDraft(deck);
      const context: RecoveryContext = {
        file: { name: "Older saved.scislide", kind: "saved" },
        sessionId: "known-dirty-session",
        unsaved: true,
      };
      const saving = saveWorkspaceRecovery(deck, [draft], context);
      delete context.unsaved;
      await saving;
      const loaded = (await loadWorkspaceRecovery())!;
      expect(loaded.unsaved).toBe(true);
      expect(loaded).not.toHaveProperty("file");
      expect(loaded.sessionId).toBe("known-dirty-session");
      expect(loaded.deck.slides).toEqual(deck.slides);
      expect(loaded.equationDrafts).toEqual([draft]);
    },
  );

  it("does not infer dirty provenance from false or malformed flags, including cyclic metadata", () => {
    const deck = createDemoDeck();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const unsaved of [false, "true", 1, cyclic]) {
      const loaded = validateWorkspaceRecovery({
        deck,
        equationDrafts: [],
        savedAt: "2026-11-18T00:00:00.000Z",
        file: { name: "Acknowledged.scislide", kind: "opened" },
        sessionId: "stable-session",
        unsaved,
      });
      expect(loaded).not.toHaveProperty("unsaved");
      expect(loaded.file).toEqual({
        name: "Acknowledged.scislide",
        kind: "opened",
      });
      expect(loaded.deck.slides).toEqual(deck.slides);
    }
  });

  it("preserves complete media and unapplied equation source in IndexedDB", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const deck = createDemoDeck();
    // Exceeds typical localStorage capacity; IndexedDB does not touch localStorage.
    deck.assets.push({
      id: "large-video",
      name: "experiment.mp4",
      mime: "video/mp4",
      width: 1920,
      height: 1080,
      dataUrl: `data:video/mp4;base64,${"AAAA".repeat(2 * 1024 * 1024)}`,
    });
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Small localStorage", "QuotaExceededError");
      });
    const draft = unappliedDraft(deck);
    expect(await saveWorkspaceRecovery(deck, [draft])).toBe("indexeddb");
    const recovered = await loadWorkspaceRecovery();
    expect(
      recovered?.deck.assets.find((asset) => asset.id === "large-video")
        ?.dataUrl,
    ).toBe(deck.assets.at(-1)?.dataUrl);
    expect(recovered?.deck.slides).toEqual(deck.slides);
    expect(recovered?.equationDrafts).toEqual([draft]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the last committed snapshot after a transaction abort and permits a later retry", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const deck = createDemoDeck();
    await saveWorkspaceRecovery(deck, [unappliedDraft(deck)]);
    const revision = { ...deck, title: "New revision" };
    mock.state.failNextWrite = true;
    await expect(saveWorkspaceRecovery(revision)).rejects.toThrow(
      "Quota exceeded",
    );
    expect((await loadWorkspaceRecovery())?.deck.title).toBe(deck.title);
    expect((await loadWorkspaceRecovery())?.equationDrafts).toHaveLength(1);
    expect(localStorage.getItem(WORKSPACE_RECOVERY_KEY)).toBeNull();
    await saveWorkspaceRecovery(revision);
    expect((await loadWorkspaceRecovery())?.deck.title).toBe("New revision");
  });

  it("snapshots before awaiting and commits simultaneous requests in order", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const deck = createDemoDeck();
    const first = saveWorkspaceRecovery(deck);
    deck.title = "Second revision";
    const second = saveWorkspaceRecovery(deck);
    deck.title = "Unsaved change";
    await Promise.all([first, second]);
    expect((await loadWorkspaceRecovery())?.deck.title).toBe("Second revision");
  });

  it("migrates the existing recovery deck and sanitizes imported SVG figures", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const deck = createDemoDeck();
    const asset = deck.assets[0];
    asset.dataUrl =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)"><script>bad()</script><path d="M0 0L100 100"/><image href="https://bad.test/track.png"/></svg>',
      );
    saveRecovery(deck);
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const migrated = await loadWorkspaceRecovery();
    expect(migrated?.deck.id).toBe(deck.id);
    const svg = atob(migrated!.deck.assets[0].dataUrl.split(",")[1]);
    expect(svg).toContain("M0 0L100 100");
    expect(svg).not.toMatch(/script|onload|bad.test/);
    localStorage.clear();
    expect((await loadWorkspaceRecovery())?.deck.id).toBe(deck.id);
  });

  it("uses atomic localStorage fallback for drafts and surfaces quota failures", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const deck = createDemoDeck(),
      draft = unappliedDraft(deck);
    expect(await saveWorkspaceRecovery(deck, [draft])).toBe("localStorage");
    expect((await loadWorkspaceRecovery())?.equationDrafts).toEqual([draft]);
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
    await expect(
      saveWorkspaceRecovery({ ...deck, title: "Failed revision" }, [draft]),
    ).rejects.toThrow("Quota exceeded");
    expect((await loadWorkspaceRecovery())?.deck.title).toBe(deck.title);
    spy.mockRestore();
    await saveWorkspaceRecovery({ ...deck, title: "Applied draft" });
    expect(
      JSON.parse(localStorage.getItem(WORKSPACE_RECOVERY_KEY)!).savedAt,
    ).toBeTruthy();
    expect((await loadWorkspaceRecovery())?.deck.title).toBe("Applied draft");
    expect((await loadWorkspaceRecovery())?.equationDrafts).toEqual([]);
  });

  it("does not report a successful fallback when opening IndexedDB fails with a quota error", async () => {
    const deck = createDemoDeck();
    saveRecovery(deck);
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Database quota exceeded", "QuotaExceededError");
      },
    });
    await expect(
      saveWorkspaceRecovery({ ...deck, title: "Failed revision" }),
    ).rejects.toThrow("Database quota exceeded");
    vi.stubGlobal("indexedDB", undefined);
    expect((await loadWorkspaceRecovery())?.deck.title).toBe(deck.title);
  });

  it("rejects corrupt IndexedDB records without a valid fallback and preserves their stored bytes", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const corrupt = {
      deck: { id: "unreadable-latest-deck" },
      equationDrafts: [],
      savedAt: "2026-10-04T12:00:00.000Z",
    };
    mock.state.value = structuredClone(corrupt);
    await expect(loadWorkspaceRecovery()).rejects.toThrow(
      "Existing data was preserved",
    );
    expect(mock.state.value).toEqual(corrupt);
    mock.state.value = null;
    await expect(loadWorkspaceRecovery()).rejects.toThrow(
      "Existing data was preserved",
    );
    expect(mock.state.value).toBeNull();
  });

  it("rejects corrupt local v2 and legacy records instead of treating them as an empty workspace", async () => {
    vi.stubGlobal("indexedDB", undefined);
    localStorage.setItem(WORKSPACE_RECOVERY_KEY, "{broken-v2");
    await expect(loadWorkspaceRecovery()).rejects.toThrow(
      "Existing data was preserved",
    );
    expect(localStorage.getItem(WORKSPACE_RECOVERY_KEY)).toBe("{broken-v2");
    localStorage.removeItem(WORKSPACE_RECOVERY_KEY);
    localStorage.setItem("scislide.recovery.v1", "{broken-legacy");
    await expect(loadWorkspaceRecovery()).rejects.toThrow(
      "Existing data was preserved",
    );
    expect(localStorage.getItem("scislide.recovery.v1")).toBe("{broken-legacy");
  });

  it("restores a valid legacy fallback despite corrupt IndexedDB and local v2 snapshots", async () => {
    const mock = testIndexedDB();
    mock.state.value = { invalid: "latest-record" };
    vi.stubGlobal("indexedDB", mock.factory);
    const deck = createDemoDeck();
    saveRecovery(deck);
    localStorage.setItem(WORKSPACE_RECOVERY_KEY, "{broken-v2");
    expect((await loadWorkspaceRecovery())?.deck.id).toBe(deck.id);
    expect(mock.state.value).toEqual({ invalid: "latest-record" });
    expect(localStorage.getItem(WORKSPACE_RECOVERY_KEY)).toBe("{broken-v2");
    vi.stubGlobal("indexedDB", undefined);
    expect((await loadWorkspaceRecovery())?.deck.id).toBe(deck.id);
  });

  it("restores a valid local v2 snapshot when IndexedDB contains an invalid record", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const deck = createDemoDeck(),
      draft = unappliedDraft(deck);
    await saveWorkspaceRecovery(deck, [draft]);
    const mock = testIndexedDB();
    mock.state.value = { invalid: "latest-record" };
    vi.stubGlobal("indexedDB", mock.factory);
    const recovered = await loadWorkspaceRecovery();
    expect(recovered?.deck.id).toBe(deck.id);
    expect(recovered?.equationDrafts).toEqual([draft]);
  });

  it("rejects denied localStorage reads so the editor cannot overwrite an unseen snapshot", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage access denied", "SecurityError");
    });
    await expect(loadWorkspaceRecovery()).rejects.toThrow(
      "Existing data was preserved",
    );
    const mock = testIndexedDB();
    mock.state.value = { invalid: "latest-record" };
    vi.stubGlobal("indexedDB", mock.factory);
    await expect(loadWorkspaceRecovery()).rejects.toThrow(
      "Existing data was preserved",
    );
    expect(mock.state.value).toEqual({ invalid: "latest-record" });
  });

  it("chooses the newest valid snapshot across IndexedDB, local v2, and legacy storage", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const deck = createDemoDeck();
    mock.state.value = {
      deck: { ...deck, title: "IndexedDB old" },
      equationDrafts: [],
      savedAt: "2026-10-01T00:00:00.000Z",
    };
    const draft = unappliedDraft(deck);
    localStorage.setItem(
      WORKSPACE_RECOVERY_KEY,
      JSON.stringify({
        deck: { ...deck, title: "Local latest" },
        equationDrafts: [draft],
        savedAt: "2026-10-03T00:00:00.000Z",
      }),
    );
    localStorage.setItem(
      "scislide.recovery.v1",
      JSON.stringify({
        deck: { ...deck, title: "Legacy middle" },
        savedAt: "2026-10-02T00:00:00.000Z",
      }),
    );
    const recovered = await loadWorkspaceRecovery();
    expect(recovered?.deck.title).toBe("Local latest");
    expect(recovered?.equationDrafts).toEqual([draft]);
    localStorage.setItem(
      "scislide.recovery.v1",
      JSON.stringify({
        deck: { ...deck, title: "Legacy latest" },
        savedAt: "2026-10-04T00:00:00.000Z",
      }),
    );
    expect((await loadWorkspaceRecovery())?.deck.title).toBe("Legacy latest");
    mock.state.value = {
      deck: { ...deck, title: "IndexedDB latest" },
      equationDrafts: [],
      savedAt: "2026-10-05T00:00:00.000Z",
    };
    expect((await loadWorkspaceRecovery())?.deck.title).toBe(
      "IndexedDB latest",
    );
  });

  it("retains the legacy save date and treats undated legacy data as unknown age", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const deck = createDemoDeck();
    localStorage.setItem(
      "scislide.recovery.v1",
      JSON.stringify({
        deck,
        savedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    expect((await loadWorkspaceRecovery())?.savedAt).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    localStorage.setItem("scislide.recovery.v1", JSON.stringify({ deck }));
    expect((await loadWorkspaceRecovery())?.savedAt).toBe(
      "1970-01-01T00:00:00.000Z",
    );
  });

  it("restores local data after IndexedDB open or read failures", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const deck = createDemoDeck();
    await saveWorkspaceRecovery(deck, [unappliedDraft(deck)]);
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Unavailable", "QuotaExceededError");
      },
    });
    expect((await loadWorkspaceRecovery())?.deck.title).toBe(deck.title);
    const mock = testIndexedDB();
    mock.state.failNextRead = true;
    vi.stubGlobal("indexedDB", mock.factory);
    expect((await loadWorkspaceRecovery())?.equationDrafts).toHaveLength(1);
  });

  it("restores IndexedDB data when local storage is damaged or inaccessible", async () => {
    const mock = testIndexedDB();
    vi.stubGlobal("indexedDB", mock.factory);
    const deck = createDemoDeck();
    await saveWorkspaceRecovery(deck);
    localStorage.setItem(WORKSPACE_RECOVERY_KEY, "{broken");
    expect((await loadWorkspaceRecovery())?.deck.id).toBe(deck.id);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage access denied", "SecurityError");
    });
    expect((await loadWorkspaceRecovery())?.deck.id).toBe(deck.id);
  });

  it("orders local saves within the same millisecond without losing their saved date", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2020-01-01T00:00:00.000Z"),
    );
    const deck = createDemoDeck();
    await saveWorkspaceRecovery(deck);
    const first = (await loadWorkspaceRecovery())!.savedAt;
    await saveWorkspaceRecovery({ ...deck, title: "Newer" });
    const latest = (await loadWorkspaceRecovery())!;
    expect(latest.savedAt > first).toBe(true);
    expect(latest.deck.title).toBe("Newer");
  });

  it("preserves optional typography inheritance while leaving legacy drafts explicit", () => {
    const deck = createDemoDeck();
    const draft = unappliedDraft(deck);
    const recovery = {
      deck,
      equationDrafts: [draft],
      savedAt: draft.updatedAt,
    };
    expect(
      validateWorkspaceRecovery(recovery).equationDrafts[0].draft
        .inheritTypography,
    ).toBeUndefined();
    draft.draft.inheritTypography = true;
    expect(
      validateWorkspaceRecovery(recovery).equationDrafts[0].draft
        .inheritTypography,
    ).toBe(true);
    expect(() =>
      validateWorkspaceRecovery({
        ...recovery,
        equationDrafts: [
          { ...draft, draft: { ...draft.draft, inheritTypography: "true" } },
        ],
      }),
    ).toThrow("settings");
  });

  it("rejects damaged settings, bounds drafts, and drops drafts belonging to removed objects", () => {
    const deck = createDemoDeck(),
      draft = unappliedDraft(deck);
    const recovery = {
      deck,
      equationDrafts: [draft],
      savedAt: draft.updatedAt,
    };
    expect(() =>
      validateWorkspaceRecovery({
        ...recovery,
        equationDrafts: [
          { ...draft, draft: { ...draft.draft, latex: "x".repeat(32_001) } },
        ],
      }),
    ).toThrow("32,000");
    expect(() =>
      validateWorkspaceRecovery({
        ...recovery,
        equationDrafts: Array(201).fill(draft),
      }),
    ).toThrow("too many");
    const stale = { ...draft, equationId: "removed-equation" };
    const older = {
      ...draft,
      updatedAt: "2026-10-03T12:00:00.000Z",
      draft: { ...draft.draft, latex: "old" },
    };
    expect(
      validateWorkspaceRecovery({
        ...recovery,
        equationDrafts: [draft, older, stale],
      }).equationDrafts,
    ).toEqual([draft]);
    expect(() =>
      validateWorkspaceRecovery({
        ...recovery,
        equationDrafts: [
          {
            ...draft,
            draft: { ...draft.draft, color: "url(https://bad.test)" },
          },
        ],
      }),
    ).toThrow("settings");
  });
});
