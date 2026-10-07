import { useCallback, useEffect, useRef, useState } from "react";
import type { Deck } from "../lib/model";
import { SlideScene } from "./SlideScene";

type DropPosition = { slideId: string; edge: "before" | "after" };
type SlideDrag = {
  deckId: string;
  slideId: string;
  pointerId: number;
  originX: number;
  originY: number;
  clientX: number;
  clientY: number;
  active: boolean;
  element: HTMLButtonElement;
};

export function SlideList({
  deck,
  activeSlideId,
  disabled = false,
  onSelect,
  onReorder,
}: {
  deck: Deck;
  activeSlideId: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onReorder: (
    sourceId: string,
    targetId: string,
    edge: "before" | "after",
  ) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const drag = useRef<SlideDrag | null>(null);
  const suppressClick = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [position, setPosition] = useState<DropPosition | null>(null);
  const scrolling = useRef({ velocity: 0, frame: null as number | null });

  const stopScrolling = useCallback(() => {
    if (scrolling.current.frame !== null)
      cancelAnimationFrame(scrolling.current.frame);
    scrolling.current = { velocity: 0, frame: null };
  }, []);
  const cancel = useCallback(() => {
    const source = drag.current;
    drag.current = null;
    if (source?.element.hasPointerCapture?.(source.pointerId))
      source.element.releasePointerCapture(source.pointerId);
    setDraggingId(null);
    setPosition(null);
    stopScrolling();
  }, [stopScrolling]);

  useEffect(() => {
    cancel();
    return stopScrolling;
  }, [deck.id, disabled, cancel, stopScrolling]);

  const currentDrag = () => {
    const source = drag.current;
    return !disabled &&
      source?.deckId === deck.id &&
      deck.slides.some((slide) => slide.id === source.slideId)
      ? source
      : null;
  };
  const listPosition = (
    clientX: number,
    clientY: number,
  ): DropPosition | null => {
    const element = list.current;
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    if (
      clientX < bounds.left ||
      clientX > bounds.right ||
      clientY < bounds.top ||
      clientY > bounds.bottom
    )
      return null;
    const cards = element.querySelectorAll<HTMLButtonElement>(".slide-card");
    if (!cards.length) return null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2)
        return { slideId: card.dataset.slideId!, edge: "before" };
    }
    return { slideId: cards[cards.length - 1].dataset.slideId!, edge: "after" };
  };
  const scrollNearEdge = (clientX: number, clientY: number) => {
    const element = list.current;
    if (!element || !listPosition(clientX, clientY)) {
      stopScrolling();
      return;
    }
    const bounds = element.getBoundingClientRect();
    if (!bounds.height) return;
    const edge = Math.min(36, bounds.height / 4);
    const velocity =
      clientY < bounds.top + edge
        ? -Math.ceil((10 * (bounds.top + edge - clientY)) / edge)
        : clientY > bounds.bottom - edge
          ? Math.ceil((10 * (clientY - bounds.bottom + edge)) / edge)
          : 0;
    if (!velocity) {
      stopScrolling();
      return;
    }
    scrolling.current.velocity = velocity;
    if (scrolling.current.frame !== null) return;
    const tick = () => {
      const element = list.current;
      const source = drag.current;
      if (!element || !source?.active || !scrolling.current.velocity) {
        stopScrolling();
        return;
      }
      const previous = element.scrollTop;
      element.scrollTop += scrolling.current.velocity;
      if (element.scrollTop === previous) {
        stopScrolling();
        return;
      }
      setPosition(listPosition(source.clientX, source.clientY));
      scrolling.current.frame = requestAnimationFrame(tick);
    };
    scrolling.current.frame = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const source = currentDrag();
      if (!source || event.pointerId !== source.pointerId) return;
      source.clientX = event.clientX;
      source.clientY = event.clientY;
      if (!source.active) {
        if (
          Math.hypot(
            event.clientX - source.originX,
            event.clientY - source.originY,
          ) < 5
        )
          return;
        source.active = true;
        suppressClick.current = true;
        setDraggingId(source.slideId);
      }
      event.preventDefault();
      setPosition(listPosition(event.clientX, event.clientY));
      scrollNearEdge(event.clientX, event.clientY);
    };
    const finish = (event: PointerEvent) => {
      const source = currentDrag();
      if (!source || event.pointerId !== source.pointerId) return;
      const next = source.active
        ? listPosition(event.clientX, event.clientY)
        : null;
      if (source.active) event.preventDefault();
      cancel();
      if (next) onReorder(source.slideId, next.slideId, next.edge);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === drag.current?.pointerId) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
    };
  });

  return (
    <div className="slide-list" ref={list}>
      {deck.slides.map((slide, index) => (
        <button
          className={`slide-card ${slide.id === activeSlideId ? "selected" : ""} ${slide.id === draggingId ? "dragging" : ""} ${position?.slideId === slide.id ? `drop-${position.edge}` : ""}`}
          key={slide.id}
          data-slide-id={slide.id}
          data-reorderable={!disabled && deck.slides.length > 1}
          aria-label={`Slide ${index + 1}: ${slide.title || "Untitled slide"}`}
          aria-current={slide.id === activeSlideId ? "true" : undefined}
          title="Drag to reorder slide"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onClick={(event) => {
            if (event.detail > 0 && suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            onSelect(slide.id);
          }}
          onPointerDown={(event) => {
            if (
              disabled ||
              deck.slides.length < 2 ||
              drag.current ||
              event.button !== 0 ||
              !event.isPrimary
            )
              return;
            suppressClick.current = false;
            drag.current = {
              deckId: deck.id,
              slideId: slide.id,
              pointerId: event.pointerId,
              originX: event.clientX,
              originY: event.clientY,
              clientX: event.clientX,
              clientY: event.clientY,
              active: false,
              element: event.currentTarget,
            };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onLostPointerCapture={cancel}
        >
          <span className="slide-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="thumbnail">
            <SlideScene deck={deck} slide={slide} slideIndex={index} />
          </span>
          <span className="thumbnail-title">
            {slide.title || "Untitled slide"}
          </span>
        </button>
      ))}
    </div>
  );
}
