// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBlankSlide,
  createDemoDeck,
  validateDeck,
  type Deck,
} from "../src/lib/model";
import { shapeFromDrag } from "../src/lib/drawing";
import {
  captureUserSlideLayout,
  deleteUserSlideLayout,
  instantiateUserSlideLayout,
  isUserSlideLayoutCompatible,
  listUserSlideLayouts,
  saveUserSlideLayout,
  userSlideLayoutPreviewDeck,
  validateUserSlideLayout,
  MAX_USER_LAYOUTS,
  USER_LAYOUT_DATABASE,
  USER_LAYOUT_STORAGE_PREFIX,
} from "../src/lib/user-layouts";

function blank(): Deck {
  return {
    ...createDemoDeck(),
    slides: [createBlankSlide()],
    assets: [],
    pageNumbers: undefined,
  };
}
function layout(name = "My layout") {
  const deck = blank();
  deck.slides[0].notes = "Notes stay editable 한글";
  return captureUserSlideLayout(deck, deck.slides[0], name);
}
/** FIFO readwrite transactions preserve the same isolation as separate IDB connections. */
function indexedDatabase() {
  const values = new Map<string, unknown>();
  const jobs: (() => void)[] = [];
  const state = { failWrites: false, names: [] as string[], compoundWrites: 0 };
  let active = false;
  const advance = () => {
    active = false;
    const next = jobs.shift();
    if (next) {
      active = true;
      queueMicrotask(next);
    }
  };
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    createObjectStore() {},
    transaction: (_name: string, mode: string) => {
      let request: { result?: unknown[]; onsuccess?: () => void } | undefined;
      let pending: { id: string } | undefined,
        aborted = false;
      const transaction = {
        error: null as DOMException | null,
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        abort() {
          aborted = true;
        },
        objectStore: () => ({
          getAll: () => (request = {}),
          put: (value: { id: string }) => {
            pending = structuredClone(value);
            return {};
          },
        }),
      };
      jobs.push(() => {
        if (request) {
          request.result = structuredClone([...values.values()]);
          request.onsuccess?.();
        }
        queueMicrotask(() => {
          if (aborted || (mode === "readwrite" && state.failWrites)) {
            transaction.error = new DOMException(
              "Storage quota",
              "QuotaExceededError",
            );
            transaction.onabort?.();
          } else {
            if (pending) {
              values.set(pending.id, pending);
              if (request) state.compoundWrites++;
            }
            transaction.oncomplete?.();
          }
          advance();
        });
      });
      if (!active) advance();
      return transaction;
    },
  };
  return {
    values,
    state,
    factory: {
      open: (name: string) => {
        state.names.push(name);
        const request = {
          result: db,
          onsuccess: undefined as (() => void) | undefined,
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    } as unknown as IDBFactory,
  };
}

describe("reusable user slide layouts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("indexedDB", undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("captures independent notes, geometry, hidden/locked groups, media, and inherited typography", () => {
    const source = createDemoDeck();
    const slide = source.slides.find((s) =>
      s.objects.some((o) => o.type === "figure"),
    )!;
    const equation = source.slides
      .flatMap((s) => s.objects)
      .find((o) => o.type === "equation")!;
    if (equation.type !== "equation") throw new Error("Missing equation");
    equation.style = {};
    const frame = shapeFromDrag("rect", { x: 30, y: 40 }, { x: 130, y: 140 });
    const decoration = structuredClone(frame);
    decoration.id = "layout-decoration";
    frame.groupId = decoration.groupId = "layout-group";
    decoration.metadata.mediaPlaceholderFor = frame.id;
    decoration.visible = false;
    frame.locked = true;
    slide.objects = [
      ...slide.objects.filter((object) => object.id !== equation.id),
      structuredClone(equation),
      frame,
      decoration,
    ];
    const text = slide.objects.find((o) => o.type === "text")!;
    if (text.type !== "text") throw new Error("Missing text");
    text.fontFamilySource = "deck";
    text.text = "Symmetry $U(1)$";
    source.theme.fontFamily = "Nanum Gothic";
    source.theme.inlineMathFontSetId = "mathjax-fira";
    source.slides = [slide];
    slide.notes = "Remember the evidence";
    const saved = captureUserSlideLayout(source, slide, " Results ");
    const preview = userSlideLayoutPreviewDeck(saved);
    expect(saved.name).toBe("Results");
    expect(preview.slides[0].notes).toBe(slide.notes);
    expect(
      preview.slides[0].objects.find((o) => o.id === equation.id),
    ).toMatchObject({ style: source.theme.equation });
    expect(
      preview.slides[0].objects.find((o) => o.id === text.id),
    ).toMatchObject({
      fontFamily: "Nanum Gothic",
      inlineMathFontSetId: "mathjax-fira",
    });
    expect(
      preview.slides[0].objects.find((o) => o.id === text.id),
    ).not.toHaveProperty("fontFamilySource");
    const target = blank();
    const first = instantiateUserSlideLayout(
      target,
      target.slides[0].id,
      saved,
    );
    const second = instantiateUserSlideLayout(target, first.id, saved);
    const identifiers = target.slides.flatMap((s) => [
      s.id,
      ...s.objects.map((o) => o.id),
    ]);
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(first.objects.map((o) => o.transform)).toEqual(
      slide.objects.map((o) => o.transform),
    );
    const firstGroup = first.objects.filter((o) => o.groupId);
    expect(firstGroup[0].groupId).toBe(firstGroup[1].groupId);
    expect(firstGroup[0].groupId).not.toBe(frame.groupId);
    expect(firstGroup[0].groupId).not.toBe(
      second.objects.find((o) => o.groupId)?.groupId,
    );
    expect(firstGroup[1].metadata.mediaPlaceholderFor).toBe(firstGroup[0].id);
    expect(firstGroup[0].locked).toBe(true);
    expect(firstGroup[1].visible).toBe(false);
    expect(new Set(target.assets.map((a) => a.id)).size).toBe(
      target.assets.length,
    );
    expect(target.assets).toHaveLength(
      saved.snapshot.content.assets.length * 2,
    );
    validateDeck(target);
    slide.notes = "Changed source";
    source.assets.length = 0;
    expect(saved.snapshot.slide.notes).toBe("Remember the evidence");
    expect(saved.snapshot.content.assets.length).toBeGreaterThan(0);
  });

  it("keeps the target unchanged when page dimensions differ or a stored reference is invalid", () => {
    const saved = layout();
    const target = blank();
    target.slideSize.width = 1200;
    const before = structuredClone(target);
    expect(isUserSlideLayoutCompatible(saved, target)).toBe(false);
    expect(() =>
      instantiateUserSlideLayout(target, target.slides[0].id, saved),
    ).toThrow("different page size");
    expect(target).toEqual(before);
    const invalid = structuredClone(saved);
    invalid.snapshot.content.objects.push({
      ...shapeFromDrag("rect", { x: 0, y: 0 }, { x: 10, y: 10 }),
      type: "figure",
      assetId: "missing",
      alt: "Missing",
    } as never);
    expect(() => validateUserSlideLayout(invalid)).toThrow();
    expect(target).toEqual(before);
  });

  it("updates a named layout without changing its identity or earlier applied slides", async () => {
    const source = blank();
    const first = captureUserSlideLayout(source, source.slides[0], "Original");
    await expect(saveUserSlideLayout(first)).resolves.toBe("localStorage");
    const target = blank();
    const applied = instantiateUserSlideLayout(
      target,
      target.slides[0].id,
      first,
    );
    source.slides[0].notes = "Updated notes";
    const updated = captureUserSlideLayout(
      source,
      source.slides[0],
      "Renamed",
      first,
    );
    await saveUserSlideLayout(updated);
    expect((await listUserSlideLayouts()).entries).toEqual([
      expect.objectContaining({
        id: first.id,
        name: "Renamed",
        createdAt: first.createdAt,
      }),
    ]);
    expect(applied.notes).not.toBe("Updated notes");
    expect(updated.updatedAt > first.updatedAt).toBe(true);
  });

  it("preserves existing fallback entries on quota failure and rejects malformed IDs", async () => {
    const first = layout("Keep this one");
    await saveUserSlideLayout(first);
    const original = localStorage.getItem(
      USER_LAYOUT_STORAGE_PREFIX + first.id,
    );
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Full", "QuotaExceededError");
      });
    await expect(
      saveUserSlideLayout(layout("Failed addition")),
    ).rejects.toThrow("preserved");
    write.mockRestore();
    expect(localStorage.getItem(USER_LAYOUT_STORAGE_PREFIX + first.id)).toBe(
      original,
    );
    expect((await listUserSlideLayouts()).entries.map((e) => e.name)).toEqual([
      first.name,
    ]);
    await expect(deleteUserSlideLayout("../bad")).rejects.toThrow("ID");
  });

  it("does not evict old layouts at the entry or fallback byte limits", async () => {
    for (let index = 0; index < MAX_USER_LAYOUTS; index++)
      await saveUserSlideLayout(layout(`Layout ${index}`));
    await expect(saveUserSlideLayout(layout("Over capacity"))).rejects.toThrow(
      /limited/i,
    );
    expect((await listUserSlideLayouts()).entries).toHaveLength(
      MAX_USER_LAYOUTS,
    );
    const entries = (await listUserSlideLayouts()).entries;
    for (const entry of entries) await deleteUserSlideLayout(entry.id);
    const source = blank();
    const shape = shapeFromDrag("rect", { x: 0, y: 0 }, { x: 10, y: 10 });
    shape.metadata.payload = "가".repeat(1500000);
    source.slides[0].objects.push(shape);
    const large = captureUserSlideLayout(source, source.slides[0], "Large");
    await expect(saveUserSlideLayout(large)).rejects.toThrow("Limited storage");
    expect((await listUserSlideLayouts()).entries).toEqual([]);
    const indexed = indexedDatabase();
    vi.stubGlobal("indexedDB", indexed.factory);
    await expect(saveUserSlideLayout(large)).resolves.toBe("indexeddb");
    expect((await listUserSlideLayouts()).entries).toHaveLength(1);
  });

  it("isolates a damaged entry without replacing its stored source", async () => {
    const raw = '{"invalid":"preserve this source"}';
    localStorage.setItem(USER_LAYOUT_STORAGE_PREFIX + "damaged", raw);
    await saveUserSlideLayout(layout("Good entry"));
    expect(await listUserSlideLayouts()).toMatchObject({
      entries: [{ name: "Good entry" }],
      unavailableCount: 1,
    });
    expect(localStorage.getItem(USER_LAYOUT_STORAGE_PREFIX + "damaged")).toBe(
      raw,
    );
  });

  it("stores independent primary records and keeps fallback deletion authoritative when IDB writing fails", async () => {
    const first = layout("First");
    await saveUserSlideLayout(first);
    const indexed = indexedDatabase();
    vi.stubGlobal("indexedDB", indexed.factory);
    await expect(saveUserSlideLayout(first)).resolves.toBe("indexeddb");
    const second = layout("Second");
    await saveUserSlideLayout(second);
    expect(
      indexed.state.names.every((name) => name === USER_LAYOUT_DATABASE),
    ).toBe(true);
    expect(indexed.values.size).toBe(2);
    expect(indexed.state.compoundWrites).toBe(2);
    indexed.state.failWrites = true;
    await deleteUserSlideLayout(first.id);
    expect((await listUserSlideLayouts()).entries.map((e) => e.id)).toEqual([
      second.id,
    ]);
    vi.stubGlobal("indexedDB", undefined);
    expect((await listUserSlideLayouts()).entries).toEqual([]);
    vi.stubGlobal("indexedDB", indexed.factory);
    expect((await listUserSlideLayouts()).entries.map((e) => e.id)).toEqual([
      second.id,
    ]);
  });

  it("keeps usable IndexedDB independent from a denied localStorage backend", async () => {
    const indexed = indexedDatabase();
    vi.stubGlobal("indexedDB", indexed.factory);
    const storage = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    try {
      const saved = layout("Primary survives");
      await expect(saveUserSlideLayout(saved)).resolves.toBe("indexeddb");
      expect(await listUserSlideLayouts()).toMatchObject({
        entries: [{ name: saved.name }],
        unavailableCount: 1,
      });
    } finally {
      Object.defineProperty(window, "localStorage", storage);
    }
  });

  it("preserves concurrent saves from independent module contexts as separate primary records", async () => {
    const indexed = indexedDatabase();
    vi.stubGlobal("indexedDB", indexed.factory);
    const firstWindow = await import("../src/lib/user-layouts?layout-window-a");
    const secondWindow =
      await import("../src/lib/user-layouts?layout-window-b");
    const first = layout("Window A"),
      second = layout("Window B");
    await Promise.all([
      firstWindow.saveUserSlideLayout(first),
      secondWindow.saveUserSlideLayout(second),
    ]);
    expect(indexed.values.size).toBe(2);
    expect(indexed.state.compoundWrites).toBe(2);
    expect(
      (await firstWindow.listUserSlideLayouts()).entries
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["Window A", "Window B"]);
  });
});
