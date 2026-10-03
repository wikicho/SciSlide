import { createElement } from "react";
import type { ShapeObject } from "../lib/model";
import { shapeGeometry } from "../lib/shape-geometry";

/** React uses camel-case SVG attributes; exports use the same primitive data. */
export function ShapeView({ object }: { object: ShapeObject }) {
  return shapeGeometry(object).map(({ tag, attributes }, index) =>
    createElement(tag, {
      key: index,
      ...Object.fromEntries(
        Object.entries(attributes).map(([name, value]) => [
          name.replace(/-([a-z])/g, (_, letter: string) =>
            letter.toUpperCase(),
          ),
          value,
        ]),
      ),
    }),
  );
}
