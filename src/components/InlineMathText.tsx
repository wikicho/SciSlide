import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Deck, TextObject } from "../lib/model";
import { inlineTextLayoutKey, layoutInlineText } from "../lib/inline-math";
import type { InlineTextLayout } from "../lib/inline-math";
import { wrapText } from "../lib/layout";
import {
  effectiveTextFontFamily,
  exportTextFontFamily,
  exportTextFontWeight,
} from "../lib/text-fonts";

const MAX_LAYOUT_ENTRIES = 128;
const MAX_LAYOUT_BYTES = 8 * 1024 * 1024;
interface CachedLayout {
  promise: Promise<InlineTextLayout>;
  bytes: number;
  layout?: InlineTextLayout;
}
const layouts = new Map<string, CachedLayout>();
let layoutBytes = 0;
let fontIdentity: FontFaceSet | undefined | null = null;
let fontGeneration = 0;
let disconnectFonts: (() => void) | undefined;
const fontSubscribers = new Set<() => void>();

function clearLayouts() {
  layouts.clear();
  layoutBytes = 0;
}

function fontSnapshot() {
  const fonts = document.fonts;
  if (fonts !== fontIdentity) {
    disconnectFonts?.();
    fontIdentity = fonts;
    clearLayouts();
    fontGeneration++;
    const invalidate = () => {
      if (fontIdentity !== fonts) return;
      clearLayouts();
      fontGeneration++;
      for (const subscriber of fontSubscribers) subscriber();
    };
    fonts?.addEventListener?.("loadingdone", invalidate);
    // Minimal font sets may expose only ready, without loadingdone events.
    if (fonts?.ready && !fonts.addEventListener)
      void fonts.ready.then(invalidate).catch(() => undefined);
    disconnectFonts = () =>
      fonts?.removeEventListener?.("loadingdone", invalidate);
  }
  return fontGeneration;
}

function subscribeFonts(subscriber: () => void) {
  fontSnapshot();
  fontSubscribers.add(subscriber);
  return () => {
    fontSubscribers.delete(subscriber);
  };
}

function trimLayouts() {
  while (layouts.size > MAX_LAYOUT_ENTRIES || layoutBytes > MAX_LAYOUT_BYTES) {
    const [key, entry] = layouts.entries().next().value!;
    layouts.delete(key);
    layoutBytes -= entry.bytes;
  }
}

/** Share bounded in-flight and completed work across canvas/thumbnail remounts. */
function cachedLayout(object: TextObject, deck: Deck, key: string) {
  // Without a font set there is no reliable font-change invalidation signal.
  if (!document.fonts)
    return layoutInlineText(object, deck, { tolerateErrors: true });
  const existing = layouts.get(key);
  if (existing) {
    layouts.delete(key);
    layouts.set(key, existing);
    return existing.promise;
  }
  const entry: CachedLayout = {
    bytes: key.length * 2,
    promise: layoutInlineText(object, deck, { tolerateErrors: true }),
  };
  entry.promise = entry.promise.then(
    (layout) => {
      if (layouts.get(key) === entry) {
        entry.layout = layout;
        const bytes =
          key.length * 2 +
          layout.lines.reduce(
            (total, line) =>
              total +
              line.runs.reduce(
                (sum, run) =>
                  sum +
                  128 +
                  (run.type === "math"
                    ? run.svg.length * 2
                    : run.text.length * 2),
                64,
              ),
            0,
          );
        layoutBytes += bytes - entry.bytes;
        entry.bytes = bytes;
        trimLayouts();
      }
      return layout;
    },
    (error: unknown) => {
      if (layouts.get(key) === entry) {
        layouts.delete(key);
        layoutBytes -= entry.bytes;
      }
      throw error;
    },
  );
  layouts.set(key, entry);
  layoutBytes += entry.bytes;
  trimLayouts();
  return entry.promise;
}

