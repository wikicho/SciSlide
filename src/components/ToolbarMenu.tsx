import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const OPEN_MENU = "scislide:toolbar-menu-open";
const controls =
  "button,a[href],input:not([type=hidden]),select,textarea,[tabindex]";
const scope = (menu: Element) =>
  menu.closest(".editor-toolbar,[role=toolbar]") ?? menu.ownerDocument;
const usable = (element: HTMLElement) =>
  !element.matches(":disabled,[aria-disabled=true],[tabindex='-1']") &&
  !element.closest(
    "[hidden],[inert],details:not([open]) > .toolbar-menu-content",
  );
const textControl = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    !!target.closest("input,textarea,select,[contenteditable=true]"));

/** A disclosure group keeps native controls while adding toolbar keyboard navigation. */
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
  const trigger = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const focusAfterOpen = useRef<"first" | "last" | null>(null);
  const restoreFocus = useRef(false);
  const search = useRef({ value: "", time: 0 });
  const unavailable = () =>
    disabled || !!details.current?.closest("fieldset[disabled]");
  const items = () =>
    [...(panel.current?.querySelectorAll<HTMLElement>(controls) ?? [])].filter(
      usable,
    );
  const focusItem = (item: HTMLElement | undefined) => {
    item?.focus();
    item?.scrollIntoView?.({ block: "nearest" });
  };
  const position = () => {
    if (!details.current?.open || !panel.current || !trigger.current) return;
    const content = panel.current,
      bounds = trigger.current.getBoundingClientRect();
    const availableWidth = Math.max(0, window.innerWidth - 24),
      availableHeight = Math.max(0, window.innerHeight - 24);
    content.style.maxWidth = `${availableWidth}px`;
    content.style.maxHeight = `${Math.min(520, availableHeight)}px`;
    const width = Math.min(content.offsetWidth || 236, availableWidth);
    const height = Math.min(
      content.scrollHeight
        ? content.scrollHeight + 2
        : content.getBoundingClientRect().height,
      520,
      availableHeight,
    );
    const below = bounds.bottom + 6,
      above = bounds.top - height - 6;
    const top =
      below + height <= window.innerHeight - 12
        ? below
        : above >= 12
          ? above
          : Math.max(12, window.innerHeight - height - 12);
    content.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
    content.style.top = `${top}px`;
  };
  const close = (returnFocus = false) => {
    restoreFocus.current = returnFocus;
    focusAfterOpen.current = null;
    search.current = { value: "", time: 0 };
    if (details.current) details.current.open = false;
    setOpen(false);
  };
  const show = (focus: "first" | "last" | null = null) => {
    if (unavailable() || !details.current) return;
    details.current.dispatchEvent(
      new CustomEvent(OPEN_MENU, { bubbles: true, detail: details.current }),
    );
    restoreFocus.current = false;
    focusAfterOpen.current = focus;
    details.current.open = true;
    setOpen(true);
    if (open) {
      position();
      if (focus) focusItem(focus === "first" ? items()[0] : items().at(-1));
      focusAfterOpen.current = null;
    }
  };
  const nextMenu = (direction: number, reveal: boolean) => {
    const menu = details.current;
    if (!menu) return;
    const menus = [
      ...scope(menu).querySelectorAll<HTMLDetailsElement>(
        "details[data-toolbar-menu]",
      ),
    ].filter((candidate) => {
      const summary = candidate.querySelector<HTMLElement>(":scope > summary");
      return (
        scope(candidate) === scope(menu) &&
        !!summary &&
        usable(summary) &&
        !candidate.closest("fieldset[disabled]")
      );
    });
    const index = menus.indexOf(menu),
      next = menus[(index + direction + menus.length) % menus.length];
    if (!next || next === menu) return;
    close(false);
    const summary = next.querySelector<HTMLElement>(":scope > summary")!;
    summary.focus();
    if (reveal) summary.click();
  };
  useLayoutEffect(() => {
    if (disabled && open) {
      close(!!panel.current?.contains(document.activeElement));
      return;
    }
    if (open) {
      position();
      if (focusAfterOpen.current)
        focusItem(
          focusAfterOpen.current === "first" ? items()[0] : items().at(-1),
        );
      focusAfterOpen.current = null;
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      if (!unavailable()) trigger.current?.focus();
      else if (details.current) {
        // A disabled trigger cannot receive focus. Leave its hidden panel for
        // the next available toolbar control, or the document if none remain.
        const candidates = [
          ...scope(details.current).querySelectorAll<HTMLElement>(controls),
        ].filter(
          (candidate) =>
            !details.current!.contains(candidate) && usable(candidate),
        );
        const following = candidates.find(
          (candidate) =>
            !!(
              trigger.current!.compareDocumentPosition(candidate) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        );
        const target = following ?? candidates.at(-1);
        if (target) target.focus();
        else if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
      }
    }
  }, [open, disabled]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        details.current?.open &&
        event.target instanceof Node &&
        !details.current.contains(event.target)
      )
        close(false);
    };
    const another = (event: Event) => {
      const peer = (event as CustomEvent).detail;
      if (
        peer instanceof HTMLDetailsElement &&
        details.current &&
        peer !== details.current &&
        scope(peer) === scope(details.current)
      )
        close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener(OPEN_MENU, another);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener(OPEN_MENU, another);
    };
  });
  useEffect(() => {
    if (!open) return;
    const reposition = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !panel.current?.contains(event.target)
      )
        position();
    };
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open]);
  return (
    <details
      className="toolbar-menu"
      data-toolbar-menu
      ref={details}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open === open) return;
        if (event.currentTarget.open && !unavailable()) show();
        else close(false);
      }}
      onBlur={(event) => {
        if (
          open &&
          (!(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget))
        )
          close(false);
      }}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const atTrigger = event.target === trigger.current;
        // Global help/presentation shortcuts must still reach the application,
        // which also prevents the browser's default F5 reload.
        if (/^F\d{1,2}$/.test(event.key)) {
          if (open) {
            if (panel.current?.contains(document.activeElement))
              trigger.current?.focus();
            close(false);
          }
          return;
        }
        // A focused disclosure owns plain keys, including Delete/Backspace.
        // Text fields and modified application shortcuts retain native routing.
        if (
          (atTrigger || open) &&
          !textControl(event.target) &&
          event.key !== "Tab"
        )
          event.stopPropagation();
        if (unavailable()) {
          if (
            atTrigger &&
            ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        if (
          atTrigger &&
          ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          if (open && ["Enter", " "].includes(event.key)) close(true);
          else show(event.key === "ArrowUp" ? "last" : "first");
          return;
        }
        if (textControl(event.target)) return;
        if (
          ["ArrowLeft", "ArrowRight"].includes(event.key) &&
          (open || atTrigger)
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat)
            nextMenu(event.key === "ArrowRight" ? 1 : -1, open);
          return;
        }
        if (!open) return;
        // Preserve native button activation without also running canvas commands.
        if (["Enter", " "].includes(event.key)) {
          event.stopPropagation();
          return;
        }
        const available = items();
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const index = available.indexOf(
            document.activeElement as HTMLElement,
          );
          const destination =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? available.length - 1
                : index < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : available.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      available.length) %
                    available.length;
          focusItem(available[destination]);
        } else if (event.key.length === 1 && /\S/u.test(event.key)) {
          const now = Date.now(),
            character = event.key.toLocaleLowerCase();
          let value =
            now - search.current.time < 700
              ? search.current.value + character
              : character;
          if ([...value].every((letter) => letter === character))
            value = character;
          const current = available.indexOf(
            document.activeElement as HTMLElement,
          );
          const ordered = [
            ...available.slice(current + 1),
            ...available.slice(0, current + 1),
          ];
          const name = (item: HTMLElement) =>
            (
              item.textContent?.trim() ||
              item.getAttribute("aria-label") ||
              item.getAttribute("title") ||
              ""
            ).toLocaleLowerCase();
          let match = ordered.find((item) => name(item).startsWith(value));
          if (!match) {
            value = character;
            match = ordered.find((item) => name(item).startsWith(value));
          }
          search.current = { value, time: now };
          if (match) {
            event.preventDefault();
            event.stopPropagation();
            focusItem(match);
          }
        }
      }}
    >
      <summary
        ref={trigger}
        className="tool"
        aria-label={`${label} menu`}
        aria-disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          event.preventDefault();
          if (unavailable()) return;
          if (open) close(true);
          else show(event.detail === 0 ? "first" : null);
        }}
      >
        {icon}
        {label}
        <ChevronDown size={13} aria-hidden="true" />
      </summary>
      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        className="toolbar-menu-content"
        role="group"
        aria-label={`${label} tools`}
        onClickCapture={(event) => {
          const action =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("button,a[href]")
              : null;
          if (
            action &&
            usable(action) &&
            !action.closest("[data-keep-open]") &&
            panel.current?.contains(document.activeElement)
          )
            // Dialogs record their previous focus after this action runs.
            // Give them the visible trigger rather than a soon-hidden item.
            trigger.current?.focus();
        }}
        onClick={(event) => {
          const action =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("button,a[href]")
              : null;
          if (!action || !usable(action) || action.closest("[data-keep-open]"))
            return;
          close(!!panel.current?.contains(document.activeElement));
        }}
      >
        {children}
      </div>
    </details>
  );
}
