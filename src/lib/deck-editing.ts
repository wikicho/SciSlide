import type { Deck } from "./model";

/**
 * Copy editable state and asset records for history without deep-copying large
 * immutable embedded media strings. Asset data URLs are replaced, never edited.
 */
export function cloneDeck(deck: Deck): Deck {
  const { assets, ...document } = deck;
  return {
    ...structuredClone(document),
    assets: assets.map((asset) => ({ ...asset })),
  };
}

/**
 * Remove unreferenced media after deleting objects or slides. References on
 * hidden objects still count; duplicate objects can share the same asset.
 * Only this deck's registry is changed, leaving independent history intact.
 */
export function pruneUnusedAssets(deck: Deck): void {
  const used = new Set(
    deck.slides.flatMap((slide) =>
      slide.objects.flatMap((object) =>
        object.type === "figure" || object.type === "video"
          ? [object.assetId]
          : [],
      ),
    ),
  );
  deck.assets = deck.assets.filter((asset) => used.has(asset.id));
}
