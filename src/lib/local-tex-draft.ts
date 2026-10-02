export const MAX_EQUATION_SOURCE_CHARACTERS = 32_000;
export const MAX_LOCAL_PREAMBLE_CHARACTERS = 16_000;

export function assertEquationDocumentLimits(
  source: string,
  preamble?: string,
): void {
  if (source.length > MAX_EQUATION_SOURCE_CHARACTERS)
    throw new Error("수식 원문은 32,000자 이하로 입력해주세요.");
  if (preamble !== undefined && preamble.length > MAX_LOCAL_PREAMBLE_CHARACTERS)
    throw new Error("LaTeX 프리앰블은 16,000자 이하로 입력해주세요.");
}

function skipTrivia(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) cursor++;
    else if (source[cursor] === "%") {
      const end = source.indexOf("\n", cursor);
      cursor = end < 0 ? source.length : end + 1;
    } else break;
  }
  return cursor;
}

function readGroup(source: string, start: number, open: "[" | "{"): number {
  const close = open === "[" ? "]" : "}";
  let depth = 1,
    braces = 0;
  for (let cursor = start + 1; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (character === "\\") {
      cursor++;
      continue;
    }
    if (character === "%") {
      const end = source.indexOf("\n", cursor);
      if (end < 0) break;
      cursor = end;
      continue;
    }
    if (open === "[") {
      if (character === "{") {
        braces++;
        continue;
      }
      if (character === "}") {
        if (--braces < 0) break;
        continue;
      }
      if (braces) continue;
    }
    if (character === open) depth++;
    else if (character === close && --depth === 0) return cursor + 1;
  }
  throw new Error(
    "패키지 선언의 괄호를 확인해주세요. 예: \\usepackage{physics}",
  );
}

interface Declaration {
  start: number;
  end: number;
  latex: string;
  keys: string[];
}

function declarationAt(source: string, start: number): Declaration | null {
  const command = /^\\(usepackage|require)\b/.exec(source.slice(start));
  if (!command) return null;
  let cursor = skipTrivia(source, start + command[0].length),
    options = "";
  if (source[cursor] === "[") {
    const end = readGroup(source, cursor, "[");
    options = source.slice(cursor + 1, end - 1).trim();
    cursor = skipTrivia(source, end);
  }
  if (source[cursor] !== "{")
    throw new Error(
      "패키지 이름을 중괄호로 감싸주세요. 예: \\usepackage{physics}",
    );
  const end = readGroup(source, cursor, "{");
  const latex = "\\usepackage" + source.slice(start + command[0].length, end);
  const names = source
    .slice(cursor + 1, end - 1)
    .split(",")
    .map((name) => name.trim());
  // Deduplicate only literal package names with identical options. Definitions/macros
  // or different option sets must retain their original LaTeX behavior.
  const keys =
    !latex.includes("%") &&
    names.length &&
    names.every((name) => /^[a-zA-Z][a-zA-Z0-9._/-]*$/.test(name))
      ? names.map((name) => JSON.stringify([name, options]))
      : [];
  return {
    start,
    end,
    keys,
    latex,
  };
}

function existingPackages(preamble: string): Set<string> {
  const result = new Set<string>();
  let cursor = 0;
  // Read only an unambiguous initial declaration sequence. A later \usepackage
  // may be a token in a macro definition, condition, or deferred hook.
  while (cursor < preamble.length) {
    const start = skipTrivia(preamble, cursor),
      declaration = declarationAt(preamble, start);
    if (!declaration) break;
    declaration.keys.forEach((key) => result.add(key));
    cursor = declaration.end;
  }
  return result;
}

/** Lift only the leading declarations; expression text and comments remain editable. */
export function moveLeadingPackagesToPreamble(
  source: string,
  preamble: string,
): { source: string; preamble: string } {
  const declarations: Declaration[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = skipTrivia(source, cursor),
      declaration = declarationAt(source, start);
    if (!declaration) break;
    declarations.push(declaration);
    cursor = declaration.end;
  }
  if (!declarations.length) return { source, preamble };
  const known = existingPackages(preamble),
    additions: string[] = [];
  const retained: string[] = [];
  cursor = 0;
  for (const declaration of declarations) {
    retained.push(source.slice(cursor, declaration.start));
    cursor = declaration.end;
    if (
      !declaration.keys.length ||
      !declaration.keys.every((key) => known.has(key))
    ) {
      additions.push(declaration.latex);
      declaration.keys.forEach((key) => known.add(key));
    }
  }
  retained.push(source.slice(cursor));
  const relocated = {
    source: retained.join(""),
    preamble: additions.length
      ? preamble +
        (preamble && !preamble.endsWith("\n") ? "\n" : "") +
        additions.join("\n")
      : preamble,
  };
  assertEquationDocumentLimits(relocated.source, relocated.preamble);
  return relocated;
}
