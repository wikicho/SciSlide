import { attr, child, children } from "./pptx-package";

export type Warn = (message: string) => void;
const defaultColors: Record<string, string> = {
  dk1: "#000000",
  lt1: "#ffffff",
  dk2: "#44546a",
  lt2: "#e7e6e6",
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
  hlink: "#0563c1",
  folHlink: "#954f72",
};
const defaultMap: Record<string, string> = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
};
const presetColors: Record<string, string> = {
  dkBlue: "#00008b",
  dkGreen: "#006400",
  dkRed: "#8b0000",
  dkGray: "#a9a9a9",
  ltBlue: "#add8e6",
  ltGreen: "#90ee90",
  ltGray: "#d3d3d3",
  medBlue: "#0000cd",
};

function hex(value: string | undefined) {
  return value && /^[\da-f]{6}$/i.test(value)
    ? `#${value.toLowerCase()}`
    : undefined;
}

export function numeric(value: string | undefined) {
  return value !== undefined &&
    /^[-+]?\d+$/.test(value) &&
    Number.isSafeInteger(Number(value))
    ? Number(value)
    : undefined;
}

export function emu(value: string | undefined) {
  const number = numeric(value);
  return number === undefined ? undefined : number / 9525;
}

export function flag(value: string | undefined) {
  return value === "1" || value === "true";
}

