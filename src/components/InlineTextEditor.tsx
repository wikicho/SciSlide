import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { Deck, TextObject, TextStyleRange } from "../lib/model";
import { wrapText } from "../lib/layout";
import { needsInlineTextLayout, inlineTextLayoutKey } from "../lib/inline-math";
import { continueBulletLine } from "../lib/text-formatting";
import { InlineMathText } from "./InlineMathText";
import {
  effectiveTextFontFamily,
  exportTextFontFamily,
  exportTextFontWeight,
} from "../lib/text-fonts";
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
  styles?: TextStyleRange[];
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
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
  onHeightChange?: (height: number, width?: number) => void;
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
  const fontFamily = effectiveTextFontFamily(deck, object);
  const previewObject = {
    ...object,
    text: editing.value,
    textStyles: editing.styles ?? object.textStyles,
  };
  const showPreview = !!deck && needsInlineTextLayout(previewObject);
  const minimumHeight =
    object.autoFit === "content"
      ? object.fontSize * 1.3
      : Math.max(height, object.fontSize * 1.6);
  const sourceWidth = showPreview
    ? Math.min(
        object.autoFit === "content" ? Math.max(360, width) : width,
        Math.max(1, deck.slideSize.width - 32),
      )
    : width;
  const sourceMaximumHeight = showPreview
    ? Math.max(1, Math.min(320, deck.slideSize.height - 64))
    : Infinity;
  const sourceMinimumHeight = showPreview
    ? Math.min(sourceMaximumHeight, Math.max(96, object.fontSize * 2.6))
    : minimumHeight;
  const [editorHeight, setEditorHeight] = useState(sourceMinimumHeight);
  const previewKey = deck ? inlineTextLayoutKey(previewObject, deck) : "";
  const [previewMetrics, setPreviewMetrics] = useState<{
    key: string;
    height: number;
    width?: number;
  }>();
  const currentPreviewMetrics =
    previewMetrics?.key === previewKey ? previewMetrics : undefined;
  const previewWidth =
    object.autoFit === "content"
      ? (currentPreviewMetrics?.width ?? width)
      : width;
  const previewHeight =
    object.autoFit === "content"
      ? (currentPreviewMetrics?.height ?? object.fontSize * 1.3)
      : Math.max(
          minimumHeight,
          currentPreviewMetrics?.height ?? object.fontSize * 1.3,
        );
  const rotationHeight = object.autoFit === "content" ? previewHeight : height;
  const reportPreviewMetrics = useCallback(
    (_id: string, key: string, contentHeight: number, contentWidth?: number) =>
      setPreviewMetrics((current) =>
        current?.key === key &&
        current.height === contentHeight &&
        current.width === contentWidth
          ? current
          : { key, height: contentHeight, width: contentWidth },
      ),
    [],
  );
  // The source panel stays upright in slide coordinates, independently of the
  // preview's rotation and frame height. Clamp it even when neither side fits.
  const radians = (rotation * Math.PI) / 180;
  const rotatedY = [
    [-previewWidth / 2, -rotationHeight / 2],
    [previewWidth / 2, -rotationHeight / 2],
    [-previewWidth / 2, previewHeight - rotationHeight / 2],
    [previewWidth / 2, previewHeight - rotationHeight / 2],
  ].map(
    ([dx, dy]) =>
      y + rotationHeight / 2 + dx * Math.sin(radians) + dy * Math.cos(radians),
  );
  const below = Math.max(...rotatedY) + 28;
  const above = Math.min(...rotatedY) - editorHeight - 12;
  const sourceX = showPreview
    ? Math.max(16, Math.min(x, deck.slideSize.width - sourceWidth - 16))
    : 0;
  const sourceY = showPreview
    ? Math.max(
        40,
        Math.min(
          below + editorHeight <= deck.slideSize.height - 16 ? below : above,
          deck.slideSize.height - editorHeight - 16,
        ),
      )
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
          sourceWidth,
          object.fontSize,
          fontFamily,
          object.fontWeight,
        ).length *
          object.fontSize *
          1.3;
      textarea.style.height = "100%";
      const nextHeight = Math.min(
        sourceMaximumHeight,
        Math.max(sourceMinimumHeight, Math.ceil(contentHeight)),
      );
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
    sourceWidth,
    sourceMinimumHeight,
    sourceMaximumHeight,
    object.fontSize,
    fontFamily,
    object.fontWeight,
    showPreview,
  ]);
  useLayoutEffect(() => {
    if (showPreview)
      heightCallback.current?.(
        previewHeight,
        object.autoFit === "content"
          ? previewWidth
          : currentPreviewMetrics?.width,
      );
  }, [
    showPreview,
    previewHeight,
    previewWidth,
    previewKey,
    currentPreviewMetrics?.width,
    object.autoFit,
  ]);

  return (
    <g
      data-inline-text-editor={object.id}
      transform={
        showPreview
          ? undefined
          : `translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2})`
      }
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {showPreview && (
        <>
          <g
            data-inline-text-preview={object.id}
            transform={`translate(${x} ${y}) rotate(${rotation} ${previewWidth / 2} ${rotationHeight / 2})`}
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
            x={sourceX - 6}
            y={sourceY - 24}
            width={sourceWidth + 12}
            height={editorHeight + 30}
            rx={4}
            fill="#ffffff"
            stroke="rgb(107 114 128 / 45%)"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={sourceX}
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
      <foreignObject
        x={sourceX}
        y={sourceY}
        width={sourceWidth}
        height={editorHeight}
      >
        <textarea
          ref={(node) => {
            field.current = node;
            if (editing.fieldRef) editing.fieldRef.current = node;
          }}
          aria-label="Edit text on slide"
          aria-description={`Inline math uses $...$ or \\(...\\). ${shortcutLabel("insertInlineEquation", platform)} to insert or edit an equation. Enter for a new line. ${shortcutLabel("finishTextEditing", platform)} to finish. Escape to cancel.`}
          className={`inline-text-editor${showPreview ? " inline-text-source-editor" : ""}`}
          value={editing.value}
          maxLength={100_000}
          spellCheck={false}
          style={{
            color: showPreview ? "#253347" : object.color,
            fontFamily: `${exportTextFontFamily(editing.value, fontFamily)}, sans-serif`,
            fontSize: object.fontSize,
            fontWeight: exportTextFontWeight(
              editing.value,
              fontFamily,
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
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Element &&
              event.relatedTarget.closest("[data-text-formatting]")
            )
              return;
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
            if (
              event.key === "Enter" &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.shiftKey
            ) {
              const next = continueBulletLine(
                editing.value,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
              );
              if (next) {
                event.preventDefault();
                editing.onChange(next.value);
                const element = event.currentTarget;
                queueMicrotask(() =>
                  element.setSelectionRange(next.start, next.end),
                );
                return;
              }
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
