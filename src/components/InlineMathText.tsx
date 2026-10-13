import { useEffect, useState } from "react";
import type { Deck, TextObject } from "../lib/model";
import {
  getInlineMathSpans,
  inlineTextLayoutKey,
  layoutInlineText,
} from "../lib/inline-math";
import type { InlineTextLayout } from "../lib/inline-math";
import { wrapText } from "../lib/layout";
import { exportTextFontFamily, exportTextFontWeight } from "../lib/text-fonts";

/** The source remains ordinary editable text; only its display contains vectors. */
export function InlineMathText({
  object,
  deck,
  onMetrics,
  onEditEquation,
}: {
  object: TextObject;
  deck: Deck;
  onMetrics?: (id: string, key: string, height: number) => void;
  onEditEquation?: (start: number, end: number) => void;
}) {
  const key = inlineTextLayoutKey(object, deck);
  const [state, setState] = useState<{
    key: string;
    layout?: InlineTextLayout;
    error?: string;
  }>();
  useEffect(() => {
    let active = true;
    layoutInlineText(object, deck).then(
      (layout) => {
        if (active) setState({ key, layout });
      },
      (error: unknown) => {
        if (active)
          setState({
            key,
            error: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      active = false;
    };
    // A new deck snapshot may contain unrelated edits; the key tracks all inputs.
  }, [key]);
  const current = state?.key === key ? state : undefined;
  const layout = current?.layout;
  const spans = getInlineMathSpans(object.text);
  let equationIndex = 0;
  useEffect(() => {
    if (layout) onMetrics?.(object.id, key, layout.height);
  }, [object.id, key, layout, onMetrics]);
  return (
    <g
      data-inline-math={object.id}
      data-inline-math-error={current?.error}
      aria-label={object.text}
      aria-busy={!current}
    >
      {current?.error && <title>{current.error}</title>}
      {layout ? (
        layout.lines.map((line, index) => (
          <g key={index} data-inline-math-line={index}>
            {line.runs.map((run, runIndex) => {
              const span =
                run.type === "math" ? spans[equationIndex++] : undefined;
              return run.type === "math" ? (
                <g
                  key={runIndex}
                  data-inline-math-fragment={run.latex}
                  aria-label={run.latex}
                  transform={`translate(${run.x} ${run.y})`}
                  onDoubleClick={(event) => {
                    if (!span || !onEditEquation) return;
                    event.stopPropagation();
                    onEditEquation(span.start, span.end);
                  }}
                  dangerouslySetInnerHTML={{ __html: run.svg }}
                />
              ) : (
                <text
                  key={runIndex}
                  x={run.x}
                  y={line.baseline}
                  fill={object.color}
                  fontSize={object.fontSize}
                  fontFamily={layout.fontFamily}
                  fontWeight={layout.fontWeight}
                  xmlSpace="preserve"
                >
                  {run.text}
                </text>
              );
            })}
          </g>
        ))
      ) : (
        <text
          fill={current?.error ? "#be123c" : object.color}
          fontSize={object.fontSize}
          fontFamily={exportTextFontFamily(object.text, object.fontFamily)}
          fontWeight={exportTextFontWeight(
            object.text,
            object.fontFamily,
            object.fontWeight,
          )}
          textAnchor={
            object.align === "center"
              ? "middle"
              : object.align === "right"
                ? "end"
                : "start"
          }
        >
          {wrapText(
            object.text,
            object.transform.width,
            object.fontSize,
            object.fontFamily,
            object.fontWeight,
          ).map((line, index) => (
            <tspan
              key={index}
              x={
                object.align === "center"
                  ? object.transform.width / 2
                  : object.align === "right"
                    ? object.transform.width
                    : 0
              }
              y={object.fontSize + index * object.fontSize * 1.3}
            >
              {line || " "}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}
