import { desktop } from "./desktop";
import type { ObjectClipboard } from "./object-clipboard";
import type { SlideClipboard } from "./slide-clipboard";
import { newId } from "./model";
import type { Asset } from "./model";
import { validateWorkspaceRecovery } from "./workspace-recovery";

export const SCISLIDE_CLIPBOARD_MIME = "application/x-scislide-clipboard+json";
export const MAX_CLIPBOARD_BYTES = 64 * 1024 * 1024;
export const MAX_CLIPBOARD_TEXT_CHARACTERS = 100_000;
const MARKER = "data-scislide-clipboard";

export type SystemClipboardPayload =
  | { kind: "objects"; value: ObjectClipboard }
  | { kind: "slide"; value: SlideClipboard };

export type ClipboardReadResult =
  | { kind: "internal"; payload: SystemClipboardPayload }
  | { kind: "text"; text: string }
  | { kind: "files"; files: File[] }
  | { kind: "empty" };

function checkSize(source: string, limit = MAX_CLIPBOARD_BYTES): void {
  if (source.length > limit || new TextEncoder().encode(source).length > limit)
    throw new Error("Clipboard data exceeds the supported size limit.");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("SciSlide clipboard data is invalid.");
  return value as Record<string, unknown>;
}

/** System clipboard contents receive the same model/media checks as recovery. */
export function validateSystemClipboardPayload(
  value: unknown,
): SystemClipboardPayload {
  const payload = record(value);
  checkSize(JSON.stringify(payload));
  if (payload.kind !== "objects" && payload.kind !== "slide")
    throw new Error("Unsupported SciSlide clipboard content.");
  const copied = record(payload.value);
  const content = payload.kind === "slide" ? record(copied.content) : copied;
  const settings =
    payload.kind === "slide"
      ? record(copied.slide)
      : {
          id: newId(),
          title: "Clipboard",
          background: "#ffffff",
          notes: "",
        };
  const deck = validateWorkspaceRecovery({
    deck: {
      formatVersion: "0.5.0",
      id: content.sourceDeckId,
      title: "Clipboard",
      slideSize: { width: 1600, height: 900, unit: "px96" },
      theme: {
        fontFamily: "Inter",
        equation: {
          fontSetId: "mathjax-modern",
          fontSize: 40,
          color: "#000000",
        },
      },
      slides: [{ ...settings, objects: content.objects }],
      assets: content.assets,
    },
    equationDrafts: [],
    savedAt: "1970-01-01T00:00:00.000Z",
  }).deck;
  const originals = content.assets as Asset[];
  const svgSource = (dataUrl: string) => {
    const comma = dataUrl.indexOf(",");
    const body = dataUrl.slice(comma + 1);
    return dataUrl.slice(0, comma).split(";").includes("base64")
      ? new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(body), (character) => character.charCodeAt(0)),
        )
      : decodeURIComponent(body);
  };
  const snapshot: ObjectClipboard = {
    sourceDeckId: deck.id,
    objects: deck.slides[0].objects,
    assets: deck.assets.map((asset) => {
      const original = originals.find(
        (candidate) => candidate.id === asset.id,
      )!;
      // Preserve an already-safe SVG's original data URL so the ordinary asset
      // deduplicator can share it with the copied source in this document.
      return asset.mime === "image/svg+xml" &&
        svgSource(original.dataUrl) === svgSource(asset.dataUrl)
        ? { ...asset, dataUrl: original.dataUrl }
        : asset;
    }),
  };
  if (payload.kind === "objects") return { kind: "objects", value: snapshot };
  const { objects: _objects, ...slide } = deck.slides[0];
  return { kind: "slide", value: { slide, content: snapshot } };
}

function encode(payload: SystemClipboardPayload): {
  json: string;
  html: string;
  text: string;
} {
  const checked = validateSystemClipboardPayload(payload);
  const content =
    checked.kind === "objects" ? checked.value : checked.value.content;
  const text = [
    ...(checked.kind === "slide" ? [checked.value.slide.title] : []),
    ...content.objects.map((object) => {
      if (object.type === "text") return object.text;
      if (object.type === "equation") return object.latex;
      if (object.type === "figure" || object.type === "video")
        return object.alt || object.name;
      return object.name;
    }),
  ]
    .filter(Boolean)
    .join("\n");
  const json = JSON.stringify({
    format: "scislide-clipboard",
    version: 1,
    payload: checked,
  });
  checkSize(json);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  const escaped = text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
  return {
    json,
    html: `<span ${MARKER}="1" data-scislide-payload="${btoa(binary)}">${escaped}</span>`,
    text,
  };
}

function decode(source: string): SystemClipboardPayload {
  checkSize(source);
  const envelope = record(JSON.parse(source));
  if (envelope.format !== "scislide-clipboard" || envelope.version !== 1)
    throw new Error("Unsupported SciSlide clipboard version.");
  return validateSystemClipboardPayload(envelope.payload);
}

