import type { SvgFontData } from "@mathjax/src/js/output/svg/FontData.js";

/**
 * Install per-character fallback after both bundled fonts have loaded their ranges.
 * Missing glyphs use STIX paths and STIX metrics together. Native glyphs and
 * primary font parameters remain intact, and shared font tables are not modified.
 * Clear the returned set immediately before each serialized equation conversion.
 */
export function installVectorGlyphFallback(
  primary: SvgFontData,
  fallback: SvgFontData,
): Set<number> {
  const used = new Set<number>();
  const getNativeChar = primary.getChar.bind(primary);
  primary.getChar = (variant, codepoint) => {
    const native = getNativeChar(variant, codepoint);
    if (native || !fallback.getVariant(variant)) return native;
    const replacement = fallback.getChar(variant, codepoint);
    const options = replacement?.[3];
    // Accept an actual vector outline with finite metrics, never system text or
    // an alias whose referenced characters belong to a different font table.
    if (
      !replacement ||
      typeof options?.p !== "string" ||
      options.unknown ||
      !replacement.slice(0, 3).every(Number.isFinite)
    )
      return native;
    used.add(codepoint);
    return [replacement[0], replacement[1], replacement[2], { ...options }];
  };
  return used;
}
