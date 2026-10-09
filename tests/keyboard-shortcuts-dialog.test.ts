// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsDialog } from "../src/components/KeyboardShortcutsDialog";
import type { KeyboardPlatform } from "../src/lib/shortcuts";

describe("platform keyboard shortcut reference", () => {
  let host: HTMLDivElement;
  let opener: HTMLButtonElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    opener = document.createElement("button");
    opener.textContent = "Keyboard shortcuts";
    document.body.append(opener, host);
    opener.focus();
    root = createRoot(host);
    onClose = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    opener.remove();
    vi.unstubAllGlobals();
  });

  async function mount(platform: KeyboardPlatform = "mac") {
    await act(async () =>
      root.render(
        createElement(KeyboardShortcutsDialog, { platform, onClose }),
      ),
    );
  }

  function tab(platform: "mac" | "linux" | "windows") {
    return host.querySelector<HTMLButtonElement>(
      `[role=tab][id*='-${platform}-']`,
    )!;
  }

  function button(label: string) {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === label ||
        candidate.textContent?.trim() === label,
    );
    if (!result) throw new Error(`Missing shortcut control: ${label}`);
    return result;
  }

  function keys(label: string) {
    const row = [...host.querySelectorAll("dt")].find(
      (element) => element.textContent === label,
    );
    if (!row) throw new Error(`Missing shortcut row: ${label}`);
    return row.nextElementSibling!.querySelector("kbd")!.textContent!;
  }

  async function click(element: Element) {
    await act(async () =>
      element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  }

  async function key(key: string, extra: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    await act(async () => document.activeElement?.dispatchEvent(event));
    return event;
  }

  it("opens on the current OS and exposes an accessible, complete reference", async () => {
    await mount();
    const dialog = host.querySelector<HTMLElement>("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby")!)
        ?.textContent,
    ).toBe("Keyboard shortcuts");
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toContain("each platform");
    expect(
      host.querySelector("[role=tablist]")?.getAttribute("aria-label"),
    ).toBe("Shortcut platform");
    expect(tab("mac").getAttribute("aria-selected")).toBe("true");
    expect(tab("mac").textContent).toContain("Current");
    expect(document.activeElement).toBe(tab("mac"));
    expect(keys("Save")).toContain("⌘");
    expect(keys("Apply text changes")).toContain("⌘");
    expect(keys("Delete selected objects")).toBe("⌫ / Fn + ⌫");
    expect(keys("Bypass alignment guides while dragging")).toBe("Option");
    expect(keys("Insert a new line")).toBe("Enter");
    expect(keys("Next slide or build")).toContain("Page Down");
    expect(
      [...host.querySelectorAll("h3")].map((heading) => heading.textContent),
    ).toEqual([
      "File",
      "Editing",
      "Insert",
      "Slides",
      "Text",
      "Canvas",
      "Object order and locks",
      "View",
      "Presentation",
      "Help",
    ]);
    expect(host.querySelector("footer")?.textContent).toContain(
      "Tabs only change this reference",
    );
  });

  it("shows canonical Keynote-style Mac bindings and explains editing scope", async () => {
    await mount();
    expect(keys("Save as")).toBe("⌘+⌥+⇧+S");
    expect(keys("Group objects")).toBe("⌘+⌥+G");
    expect(keys("Ungroup objects")).toBe("⌘+⌥+⇧+G");
    expect(keys("Start presentation")).toBe("⌘+⌥+P");
    expect(keys("Export PDF")).toBe("⌘+⌥+⇧+P");
    expect(keys("Apply text changes")).toBe("⌘+Enter");
    expect(keys("End presentation")).toBe("Esc / Q");
    expect(keys("Add slide from a layout")).toBe("⌘+⇧+N");
    expect(keys("Insert equation")).toBe("⌘+⌥+E");
    expect(keys("Insert image, SVG or PDF")).toBe("⌘+⇧+V");
    expect(keys("Deselect all objects")).toBe("⌘+⇧+A");
    expect(keys("Lock selected objects")).toBe("⌘+L");
    expect(keys("Unlock selected objects")).toBe("⌘+⌥+L");
    expect(keys("Bring to front")).toBe("⌘+⇧+F");
    expect(keys("Send to back")).toBe("⌘+⇧+B");
    expect(keys("Bring forward one layer")).toBe("⌘+⌥+⇧+F");
    expect(keys("Send backward one layer")).toBe("⌘+⌥+⇧+B");
    expect(keys("Zoom in")).toBe("⌘+⇧+>");
    expect(keys("Zoom out")).toBe("⌘+⇧+<");
    expect(keys("Fit slide to window")).toBe("⌘+⌥+0");
    expect(keys("Next slide")).toBe("PageDown");
    expect(keys("Previous slide")).toBe("PageUp");
    expect(keys("First slide")).toBe("Home");
    expect(keys("Last slide")).toBe("End");
    expect(keys("Toggle bold on selected text objects")).toBe("⌘+B");
    expect(keys("Increase selected text size")).toBe("⌘++");
    expect(keys("Decrease selected text size")).toBe("⌘+-");
    expect(keys("Align selected text left")).toBe("⌘+⇧+{");
    expect(keys("Center selected text")).toBe("⌘+⇧+|");
    expect(keys("Align selected text right")).toBe("⌘+⇧+}");
    expect(keys("Add or remove objects from selection")).toContain("⌘ + click");
    expect(host.textContent).toContain("Fn + ↓ / ↑");
    expect(host.textContent).toContain("when a thumbnail has focus");
    expect(host.textContent).toContain("whole selected text objects");
    expect(host.textContent).toContain("⌘+Enter applies an inline text edit");
  });

  it.each(["linux", "windows"] as const)(
    "shows the supported presentation conventions for %s without Mac-only actions",
    async (platform) => {
      await mount("mac");
      await click(tab(platform));
      const rows = [...host.querySelectorAll("dt")].map(
        (row) => row.textContent,
      );
      expect(rows).not.toContain("Insert image, SVG or PDF");
      expect(rows).not.toContain("Deselect all objects");
      expect(rows).not.toContain("Lock selected objects");
      expect(rows).not.toContain("Unlock selected objects");
      expect(rows).not.toContain("Start presentation");
      expect(
        [...host.querySelectorAll("h3")].map((heading) => heading.textContent),
      ).toEqual([
        "File",
        "Editing",
        "Insert",
        "Slides",
        "Text",
        "Canvas",
        "Object order and locks",
        "View",
        "Presentation",
        "Help",
      ]);
      expect(keys("Save as")).toBe("Ctrl+Shift+S");
      expect(keys("Redo")).toBe("Ctrl+Y");
      expect(keys("Start from first slide")).toBe("F5");
      expect(keys("Start from current slide")).toBe("Shift+F5");
      expect(keys("Add slide from a layout")).toBe("Ctrl+M");
      expect(keys("Export PDF")).toBe("Ctrl+Alt+P");
      expect(keys("Keyboard shortcuts")).toBe("F1");
      expect(keys("Next slide")).toBe("PageDown");
      expect(keys("Previous slide")).toBe("PageUp");
      expect(keys("First slide")).toBe("Home");
      expect(keys("Last slide")).toBe("End");
      expect(keys("Toggle bold on selected text objects")).toBe("Ctrl+B");
      expect(keys("Align selected text left")).toBe("Ctrl+L");
      expect(keys("Center selected text")).toBe("Ctrl+E");
      expect(keys("Align selected text right")).toBe("Ctrl+R");
      expect(keys("Add or remove objects from selection")).toBe(
        "Shift + click",
      );
      expect(keys("Select slides in the slide navigator")).toBe("↑ / ↓");
      expect(keys("Delete slide in the slide navigator")).toBe(
        "Delete / Backspace",
      );
      expect(keys("Next slide or build")).toContain("Enter");
      expect(keys("Previous slide or build")).toContain("Backspace");
      expect(host.textContent).not.toContain("Fn + ↓ / ↑");
      expect(host.textContent).toContain("whole selected text objects");
      expect(host.textContent).toContain("when a thumbnail has focus");
      expect(host.textContent).toContain(
        "Ctrl+Enter applies an inline text edit",
      );
      await click(tab("mac"));
      expect(keys("Insert equation")).toBe("⌘+⌥+E");
      expect(keys("Start presentation")).toBe("⌘+⌥+P");
    },
  );

  it("shows PowerPoint object, equation, view and slide commands on Windows", async () => {
    await mount("windows");
    expect(keys("Duplicate selection or slide")).toBe("Ctrl+D");
    expect(keys("Duplicate current slide")).toBe("Ctrl+Shift+D");
    expect(keys("Insert equation")).toBe("Alt+=");
    expect(keys("Group objects")).toBe("Ctrl+G");
    expect(keys("Ungroup objects")).toBe("Ctrl+Shift+G");
    expect(keys("Bring forward one layer")).toBe("Ctrl+Shift+]");
    expect(keys("Send backward one layer")).toBe("Ctrl+Shift+[");
    expect(host.textContent).not.toContain("Bring to front");
    expect(host.textContent).not.toContain("Send to back");
    expect(keys("Zoom in")).toBe("Ctrl++");
    expect(keys("Zoom out")).toBe("Ctrl+-");
    expect(keys("Fit slide to window")).toBe("Ctrl+Alt+O");
    expect(keys("Increase selected text size")).toBe("Ctrl+Shift+>");
    expect(keys("Decrease selected text size")).toBe("Ctrl+Shift+<");
    expect(keys("Move focused slide up")).toBe("Ctrl+ArrowUp");
    expect(keys("Move focused slide down")).toBe("Ctrl+ArrowDown");
    expect(keys("Move focused slide to the beginning")).toBe(
      "Ctrl+Shift+ArrowUp",
    );
    expect(keys("Move focused slide to the end")).toBe("Ctrl+Shift+ArrowDown");
    expect(keys("Open presenter display")).toBe("Alt+F5");
    expect(keys("End presentation")).toBe("Esc");
    expect(keys("Next slide or build")).toContain(" / N");
    expect(keys("Previous slide or build")).toContain(" / P");
    expect(host.textContent).toContain("PowerPoint conventions");
  });

  it("shows Impress object, view and slide commands on Ubuntu with duplication scope", async () => {
    await mount("linux");
    expect(keys("Duplicate selection or slide")).toBe("Shift+F3");
    expect(host.textContent).not.toContain("Duplicate current slide");
    expect(keys("Insert equation")).toBe("Alt+Shift+E");
    expect(keys("Group objects")).toBe("Ctrl+Shift+G");
    expect(keys("Ungroup objects")).toBe("Ctrl+Alt+Shift+G");
    expect(keys("Bring forward one layer")).toBe("Ctrl+Num +");
    expect(keys("Send backward one layer")).toBe("Ctrl+-");
    expect(keys("Bring to front")).toBe("Ctrl+Shift+Num +");
    expect(keys("Send to back")).toBe("Ctrl+Shift+-");
    expect(keys("Zoom in")).toBe("+");
    expect(keys("Zoom out")).toBe("-");
    expect(keys("Fit slide to window")).toBe("Num *");
    expect(keys("Increase selected text size")).toBe("Ctrl+]");
    expect(keys("Decrease selected text size")).toBe("Ctrl+[");
    expect(keys("Move focused slide up")).toBe("Alt+Shift+PageUp");
    expect(keys("Move focused slide down")).toBe("Alt+Shift+PageDown");
    expect(keys("Move focused slide to the beginning")).toBe("Alt+Shift+Home");
    expect(keys("Move focused slide to the end")).toBe("Alt+Shift+End");
    expect(host.textContent).not.toContain("Open presenter display");
    expect(keys("End presentation")).toBe("Esc / -");
    expect(host.textContent).toContain("LibreOffice Impress conventions");
    expect(host.textContent).toContain("Use numeric-keypad +");
    expect(host.textContent).toContain("Ctrl+= and Ctrl+Shift+=");
    expect(host.textContent).toContain(
      "immediately duplicates the selection or slide",
    );
  });

  it("previews Windows and Ubuntu without changing the current operating system", async () => {
    await mount();
    await click(tab("windows"));
    expect(tab("windows").getAttribute("aria-selected")).toBe("true");
    expect(tab("windows").tabIndex).toBe(0);
    expect(tab("mac").tabIndex).toBe(-1);
    expect(keys("Save")).toContain("Ctrl");
    expect(keys("Redo")).toContain("Y");
    expect(keys("Delete selected objects")).toBe("Delete / Backspace");
    expect(keys("Bypass alignment guides while dragging")).toBe("Alt");
    expect(host.querySelector("footer")?.textContent).toContain(
      "Your shortcuts follow macOS",
    );
    expect(tab("mac").textContent).toContain("Current");
    expect(tab("windows").textContent).not.toContain("Current");
    await click(tab("linux"));
    expect(keys("Save")).toContain("Ctrl");
    expect(keys("Apply text changes")).toContain("Ctrl");
    expect(
      host.querySelector("[role=tabpanel]")?.getAttribute("aria-labelledby"),
    ).toBe(tab("linux").id);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("supports tab arrow, Home, and End navigation with roving focus", async () => {
    await mount("linux");
    expect(document.activeElement).toBe(tab("linux"));
    expect((await key("ArrowRight")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tab("windows"));
    expect(tab("windows").getAttribute("aria-selected")).toBe("true");
    await key("ArrowRight");
    expect(document.activeElement).toBe(tab("mac"));
    await key("ArrowLeft");
    expect(document.activeElement).toBe(tab("windows"));
    await key("Home");
    expect(document.activeElement).toBe(tab("mac"));
    await key("End");
    expect(document.activeElement).toBe(tab("windows"));
    expect(host.querySelector("footer")?.textContent).toContain(
      "Ubuntu / Linux",
    );
  });

  it("keeps focus inside the dialog and returns it to the opener", async () => {
    await mount();
    const first = button("Close keyboard shortcuts");
    const last = button("Done");
    first.focus();
    expect((await key("Tab", { shiftKey: true })).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect((await key("Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    opener.focus();
    expect((await key("Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape while respecting IME composition", async () => {
    await mount();
    expect((await key("Escape", { isComposing: true })).defaultPrevented).toBe(
      false,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect((await key("Escape")).defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes through Done, the close button, or the backdrop only", async () => {
    await mount();
    await click(host.querySelector("h2")!);
    expect(onClose).not.toHaveBeenCalled();
    await click(button("Done"));
    await click(button("Close keyboard shortcuts"));
    await click(host.querySelector(".keyboard-shortcuts-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
