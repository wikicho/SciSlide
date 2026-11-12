import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Native disclosure keeps secondary tools available without crowding the canvas. */
export function ToolbarMenu({
  label,
  icon,
  children,
  disabled = false,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        details.current?.open &&
        !details.current.contains(event.target as Node)
      )
        details.current.open = false;
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, []);
  useEffect(() => {
    if (disabled && details.current) details.current.open = false;
  }, [disabled]);
  return (
    <details
      className="toolbar-menu"
      ref={details}
      onToggle={(event) => {
        const current = event.currentTarget;
        if (!current.open) return;
        const content = current.querySelector<HTMLElement>(
          ".toolbar-menu-content",
        );
        if (!content) return;
        const bounds = current.getBoundingClientRect();
        content.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - 248))}px`;
        content.style.top = `${Math.max(12, Math.min(bounds.bottom + 6, window.innerHeight - Math.min(content.scrollHeight, 520) - 12))}px`;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !details.current?.open) return;
        event.preventDefault();
        event.stopPropagation();
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }}
    >
      <summary
        className="tool"
        aria-label={`${label} menu`}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {icon}
        {label}
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div
        className="toolbar-menu-content"
        role="group"
        aria-label={`${label} tools`}
        onClick={(event) => {
          const action = (event.target as Element).closest("button");
          if (
            !action ||
            action.disabled ||
            action.hasAttribute("data-keep-open")
          )
            return;
          if (details.current) details.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
