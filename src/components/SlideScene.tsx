import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { Deck, Slide, SlideObject, EquationObject } from "../lib/model";
import { renderObjectEquation } from "../lib/equation-renderer";
import type { RenderedEquation } from "../lib/equations";
import { wrapText } from "../lib/layout";
import { resolvePageNumber } from "../lib/model";
import { isVisibleAtStep } from "../lib/presentation";
import { VideoPlaceholder, VideoView } from "./VideoView";

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

export function SlideScene({
  deck,
  slide,
  selected = [],
  preview = {},
  onPointer,
  onResize,
  onEdit,
  onBackground,
  onMetrics,
  metrics = {},
  slideIndex = deck.slides.findIndex((candidate) => candidate.id === slide.id),
  presentationStep,
  playback = false,
}: {
  deck: Deck;
  slide: Slide;
  selected?: string[];
  preview?: Record<string, SlideObject>;
  onPointer?: (e: PointerEvent<SVGGElement>, o: SlideObject) => void;
  onResize?: (e: PointerEvent<SVGRectElement>, o: SlideObject) => void;
  onEdit?: (o: SlideObject) => void;
  onBackground?: () => void;
  onMetrics?: (id: string, w: number, h: number) => void;
  metrics?: Record<string, { width: number; height: number }>;
  slideIndex?: number;
  presentationStep?: number;
  playback?: boolean;
}) {
  const pageNumber = resolvePageNumber(deck, slideIndex);
  const [localMetrics, setLocalMetrics] = useState<
    Record<string, { width: number; height: number }>
  >({});
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
  return (
    <svg
      className="slide-scene"
      viewBox={`0 0 ${deck.slideSize.width} ${deck.slideSize.height}`}
      xmlns="http://www.w3.org/2000/svg"
      role={playback ? "group" : "img"}
      aria-label={slide.title}
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
          const m =
              o.type === "equation"
                ? (localMetrics[o.id] ?? metrics[o.id])
                : undefined,
            w = m?.width ?? t.width,
            h = m?.height ?? t.height;
          return (
            <g
              key={`${slide.id}:${o.id}`}
              transform={`translate(${t.x} ${t.y}) rotate(${t.rotation} ${w / 2} ${h / 2})`}
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
              {o.type === "text" && (
                <text
                  fill={o.color}
                  fontSize={o.fontSize}
                  fontWeight={o.fontWeight}
                  fontFamily={o.fontFamily}
                  textAnchor={
                    o.align === "center"
                      ? "middle"
                      : o.align === "right"
                        ? "end"
                        : "start"
                  }
                >
                  {wrapText(
                    o.text,
                    t.width,
                    o.fontSize,
                    o.fontFamily,
                    o.fontWeight,
                  ).map((line, i) => (
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
              )}
              {o.type === "shape" &&
                (o.shape === "ellipse" ? (
                  <ellipse
                    cx={t.width / 2}
                    cy={t.height / 2}
                    rx={t.width / 2}
                    ry={t.height / 2}
                    fill={o.fill}
                    stroke={o.stroke}
                    strokeWidth={o.strokeWidth}
                  />
                ) : (
                  <rect
                    width={t.width}
                    height={t.height}
                    rx="12"
                    fill={o.fill}
                    stroke={o.stroke}
                    strokeWidth={o.strokeWidth}
                  />
                ))}
              {o.type === "figure" && (
                <image
                  href={deck.assets.find((a) => a.id === o.assetId)?.dataUrl}
                  width={t.width}
                  height={t.height}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <title>{o.alt}</title>
                </image>
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
                  return playback && asset ? (
                    <VideoView object={o} asset={asset} />
                  ) : (
                    <VideoPlaceholder object={o} missing={!asset} />
                  );
                })()}
              {onPointer && (
                <rect
                  width={w}
                  height={h}
                  fill="transparent"
                  pointerEvents="all"
                />
              )}
              {selected.includes(o.id) && (
                <g className="selection">
                  <rect
                    width={w}
                    height={h}
                    fill="none"
                    stroke="#0f9f87"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                  {!(o.type === "equation" && o.renderer === "local-latex") &&
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
                        stroke="#0f9f87"
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
    </svg>
  );
}
