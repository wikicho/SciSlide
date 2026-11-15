// @vitest-environment jsdom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportMenu } from "../src/components/ExportMenu";
import { ToolbarMenu } from "../src/components/ToolbarMenu";
import { KeyboardShortcutsDialog } from "../src/components/KeyboardShortcutsDialog";
import { shortcutLabel, type KeyboardPlatform } from "../src/lib/shortcuts";

describe("Export disclosure", () => {
  let host: HTMLDivElement;
  let root: Root;
  let exported: ReturnType<typeof vi.fn>;
  let changeOpen: (open: boolean) => void;
  const trigger = () =>
    host.querySelector<HTMLButtonElement>("button[aria-controls]")!;
  const panel = () =>
    host.querySelector<HTMLDivElement>("[aria-label='Export formats']")!;
  const buttons = () => [
    ...panel().querySelectorAll<HTMLButtonElement>("button"),
  ];
  const outside = () => host.querySelector<HTMLInputElement>("input")!;
  const click = (target: HTMLElement) => act(() => target.click());
  const focus = (target: HTMLElement) => act(() => target.focus());
  const key = (
    target: HTMLElement,
    value: string,
    options: KeyboardEventInit = {},
  ) => {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    act(() => target.dispatchEvent(event));
    return event;
  };
  function Fixture({
    disabled = false,
    platform = "linux" as KeyboardPlatform,
    toolbar = false,
    dialog = false,
  } = {}) {
    const [open, setOpen] = useState(false),
      [help, setHelp] = useState(false);
    changeOpen = setOpen;
    return h(
      "div",
      {},
      h(
        "header",
        {},
        h(ExportMenu, {
          open,
          onOpenChange: setOpen,
          disabled: disabled || help,
          platform,
          onExport: (kind) => {
            exported(kind, document.activeElement);
            if (dialog) setHelp(true);
          },
        }),
        h("input", { "aria-label": "Outside field" }),
      ),
      toolbar &&
        h(
          "div",
          { role: "toolbar" },
          h(ToolbarMenu, { label: "File", children: h("button", {}, "Open") }),
        ),
      help &&
        h(KeyboardShortcutsDialog, { platform, onClose: () => setHelp(false) }),
    );
  }
  const render = (props: Parameters<typeof Fixture>[0] = {}) =>
    act(() => root.render(h(Fixture, props)));

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    exported = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each<KeyboardPlatform>(["mac", "windows", "linux"])(
    "retains labels, descriptions and %s shortcuts with a real accessible button",
    (platform) => {
      render({ platform });
      expect(trigger().tagName).toBe("BUTTON");
      expect(trigger().type).toBe("button");
      expect(trigger().textContent).toContain("Export");
      expect(trigger().getAttribute("aria-expanded")).toBe("false");
      expect(trigger().getAttribute("aria-controls")).toBe(panel().id);
      expect(panel().hidden).toBe(true);
      expect(buttons().map((button) => button.textContent)).toEqual([
        "PowerPoint (.pptx)All slides · editable text and shapes",
        "PDF presentationAll slides · vector equations",
        "Current slide as SVGEditable vector format",
      ]);
      expect(buttons()[0].title).toBe("Export PowerPoint (.pptx)");
      expect(buttons()[1].title).toBe(
        `Export PDF · ${shortcutLabel("exportPdf", platform)}`,
      );
      expect(buttons()[2].title).toBe(
        `Export SVG · ${shortcutLabel("exportSvg", platform)}`,
      );
    },
  );

  it("enters at either boundary and navigates with wrapped arrows, Home and End", () => {
    render();
    for (const [value, index] of [
      ["ArrowDown", 0],
      ["ArrowUp", 2],
      ["Home", 0],
      ["End", 2],
    ] as const) {
      focus(trigger());
      expect(key(trigger(), value).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(buttons()[index]);
      key(buttons()[index], "Escape");
    }
    key(trigger(), "ArrowDown");
    key(buttons()[0], "ArrowUp");
    expect(document.activeElement).toBe(buttons()[2]);
    key(buttons()[2], "ArrowDown");
    expect(document.activeElement).toBe(buttons()[0]);
    key(buttons()[0], "End");
    expect(document.activeElement).toBe(buttons()[2]);
    key(buttons()[2], "Home");
    expect(document.activeElement).toBe(buttons()[0]);
  });

  it("retains native Enter/Space activation without sending menu keys to canvas handlers", () => {
    render();
    const canvas = vi.fn();
    window.addEventListener("keydown", canvas);
    try {
      focus(trigger());
      expect(key(trigger(), "Enter").defaultPrevented).toBe(false);
      click(trigger()); // jsdom does not synthesize native keyboard clicks.
      expect(document.activeElement).toBe(buttons()[0]);
      for (const value of [
        "Enter",
        " ",
        "Delete",
        "Backspace",
        "PageDown",
        "+",
      ])
        expect(key(buttons()[0], value).defaultPrevented).toBe(false);
      expect(key(buttons()[0], "Escape").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(trigger());
      expect(panel().hidden).toBe(true);
      expect(canvas).not.toHaveBeenCalled();
      expect(exported).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", canvas);
    }
  });

  it("closes on outside pointer and Tab-out while preserving the outside focus", () => {
    render();
    click(trigger());
    expect(key(buttons()[0], "Tab").defaultPrevented).toBe(false);
    focus(outside());
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(outside());
    click(trigger());
    act(() =>
      outside().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    );
    focus(outside());
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(outside());
    expect(exported).not.toHaveBeenCalled();
  });

  it("closes when a ToolbarMenu opens even without a pointer/focus event", () => {
    render({ toolbar: true });
    click(trigger());
    const summary = host.querySelector<HTMLElement>("summary")!;
    act(() =>
      summary.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      ),
    );
    expect(panel().hidden).toBe(true);
    expect(summary.parentElement!.hasAttribute("open")).toBe(true);
    expect(exported).not.toHaveBeenCalled();
  });

  it("lets F1/F5 and modified shortcuts reach the application with a visible return target", () => {
    render();
    const application = vi.fn((event: KeyboardEvent) => {
      if (event.key === "F5") event.preventDefault();
    });
    window.addEventListener("keydown", application);
    try {
      click(trigger());
      expect(key(buttons()[0], "F5").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(trigger());
      expect(panel().hidden).toBe(true);
      key(trigger(), "F1");
      key(trigger(), "s", { ctrlKey: true });
      expect(application).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener("keydown", application);
    }
  });

  it.each(["pptx", "pdf", "svg"] as const)(
    "captures the visible trigger before %s opens a native dialog",
    (kind) => {
      render();
      click(trigger());
      const index = ["pptx", "pdf", "svg"].indexOf(kind);
      focus(buttons()[index]);
      click(buttons()[index]);
      expect(exported).toHaveBeenCalledExactlyOnceWith(kind, trigger());
      expect(panel().hidden).toBe(true);
      expect(document.activeElement).toBe(trigger());
      click(buttons()[index]);
      expect(exported).toHaveBeenCalledOnce();
    },
  );

  it("preserves focus chosen synchronously by the export action", () => {
    render();
    exported.mockImplementation(() => outside().focus());
    click(trigger());
    click(buttons()[1]);
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(outside());
  });

  it("returns to Export after a real React dialog disables and then restores the trigger", () => {
    render({ dialog: true });
    click(trigger());
    click(buttons()[0]);
    expect(
      host.querySelector("[role=dialog]")?.contains(document.activeElement),
    ).toBe(true);
    key(document.activeElement as HTMLElement, "Escape");
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes and evacuates a disabled popup without stealing an already external focus", () => {
    render();
    click(trigger());
    render({ disabled: true });
    expect(trigger().disabled).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(outside());
    click(trigger());
    key(trigger(), "ArrowDown");
    expect(panel().hidden).toBe(true);
    expect(exported).not.toHaveBeenCalled();
    render();
    click(trigger());
    focus(outside());
    render({ disabled: true });
    expect(document.activeElement).toBe(outside());
  });

  it("restores focus on an externally controlled close and ignores composing navigation", () => {
    render();
    click(trigger());
    expect(
      key(buttons()[0], "ArrowDown", { isComposing: true }).defaultPrevented,
    ).toBe(false);
    expect(document.activeElement).toBe(buttons()[0]);
    act(() => changeOpen(false));
    expect(document.activeElement).toBe(trigger());
    expect(panel().hidden).toBe(true);
  });
});
