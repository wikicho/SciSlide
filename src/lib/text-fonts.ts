/** Families available without an additional user-supplied font asset. */
export const KOREAN_FONT_FAMILY = "Nanum Gothic";
export const TEXT_FONT_WEIGHTS = [400, 500, 600, 700] as const;
export type TextFontWeight = (typeof TEXT_FONT_WEIGHTS)[number];

export const PDF_GENERIC_FONT_FAMILIES = [
  "serif",
  "sans-serif",
  "monospace",
  "Arial",
  "Times",
  "Times New Roman",
  "Courier",
  "Courier New",
  "Helvetica",
  "helvetica",
  "times",
  "courier",
] as const;

export function firstFontFamily(family: string): string {
  return family
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

/** Includes modern/archaic Hangul syllables and the four Jamo blocks. */
export function containsKorean(text: string): boolean {
  return /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]/u.test(
    text,
  );
}

/** Preserve source text while rendering canonically equivalent Hangul alike. */
export function normalizeRenderedText(text: string): string {
  return text.normalize("NFC");
}

export function isKoreanFontFamily(family: string): boolean {
  return (
    firstFontFamily(family).toLowerCase() === KOREAN_FONT_FAMILY.toLowerCase()
  );
}

/** Resolve each mixed text run as a whole, without replacing arbitrary fonts. */
export function exportTextFontFamily(
  text: string,
  requestedFamily: string,
): string {
  const family = firstFontFamily(requestedFamily);
  if (isKoreanFontFamily(family)) return KOREAN_FONT_FAMILY;
  if (
    containsKorean(text) &&
    (family.toLowerCase() === "inter" ||
      PDF_GENERIC_FONT_FAMILIES.some(
        (candidate) => candidate.toLowerCase() === family.toLowerCase(),
      ))
  ) {
    return KOREAN_FONT_FAMILY;
  }
  return requestedFamily;
}

/** Nanum Gothic is bundled as two static masters, shared by display and export. */
export function nearestKoreanWeight(weight: number): number {
  if (weight === 500) return 400;
  if (weight === 600) return 700;
  return weight;
}

export function exportTextFontWeight(
  text: string,
  family: string,
  weight: number,
): number {
  return isKoreanFontFamily(exportTextFontFamily(text, family))
    ? nearestKoreanWeight(weight)
    : weight;
}
