import { useEffect, useRef } from "react";

export function PanelResizeHandle({
  label,
  value,
  min,
  max,
  orientation = "vertical",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  orientation?: "vertical" | "horizontal";
  onChange: (value: number) => void;
}) {
  const drag = useRef<{
    pointerId: number;
    coordinate: number;
    value: number;
  } | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;
      event.preventDefault();
      const coordinate =
        orientation === "vertical" ? event.clientX : event.clientY;
      onChange(clamp(start.value + start.coordinate - coordinate));
    };
    const end = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  });
  return (
    <div
      className={`panel-resize-handle is-${orientation}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = {
          pointerId: event.pointerId,
          coordinate:
            orientation === "vertical" ? event.clientX : event.clientY,
          value,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const increase = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const decrease =
          orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        if (![increase, decrease, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(
          event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : clamp(
                  value +
                    (event.key === increase ? 1 : -1) *
                      (event.shiftKey ? 40 : 10),
                ),
        );
      }}
    />
  );
}
