/** Local LaTeX caches contain passive vector shapes, never HTML, scripts, or text fonts. */
export const MAX_LOCAL_SVG_BYTES = 2 * 1024 * 1024;

const tags = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "use",
  "rect",
  "line",
  "polyline",
  "polygon",
  "circle",
  "ellipse",
  "clipPath",
  "title",
  "desc",
]);
const attributes = new Set([
  "id",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "stroke",
  "fill-opacity",
  "stroke-opacity",
  "stroke-width",
  "opacity",
  "fill-rule",
  "clip-rule",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "clip-path",
  "color",
  "href",
  "xlink:href",
  "xmlns",
  "xmlns:xlink",
  "version",
  "preserveAspectRatio",
  "aria-label",
  "role",
  "style",
  "clipPathUnits",
]);
const styles = new Set([
  "fill",
  "stroke",
  "color",
  "fill-opacity",
  "stroke-opacity",
  "stroke-width",
  "opacity",
  "fill-rule",
  "clip-rule",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "clip-path",
]);
const plainPaint = /^(?:#[\da-f]{3,8}|[a-z]{1,24}|rgba?\([\d\s.,%]+\))$/i;
const identifier = /^[a-zA-Z_][\w.:-]{0,200}$/;

function invalid(): never {
  throw new Error(
    "Local LaTeX SVG must contain only self-contained vector paths and shapes.",
  );
}

function decodeXml(value: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(value)) invalid();
  return value.replace(/&([^;]+);/g, (_match, entity: string) => {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
    };
    if (named[entity]) return named[entity];
    const point = entity.startsWith("#x")
      ? Number.parseInt(entity.slice(2), 16)
      : Number(entity.slice(1));
    if (!Number.isInteger(point) || point < 1 || point > 0x10ffff) invalid();
    return String.fromCodePoint(point);
  });
}

/** Strict validation also works during recovery in environments without a DOM parser. */
export function sanitizeLocalEquationSvg(source: string): string {
  if (
    typeof source !== "string" ||
    !source.trim() ||
    new TextEncoder().encode(source).length > MAX_LOCAL_SVG_BYTES
  )
    throw new Error("A Local LaTeX SVG is empty or exceeds the 2 MB limit.");
  const svg = source
    .replace(/^\s*<\?xml\s[^?]*\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const stack: string[] = [];
  const ids = new Map<string, string>();
  const references: Array<{ id: string; kind: "glyph" | "clip" }> = [];
  let cursor = 0,
    count = 0,
    roots = 0;
  const token = /<(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  const validateText = (value: string) => {
    if (!value.trim()) return;
    if (!["title", "desc"].includes(stack.at(-1) ?? "") || /[<>]/.test(value))
      invalid();
    decodeXml(value);
  };
  const checkValue = (name: string, value: string) => {
    if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid();
    if (["href", "xlink:href"].includes(name)) {
      if (!value.startsWith("#") || !identifier.test(value.slice(1))) invalid();
      references.push({ id: value.slice(1), kind: "glyph" });
    } else if (name === "clip-path") {
      const local = /^url\(#([\w.:-]+)\)$/.exec(value);
      if (!local) invalid();
      references.push({ id: local[1], kind: "clip" });
    } else if (["fill", "stroke", "color"].includes(name)) {
      if (!plainPaint.test(value)) invalid();
    } else if (name === "style") {
      if (/[\\{}@!]/.test(value)) invalid();
      for (const declaration of value.split(";")) {
        if (!declaration.trim()) continue;
        const colon = declaration.indexOf(":");
        if (colon < 1) invalid();
        const property = declaration.slice(0, colon).trim();
        if (!styles.has(property)) invalid();
        checkValue(property, declaration.slice(colon + 1).trim());
      }
    } else if (name === "xmlns" && value !== "http://www.w3.org/2000/svg")
      invalid();
    else if (name === "xmlns:xlink" && value !== "http://www.w3.org/1999/xlink")
      invalid();
    else if (
      !["id", "aria-label", "role", "xmlns", "xmlns:xlink"].includes(name) &&
      /(?:\\|url\s*\(|javascript:|data:|https?:|@|expression\s*\()/i.test(value)
    )
      invalid();
  };
  for (const match of svg.matchAll(token)) {
    validateText(svg.slice(cursor, match.index));
    cursor = match.index! + match[0].length;
    const closing = /^<\/([\w:]+)\s*>$/.exec(match[0]);
    if (closing) {
      if (stack.pop() !== closing[1]) invalid();
      continue;
    }
    const opening = /^<([\w:]+)([\s\S]*?)(\/?)>$/.exec(match[0]);
    if (!opening || !tags.has(opening[1]) || ++count > 20_000) invalid();
    const [, tag, tail, selfClosing] = opening;
    if (!stack.length) {
      if (tag !== "svg" || ++roots > 1) invalid();
    } else if (stack.at(-1) === "title" || stack.at(-1) === "desc") invalid();
    let offset = 0;
    const names = new Set<string>();
    const attribute = /\s+([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g;
    for (const entry of tail.matchAll(attribute)) {
      if (tail.slice(offset, entry.index).trim()) invalid();
      offset = entry.index! + entry[0].length;
      const name = entry[1],
        value = decodeXml(entry[2].slice(1, -1));
      if (!attributes.has(name) || names.has(name)) invalid();
      names.add(name);
      checkValue(name, value);
      if (name === "id") {
        if (!identifier.test(value) || ids.has(value)) invalid();
        ids.set(value, tag);
      }
    }
    if (tail.slice(offset).trim()) invalid();
    if (!selfClosing) stack.push(tag);
  }
  validateText(svg.slice(cursor));
  if (
    stack.length ||
    roots !== 1 ||
    !count ||
    references.some((reference) => !ids.has(reference.id))
  )
    invalid();
  // A use can only reference a leaf vector shape, avoiding recursive reference graphs.
  for (const reference of references) {
    const target = ids.get(reference.id)!;
    if (
      reference.kind === "clip"
        ? target !== "clipPath"
        : ![
            "path",
            "rect",
            "line",
            "polyline",
            "polygon",
            "circle",
            "ellipse",
          ].includes(target)
    )
      invalid();
  }
  return svg;
}
