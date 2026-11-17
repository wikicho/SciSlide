/** Count the actual JSON UTF-8 bytes without repeatedly serializing immutable
 * embedded media. The small JSON skeleton still uses native JSON semantics. */
const lengths = new Map<string, number>();
const MAX_CACHE_CHARACTERS = 128 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;
let characters = 0;
function mediaStringBytes(value: string): number {
  const cached = lengths.get(value);
  if (cached !== undefined) {
    lengths.delete(value);
    lengths.set(value, cached);
    return cached;
  }
  const size = new TextEncoder().encode(JSON.stringify(value)).length;
  if (value.length <= MAX_CACHE_CHARACTERS) {
    while (
      lengths.size &&
      (lengths.size >= MAX_CACHE_ENTRIES ||
        characters + value.length > MAX_CACHE_CHARACTERS)
    ) {
      const oldest = lengths.keys().next().value!;
      characters -= oldest.length;
      lengths.delete(oldest);
    }
    lengths.set(value, size);
    characters += value.length;
  }
  return size;
}
export function jsonMediaByteLength(value: unknown): number {
  let mediaBytes = 0;
  const skeleton = JSON.stringify(value, (_key, item: unknown) => {
    if (
      typeof item === "string" &&
      item.length >= 1024 &&
      item.startsWith("data:")
    ) {
      mediaBytes += mediaStringBytes(item) - 2;
      return "";
    }
    return item;
  });
  return new TextEncoder().encode(skeleton).length + mediaBytes;
}
