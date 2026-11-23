import { MAX_EQUATION_SOURCE_CHARACTERS } from "./local-tex-draft";
import { attr, child, children } from "./pptx-package";

const mathNamespaces = [
  "http://schemas.openxmlformats.org/officeDocument/2006/math",
  "http://purl.oclc.org/ooxml/officeDocument/math",
];
const drawingMathNamespace =
  "http://schemas.microsoft.com/office/drawing/2010/main";

export function isOfficeMath(node: Element) {
  return (
    (node.localName === "m" && node.namespaceURI === drawingMathNamespace) ||
    (["oMath", "oMathPara"].includes(node.localName) &&
      mathNamespaces.includes(node.namespaceURI ?? ""))
  );
}

export function officeEquations(container: Element | undefined) {
  return mathNamespaces.flatMap((namespace) =>
    Array.from(container?.getElementsByTagNameNS(namespace, "oMath") ?? []),
  );
}

function mathValue(node: Element | undefined) {
  for (const namespace of mathNamespaces) {
    const value = node?.getAttributeNS(namespace, "val");
    if (value != null) return value;
  }
  return attr(node, "val");
}

const symbols: Record<string, string> = {
  "\\": "\\backslash ",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  $: "\\$",
  "%": "\\%",
  "&": "\\&",
  _: "\\_",
  "^": "\\hat{}",
  "~": "\\sim ",
  "−": "-",
  "×": "\\times ",
  "÷": "\\div ",
  "·": "\\cdot ",
  "≤": "\\leq ",
  "≥": "\\geq ",
  "≠": "\\neq ",
  "∞": "\\infty ",
  "±": "\\pm ",
  "→": "\\to ",
  "∂": "\\partial ",
  "∇": "\\nabla ",
};
const naryOperators: Record<string, string> = {
  "∑": "\\sum",
  "∏": "\\prod",
  "∐": "\\coprod",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "⋃": "\\bigcup",
  "⋂": "\\bigcap",
};
const delimiters: Record<string, string> = {
  "": ".",
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "|": "|",
  "{": "\\{",
  "}": "\\}",
  "⟨": "\\langle",
  "⟩": "\\rangle",
  "‖": "\\Vert",
  "⌊": "\\lfloor",
  "⌋": "\\rfloor",
  "⌈": "\\lceil",
  "⌉": "\\rceil",
};

/** Translate the supported Office Math constructs without accepting raw TeX. */
export function officeMathToLatex(node: Element) {
  let nodes = 0;
  let sourceCharacters = 0;
  const unsupported = Symbol();

  function read(element: Element | undefined, depth: number): string {
    if (!element || depth > 48 || ++nodes > 4096) throw unsupported;
    const content = () =>
      children(element)
        .filter((item) => !item.localName.endsWith("Pr"))
        .map((item) => read(item, depth + 1))
        .join("");
    const part = (name: string) => read(child(element, name), depth + 1);
    const optionalPart = (name: string) =>
      child(element, name) ? part(name) : "";
    const property = (properties: string, name: string) =>
      mathValue(child(child(element, properties), name));

    switch (element.localName) {
      case "m": {
        if (element.namespaceURI === drawingMathNamespace) return content();
        const rows = children(element, "mr").map((row) =>
          children(row, "e")
            .map((item) => read(item, depth + 1))
            .join(" & "),
        );
        if (!rows.length) throw unsupported;
        return `\\begin{matrix}${rows.join("\\\\")}\\end{matrix}`;
      }
      case "oMathPara":
      case "oMath":
      case "e":
      case "num":
      case "den":
      case "sub":
      case "sup":
      case "deg":
      case "fName":
        return content();
      case "r": {
        const source = child(element, "t")?.textContent ?? "";
        sourceCharacters += source.length;
        if (sourceCharacters > MAX_EQUATION_SOURCE_CHARACTERS)
          throw unsupported;
        // Office may use mathematical-alphabet Unicode glyphs in ordinary runs.
        const text = Array.from(source, (value) =>
          /[\u{1d400}-\u{1d7ff}]/u.test(value)
            ? value.normalize("NFKC")
            : value,
        ).join("");
        const plain = child(child(element, "rPr"), "nor");
        const normal =
          plain && !["0", "false", "off"].includes(mathValue(plain) ?? "");
        const escaped = Array.from(text, (value) => {
          if (/\s/u.test(value)) return normal ? " " : "\\ ";
          return symbols[value] ?? value;
        }).join("");
        return normal ? `\\text{${escaped}}` : escaped;
      }
      case "f": {
        const kind = property("fPr", "type") ?? "bar";
        const numerator = part("num");
        const denominator = part("den");
        if (kind === "noBar")
          return `\\genfrac{}{}{0pt}{}{${numerator}}{${denominator}}`;
        if (kind === "lin" || kind === "skw")
          return `{${numerator}}/{${denominator}}`;
        if (kind === "bar") return `\\frac{${numerator}}{${denominator}}`;
        throw unsupported;
      }
      case "sSub":
        return `{${part("e")}}_{${part("sub")}}`;
      case "sSup":
        return `{${part("e")}}^{${part("sup")}}`;
      case "sSubSup":
        return `{${part("e")}}_{${part("sub")}}^{${part("sup")}}`;
      case "rad": {
        const degree = optionalPart("deg");
        return degree
          ? `\\sqrt[{${degree}}]{${part("e")}}`
          : `\\sqrt{${part("e")}}`;
      }
      case "d": {
        const left = delimiters[property("dPr", "begChr") ?? "("];
        const right = delimiters[property("dPr", "endChr") ?? ")"];
        const separator = delimiters[property("dPr", "sepChr") ?? "|"];
        if (
          left === undefined ||
          right === undefined ||
          separator === undefined
        )
          throw unsupported;
        const arguments_ = children(element, "e").map((item) =>
          read(item, depth + 1),
        );
        return `\\left${left} ${arguments_.join(` \\middle${separator} `)} \\right${right} `;
      }
      case "nary": {
        const operator = naryOperators[property("naryPr", "chr") ?? "∫"];
        if (!operator) throw unsupported;
        const sub = optionalPart("sub");
        const sup = optionalPart("sup");
        const limits =
          property("naryPr", "limLoc") === "undOvr" ? "\\limits" : "";
        return `${operator}${limits}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""} {${part("e")}}`;
      }
      case "func": {
        const name = part("fName");
        return `\\operatorname{${name}}{${part("e")}}`;
      }
      case "eqArr":
        return `\\begin{gathered}${children(element, "e")
          .map((item) => read(item, depth + 1))
          .join("\\\\")}\\end{gathered}`;
    }
    throw unsupported;
  }

  try {
    const latex = read(node, 0).trim();
    return latex && latex.length <= MAX_EQUATION_SOURCE_CHARACTERS
      ? latex
      : undefined;
  } catch (error) {
    if (error !== unsupported) throw error;
    return undefined;
  }
}
