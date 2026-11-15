import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { ChevronDown, Download, ImagePlus, Presentation } from "lucide-react";
import { shortcutLabel, type KeyboardPlatform } from "../lib/shortcuts";

type ExportKind = "pptx" | "pdf" | "svg";

/** Native buttons in a controlled disclosure, matching ToolbarMenu's key ownership. */
export function ExportMenu({
  open,
  onOpenChange,
  disabled,
  platform,
  onExport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  platform: KeyboardPlatform;
  onExport: (kind: ExportKind) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusAfterOpen = useRef<"first" | "last" | null>(null);
  const previouslyOpen = useRef(open);
  const panelId = useId();
  const actions = () =>
    [
      ...(panel.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].filter((button) => !button.disabled);
  const focusAction = (button: HTMLButtonElement | undefined) => {
    button?.focus();
    button?.scrollIntoView?.({ block: "nearest" });
  };
  const close = (returnFocus = false) => {
    focusAfterOpen.current = null;
    if (returnFocus && !disabled) trigger.current?.focus();
    onOpenChange(false);
  };
  const show = (focus: "first" | "last" | null) => {
    if (disabled) return;
    focusAfterOpen.current = focus;
    if (open && focus) {
      focusAction(focus === "first" ? actions()[0] : actions().at(-1));
      focusAfterOpen.current = null;
    }
    onOpenChange(true);
  };

  useLayoutEffect(() => {
    const focusedItem = panel.current?.contains(document.activeElement);
    if (disabled && open) {
      onOpenChange(false);
      focusAfterOpen.current = null;
    } else if (open && focusAfterOpen.current) {
      focusAction(
        focusAfterOpen.current === "first" ? actions()[0] : actions().at(-1),
      );
      focusAfterOpen.current = null;
    }
    if (focusedItem && (disabled || (!open && previouslyOpen.current))) {
      if (!disabled) trigger.current?.focus();
      else {
        // Do not leave focus in a hidden/disabled popup. A dialog which has
        // already chosen its own focus is outside this branch.
        const context = root.current?.closest("header") ?? document;
        const next = [
          ...context.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']",
          ),
        ].find(
          (element) =>
            !root.current?.contains(element) &&
            !element.closest("[hidden],[inert],fieldset[disabled]"),
        );
        if (next) next.focus();
        else if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
      }
    }
    previouslyOpen.current = open;
  }, [open, disabled]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        close(false);
    };
    // ToolbarMenu emits this event before opening. The Export disclosure lives
    // in the header, so it intentionally listens across toolbar scopes.
    const toolbarOpened = (event: Event) => {
      if ((event as CustomEvent).detail instanceof HTMLDetailsElement)
        close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scislide:toolbar-menu-open", toolbarOpened);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scislide:toolbar-menu-open", toolbarOpened);
    };
  });

  const exportAction = (kind: ExportKind) => {
    if (disabled || !open) return;
    close(false);
    onExport(kind);
  };
  return (
    <div
      className="dropdown-wrap"
      ref={root}
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
        if (/^F\d{1,2}$/.test(event.key)) {
          if (open) close(!!panel.current?.contains(document.activeElement));
          return;
        }
        // Keep plain navigation/deletion keys from changing the canvas selection.
        // Tab and native button activation retain their browser default behavior.
        if (event.key !== "Tab") event.stopPropagation();
        if (disabled) return;
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close(true);
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const atTrigger = event.target === trigger.current;
        if (atTrigger) {
          show(["ArrowUp", "End"].includes(event.key) ? "last" : "first");
          return;
        }
        if (!open) return;
        const buttons = actions(),
          index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const destination =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : index < 0
                ? event.key === "ArrowDown"
                  ? 0
                  : buttons.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
        focusAction(buttons[destination]);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="button primary"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          if (disabled) return;
          if (open) close(true);
          else show(event.detail === 0 ? "first" : null);
        }}
      >
        <Download size={16} aria-hidden="true" /> Export{" "}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        ref={panel}
        id={panelId}
        className="dropdown"
        role="group"
        aria-label="Export formats"
        hidden={!open || disabled}
        onClickCapture={(event) => {
          const action =
            event.target instanceof Element
              ? event.target.closest("button")
              : null;
          // Native save dialogs and React dialogs must capture the visible
          // trigger, not the action which is about to disappear.
          if (
            action &&
            !disabled &&
            panel.current?.contains(document.activeElement)
          )
            trigger.current?.focus();
        }}
      >
        <button
          type="button"
          disabled={disabled}
          title="Export PowerPoint (.pptx)"
          onClick={() => exportAction("pptx")}
        >
          <Presentation size={15} aria-hidden="true" />
          <span>
            PowerPoint (.pptx)
            <small>All slides · editable text and shapes</small>
          </span>
        </button>
        <button
          type="button"
          disabled={disabled}
          title={`Export PDF · ${shortcutLabel("exportPdf", platform)}`}
          onClick={() => exportAction("pdf")}
        >
          <Download size={15} aria-hidden="true" />
          <span>
            PDF presentation<small>All slides · vector equations</small>
          </span>
        </button>
        <button
          type="button"
          disabled={disabled}
          title={`Export SVG · ${shortcutLabel("exportSvg", platform)}`}
          onClick={() => exportAction("svg")}
        >
          <ImagePlus size={15} aria-hidden="true" />
          <span>
            Current slide as SVG<small>Editable vector format</small>
          </span>
        </button>
      </div>
    </div>
  );
}
