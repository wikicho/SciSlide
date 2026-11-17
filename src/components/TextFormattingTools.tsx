import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { TextStyleRange } from "../lib/model";
import {
  colorTextRange,
  rebaseTextStyles,
  toggleBulletLines,
} from "../lib/text-formatting";
import { getInlineMathSpans } from "../lib/inline-math";
import { wrapEquationSourceColor } from "../lib/equation-macros";
import "./TextFormattingTools.css";

export function TextFormattingTools({
  fieldRef,
  value,
  styles,
  onChange,
  disabled = false,
}: {
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  styles?: TextStyleRange[];
  onChange: (value: string, styles: TextStyleRange[]) => void;
  disabled?: boolean;
}) {
  const [color, setColor] = useState("#c43131");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [error, setError] = useState("");
  const pending = useRef<{ start: number; end: number } | null>(null);
  const remember = () => {
    const field = fieldRef.current;
    if (field)
      setSelection({ start: field.selectionStart, end: field.selectionEnd });
  };
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const events = ["select", "keyup", "pointerup", "input"];
    for (const event of events) field.addEventListener(event, remember);
    remember();
    return () => {
      for (const event of events) field.removeEventListener(event, remember);
    };
  }, [fieldRef]);
  useLayoutEffect(() => {
    if (!pending.current || !fieldRef.current) return;
    fieldRef.current.focus({ preventScroll: true });
    fieldRef.current.setSelectionRange(
      pending.current.start,
      pending.current.end,
    );
    pending.current = null;
    remember();
  }, [value, styles]);
  const format = (
    next: { value: string; start: number; end: number },
    ranges: TextStyleRange[],
  ) => {
    pending.current = { start: next.start, end: next.end };
    onChange(next.value, ranges);
  };
  const applyColor = (paint: string | null) => {
    if (disabled || selection.start === selection.end) return;
    const { start, end } = selection;
    const equation = getInlineMathSpans(value).find((span) => {
      const delimiter = span.source.startsWith("$") ? 1 : 2;
      return start >= span.start + delimiter && end <= span.end - delimiter;
    });
    setError("");
    try {
      if (equation && paint) {
        const offset =
          equation.start + (equation.source.startsWith("$") ? 1 : 2);
        const edited = wrapEquationSourceColor(
          equation.latex,
          start - offset,
          end - offset,
          paint,
        );
        const next =
          value.slice(0, offset) +
          edited.source +
          value.slice(equation.end - (equation.source.startsWith("$") ? 1 : 2));
        format(
          {
            value: next,
            start: offset + edited.selectionStart,
            end: offset + edited.selectionEnd,
          },
          rebaseTextStyles(value, next, styles),
        );
      } else if (equation)
        setError("Use the equation color tool to change a formula's color.");
      else
        format(
          { value, start, end },
          colorTextRange(styles, start, end, paint),
        );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div
      className="text-formatting-tools"
      data-text-formatting="true"
      role="group"
      aria-label="Text formatting"
      onPointerDownCapture={remember}
    >
      <button
        type="button"
        disabled={disabled}
        title="Add or remove bullets on selected lines"
        aria-label="Toggle bullet list"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => {
          const next = toggleBulletLines(
            value,
            selection.start,
            selection.end,
            styles ?? [],
          );
          format(next, next.styles ?? []);
        }}
      >
        • Bullets
      </button>
      <label title="Choose the color for the selected text">
        <span>Selection</span>
        <input
          aria-label="Selection color"
          type="color"
          disabled={disabled}
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={disabled || selection.start === selection.end}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => applyColor(color)}
      >
        Color selection
      </button>
      <button
        type="button"
        disabled={disabled || selection.start === selection.end}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => applyColor(null)}
      >
        Reset color
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
