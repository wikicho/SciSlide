import type { TextStyleRange } from "./model";

export function textStyleColor(
  ranges: TextStyleRange[] | undefined,
  at: number,
) {
  return ranges?.find((range) => at >= range.start && at < range.end)?.color;
}

function merged(ranges: TextStyleRange[]): TextStyleRange[] {
  const result: TextStyleRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.end <= range.start) continue;
    const last = result.at(-1);
    if (last && last.end === range.start && last.color === range.color)
      last.end = range.end;
    else result.push({ ...range });
  }
  return result;
}

/** Source ranges use the same UTF-16 positions as a native textarea. */
export function colorTextRange(
  ranges: TextStyleRange[] | undefined,
  start: number,
  end: number,
  color: string | null,
): TextStyleRange[] {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  )
    throw new Error("Text color bounds must be ordered non-negative integers.");
  if (start >= end) return (ranges ?? []).map((range) => ({ ...range }));
  const next: TextStyleRange[] = [];
  for (const range of ranges ?? []) {
    if (range.end <= start || range.start >= end) next.push({ ...range });
    else {
      if (range.start < start) next.push({ ...range, end: start });
      if (range.end > end) next.push({ ...range, start: end });
    }
  }
  if (color) next.push({ start, end, color });
  return merged(next);
}

/** Preserve formatting through a native text edit, including insertion/deletion. */
export function rebaseTextStyles(
  before: string,
  after: string,
  ranges: TextStyleRange[] | undefined,
): TextStyleRange[] {
  if (!ranges?.length) return [];
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let oldEnd = before.length,
    newEnd = after.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  const result: TextStyleRange[] = [];
  for (const range of ranges) {
    if (range.start < start)
      result.push({ ...range, end: Math.min(start, range.end) });
    if (range.end > oldEnd)
      result.push({
        ...range,
        start: Math.max(oldEnd, range.start) + delta,
        end: range.end + delta,
      });
  }
  const inherited = textStyleColor(ranges, start > 0 ? start - 1 : 0);
  if (inherited && newEnd > start)
    result.push({ start, end: newEnd, color: inherited });
  return merged(result);
}

interface SourceLine {
  start: number;
  end: number;
  text: string;
  ending: string;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    lines.push({
      start,
      end: match.index,
      text: source.slice(start, match.index),
      ending: match[0],
    });
    start = match.index + match[0].length;
  }
  lines.push({
    start,
    end: source.length,
    text: source.slice(start),
    ending: "",
  });
  return lines;
}

function lineAt(lines: SourceLine[], offset: number) {
  return lines.findIndex(
    (line, index) =>
      offset < line.end + line.ending.length || index === lines.length - 1,
  );
}

const bulletPrefix = /^([^\S\r\n]*• )/u;

export function toggleBulletLines(
  source: string,
  start: number,
  end: number,
  styles?: TextStyleRange[],
) {
  const all = sourceLines(source);
  const firstIndex = lineAt(all, start);
  const lastIndex = lineAt(all, Math.max(start, end - 1));
  const lines = all.slice(firstIndex, lastIndex + 1);
  const nonempty = lines.filter((line) => line.text.trim());
  const remove =
    nonempty.length > 0 &&
    nonempty.every((line) => bulletPrefix.test(line.text));
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const text = lines
    .map((line, index) => {
      const prefix = bulletPrefix.exec(line.text)?.[1];
      if (remove && prefix) {
        const at = line.start + prefix.length - 2;
        edits.push({ start: at, end: at + 2, value: "" });
      } else if (!remove && !prefix) {
        const indent = /^[^\S\r\n]*/u.exec(line.text)![0].length;
        const at = line.start + indent;
        edits.push({ start: at, end: at, value: "• " });
      }
      const value = remove
        ? line.text.replace(bulletPrefix, (prefix) => prefix.replace("• ", ""))
        : bulletPrefix.test(line.text)
          ? line.text
          : line.text.replace(/^([^\S\r\n]*)/u, "$1• ");
      return value + (index < lines.length - 1 ? line.ending : "");
    })
    .join("");
  const first = lines[0].start;
  const last = lines.at(-1)!.end;
  let nextStyles = styles?.map((range) => ({ ...range }));
  if (nextStyles) {
    let current = source;
    // Separate prefix edits preserve every unchanged colored word between them.
    for (const edit of edits.reverse()) {
      const next =
        current.slice(0, edit.start) + edit.value + current.slice(edit.end);
      nextStyles = rebaseTextStyles(current, next, nextStyles);
      current = next;
    }
  }
  return {
    value: source.slice(0, first) + text + source.slice(last),
    start: first,
    end: first + text.length,
    ...(nextStyles === undefined ? {} : { styles: nextStyles }),
  };
}

export function continueBulletLine(source: string, start: number, end: number) {
  if (start !== end) return null;
  const lines = sourceLines(source);
  const index = lineAt(lines, start);
  const line = lines[index];
  const match = bulletPrefix.exec(line.text);
  if (!match || start < line.start + match[1].length || start > line.end)
    return null;
  const prefix = match[1];
  if (!line.text.slice(prefix.length).trim())
    return {
      value: source.slice(0, line.start) + source.slice(line.end),
      start: line.start,
      end: line.start,
    };
  const ending =
    line.ending ||
    lines
      .slice(0, index)
      .reverse()
      .find((before) => before.ending)?.ending ||
    "\n";
  const insert = ending + prefix;
  return {
    value: source.slice(0, start) + insert + source.slice(end),
    start: start + insert.length,
    end: start + insert.length,
  };
}
