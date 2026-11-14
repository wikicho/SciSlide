// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktop } from "../src/lib/desktop";
import { createDemoDeck } from "../src/lib/model";
import { captureObjectClipboard } from "../src/lib/object-clipboard";
import { captureSlideClipboard } from "../src/lib/slide-clipboard";
import {
  MAX_CLIPBOARD_TEXT_CHARACTERS,
  SCISLIDE_CLIPBOARD_MIME,
  readClipboardEvent,
  readSystemClipboard,
  validateSystemClipboardPayload,
  writeClipboardEvent,
  writeSystemClipboard,
} from "../src/lib/system-clipboard";
import type { SystemClipboardPayload } from "../src/lib/system-clipboard";

vi.mock("../src/lib/desktop", () => ({ desktop: {} }));

function transfer(files: File[] = []) {
  const values = new Map<string, string>();
  return {
    values,
    data: {
      files,
      getData: (type: string) => values.get(type) ?? "",
      setData: (type: string, value: string) => {
        values.set(type, value);
      },
    } as unknown as DataTransfer,
  };
}

function sample(): SystemClipboardPayload {
  const deck = createDemoDeck();
  const slide = deck.slides[0];
  return {
    kind: "objects",
    value: captureObjectClipboard(
      deck,
      slide,
      slide.objects.map((object) => object.id),
    )!,
  };
}

