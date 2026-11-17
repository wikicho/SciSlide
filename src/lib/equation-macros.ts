/** Favorites are copied into equation source/settings; documents never depend on this store. */
export const EQUATION_MACROS_KEY = "scislide.equation-macros.v1";
const MAX_FAVORITES = 100;
const MAX_DEFINITIONS = 4000;
const MAX_STORE = 512_000;

export interface EquationMacroFavorite {
  id: string;
  name: string;
  definitions: string;
  invocation: string;
}
export interface EquationSourceEdit {
  source: string;
  preamble?: string;
  selectionStart: number;
  selectionEnd: number;
}
interface Definition {
  name: string;
  definition: string;
}

function uncomment(source: string): string {
  let result = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\") {
      result += source[i] + (source[++i] ?? "");
    } else if (source[i] === "%") {
      const end = source.indexOf("\n", i);
      if (end < 0) break;
      i = end;
      result += "\n";
    } else result += source[i];
  }
  return result;
}

function trivia(source: string, from: number): number {
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

function group(
  source: string,
  from: number,
  open = "{",
): { value: string; end: number } {
  const close = open === "[" ? "]" : "}";
  if (source[from] !== open)
    throw new Error("Check the command's braces and arguments.");
  let depth = 1,
    braces = 0;
  for (let i = from + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === "%") {
      const end = source.indexOf("\n", i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (open === "[") {
      if (source[i] === "{") {
        braces++;
        continue;
      }
      if (source[i] === "}") {
        if (--braces < 0) break;
        continue;
      }
      if (braces) continue;
    }
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0)
      return { value: source.slice(from + 1, i), end: i + 1 };
  }
  throw new Error("Check the command's balanced braces and arguments.");
}

// This is a bounded source editor, never a package loader or executable config.
// Explicit Local LaTeX compilation still uses the desktop compiler's sandbox.
function restrictedCommands(source: string): void {
  if (
    /\^\^/.test(source) ||
    /\\(?:input|include|includeonly|includegraphics|usepackage|require|autoload|write|immediate|openout|openin|read|newread|newwrite|catcode|special|directlua|luaexec|csname|endcsname|expandafter|noexpand|def|gdef|edef|xdef|let|futurelet|global|loop|repeat|every\w*|documentclass|begin|end|href|url|style|class|cssId|html\w*|pdf\w*|XeTeX\w*)(?![A-Za-z])/i.test(
      source,
    )
  )
    throw new Error(
      "Favorites accept reusable math commands, without packages, file access, environments or external content.",
    );
}

/** Parse only a small, portable newcommand definition form, without executing it. */
export function parseMacroDefinitions(source: string): Definition[] {
  if (!source.trim() || source.length > MAX_DEFINITIONS)
    throw new Error(
      "Enter command definitions containing at most 4,000 characters.",
    );
  restrictedCommands(source);
  const result: Definition[] = [];
  const bodies = new Map<string, string>();
  let cursor = trivia(source, 0);
  while (cursor < source.length) {
    const start = cursor;
    if (
      !source.slice(cursor).startsWith("\\newcommand") ||
      /[A-Za-z]/.test(source[cursor + 11] ?? "")
    )
      throw new Error(
        "Use only definitions such as \\newcommand{\\RR}{\\mathbb{R}}.",
      );
    cursor = trivia(source, cursor + 11);
    const name = group(source, cursor);
    if (!/^\\[A-Za-z]{1,40}$/.test(name.value))
      throw new Error(
        "Command names must contain 1–40 letters, for example \\RR.",
      );
    if (result.some((item) => item.name === name.value))
      throw new Error(`Duplicate command: ${name.value}.`);
    cursor = trivia(source, name.end);
    let count = 0;
    if (source[cursor] === "[") {
      const argument = group(source, cursor, "[");
      if (!/^[0-9]$/.test(argument.value))
        throw new Error("A command accepts zero to nine arguments.");
      count = Number(argument.value);
      cursor = trivia(source, argument.end);
      if (source[cursor] === "[") {
        if (!count)
          throw new Error("A default argument needs at least one argument.");
        cursor = trivia(source, group(source, cursor, "[").end);
      }
    }
    const body = group(source, cursor);
    if (
      Array.from(body.value.matchAll(/#([0-9])/g)).some(
        (match) => Number(match[1]) < 1 || Number(match[1]) > count,
      )
    )
      throw new Error(
        "Command parameters must match the declared argument count.",
      );
    if (
      new RegExp(`\\\\${name.value.slice(1)}(?![A-Za-z])`).test(
        uncomment(body.value),
      )
    )
      throw new Error("A favorite command cannot recursively call itself.");
    result.push({
      name: name.value,
      definition: source.slice(start, body.end),
    });
    bodies.set(name.value, body.value);
    if (result.length > 20)
      throw new Error("A favorite accepts at most 20 command definitions.");
    cursor = trivia(source, body.end);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (name: string) => {
    if (visiting.has(name))
      throw new Error("Favorite commands cannot recursively call one another.");
    if (visited.has(name)) return;
    visiting.add(name);
    for (const match of uncomment(bodies.get(name)!).matchAll(
      /\\([A-Za-z]+)/g,
    )) {
      const next = `\\${match[1]}`;
      if (bodies.has(next)) visit(next);
    }
    visiting.delete(name);
    visited.add(name);
  };
  bodies.forEach((_body, name) => visit(name));
  return result;
}

export function validateMacroFavorite(value: unknown): EquationMacroFavorite {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid command favorite.");
  const raw = value as Record<string, unknown>;
  for (const [key, limit] of [
    ["id", 100],
    ["name", 80],
    ["definitions", MAX_DEFINITIONS],
    ["invocation", 1000],
  ] as const)
    if (
      typeof raw[key] !== "string" ||
      !(raw[key] as string).trim() ||
      (raw[key] as string).length > limit
    )
      throw new Error(`Favorite ${key} is missing or too long.`);
  parseMacroDefinitions(raw.definitions as string);
  restrictedCommands(raw.invocation as string);
  return {
    id: raw.id as string,
    name: (raw.name as string).trim(),
    definitions: raw.definitions as string,
    invocation: raw.invocation as string,
  };
}

function validateFavorites(value: unknown): EquationMacroFavorite[] {
  if (!Array.isArray(value) || value.length > MAX_FAVORITES)
    throw new Error("Store at most 100 command favorites.");
  const entries = value.map(validateMacroFavorite);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error("Command favorites contain duplicate IDs.");
  return entries;
}
export function loadMacroFavorites(
  storage: Pick<Storage, "getItem"> = localStorage,
): EquationMacroFavorite[] {
  const source = storage.getItem(EQUATION_MACROS_KEY);
  if (source === null) return [];
  if (source.length > MAX_STORE)
    throw new Error("The saved command favorites are too large.");
  const value = JSON.parse(source);
  if (value?.version !== 1)
    throw new Error("The saved command favorites have an unsupported format.");
  return validateFavorites(value.entries);
}
export function saveMacroFavorites(
  entries: EquationMacroFavorite[],
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  const source = JSON.stringify({
    version: 1,
    entries: validateFavorites(entries),
  });
  if (source.length > MAX_STORE)
    throw new Error("The saved command favorites are too large.");
  storage.setItem(EQUATION_MACROS_KEY, source);
}

function selection(source: string, start: number, end: number): void {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.length
  )
    throw new Error("Select a valid range in the equation source.");
}
function sourceLimit(
  source: string,
  renderer: "mathjax" | "local-latex",
  preamble: string,
): void {
  if (
    source.length > (renderer === "mathjax" ? 12_000 : 32_000) ||
    preamble.length > 16_000
  )
    throw new Error(
      "The edited equation or preamble exceeds its source limit.",
    );
}

/** Keep package declarations at the beginning for MathJax's explicit allowlist. */
function packagePrefixEnd(source: string): number {
  let cursor = 0;
  while (true) {
    const start = trivia(source, cursor),
      command = /^\\(?:usepackage|require)\b/.exec(source.slice(start));
    if (!command) return start;
    cursor = trivia(source, start + command[0].length);
    if (source[cursor] === "[")
      cursor = trivia(source, group(source, cursor, "[").end);
    cursor = group(source, cursor).end;
  }
}

function addDefinitions(
  source: string,
  definitions: string,
): { source: string; offset: number; at: number } {
  const additions: string[] = [];
  const active = uncomment(source);
  for (const item of parseMacroDefinitions(definitions)) {
    const command = item.name.slice(1);
    const declared = new RegExp(
      `\\\\(?:newcommand|renewcommand|providecommand)\\s*(?:\\{\\s*\\\\${command}\\s*\\}|\\\\${command}(?![A-Za-z]))`,
    );
    if (active.includes(uncomment(item.definition))) continue;
    if (declared.test(active))
      throw new Error(
        `The equation already defines ${item.name} differently. Edit that definition first.`,
      );
    additions.push(item.definition);
  }
  if (!additions.length) return { source, offset: 0, at: 0 };
  const at = packagePrefixEnd(source),
    inserted =
      (at > 0 && source[at - 1] !== "\n" ? "\n" : "") +
      additions.join("\n") +
      "\n";
  return {
    source: source.slice(0, at) + inserted + source.slice(at),
    offset: inserted.length,
    at,
  };
}

/** Copy definitions, so future edits/deletion of a favorite cannot change saved equations. */
export function applyMacroFavorite(
  source: string,
  preamble: string,
  renderer: "mathjax" | "local-latex",
  favorite: EquationMacroFavorite,
  start: number,
  end: number,
  insertInvocation = true,
): EquationSourceEdit {
  selection(source, start, end);
  const valid = validateMacroFavorite(favorite);
  const invocation = insertInvocation
    ? valid.invocation
    : source.slice(start, end);
  const changed = source.slice(0, start) + invocation + source.slice(end);
  const definitions = addDefinitions(
    renderer === "mathjax" ? changed : preamble,
    valid.definitions,
  );
  const added =
    renderer === "mathjax" && definitions.at <= start ? definitions.offset : 0;
  const result = {
    source: renderer === "mathjax" ? definitions.source : changed,
    ...(renderer === "local-latex" ? { preamble: definitions.source } : {}),
    selectionStart: start + added,
    selectionEnd: start + added + invocation.length,
  };
  sourceLimit(result.source, renderer, result.preamble ?? preamble);
  return result;
}

/** Both bundled MathJax and xcolor accept this explicit integer RGB model. */
export function wrapEquationSourceColor(
  source: string,
  start: number,
  end: number,
  color: string,
): EquationSourceEdit {
  selection(source, start, end);
  if (start === end) throw new Error("Select the LaTeX terms to color first.");
  const fragment = source.slice(start, end);
  if (/\\(?:newcommand|renewcommand|providecommand)\b/.test(fragment))
    throw new Error("Select equation terms without command definitions.");
  for (const command of source.matchAll(/\\[A-Za-z]+/g)) {
    const left = command.index!,
      right = left + command[0].length;
    if ((start > left && start < right) || (end > left && end < right))
      throw new Error("Select complete LaTeX commands to color.");
  }
  let braces = 0;
  const plain = uncomment(fragment);
  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === "\\") i++;
    else if (plain[i] === "{") braces++;
    else if (plain[i] === "}" && --braces < 0)
      throw new Error("Select LaTeX terms with balanced braces.");
  }
  if (braces) throw new Error("Select LaTeX terms with balanced braces.");
  if (!/^#[\da-f]{6}$/i.test(color))
    throw new Error("Choose a six-digit RGB color.");
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16),
  );
  const prefix = `\\textcolor[RGB]{${channels.join(",")}}{`;
  return {
    source:
      source.slice(0, start) +
      prefix +
      source.slice(start, end) +
      "}" +
      source.slice(end),
    selectionStart: start + prefix.length,
    selectionEnd: end + prefix.length,
  };
}
