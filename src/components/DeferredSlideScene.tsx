import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { Asset, Deck, Slide } from "../lib/model";
import { SlideScene } from "./SlideScene";

type SceneProps = { deck: Deck; slide: Slide; slideIndex: number };

/** Immutable document edits often clone unchanged slides. Compare render data,
 * without serializing large embedded media or irrelevant speaker notes. */
function equalValue(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (
    !first ||
    !second ||
    typeof first !== "object" ||
    typeof second !== "object"
  )
    return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const a = first as Record<string, unknown>,
    b = second as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalValue(a[key], b[key]))
  );
}
const assetIndexes = new WeakMap<Deck, Map<string, Asset>>();
function assets(deck: Deck) {
  let index = assetIndexes.get(deck);
  if (!index) {
    index = new Map(deck.assets.map((asset) => [asset.id, asset]));
    assetIndexes.set(deck, index);
  }
  return index;
}
function sameScene(previous: SceneProps, next: SceneProps): boolean {
  if (previous.slideIndex !== next.slideIndex) return false;
  if (previous.deck === next.deck && previous.slide === next.slide) return true;
  const a = previous.deck,
    b = next.deck;
  if (
    a.id !== b.id ||
    a.slides.length !== b.slides.length ||
    !equalValue(a.slideSize, b.slideSize) ||
    !equalValue(a.theme, b.theme) ||
    !equalValue(a.pageNumbers, b.pageNumbers)
  )
    return false;
  const first = previous.slide,
    second = next.slide;
  if (
    first.id !== second.id ||
    first.title !== second.title ||
    first.background !== second.background ||
    !equalValue(first.objects, second.objects)
  )
    return false;
  const before = assets(a),
    after = assets(b);
  return second.objects.every(
    (object) =>
      (object.type !== "figure" && object.type !== "video") ||
      equalValue(before.get(object.assetId), after.get(object.assetId)),
  );
}
const ThumbnailScene = memo(function ThumbnailScene(props: SceneProps) {
  return <SlideScene {...props} />;
}, sameScene);

type Pool = {
  observer: IntersectionObserver;
  callbacks: Map<Element, (visible: boolean) => void>;
};
const pools = new Map<Element | null, Pool>();

/** One native observer serves every preview in the same scroll root. */
function observe(
  element: Element,
  root: Element | null,
  changed: (visible: boolean) => void,
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    changed(true);
    return () => {};
  }
  let pool = pools.get(root);
  try {
    if (!pool) {
      const callbacks = new Map<Element, (visible: boolean) => void>();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            callbacks.get(entry.target)?.(entry.isIntersecting);
        },
        { root, rootMargin: "160px 0px", threshold: 0 },
      );
      pool = { observer, callbacks };
      pools.set(root, pool);
    }
    pool.callbacks.set(element, changed);
    pool.observer.observe(element);
  } catch {
    // Unsupported/blocked observers must leave a usable full-preview fallback.
    if (pool) {
      pool.observer.disconnect();
      for (const callback of pool.callbacks.values()) callback(true);
      pools.delete(root);
    }
    changed(true);
    return () => {};
  }
  const current = pool;
  return () => {
    current.callbacks.delete(element);
    current.observer.unobserve(element);
    if (!current.callbacks.size) {
      current.observer.disconnect();
      if (pools.get(root) === current) pools.delete(root);
    }
  };
}

/** Lightweight first paint; mount scientific SVG/text only near the visible area. */
export function DeferredSlideScene({
  deck,
  slide,
  slideIndex = deck.slides.findIndex((candidate) => candidate.id === slide.id),
  className,
  style,
  rootRef,
}: {
  deck: Deck;
  slide: Slide;
  slideIndex?: number;
  className?: string;
  style?: CSSProperties;
  rootRef?: RefObject<Element | null>;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (!element.current) return;
    return observe(element.current, rootRef?.current ?? null, setVisible);
  }, [rootRef]);
  return (
    <span
      ref={element}
      className={className}
      data-preview-slide-id={slide.id}
      style={{
        display: "block",
        aspectRatio: `${deck.slideSize.width}/${deck.slideSize.height}`,
        ...style,
      }}
    >
      {visible ? (
        <ThumbnailScene deck={deck} slide={slide} slideIndex={slideIndex} />
      ) : (
        <svg
          className="slide-preview-placeholder"
          viewBox={`0 0 ${deck.slideSize.width} ${deck.slideSize.height}`}
          aria-hidden="true"
          width="100%"
          height="100%"
        >
          <rect
            width={deck.slideSize.width}
            height={deck.slideSize.height}
            fill={slide.background}
          />
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            fill="#64748b"
            fontSize={
              Math.min(deck.slideSize.width, deck.slideSize.height) / 18
            }
          >
            {slide.title || "Preview"}
          </text>
        </svg>
      )}
    </span>
  );
}
