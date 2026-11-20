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

const fraction = (value: string | undefined, fallback: number) =>
  numeric(value) === undefined
    ? fallback
    : Math.min(1, Math.max(0, Number(value) / 100_000));

export function readTheme(root?: Element) {
  const elements = child(root, "themeElements");
  const colorScheme = child(elements, "clrScheme");
  const colors = { ...defaultColors };
  for (const color of children(colorScheme)) {
    const definition = children(color)[0];
    const value = hex(
      attr(definition, definition?.localName === "sysClr" ? "lastClr" : "val"),
    );
    if (value) colors[color.localName] = value;
  }
  return {
    colors,
    fonts: child(elements, "fontScheme"),
    styles: child(elements, "fmtScheme"),
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
      if (Object.hasOwn(theme.colors, value)) map[localName] = value;
  }

  function color(node: Element | undefined, warn: Warn, placeholder?: string) {
    const value = attr(node, "val");
    if (!node) return undefined;
    let result: string | undefined;
    switch (node.localName) {
      case "srgbClr":
        result = hex(value);
        break;
      case "sysClr":
        result = hex(attr(node, "lastClr"));
        break;
      case "schemeClr": {
        if (!value) break;
        const key = map[value] ?? value;
        result =
          value === "phClr"
            ? placeholder
            : Object.hasOwn(theme.colors, key)
              ? theme.colors[key]
              : undefined;
        break;
      }
      case "prstClr":
        if (!value) break;
        result = Object.hasOwn(presetColors, value)
          ? presetColors[value]
          : /^[a-z]{1,24}$/i.test(value) &&
              globalThis.CSS?.supports("color", value)
            ? value
            : undefined;
        break;
    }
    if (!result) {
      warn("A color could not be converted.");
      return undefined;
    }
    let opacity = 1;
    const rgb = /^#[\da-f]{6}$/i.test(result)
      ? [1, 3, 5].map((index) => parseInt(result!.slice(index, index + 2), 16))
      : undefined;
    for (const effect of children(node)) {
      const amount = fraction(attr(effect, "val"), 1);
      if (effect.localName === "alpha") opacity = amount;
      else if (
        rgb &&
        (effect.localName === "tint" || effect.localName === "shade")
      ) {
        for (let index = 0; index < rgb.length; index++)
          rgb[index] =
            effect.localName === "tint"
              ? 255 - (255 - rgb[index]) * amount
              : rgb[index] * amount;
      } else {
        warn("Some color adjustments were simplified.");
      }
    }
    if (rgb) {
      const channels = rgb.map(Math.round);
      return opacity < 1
        ? `rgba(${channels.join(",")},${opacity})`
        : `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    }
    if (opacity < 1) warn("A preset color's transparency was simplified.");
    return result;
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

  return { color, paint, themeFill, font, theme };
}