function browserClipboard(value: Partial<Clipboard>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function item(contents: Record<string, string>): ClipboardItem {
  return {
    types: Object.keys(contents),
    getType: async (type: string) =>
      ({ text: async () => contents[type] }) as Blob,
  } as ClipboardItem;
}

afterEach(() => {
  delete desktop!.readClipboard;
  delete desktop!.writeClipboard;
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("system clipboard codec", () => {
  it("round trips complete editable object snapshots and provides readable text and LaTeX", () => {
    const payload = sample();
    const copied = transfer();
    writeClipboardEvent(copied.data, payload);
    const first = readClipboardEvent(copied.data);
    expect(first.kind).toBe("internal");
    if (first.kind !== "internal" || first.payload.kind !== "objects")
      throw new Error("Expected objects");
    expect(first.payload.value.objects).toEqual(payload.value.objects);
    expect(first.payload.value.assets).toHaveLength(
      payload.value.assets.length,
    );
    expect(copied.values.get("text/plain")).toContain("early Universe");
    expect(copied.values.get("text/plain")).toContain("\\");
    copied.values.delete(SCISLIDE_CLIPBOARD_MIME);
    expect(readClipboardEvent(copied.data)).toEqual(first);
  });

  it("preserves slide notes and appearance through HTML-only clipboard transfer", () => {
    const deck = createDemoDeck();
    deck.slides[0].notes = "발표 메모";
    const payload: SystemClipboardPayload = {
      kind: "slide",
      value: captureSlideClipboard(deck, deck.slides[0]),
    };
    const copied = transfer();
    writeClipboardEvent(copied.data, payload);
    copied.values.delete(SCISLIDE_CLIPBOARD_MIME);
    const result = readClipboardEvent(copied.data);
    expect(result).toMatchObject({
      kind: "internal",
      payload: { kind: "slide", value: { slide: { notes: "발표 메모" } } },
    });
    expect(copied.values.get("text/plain")).toContain(deck.slides[0].title);
  });

  it("treats the current external text or image as the clipboard after copying internal objects", () => {
    const copied = transfer();
    writeClipboardEvent(copied.data, sample());
    const external = transfer();
    external.values.set("text/plain", "Current external B");
    external.values.set(
      "text/html",
      '<p><img src="https://untrusted.test/tracker">Current external B</p>',
    );
    expect(readClipboardEvent(external.data)).toEqual({
      kind: "text",
      text: "Current external B",
    });
    const png = new File([new Uint8Array([137, 80, 78, 71])], "screen.png", {
      type: "image/png",
    });
    const image = transfer([png]);
    image.values.set("text/plain", "image description");
    expect(readClipboardEvent(image.data)).toEqual({
      kind: "files",
      files: [png],
    });
    expect(readClipboardEvent(transfer().data)).toEqual({ kind: "empty" });
  });

  it("rejects malformed, unsupported, oversized, or missing-asset clipboard contents", () => {
    const copied = transfer();
    copied.values.set(SCISLIDE_CLIPBOARD_MIME, "{broken");
    expect(() => readClipboardEvent(copied.data)).toThrow();
    copied.values.set(
      SCISLIDE_CLIPBOARD_MIME,
      JSON.stringify({
        format: "scislide-clipboard",
        version: 2,
        payload: sample(),
      }),
    );
    expect(() => readClipboardEvent(copied.data)).toThrow("version");
    copied.values.clear();
    copied.values.set(
      "text/html",
      '<span data-scislide-clipboard="1" data-scislide-payload="invalid&">hello</span>',
    );
    expect(() => readClipboardEvent(copied.data)).toThrow("payload");
    copied.values.clear();
    copied.values.set(
      "text/plain",
      "x".repeat(MAX_CLIPBOARD_TEXT_CHARACTERS + 1),
    );
    expect(() => readClipboardEvent(copied.data)).toThrow("100,000");
    const payload = sample();
    if (payload.kind !== "objects") throw new Error("Expected objects");
    payload.value.assets = [];
    expect(() => validateSystemClipboardPayload(payload)).toThrow();
    expect(() =>
      validateSystemClipboardPayload({ kind: "unexpected", value: {} }),
    ).toThrow("Unsupported");
  });

  it("sanitizes embedded SVG and rejects invalid object geometry before any paste", () => {
    const payload = sample();
    if (payload.kind !== "objects") throw new Error("Expected objects");
    payload.value.assets[0].dataUrl =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script><path d="M0 0L1 1"/></svg>',
      );
    const checked = validateSystemClipboardPayload(payload);
    if (checked.kind !== "objects") throw new Error("Expected objects");
    expect(atob(checked.value.assets[0].dataUrl.split(",")[1])).not.toContain(
      "script",
    );
    payload.value.objects[0].transform.width = -1;
    expect(() => validateSystemClipboardPayload(payload)).toThrow("width");
  });

  it("propagates clipboard-event write failures so a cut can retain its source", () => {
    const copied = transfer();
    copied.data.setData = () => {
      throw new Error("Clipboard is read-only");
    };
    expect(() => writeClipboardEvent(copied.data, sample())).toThrow(
      "read-only",
    );
    copied.data.setData = () => undefined;
    expect(() => writeClipboardEvent(copied.data, sample())).toThrow(
      "retain editable",
    );
  });
});

describe("toolbar and menu clipboard access", () => {
  it("writes HTML plus plain text and reads the editable HTML snapshot with navigator.clipboard", async () => {
    let written: Record<string, Blob>;
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(value: Record<string, Blob>) {
          written = value;
        }
      },
    );
    const write = vi.fn(async () => {});
    browserClipboard({ write });
    await writeSystemClipboard(sample());
    expect(write).toHaveBeenCalledOnce();
    const html = await blobText(written!["text/html"]);
    const plain = await blobText(written!["text/plain"]);
    expect(plain).toContain("early Universe");
    browserClipboard({
      read: async () => [item({ "text/html": html, "text/plain": plain })],
    });
    expect(await readSystemClipboard()).toMatchObject({
      kind: "internal",
      payload: { kind: "objects" },
    });
  });

  it("reads external text, PNG, and text-only browser fallback without an internal cache", async () => {
    browserClipboard({ readText: async () => "External text" });
    expect(await readSystemClipboard()).toEqual({
      kind: "text",
      text: "External text",
    });
    browserClipboard({
      read: async () => [
        {
          types: ["image/png"],
          getType: async () => new Blob(["png"], { type: "image/png" }),
        } as unknown as ClipboardItem,
      ],
    });
    const result = await readSystemClipboard();
    expect(result.kind).toBe("files");
    if (result.kind !== "files") throw new Error("Expected files");
    expect(result.files[0]).toMatchObject({
      name: "clipboard.png",
      type: "image/png",
      size: 3,
    });
  });

  it("uses the fixed desktop bridge for rich copy and PNG paste without browser permissions", async () => {
    let native = { text: "", html: "" };
    desktop!.writeClipboard = async (value) => {
      native = value;
    };
    desktop!.readClipboard = async () => native;
    await writeSystemClipboard(sample());
    expect(await readSystemClipboard()).toMatchObject({
      kind: "internal",
      payload: { kind: "objects" },
    });
    desktop!.readClipboard = async () => ({
      text: "",
      html: "",
      png: new Uint8Array([137, 80, 78, 71]),
    });
    const result = await readSystemClipboard();
    expect(result.kind).toBe("files");
    if (result.kind !== "files") throw new Error("Expected PNG");
    expect(result.files[0].size).toBe(4);
  });

  it("surfaces permission and native failures instead of falling back to stale data or deleting cuts", async () => {
    const fallback = vi.fn(async () => "old text");
    browserClipboard({
      read: async () => {
        throw new Error("Permission denied");
      },
      readText: fallback,
    });
    await expect(readSystemClipboard()).rejects.toThrow("Permission denied");
    expect(fallback).not.toHaveBeenCalled();
    desktop!.writeClipboard = async () => {
      throw new Error("Native write failed");
    };
    await expect(writeSystemClipboard(sample())).rejects.toThrow(
      "Native write failed",
    );
    desktop!.readClipboard = async () => {
      throw new Error("Native read failed");
    };
    await expect(readSystemClipboard()).rejects.toThrow("Native read failed");
  });
});
