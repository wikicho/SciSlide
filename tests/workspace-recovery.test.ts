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
import type { RecoveredEquationDraft } from "../src/lib/workspace-recovery";

/** Minimal transactional test database: writes become visible only on commit. */
function testIndexedDB() {
  const state: { value?: unknown; failNextWrite: boolean } = {
    failNextWrite: false,
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
          if (mode === "readwrite" && state.failNextWrite) {
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
    expect(localStorage.getItem(WORKSPACE_RECOVERY_KEY)).toBeNull();
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
      "Storage access denied",
    );
    const mock = testIndexedDB();
    mock.state.value = { invalid: "latest-record" };
    vi.stubGlobal("indexedDB", mock.factory);
    await expect(loadWorkspaceRecovery()).rejects.toThrow(
      "Storage access denied",
    );
    expect(mock.state.value).toEqual({ invalid: "latest-record" });
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
