import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Deck, TextObject } from "../lib/model";
import { wrapText } from "../lib/layout";
import { hasInlineMath, inlineTextLayoutKey } from "../lib/inline-math";
import { InlineMathText } from "./InlineMathText";
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
  deck,
}: {
  object: TextObject;
  editing: CanvasTextEditing;
  onHeightChange?: (height: number) => void;
  deck?: Deck;
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
  const previewObject = { ...object, text: editing.value };
  const showPreview = !!deck && hasInlineMath(editing.value);
  const previewKey = deck ? inlineTextLayoutKey(previewObject, deck) : "";
  const [previewMetrics, setPreviewMetrics] = useState<{
    key: string;
    height: number;
  }>();
  const previewHeight = Math.max(
    minimumHeight,
    previewMetrics?.key === previewKey
      ? previewMetrics.height
      : object.fontSize * 1.3,
  );
  const reportPreviewMetrics = useCallback(
    (_id: string, key: string, contentHeight: number) =>
      setPreviewMetrics((current) =>
        current?.key === key && current.height === contentHeight
          ? current
          : { key, height: contentHeight },
      ),
    [],
  );
  // Keep the rendered text in its slide position. Its source field floats below
  // it (or above near the slide's bottom), without changing stored geometry.
  const sourceY = showPreview
    ? y + previewHeight + 28 + editorHeight > deck.slideSize.height &&
      y >= editorHeight + 28
      ? -editorHeight - 28
      : previewHeight + 28
    : 0;
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
      if (!showPreview) heightCallback.current?.(nextHeight);
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
    showPreview,
  ]);
  useLayoutEffect(() => {
    if (showPreview) heightCallback.current?.(previewHeight);
  }, [showPreview, previewHeight, previewKey]);

  return (
    <g
      data-inline-text-editor={object.id}
      transform={`translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2})`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {showPreview && (
        <>
          <g
            data-inline-text-preview={object.id}
            opacity={object.opacity}
            pointerEvents="none"
          >
            <InlineMathText
              object={previewObject}
              deck={deck}
              onMetrics={reportPreviewMetrics}
            />
          </g>
          <rect
            x={-6}
            y={sourceY - 24}
            width={width + 12}
            height={editorHeight + 30}
            rx={4}
            fill="#ffffff"
            stroke="rgb(107 114 128 / 45%)"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={0}
            y={sourceY - 8}
            fill="#6b7280"
            fontSize={12}
            fontFamily="Inter, sans-serif"
            pointerEvents="none"
          >
            Text source · $...$ inline math
          </text>
        </>
      )}
      <foreignObject y={sourceY} width={width} height={editorHeight}>
        <textarea
          ref={field}
          aria-label="Edit text on slide"
          aria-description={`Inline math uses $...$ or \\(...\\). ${shortcutLabel("insertInlineEquation", platform)} to insert or edit an equation. Enter for a new line. ${shortcutLabel("finishTextEditing", platform)} to finish. Escape to cancel.`}
          className="inline-text-editor"
          value={editing.value}
          maxLength={100_000}
          spellCheck={false}
          style={{
            color: showPreview ? "#253347" : object.color,
            fontFamily: `${exportTextFontFamily(editing.value, object.fontFamily)}, sans-serif`,
            fontSize: object.fontSize,
            fontWeight: exportTextFontWeight(
              editing.value,
              object.fontFamily,
              object.fontWeight,
            ),
            textAlign: object.align,
            opacity: showPreview ? 1 : object.opacity,
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
