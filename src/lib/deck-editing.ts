import type { Deck } from "./model";

/** Compare document content without serializing large immutable media strings.
 * Key order and omitted undefined options do not change a JSON document. */
export function sameDocument(current: Deck, saved: Deck): boolean {
  const pending: Array<[unknown, unknown]> = [[current, saved]];
  const compared = new WeakMap<object, WeakSet<object>>();
  while (pending.length) {
    const [first, second] = pending.pop()!;
    if (first === second) continue;
    if (
      !first ||
      !second ||
      typeof first !== "object" ||
      typeof second !== "object"
    )
      return false;
    const arrays = Array.isArray(first);
    if (arrays !== Array.isArray(second)) return false;
    if (!arrays) {
      for (const value of [first, second]) {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== null && prototype !== Object.prototype) return false;
      }
    }
    let matches = compared.get(first);
    if (matches?.has(second)) continue;
    if (!matches) compared.set(first, (matches = new WeakSet()));
    matches.add(second);
    if (arrays) {
      const a = first as unknown[],
        b = second as unknown[];
      if (a.length !== b.length) return false;
      for (let index = a.length - 1; index >= 0; index--)
        pending.push([a[index], b[index]]);
    } else {
      const a = first as Record<string, unknown>,
        b = second as Record<string, unknown>;
      const keys = Object.keys(a).filter((key) => a[key] !== undefined);
      if (
        keys.length !==
        Object.keys(b).filter((key) => b[key] !== undefined).length
      )
        return false;
      for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false;
        pending.push([a[key], b[key]]);
      }
    }
  }
  return true;
}

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
