import { isObjectLocked } from "./drawing";
import type { SlideObject } from "./model";

/** Back-to-front stack order; a visible unlocked group is one keyboard stop. */
export function objectTraversalUnits(objects: SlideObject[]): string[][] {
  const units: string[][] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    if (!object.visible || isObjectLocked(object, objects)) continue;
    const key = object.groupId ?? object.id;
    if (seen.has(key)) continue;
    seen.add(key);
    units.push(
      object.groupId
        ? objects
            .filter(
              (member) => member.groupId === object.groupId && member.visible,
            )
            .map((member) => member.id)
        : [object.id],
    );
  }
  return units;
}

/** null leaves Tab to the browser, so traversal never traps keyboard focus. */
export function traverseObjects(
  objects: SlideObject[],
  selected: string[],
  backwards: boolean,
): string[] | null {
  const units = objectTraversalUnits(objects);
  const matches = units
    .map((unit, index) =>
      unit.some((id) => selected.includes(id)) ? index : -1,
    )
    .filter((index) => index >= 0);
  const current = backwards ? matches[0] : matches.at(-1);
  const next =
    current === undefined
      ? backwards
        ? units.length - 1
        : 0
      : current + (backwards ? -1 : 1);
  return units[next] ?? null;
}
