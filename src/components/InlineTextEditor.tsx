import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TextObject } from "../lib/model";
import { wrapText } from "../lib/layout";
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
  suspended?: boolean;
  onEditEquation?: (field: HTMLTextAreaElement) => void;
}

/** A native plain-text field in slide coordinates preserves zoom and rotation. */
export function InlineTextEditor({
  object,
  editing,
  onHeightChange,
}: {
  object: TextObject;
  editing: CanvasTextEditing;
  onHeightChange?: (height: number) => void;
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
  const minimumHeight = Math.max(height, object.fontSize * 1.6);
  const [editorHeight, setEditorHeight] = useState(minimumHeight);
  const heightCallback = useRef(onHeightChange);
  heightCallback.current = onHeightChange;

  useLayoutEffect(() => {
    const textarea = field.current;
    if (!textarea) return;
    const measure = () => {
      // Reset before reading so deleting text can shrink back to the stored box.
      textarea.style.height = "0px";
      const contentHeight =
        textarea.scrollHeight ||
        wrapText(
          editing.value,
          width,
          object.fontSize,
          object.fontFamily,
          object.fontWeight,
        ).length *
          object.fontSize *
          1.3;
      textarea.style.height = "100%";
      const nextHeight = Math.max(minimumHeight, Math.ceil(contentHeight));
      setEditorHeight(nextHeight);
      heightCallback.current?.(nextHeight);
    };
    measure();

    const fonts = document.fonts;
    if (!fonts) return;
    let active = true;
    const fontLoaded = () => {
      if (active) measure();
    };
    fonts.addEventListener?.("loadingdone", fontLoaded);
    void fonts.ready?.then(fontLoaded);
    return () => {
      active = false;
      fonts.removeEventListener?.("loadingdone", fontLoaded);
    };
  }, [
    editing.value,
    width,
    minimumHeight,
    object.fontSize,
    object.fontFamily,
    object.fontWeight,
  ]);

  return (
    <g
      data-inline-text-editor={object.id}
      transform={`translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2})`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <foreignObject width={width} height={editorHeight}>
        <textarea
          ref={field}
          aria-label="Edit text on slide"
          aria-description={`Inline math uses $...$ or \\(...\\). ${shortcutLabel("insertInlineEquation", platform)} to insert or edit an equation. Enter for a new line. ${shortcutLabel("finishTextEditing", platform)} to finish. Escape to cancel.`}
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
          onBlur={() => {
            if (!editing.suspended) finish(true);
          }}
          onKeyDown={(event) => {
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            ) {
              event.stopPropagation();
              return;
            }
            if (event.defaultPrevented || event.getModifierState("AltGraph"))
              return;
            if (
              editing.onEditEquation &&
              matchesShortcut(
                event.nativeEvent,
                "insertInlineEquation",
                platform,
              )
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (!event.repeat) editing.onEditEquation(event.currentTarget);
            } else if (event.key === "Escape") {
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
