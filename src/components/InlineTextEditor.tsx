import { useEffect, useRef } from "react";
import type { TextObject } from "../lib/model";
import { exportTextFontFamily, exportTextFontWeight } from "../lib/text-fonts";
import {
  getKeyboardPlatform,
  matchesShortcut,
  shortcutLabel,
} from "../lib/shortcuts";
import type { KeyboardPlatform } from "../lib/shortcuts";
import { desktop } from "../lib/desktop";
import "./InlineTextEditor.css";

export interface CanvasTextEditing {
  objectId: string;
  value: string;
  onChange: (value: string) => void;
  onFinish: (apply: boolean) => void;
  platform?: KeyboardPlatform;
}

/** A native plain-text field in slide coordinates preserves zoom and rotation. */
export function InlineTextEditor({
  object,
  editing,
}: {
  object: TextObject;
  editing: CanvasTextEditing;
}) {
  const platform = editing.platform ?? getKeyboardPlatform(desktop?.platform);
  const field = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const finished = useRef(false);
  const finish = (apply: boolean) => {
    if (finished.current) return;
    finished.current = true;
    editing.onFinish(apply);
  };
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, []);
  const { x, y, width, height, rotation } = object.transform;
  return (
    <g
      data-inline-text-editor={object.id}
      transform={`translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2})`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <foreignObject
        width={width}
        height={Math.max(height, object.fontSize * 1.6)}
      >
        <textarea
          ref={field}
          aria-label="Edit text on slide"
          aria-description={`Inline math uses $...$ or \\(...\\). Enter for a new line. ${shortcutLabel("finishTextEditing", platform)} to finish. Escape to cancel.`}
          className="inline-text-editor"
          value={editing.value}
          maxLength={100_000}
          spellCheck={false}
          style={{
            color: object.color,
            fontFamily: `${exportTextFontFamily(editing.value, object.fontFamily)}, sans-serif`,
            fontSize: object.fontSize,
            fontWeight: exportTextFontWeight(
              editing.value,
              object.fontFamily,
              object.fontWeight,
            ),
            textAlign: object.align,
            opacity: object.opacity,
          }}
          onChange={(event) => editing.onChange(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              composing.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229 ||
              event.getModifierState("AltGraph")
            )
              return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (!event.repeat) finish(false);
            } else if (
              matchesShortcut(event.nativeEvent, "finishTextEditing", platform)
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (!event.repeat) finish(true);
            }
          }}
        />
      </foreignObject>
    </g>
  );
}