/** The source remains ordinary editable text; only its display contains vectors. */
export function InlineMathText({
  object,
  deck,
  onMetrics,
  onEditEquation,
}: {
  object: TextObject;
  deck: Deck;
  onMetrics?: (id: string, key: string, height: number, width?: number) => void;
  onEditEquation?: (start: number, end: number) => void;
}) {
  const key = inlineTextLayoutKey(object, deck);
  const fontRevision = useSyncExternalStore(
    subscribeFonts,
    fontSnapshot,
    () => fontGeneration,
  );
  const editEquation = useRef(onEditEquation);
  editEquation.current = onEditEquation;
  const requestedFamily = effectiveTextFontFamily(deck, object);
  const [state, setState] = useState<
    | {
        key: string;
        revision: number;
        layout?: InlineTextLayout;
        error?: string;
      }
    | undefined
  >(() => {
    const layout = layouts.get(key)?.layout;
    return layout ? { key, revision: fontRevision, layout } : undefined;
  });
  useEffect(() => {
    let active = true;
    cachedLayout(object, deck, key).then(
      (layout) => {
        if (active) setState({ key, revision: fontRevision, layout });
      },
      (error: unknown) => {
        if (active)
          setState({
            key,
            revision: fontRevision,
            error: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      active = false;
    };
    // A new deck snapshot may contain unrelated edits; the key tracks all inputs.
  }, [key, fontRevision]);
  const cached = layouts.get(key)?.layout;
  const current =
    state?.key === key && state.revision === fontRevision
      ? state
      : cached
        ? { key, revision: fontRevision, layout: cached }
        : undefined;
  const layout = current?.layout;
  const error = current?.error ?? layout?.errors?.join("\n");
  useEffect(() => {
    if (layout) onMetrics?.(object.id, key, layout.height, layout.width);
  }, [object.id, key, layout, onMetrics]);
  const content = useMemo(
    () =>
      layout ? (
        layout.lines.map((line, index) => (
          <g key={index} data-inline-math-line={index}>
            {line.runs.map((run, runIndex) => {
              return run.type === "math" ? (
                <g
                  key={runIndex}
                  data-inline-math-fragment={run.latex}
                  aria-label={run.latex}
                  transform={`translate(${run.x} ${run.y})`}
                  onDoubleClick={(event) => {
                    if (!editEquation.current) return;
                    event.stopPropagation();
                    editEquation.current(run.start, run.end);
                  }}
                >
                  <rect
                    width={run.width}
                    height={run.height}
                    fill="transparent"
                  />
                  <g dangerouslySetInnerHTML={{ __html: run.svg }} />
                </g>
              ) : (
                <text
                  key={runIndex}
                  x={run.x}
                  y={line.baseline}
                  fill={run.equation ? "#be123c" : (run.color ?? object.color)}
                  fontSize={object.fontSize}
                  fontFamily={layout.fontFamily}
                  fontWeight={layout.fontWeight}
                  xmlSpace="preserve"
                  data-inline-math-invalid={run.equation?.latex}
                  onDoubleClick={(event) => {
                    if (!run.equation || !editEquation.current) return;
                    event.stopPropagation();
                    editEquation.current(run.equation.start, run.equation.end);
                  }}
                >
                  {run.text}
                  {run.equation && <title>{run.equation.error}</title>}
                </text>
              );
            })}
          </g>
        ))
      ) : (
        <text
          fill={current?.error ? "#be123c" : object.color}
          fontSize={object.fontSize}
          fontFamily={exportTextFontFamily(object.text, requestedFamily)}
          fontWeight={exportTextFontWeight(
            object.text,
            requestedFamily,
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
            requestedFamily,
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
      ),
    [layout, key, current?.error, fontRevision],
  );
  return (
    <g
      data-inline-math={object.id}
      data-inline-math-error={error}
      aria-label={object.text}
      aria-busy={!current}
    >
      {error && <title>{error}</title>}
      {content}
    </g>
  );
}
