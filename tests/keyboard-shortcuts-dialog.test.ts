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
    return row.nextElementSibling!.textContent!;
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
    ).toEqual(["File", "Editing", "Text", "Canvas", "Presentation", "Help"]);
    expect(host.querySelector("footer")?.textContent).toContain(
      "Tabs only change this reference",
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
