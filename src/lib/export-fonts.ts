import { TEXT_FONT_WEIGHTS, type TextFontWeight } from "./text-fonts";

export type InterFontFiles = Record<TextFontWeight, string>;
export type KoreanFontFiles = Record<400 | 700, string>;
export type ExportFontFiles = {
  inter: InterFontFiles;
  korean?: KoreanFontFiles;
};

let interFonts: Promise<InterFontFiles> | undefined;
let koreanFonts: Promise<KoreanFontFiles> | undefined;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

async function loadFont(
  family: string,
  filename: string,
  weight: number,
): Promise<string> {
  const response = await fetch(new URL(`fonts/${filename}`, document.baseURI));
  if (!response.ok)
    throw new Error(
      `The bundled ${family} ${weight} font could not be loaded. Reload the app and try again.`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 12 || bytes[0] !== 0 || bytes[1] !== 1)
    throw new Error(
      `The bundled ${family} ${weight} font is not a valid TrueType font.`,
    );
  // Loading each face explicitly keeps wrapping and svg2pdf's browser text
  // measurement independent of whether that weight was used in the editor.
  const face = new FontFace(family, bytes, {
    weight: String(weight),
    style: "normal",
  });
  await face.load();
  document.fonts.add(face);
  return base64(bytes);
}

export async function loadInterFonts(): Promise<InterFontFiles> {
  interFonts ??= (async () => {
    const entries = await Promise.all(
      TEXT_FONT_WEIGHTS.map(
        async (weight) =>
          [
            weight,
            await loadFont("Inter", `inter-${weight}.ttf`, weight),
          ] as const,
      ),
    );
    return Object.fromEntries(entries) as InterFontFiles;
  })();
  try {
    return await interFonts;
  } catch (error) {
    interFonts = undefined;
    throw error;
  }
}

/** Keep the larger Hangul font assets out of Latin-only export work. */
export async function loadKoreanFonts(): Promise<KoreanFontFiles> {
  koreanFonts ??= (async () => {
    const entries = await Promise.all(
      ([400, 700] as const).map(
        async (weight) =>
          [
            weight,
            await loadFont(
              "Nanum Gothic",
              `nanum-gothic-${weight}.ttf`,
              weight,
            ),
          ] as const,
      ),
    );
    return Object.fromEntries(entries) as KoreanFontFiles;
  })();
  try {
    return await koreanFonts;
  } catch (error) {
    koreanFonts = undefined;
    throw error;
  }
}

export function fontDefinitions(fonts: ExportFontFiles): string {
  const inter = TEXT_FONT_WEIGHTS.map(
    (weight) =>
      `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${fonts.inter[weight]}) format('truetype')}`,
  );
  const korean = fonts.korean
    ? ([400, 700] as const).map(
        (weight) =>
          `@font-face{font-family:'Nanum Gothic';font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${fonts.korean![weight]}) format('truetype')}`,
      )
    : [];
  return [...inter, ...korean].join("\n");
}
