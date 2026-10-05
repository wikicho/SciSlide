import { cloneObjectsWithGroups, expandSelection } from "./drawing";
import type { Point } from "./drawing";
import { newId } from "./model";
import type { Asset, Deck, Slide, SlideObject } from "./model";

/** An in-memory snapshot survives source deletion and switching presentations. */
export interface ObjectClipboard {
  sourceDeckId: string;
  objects: SlideObject[];
  assets: Asset[];
}

/** Reading locked objects is allowed; callers filter a cut with editableSelection. */
export function captureObjectClipboard(
  deck: Deck,
  slide: Pick<Slide, "objects">,
  ids: readonly string[],
): ObjectClipboard | null {
  const selected = new Set(expandSelection(slide.objects, ids));
  const objects = structuredClone(
    slide.objects.filter((object) => selected.has(object.id)),
  );
  if (!objects.length) return null;
  const used = new Set<string>();
  for (const object of objects) {
    if (object.type === "figure" || object.type === "video")
      used.add(object.assetId);
    if (object.type === "equation") {
      object.style = {
        fontSetId: object.style.fontSetId ?? deck.theme.equation.fontSetId,
        fontSize: object.style.fontSize ?? deck.theme.equation.fontSize,
        color: object.style.color ?? deck.theme.equation.color,
      };
    }
  }
  const assets = [...used].map((id) => {
    const asset = deck.assets.find((candidate) => candidate.id === id);
    if (!asset)
      throw new Error("A copied object is missing its embedded asset.");
    // Media strings are immutable; only registry records need independent copies.
    return { ...asset };
  });
  return { sourceDeckId: deck.id, objects, assets };
}

/** Paste independent editable objects while sharing identical immutable media. */
export function pasteObjectClipboard(
  deck: Deck,
  targetSlideId: string,
  clipboard: ObjectClipboard,
  offset: Point = { x: 32, y: 32 },
): string[] {
  const slide = deck.slides.find((candidate) => candidate.id === targetSlideId);
  if (!slide) throw new Error("The slide for pasting objects is unavailable.");
  if (!clipboard.objects.length) return [];
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
    throw new Error("The paste offset must contain finite coordinates.");
  const used = new Set(
    clipboard.objects.flatMap((object) =>
      object.type === "figure" || object.type === "video"
        ? [object.assetId]
        : [],
    ),
  );
  const originals = [...used].map((id) => {
    const asset = clipboard.assets.find((candidate) => candidate.id === id);
    if (!asset) throw new Error("The copied media is no longer available.");
    return asset;
  });
  const assets: Asset[] = [];
  const assetIds = new Map<string, string>();
  for (const asset of originals) {
    const identical = (candidate: Asset) =>
      candidate.mime === asset.mime &&
      candidate.width === asset.width &&
      candidate.height === asset.height &&
      candidate.dataUrl === asset.dataUrl;
    const existing = deck.assets.find(identical) ?? assets.find(identical);
    const targetAsset = existing ?? { ...asset, id: newId() };
    if (!existing) assets.push(targetAsset);
    assetIds.set(asset.id, targetAsset.id);
  }
  const objects = cloneObjectsWithGroups(clipboard.objects, offset);
  for (const object of objects)
    if (object.type === "figure" || object.type === "video")
      object.assetId = assetIds.get(object.assetId)!;
  deck.assets.push(...assets);
  slide.objects.push(...objects);
  return objects.map((object) => object.id);
}