function decodeHtml(source: string): SystemClipboardPayload | null {
  // Do not parse arbitrary external HTML into a DOM or follow its resources.
  if (!source.includes(MARKER)) return null;
  checkSize(source, Math.ceil((MAX_CLIPBOARD_BYTES * 4) / 3) + 1_000_000);
  const tags = source.match(
    /<span\b[^>]*\bdata-scislide-clipboard\s*=\s*["']1["'][^>]*>/gi,
  );
  if (tags?.length !== 1)
    throw new Error("SciSlide clipboard HTML is invalid.");
  const encoded =
    /\bdata-scislide-payload\s*=\s*(["'])([A-Za-z0-9+/]*={0,2})\1/i.exec(
      tags[0],
    )?.[2];
  if (
    !encoded ||
    encoded.length % 4 ||
    encoded.length > Math.ceil(MAX_CLIPBOARD_BYTES / 3) * 4
  )
    throw new Error("SciSlide clipboard HTML payload is invalid.");
  const binary = atob(encoded);
  if (btoa(binary) !== encoded)
    throw new Error("SciSlide clipboard HTML encoding is invalid.");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return decode(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function externalContent(text: string, files: File[]): ClipboardReadResult {
  if (files.length) {
    if (
      files.length > 50 ||
      files.some((file) => file.size > MAX_CLIPBOARD_BYTES) ||
      files.reduce((sum, file) => sum + file.size, 0) > MAX_CLIPBOARD_BYTES
    )
      throw new Error("Clipboard files exceed the supported size limit.");
    return { kind: "files", files };
  }
  if (text) {
    if (text.length > MAX_CLIPBOARD_TEXT_CHARACTERS)
      throw new Error("Clipboard text exceeds 100,000 characters.");
    return { kind: "text", text };
  }
  return { kind: "empty" };
}

/** Call preventDefault only after this succeeds; failed cuts must retain their source. */
export function writeClipboardEvent(
  data: DataTransfer,
  payload: SystemClipboardPayload,
): void {
  const encoded = encode(payload);
  data.setData("text/plain", encoded.text);
  data.setData("text/html", encoded.html);
  data.setData(SCISLIDE_CLIPBOARD_MIME, encoded.json);
  if (
    data.getData(SCISLIDE_CLIPBOARD_MIME) !== encoded.json &&
    data.getData("text/html") !== encoded.html
  )
    throw new Error(
      "The clipboard could not retain editable SciSlide content.",
    );
}

export function readClipboardEvent(data: DataTransfer): ClipboardReadResult {
  const custom = data.getData(SCISLIDE_CLIPBOARD_MIME);
  if (custom) return { kind: "internal", payload: decode(custom) };
  const payload = decodeHtml(data.getData("text/html"));
  if (payload) return { kind: "internal", payload };
  return externalContent(
    data.getData("text/plain"),
    Array.from(data.files ?? []),
  );
}

export async function writeSystemClipboard(
  payload: SystemClipboardPayload,
): Promise<void> {
  const encoded = encode(payload);
  if (desktop?.writeClipboard) {
    await desktop.writeClipboard({ text: encoded.text, html: encoded.html });
    return;
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error(
      "System clipboard writing is unavailable. Use the keyboard Copy or Cut command.",
    );
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([encoded.html], { type: "text/html" }),
      "text/plain": new Blob([encoded.text], { type: "text/plain" }),
    }),
  ]);
}

async function readTextItem(
  item: ClipboardItem,
  type: string,
  limit: number,
): Promise<string> {
  const blob = await item.getType(type);
  if (blob.size > limit)
    throw new Error("Clipboard data exceeds the supported size limit.");
  return blob.text();
}

export async function readSystemClipboard(): Promise<ClipboardReadResult> {
  if (desktop?.readClipboard) {
    const content = await desktop.readClipboard();
    const payload = decodeHtml(content.html);
    if (payload) return { kind: "internal", payload };
    const files = content.png?.length
      ? [
          new File([new Uint8Array(content.png)], "clipboard.png", {
            type: "image/png",
          }),
        ]
      : [];
    return externalContent(content.text, files);
  }
  if (!navigator.clipboard)
    throw new Error(
      "System clipboard reading is unavailable. Use the keyboard Paste command.",
    );
  if (!navigator.clipboard.read) {
    if (!navigator.clipboard.readText)
      throw new Error(
        "System clipboard reading is unavailable. Use the keyboard Paste command.",
      );
    return externalContent(await navigator.clipboard.readText(), []);
  }
  const items = await navigator.clipboard.read();
  let text = "";
  const files: File[] = [];
  for (const item of items) {
    if (item.types.includes(SCISLIDE_CLIPBOARD_MIME))
      return {
        kind: "internal",
        payload: decode(
          await readTextItem(
            item,
            SCISLIDE_CLIPBOARD_MIME,
            MAX_CLIPBOARD_BYTES,
          ),
        ),
      };
    if (item.types.includes("text/html")) {
      const payload = decodeHtml(
        await readTextItem(
          item,
          "text/html",
          Math.ceil((MAX_CLIPBOARD_BYTES * 4) / 3) + 1_000_000,
        ),
      );
      if (payload) return { kind: "internal", payload };
    }
    for (const type of item.types) {
      if (type.startsWith("image/")) {
        const blob = await item.getType(type);
        if (blob.size > MAX_CLIPBOARD_BYTES || files.length >= 50)
          throw new Error("Clipboard files exceed the supported size limit.");
        const extension = type === "image/svg+xml" ? "svg" : type.split("/")[1];
        files.push(new File([blob], `clipboard.${extension}`, { type }));
      }
    }
    if (!text && item.types.includes("text/plain"))
      text = await readTextItem(
        item,
        "text/plain",
        MAX_CLIPBOARD_TEXT_CHARACTERS * 4,
      );
  }
  return externalContent(text, files);
}
