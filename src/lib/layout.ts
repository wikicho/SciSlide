import { exportTextFontFamily, exportTextFontWeight } from "./text-fonts";

let measurementContext: CanvasRenderingContext2D | null = null;

/** Shared by the editing scene and exports so text has the same line breaks. */
export function wrapText(
  text: string,
  width: number,
  fontSize: number,
  fontFamily: string,
  fontWeight: number,
): string[] {
  measurementContext ??= document.createElement("canvas").getContext("2d");
  const context = measurementContext;
  if (!context)
    throw new Error("This browser cannot measure text for the slide.");
  const renderedText = text.normalize("NFC");
  const family = exportTextFontFamily(renderedText, fontFamily);
  const weight = exportTextFontWeight(renderedText, fontFamily, fontWeight);
  context.font = `${weight} ${fontSize}px "${family}"`;
  const availableWidth = Math.max(1, width);
  const lines: string[] = [];

  for (const paragraph of renderedText.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= availableWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      // Long unbroken labels also wrap; code points keep surrogate pairs intact.
      for (const character of word) {
        if (
          line &&
          context.measureText(line + character).width > availableWidth
        ) {
          lines.push(line);
          line = character;
        } else {
          line += character;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}