function percent(value: string | undefined) {
  if (value && /^[-+]?\d+(?:\.\d+)?%$/.test(value)) {
    const amount = Number(value.slice(0, -1)) / 100;
    return Number.isFinite(amount) ? amount : undefined;
  }
  const amount = numeric(value);
  return amount === undefined ? undefined : amount / 100_000;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function fromHsl(hue: number, saturation: number, lightness: number) {
  const h = (((hue % 360) + 360) % 360) / 30;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map((offset) => {
    const channel = (offset + h) % 12;
    return (
      255 *
      (lightness -
        amplitude * Math.max(-1, Math.min(channel - 3, 9 - channel, 1)))
    );
  });
}

function toHsl([red, green, blue]: number[]) {
  const [r, g, b] = [red, green, blue].map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  if (!chroma) return [0, 0, lightness];
  const hue =
    max === r
      ? (g - b) / chroma
      : max === g
        ? (b - r) / chroma + 2
        : (r - g) / chroma + 4;
  return [60 * hue, chroma / (1 - Math.abs(2 * lightness - 1)), lightness];
}

function baseColor(
  node: Element,
  scheme?: (value: string) => string | undefined,
) {
  const value = attr(node, "val");
  switch (node.localName) {
    case "srgbClr":
      return hex(value);
    case "sysClr":
      return hex(attr(node, "lastClr"));
    case "schemeClr":
      return value ? scheme?.(value) : undefined;
    case "prstClr":
      if (!value) return undefined;
      if (Object.hasOwn(presetColors, value)) return presetColors[value];
      return /^[a-z]{1,24}$/i.test(value) &&
        globalThis.CSS?.supports("color", value)
        ? value
        : undefined;
    case "scrgbClr": {
      const channels = ["r", "g", "b"].map((name) => percent(attr(node, name)));
      if (channels.some((channel) => channel === undefined)) return undefined;
      return channels.map((channel) => {
        const linear = clamp(channel!);
        const srgb =
          linear <= 0.0031308
            ? 12.92 * linear
            : 1.055 * linear ** (1 / 2.4) - 0.055;
        return 255 * srgb;
      });
    }
    case "hslClr": {
      const hue = numeric(attr(node, "hue"));
      const saturation = percent(attr(node, "sat"));
      const lightness = percent(attr(node, "lum"));
      if (
        hue === undefined ||
        saturation === undefined ||
        lightness === undefined
      )
        return undefined;
      return fromHsl(hue / 60_000, clamp(saturation), clamp(lightness));
    }
  }
}

function resolveColor(
  node: Element | undefined,
  warn: Warn,
  scheme?: (value: string) => string | undefined,
) {
  if (!node) return undefined;
  const base = baseColor(node, scheme);
  if (!base) {
    warn("A color could not be converted.");
    return undefined;
  }
  const rgba =
    typeof base === "string"
      ? /^rgba\((\d+),(\d+),(\d+),([\d.e+-]+)\)$/.exec(base)
      : null;
  let opacity = rgba ? Number(rgba[4]) : 1;
  let rgb =
    typeof base !== "string"
      ? base
      : rgba
        ? rgba.slice(1, 4).map(Number)
        : /^#[\da-f]{6}$/i.test(base)
          ? [1, 3, 5].map((index) => parseInt(base.slice(index, index + 2), 16))
          : undefined;
  for (const effect of children(node)) {
    const type = effect.localName;
    const value = attr(effect, "val");
    const amount = percent(value);
    if (amount !== undefined && type === "alpha") opacity = clamp(amount);
    else if (amount !== undefined && type === "alphaMod")
      opacity = clamp(opacity * amount);
    else if (amount !== undefined && type === "alphaOff")
      opacity = clamp(opacity + amount);
    else if (
      rgb &&
      amount !== undefined &&
      (type === "tint" || type === "shade")
    ) {
      const factor = clamp(amount);
      rgb = rgb.map((channel) =>
        type === "tint" ? 255 - (255 - channel) * factor : channel * factor,
      );
    } else if (
      rgb &&
      amount !== undefined &&
      /^(lum|sat)(Mod|Off)?$/.test(type)
    ) {
      const [hue, saturation, lightness] = toHsl(rgb);
      const isLum = type.startsWith("lum");
      const current = isLum ? lightness : saturation;
      const adjusted = clamp(
        type.endsWith("Mod")
          ? current * amount
          : type.endsWith("Off")
            ? current + amount
            : amount,
      );
      rgb = fromHsl(
        hue,
        isLum ? saturation : adjusted,
        isLum ? adjusted : lightness,
      );
    } else {
      warn("Some color adjustments were simplified.");
    }
  }
  if (rgb) {
    const channels = rgb.map(Math.round);
    return opacity < 1
      ? `rgba(${channels.join(",")},${opacity.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")})`
      : `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  if (opacity < 1) warn("A preset color's transparency was simplified.");
  return typeof base === "string" ? base : undefined;
}

export function readTheme(
  warn: Warn,
  root?: Element,
  ...overrides: (Element | undefined)[]
) {
  const layers = [child(root, "themeElements"), ...overrides];
  const colors = { ...defaultColors };
  let fonts: Element | undefined;
  let styles: Element | undefined;
  for (const layer of layers) {
    fonts = child(layer, "fontScheme") ?? fonts;
    styles = child(layer, "fmtScheme") ?? styles;
    for (const color of children(child(layer, "clrScheme"))) {
      if (!Object.hasOwn(defaultColors, color.localName)) continue;
      const value = resolveColor(children(color)[0], warn);
      if (value) colors[color.localName] = value;
    }
  }
  return {
    colors,
    fonts,
    styles,
  };
}

export function slideStyle(
  theme: ReturnType<typeof readTheme>,
  master?: Element,
  layout?: Element,
  slide?: Element,
) {
  const masterMap = child(master, "clrMap");
  const layoutMap = children(child(layout, "clrMapOvr"))[0];
  const slideMap = children(child(slide, "clrMapOvr"))[0];
  const override = slideMap ?? layoutMap;
  const map = { ...defaultMap };
  const colorMaps =
    override?.localName === "overrideClrMapping"
      ? [masterMap, override]
      : [masterMap];
  for (const node of colorMaps) {
    for (const { localName, value } of Array.from(node?.attributes ?? []))
      if (
        Object.hasOwn(theme.colors, value) &&
        (Object.hasOwn(defaultMap, localName) ||
          Object.hasOwn(defaultColors, localName))
      )
        map[localName] = value;
  }

  function schemeColor(value: string) {
    const key = Object.hasOwn(map, value) ? map[value] : value;
    return Object.hasOwn(theme.colors, key) ? theme.colors[key] : undefined;
  }

  function color(node: Element | undefined, warn: Warn, placeholder?: string) {
    return resolveColor(node, warn, (value) =>
      value === "phClr" ? placeholder : schemeColor(value),
    );
  }

  function paint(
    sources: (Element | undefined)[],
    warn: Warn,
    fallback: string,
    placeholder?: string,
  ) {
    for (const source of sources) {
      for (const fill of children(source)) {
        if (fill.localName === "noFill") return "none";
        if (fill.localName === "solidFill")
          return color(children(fill)[0], warn, placeholder) ?? fallback;
        if (
          ["gradFill", "pattFill", "blipFill", "grpFill"].includes(
            fill.localName,
          )
        ) {
          warn("A gradient, pattern, or picture fill was simplified.");
          return fallback;
        }
      }
    }
    return fallback;
  }

  function themeFill(
    reference: Element | undefined,
    warn: Warn,
    fallback: string,
  ) {
    const index = numeric(attr(reference, "idx"));
    if (index === undefined) return fallback;
    if (index === 0 || index === 1000) return "none";
    const background = index > 1000;
    const list = child(
      theme.styles,
      background ? "bgFillStyleLst" : "fillStyleLst",
    );
    const fill = children(list)[index - (background ? 1001 : 1)];
    const referenceColor = color(children(reference)[0], warn);
    if (fill?.localName === "solidFill")
      return color(children(fill)[0], warn, referenceColor) ?? fallback;
    if (fill?.localName === "noFill") return "none";
    if (fill) warn("A theme fill was simplified.");
    return referenceColor ?? fallback;
  }

  function font(typeface: string | undefined, major: boolean) {
    const set =
      typeface?.startsWith("+mj") || (!typeface && major)
        ? "majorFont"
        : "minorFont";
    const name =
      typeface && !/^\+(?:mj|mn)-/.test(typeface)
        ? typeface
        : attr(child(child(theme.fonts, set), "latin"), "typeface");
    return name?.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200) || "Arial";
  }

  return {
    color,
    paint,
    themeFill,
    font,
    theme,
    textColor: schemeColor("tx1") ?? "#000000",
  };
}
