import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type {
  Deck,
  Slide,
  SlideObject,
  EquationObject,
  ShapeObject,
  TextObject,
} from "../lib/model";
import { renderObjectEquation } from "../lib/equation-renderer";
import type { RenderedEquation } from "../lib/equations";
import { wrapText } from "../lib/layout";
import {
  inlinePlainText,
  inlineTextLayoutKey,
  needsInlineTextLayout,
} from "../lib/inline-math";
import { InlineMathText } from "./InlineMathText";
import { resolvePageNumber } from "../lib/model";
import { isVisibleAtStep } from "../lib/presentation";
import { VideoPlaceholder, VideoView } from "./VideoView";
import { ShapeView } from "./ShapeView";
import { FigureView } from "./FigureView";
import { SmartGuideOverlay } from "./SmartGuideOverlay";
import { InlineTextEditor } from "./InlineTextEditor";
import type { CanvasTextEditing } from "./InlineTextEditor";
import type { SceneGuide } from "./SmartGuideOverlay";
import { isLineShape, lineEndpoints } from "../lib/shape-geometry";
import {
  exportTextFontFamily,
  effectiveTextFontFamily,
  exportTextFontWeight,
  isKoreanFontFamily,
  KOREAN_FONT_FAMILY,
} from "../lib/text-fonts";

export function EquationView({
  object,
  deck,
  onMetrics,
}: {
  object: EquationObject;
  deck: Deck;
  onMetrics?: (id: string, w: number, h: number) => void;
}) {
  const font = object.style.fontSetId ?? deck.theme.equation.fontSetId;
  const size = object.style.fontSize ?? deck.theme.equation.fontSize;
  const color = object.style.color ?? deck.theme.equation.color;
  const [result, setResult] = useState<RenderedEquation | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    renderObjectEquation(object, deck)
      .then((r) => {
        if (active) {
          setResult(r);
          onMetrics?.(object.id, r.width, r.height);
        }
      })
      .catch((e) => {
        if (active) {
          setResult(null);
          setError(String(e.message));
        }
      });
    return () => {
      active = false;
    };
  }, [
    object.latex,
    font,
    size,
    color,
    object.displayMode,
    object.id,
    object.renderer,
    object.localTex,
    onMetrics,
  ]);
  if (error)
    return (
      <g>
        <rect
          width={object.transform.width}
          height={object.transform.height}
          fill="#fff1f2"
        />
        <text x="12" y="28" fill="#be123c" fontSize="20">
          {object.renderer === "local-latex"
            ? "Recompile equation"
            : "Invalid equation"}
        </text>
        <title>{error}</title>
      </g>
    );
  if (!result)
    return (
      <text y="30" fill="#8b94a5" fontSize="20">
        Typesetting…
      </text>
    );
  return (
    <g
      aria-label={object.description || object.latex}
      dangerouslySetInnerHTML={{
        __html:
          (result.fallbackGlyphs?.length
            ? "<title>Some symbols use STIX Two vector glyphs.</title>"
            : "") + result.svg,
      }}
    />
  );
}

interface TextFrame {
  width: number;
  height: number;
  lines: string[];
}

interface TextMeasurement {
  text: string;
  width: number;
  fontSize: number;
  family: string;
  weight: number;
  formatted: boolean;
  revision: number;
  inline: boolean;
  lines: string[];
}

export const SlideScene = memo(function SlideScene({
  deck,
  slide,
  selected = [],
  preview = {},
  onPointer,
  onResize,
  onEdit,
  onEditInlineEquation,
  onBackground,
  onEndpoint,
  onDrawStart,
  drawing = false,
  guides = [],
  guideScale = 1,
  draftShape,
  onMetrics,
  metrics = {},
  slideIndex = deck.slides.findIndex((candidate) => candidate.id === slide.id),
  presentationStep,
  playback = false,
  playMedia = true,
  textEditing,
}: {
  deck: Deck;
  slide: Slide;
  selected?: string[];
  preview?: Record<string, SlideObject>;
  onPointer?: (e: PointerEvent<SVGGElement>, o: SlideObject) => void;
  onResize?: (e: PointerEvent<SVGRectElement>, o: SlideObject) => void;
  onEdit?: (o: SlideObject) => void;
  onEditInlineEquation?: (o: TextObject, start: number, end: number) => void;
  onBackground?: () => void;
  onEndpoint?: (
    e: PointerEvent<SVGCircleElement>,
    o: ShapeObject,
    endpoint: "start" | "end",
  ) => void;
  onDrawStart?: (e: PointerEvent<SVGSVGElement>) => void;
  drawing?: boolean;
  guides?: SceneGuide[];
  guideScale?: number;
  draftShape?: ShapeObject;
  onMetrics?: (id: string, w: number, h: number) => void;
  metrics?: Record<string, { width: number; height: number }>;
  slideIndex?: number;
  presentationStep?: number;
  playback?: boolean;
  /** Presenter previews follow builds without starting a second media player. */
  playMedia?: boolean;
  textEditing?: CanvasTextEditing;
}) {
  const editingObject =
    !playback && textEditing
      ? slide.objects.find(
          (object) =>
            object.id === textEditing.objectId &&
            object.type === "text" &&
            object.visible,
        )
      : undefined;
  const pageNumber = resolvePageNumber(deck, slideIndex);
  const [localMetrics, setLocalMetrics] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [textFontRevision, refreshTextMetrics] = useState(0);
  const textMeasurements = useRef(new Map<string, TextMeasurement>());
  const previousTextFrames = useRef<Record<string, TextFrame>>({});
  const [inlineMetrics, setInlineMetrics] = useState<
    Record<string, { key: string; height: number; width?: number }>
  >({});
  const [editingMetrics, setEditingMetrics] = useState<{
    key: string;
    height: number;
    width?: number;
  }>();
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let active = true;
    const fontsLoaded = () => {
      if (active) refreshTextMetrics((revision) => revision + 1);
    };
    fonts.addEventListener?.("loadingdone", fontsLoaded);
    if (fonts.status !== "loaded")
      void fonts.ready?.then(fontsLoaded).catch(() => undefined);
    return () => {
      active = false;
      fonts.removeEventListener?.("loadingdone", fontsLoaded);
    };
  }, []);
  const koreanWeights = new Set<number>();
  for (const original of slide.objects) {
    const object = preview[original.id] ?? original;
    if (
      object.type === "text" &&
      object.visible &&
      isKoreanFontFamily(
        exportTextFontFamily(
          object.text,
          effectiveTextFontFamily(deck, object),
        ),
      )
    ) {
      koreanWeights.add(
        exportTextFontWeight(
          object.text,
          effectiveTextFontFamily(deck, object),
          object.fontWeight,
        ),
      );
    }
  }
  if (pageNumber && isKoreanFontFamily(deck.theme.fontFamily))
    koreanWeights.add(400);
  const koreanFontKey = [...koreanWeights].sort().join(",");
  useEffect(() => {
    if (!koreanFontKey || !document.fonts?.load) return;
    let active = true;
    const pending = koreanFontKey
      .split(",")
      .filter(
        (weight) =>
          !document.fonts.check?.(
            `${weight} 16px "${KOREAN_FONT_FAMILY}"`,
            "한글",
          ),
      );
    if (!pending.length) return;
    void Promise.all(
      pending.map((weight) =>
        document.fonts.load(`${weight} 16px "${KOREAN_FONT_FAMILY}"`, "한글"),
      ),
    )
      .then(() => {
        // A real FontFaceSet reports loadingdone once for all mounted scenes.
        if (active && !document.fonts.addEventListener)
          refreshTextMetrics((revision) => revision + 1);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [koreanFontKey]);
  const reportMetrics = useCallback(
    (id: string, width: number, height: number) => {
      setLocalMetrics((m) =>
        m[id]?.width === width && m[id]?.height === height
          ? m
          : { ...m, [id]: { width, height } },
      );
      onMetrics?.(id, width, height);
    },
    [onMetrics],
  );
  const reportInlineMetrics = useCallback(
    (id: string, key: string, height: number, width?: number) => {
      setInlineMetrics((current) =>
        current[id]?.key === key &&
        current[id]?.height === height &&
        current[id]?.width === width
          ? current
          : { ...current, [id]: { key, height, width } },
      );
    },
    [],
  );
  const textFrames = useMemo(() => {
    const frames: Record<string, TextFrame> = {};
    const nextMeasurements = new Map<string, TextMeasurement>();
    for (const original of slide.objects) {
      const object = preview[original.id] ?? original;
      if (object.type !== "text" || !object.visible) continue;
      const family = effectiveTextFontFamily(deck, object);
      const formatted =
        !!object.textStyles?.length || object.autoFit === "content";
      let measurement = textMeasurements.current.get(object.id);
      if (
        !measurement ||
        measurement.text !== object.text ||
        measurement.width !== object.transform.width ||
        measurement.fontSize !== object.fontSize ||
        measurement.family !== family ||
        measurement.weight !== object.fontWeight ||
        measurement.formatted !== formatted ||
        measurement.revision !== textFontRevision
      ) {
        const inline = needsInlineTextLayout(object);
        measurement = {
          text: object.text,
          width: object.transform.width,
          fontSize: object.fontSize,
          family,
          weight: object.fontWeight,
          formatted,
          revision: textFontRevision,
          inline,
          lines: wrapText(
            inline ? object.text : inlinePlainText(object.text),
            object.transform.width,
            object.fontSize,
            family,
            object.fontWeight,
          ),
        };
      }
      nextMeasurements.set(object.id, measurement);
      const { inline, lines } = measurement;
      const measured = inlineMetrics[object.id];
      const current =
        inline && measured?.key === inlineTextLayoutKey(object, deck)
          ? measured
          : undefined;
      const contentHeight =
        current?.height ?? lines.length * object.fontSize * 1.3;
      frames[object.id] = {
        width:
          object.autoFit === "content" && current
            ? (current.width ?? object.transform.width)
            : object.transform.width,
        height:
          object.autoFit === "content" && current
            ? contentHeight
            : Math.max(object.transform.height, contentHeight),
        lines,
      };
      const previous = previousTextFrames.current[object.id];
      if (
        previous?.width === frames[object.id].width &&
        previous.height === frames[object.id].height &&
        previous.lines === lines
      )
        frames[object.id] = previous;
    }
    textMeasurements.current = nextMeasurements;
    const previous = previousTextFrames.current;
    if (
      Object.keys(previous).length === Object.keys(frames).length &&
      Object.keys(frames).every((id) => frames[id] === previous[id])
    )
      return previous;
    previousTextFrames.current = frames;
    return frames;
  }, [
    slide.objects,
    preview,
    inlineMetrics,
    deck.theme.equation.fontSetId,
    deck.theme.inlineMathFontSetId,
    deck.theme.fontFamily,
    deck.slideSize.width,
    textFontRevision,
  ]);
  const editingKey =
    editingObject?.type === "text" && textEditing
      ? JSON.stringify([
          editingObject.id,
          inlineTextLayoutKey(
            {
              ...editingObject,
              text: textEditing.value,
              textStyles: textEditing.styles ?? editingObject.textStyles,
            },
            deck,
          ),
          editingObject.autoFit === "content"
            ? undefined
            : editingObject.transform.height,
        ])
      : "";
  const reportEditingHeight = useCallback(
    (height: number, width?: number) =>
      setEditingMetrics((current) =>
        current?.key === editingKey &&
        current.height === height &&
        current.width === width
          ? current
          : { key: editingKey, height, width },
      ),
    [editingKey],
  );
  useEffect(() => {
    if (!onMetrics) return;
    for (const [id, frame] of Object.entries(textFrames)) {
      if (id === editingObject?.id) {
        if (editingMetrics?.key !== editingKey) continue;
        onMetrics(
          id,
          editingObject.type === "text" && editingObject.autoFit === "content"
            ? (editingMetrics.width ?? frame.width)
            : frame.width,
          editingMetrics.height,
        );
      } else onMetrics(id, frame.width, frame.height);
    }
  }, [
    textFrames,
    onMetrics,
    deck,
    editingKey,
    editingMetrics,
    editingObject?.id,
  ]);
  return (
    <svg
      className={drawing && !playback ? "slide-scene drawing" : "slide-scene"}
      viewBox={`0 0 ${deck.slideSize.width} ${deck.slideSize.height}`}
      xmlns="http://www.w3.org/2000/svg"
      role={playback || onEdit ? "group" : "img"}
      aria-label={slide.title}
      onPointerDownCapture={(e) => {
        if (!drawing || playback) return;
        e.preventDefault();
        e.stopPropagation();
        onDrawStart?.(e);
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onBackground?.();
      }}
    >
      <rect
        width={deck.slideSize.width}
        height={deck.slideSize.height}
        fill={slide.background}
        onPointerDown={() => onBackground?.()}
      />
      {slide.objects
        .filter((o) =>
          isVisibleAtStep(o, playback ? presentationStep : undefined),
        )
        .map((original) => {
          const o = preview[original.id] ?? original,
            t = o.transform;
          const line = o.type === "shape" && isLineShape(o);
          const editable = !o.locked && !o.groupId;
          const selectionColor =
            o.type === "text"
              ? "rgb(107 114 128 / 45%)"
              : "var(--ui-accent, #5268c8)";
          const m =
              o.type === "equation"
                ? (localMetrics[o.id] ?? metrics[o.id])
                : undefined,
            w =
              editingObject?.id === o.id &&
              editingMetrics?.key === editingKey &&
              o.type === "text" &&
              o.autoFit === "content"
                ? (editingMetrics.width ?? textFrames[o.id]?.width ?? t.width)
                : (textFrames[o.id]?.width ?? m?.width ?? t.width),
            h =
              editingObject?.id === o.id && editingMetrics?.key === editingKey
                ? editingMetrics.height
                : (textFrames[o.id]?.height ?? m?.height ?? t.height);
          return (
            <g
              key={`${slide.id}:${o.id}`}
              transform={`translate(${t.x} ${t.y}) rotate(${t.rotation} ${w / 2} ${(o.type === "text" && o.autoFit !== "content" ? t.height : h) / 2})`}
              opacity={o.opacity}
              className={[
                onPointer && !o.locked ? "canvas-object" : "",
                playback && o.build?.step && o.build.effect === "fade"
                  ? "build-fade"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                playback && o.build?.effect === "fade"
                  ? ({
                      animationDuration: `${o.build.durationMs}ms`,
                      "--build-opacity": o.opacity,
                    } as CSSProperties)
                  : undefined
              }
              onPointerDown={(e) => onPointer?.(e, o)}
              onDoubleClick={() => onEdit?.(o)}
            >
              {onPointer && editingObject?.id !== o.id && o.type === "text" && (
                <rect
                  width={w}
                  height={h}
                  fill="transparent"
                  pointerEvents="all"
                />
              )}
              {o.type === "text" &&
                editingObject?.id !== o.id &&
                (needsInlineTextLayout(o) ? (
                  <InlineMathText
                    object={o}
                    deck={deck}
                    onMetrics={reportInlineMetrics}
                    onEditEquation={
                      !playback && onEditInlineEquation
                        ? (start, end) => onEditInlineEquation(o, start, end)
                        : undefined
                    }
                  />
                ) : (
                  <text
                    fill={o.color}
                    fontSize={o.fontSize}
                    fontWeight={exportTextFontWeight(
                      inlinePlainText(o.text),
                      effectiveTextFontFamily(deck, o),
                      o.fontWeight,
                    )}
                    fontFamily={exportTextFontFamily(
                      inlinePlainText(o.text),
                      effectiveTextFontFamily(deck, o),
                    )}
                    textAnchor={
                      o.align === "center"
                        ? "middle"
                        : o.align === "right"
                          ? "end"
                          : "start"
                    }
                  >
                    {textFrames[o.id].lines.map((line, i) => (
                      <tspan
                        key={i}
                        x={
                          o.align === "center"
                            ? t.width / 2
                            : o.align === "right"
                              ? t.width
                              : 0
                        }
                        y={o.fontSize + i * o.fontSize * 1.3}
                      >
                        {line || " "}
                      </tspan>
                    ))}
                  </text>
                ))}
              {o.type === "shape" && <ShapeView object={o} />}
              {o.type === "figure" && (
                <FigureView
                  object={o}
                  asset={deck.assets.find((a) => a.id === o.assetId)}
                />
              )}
              {o.type === "equation" && (
                <EquationView
                  object={o}
                  deck={deck}
                  onMetrics={reportMetrics}
                />
              )}
              {o.type === "video" &&
                (() => {
                  const asset = deck.assets.find(
                    (candidate) => candidate.id === o.assetId,
                  );
                  return playback && playMedia && asset ? (
                    <VideoView object={o} asset={asset} />
                  ) : (
                    <VideoPlaceholder object={o} missing={!asset} />
                  );
                })()}
              {onPointer &&
                editingObject?.id !== o.id &&
                o.type !== "text" &&
                (line && o.type === "shape" ? (
                  <path
                    data-line-hit="true"
                    d={(() => {
                      const { start, end } = lineEndpoints(o);
                      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
                    })()}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(16, o.strokeWidth)}
                    pointerEvents="stroke"
                  />
                ) : (
                  <rect
                    width={w}
                    height={h}
                    fill="transparent"
                    pointerEvents="all"
                  />
                ))}
              {!playback && selected.includes(o.id) && (
                <g className="selection">
                  {line && o.type === "shape" ? (
                    <>
                      <path
                        d={(() => {
                          const { start, end } = lineEndpoints(o);
                          return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
                        })()}
                        fill="none"
                        stroke={selectionColor}
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                      {editable &&
                        onEndpoint &&
                        Object.entries(lineEndpoints(o)).map(([end, point]) => (
                          <circle
                            key={end}
                            cx={point.x}
                            cy={point.y}
                            r="7"
                            fill="white"
                            stroke={selectionColor}
                            strokeWidth="2"
                            vectorEffect="non-scaling-stroke"
                            className="endpoint-handle"
                            role="button"
                            aria-label={`Move ${end} endpoint`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              onEndpoint(e, o, end as "start" | "end");
                            }}
                          />
                        ))}
                    </>
                  ) : (
                    <rect
                      width={w}
                      height={h}
                      fill="none"
                      stroke={selectionColor}
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  )}
                  {!line &&
                    editingObject?.id !== o.id &&
                    editable &&
                    !(o.type === "equation" && o.renderer === "local-latex") &&
                    [
                      [0, 0],
                      [w, 0],
                      [0, h],
                      [w, h],
                    ].map(([x, y], i) => (
                      <rect
                        key={i}
                        x={x - 6}
                        y={y - 6}
                        width="12"
                        height="12"
                        fill="white"
                        stroke={selectionColor}
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        className={i === 3 ? "resize-handle" : ""}
                        onPointerDown={(e) => {
                          if (i === 3) onResize?.(e, o);
                          else e.stopPropagation();
                        }}
                      />
                    ))}
                </g>
              )}
            </g>
          );
        })}
      {!playback && draftShape && (
        <g
          data-drawing-preview="true"
          pointerEvents="none"
          opacity={draftShape.opacity}
          transform={`translate(${draftShape.transform.x} ${draftShape.transform.y}) rotate(${draftShape.transform.rotation} ${draftShape.transform.width / 2} ${draftShape.transform.height / 2})`}
        >
          <ShapeView object={draftShape} />
        </g>
      )}
      {!playback && guides.length > 0 && (
        <SmartGuideOverlay
          guides={guides}
          slideSize={deck.slideSize}
          scale={guideScale}
        />
      )}
      {pageNumber && (
        <text
          className="slide-page-number"
          x={pageNumber.x}
          y={pageNumber.y}
          textAnchor={pageNumber.anchor}
          fontSize={pageNumber.fontSize}
          fill={pageNumber.color}
          fontFamily={deck.theme.fontFamily}
          fontWeight="400"
          pointerEvents="none"
          aria-label={`Slide ${pageNumber.text}`}
        >
          {pageNumber.text}
        </text>
      )}
      {editingObject?.type === "text" && textEditing && (
        <InlineTextEditor
          key={editingObject.id}
          object={editingObject}
          editing={textEditing}
          deck={deck}
          onHeightChange={reportEditingHeight}
        />
      )}
    </svg>
  );
});
