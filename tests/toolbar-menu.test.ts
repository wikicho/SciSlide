// @vitest-environment jsdom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolbarMenu } from "../src/components/ToolbarMenu";
import { KeyboardShortcutsDialog } from "../src/components/KeyboardShortcutsDialog";

describe("toolbar disclosures", () => {
  let host: HTMLDivElement;
  let root: Root;
  const button = (name: string, props: object = {}) =>
    h("button", { key: name, ...props }, name);
  const menu = (
    label: string,
    children = [button("Open"), button("Save"), button("Print")],
    disabled = false,
  ) => h(ToolbarMenu, { label, disabled, children, key: label });
  const render = (...children: ReturnType<typeof h>[]) =>
    act(() => root.render(h("div", { role: "toolbar" }, ...children)));
  const summary = (label: string) =>
    host.querySelector<HTMLElement>(`summary[aria-label="${label} menu"]`)!;
  const panel = (label: string) =>
    host.querySelector<HTMLDivElement>(`[aria-label="${label} tools"]`)!;
  const action = (label: string, name: string) =>
    [...panel(label).querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === name,
    )!;
  const opened = (label: string) =>
    summary(label).parentElement!.hasAttribute("open");
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
  const click = (target: HTMLElement) => act(() => target.click());
  const focus = (target: HTMLElement) => act(() => target.focus());

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

  it("exposes disclosure state and enters the first or last available action", () => {
    render(
      menu("File", [
        button("Unavailable", { disabled: true }),
        button("Hidden", { hidden: true }),
        button("Open"),
        button("Save"),
      ]),
    );
    expect(panel("File").hidden).toBe(true);
    expect(summary("File").getAttribute("aria-controls")).toBe(
      panel("File").id,
    );
    focus(summary("File"));
    expect(key(summary("File"), "ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(action("File", "Open"));
    expect(summary("File").getAttribute("aria-expanded")).toBe("true");
    key(document.activeElement as HTMLElement, "Escape");
    expect(document.activeElement).toBe(summary("File"));
    expect(panel("File").hidden).toBe(true);
    key(summary("File"), "ArrowUp");
    expect(document.activeElement).toBe(action("File", "Save"));
  });

  it("cycles actions, supports Home/End and keeps navigation out of canvas handlers", () => {
    render(
      menu("File", [
        button("Open"),
        button("Unavailable", { disabled: true }),
        button("Save"),
        button("Print"),
      ]),
    );
    const canvas = vi.fn();
    window.addEventListener("keydown", canvas);
    try {
      key(summary("File"), "Enter");
      key(action("File", "Open"), "ArrowUp");
      expect(document.activeElement).toBe(action("File", "Print"));
      key(action("File", "Print"), "ArrowDown");
      expect(document.activeElement).toBe(action("File", "Open"));
      key(action("File", "Open"), "End");
      expect(document.activeElement).toBe(action("File", "Print"));
      key(action("File", "Print"), "Home");
      expect(document.activeElement).toBe(action("File", "Open"));
      expect(key(action("File", "Open"), "Enter").defaultPrevented).toBe(false);
      expect(key(action("File", "Open"), " ").defaultPrevented).toBe(false);
      focus(summary("File"));
      key(summary("File"), "Delete");
      key(summary("File"), "Backspace");
      key(summary("File"), "Escape");
      key(summary("File"), "Delete");
      expect(canvas).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", canvas);
    }
  });

  it("opens only one menu in a toolbar and navigates adjacent available menus", () => {
    render(
      menu("File"),
      menu("Unavailable", undefined, true),
      menu("Edit", [button("Undo"), button("Redo")]),
    );
    click(summary("File"));
    key(action("File", "Open"), "ArrowRight");
    expect(opened("File")).toBe(false);
    expect(opened("Unavailable")).toBe(false);
    expect(opened("Edit")).toBe(true);
    expect(document.activeElement).toBe(action("Edit", "Undo"));
    key(action("Edit", "Undo"), "ArrowRight");
    expect(opened("Edit")).toBe(false);
    expect(document.activeElement).toBe(action("File", "Open"));
    key(action("File", "Open"), "Escape");
    key(summary("File"), "ArrowLeft");
    expect(document.activeElement).toBe(summary("Edit"));
    expect(opened("Edit")).toBe(false);
    click(summary("Edit"));
    click(summary("File"));
    expect(opened("Edit")).toBe(false);
  });

  it("allows global function keys to prevent browser reload and use a visible return target", () => {
    render(menu("File"));
    const globalShortcut = vi.fn((event: KeyboardEvent) => {
      if (event.key === "F5") event.preventDefault();
    });
    window.addEventListener("keydown", globalShortcut);
    try {
      click(summary("File"));
      expect(key(action("File", "Open"), "F5").defaultPrevented).toBe(true);
      expect(opened("File")).toBe(false);
      expect(document.activeElement).toBe(summary("File"));
      key(summary("File"), "F1");
      expect(globalShortcut).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("keydown", globalShortcut);
    }
  });

  it("scopes mutual exclusion to each toolbar", () => {
    act(() =>
      root.render(
        h(
          "div",
          {},
          h("div", { role: "toolbar" }, menu("File")),
          h("div", { role: "toolbar" }, menu("View")),
        ),
      ),
    );
    // Pointer opening does not move focus, so both independent toolbars can stay open.
    act(() =>
      summary("File").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      ),
    );
    act(() =>
      summary("View").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      ),
    );
    expect(opened("File")).toBe(true);
    expect(opened("View")).toBe(true);
  });

  it("finds actions by a typed prefix and cycles repeated initial letters", () => {
    render(
      menu("File", [
        button("Open"),
        button("Copy"),
        button("Cut"),
        button("Save"),
        button("Save as"),
      ]),
    );
    click(summary("File"));
    key(action("File", "Open"), "s");
    expect(document.activeElement).toBe(action("File", "Save"));
    key(action("File", "Save"), "a");
    expect(document.activeElement).toBe(action("File", "Save as"));
    key(action("File", "Save as"), "c");
    expect(document.activeElement).toBe(action("File", "Copy"));
    key(action("File", "Copy"), "c");
    expect(document.activeElement).toBe(action("File", "Cut"));
    expect(
      key(action("File", "Cut"), "s", { ctrlKey: true }).defaultPrevented,
    ).toBe(false);
    expect(
      key(action("File", "Cut"), "ArrowDown", { isComposing: true })
        .defaultPrevented,
    ).toBe(false);
    expect(document.activeElement).toBe(action("File", "Cut"));
  });

  it("restores focus after an action but preserves a dialog's chosen focus", () => {
    const called = vi.fn();
    render(
      menu("File", [
        button("Save", { onClick: called }),
        button("Open dialog", {
          onClick: () => host.querySelector<HTMLInputElement>("input")!.focus(),
        }),
      ]),
      h("input", { "aria-label": "Dialog field" }),
    );
    click(summary("File"));
    click(action("File", "Save"));
    expect(called).toHaveBeenCalledOnce();
    expect(opened("File")).toBe(false);
    expect(document.activeElement).toBe(summary("File"));
    click(summary("File"));
    click(action("File", "Open dialog"));
    expect(opened("File")).toBe(false);
    expect(document.activeElement).toBe(host.querySelector("input"));
  });

  it("returns to the trigger after opening and closing a real modal that disables the toolbar", () => {
    function Fixture() {
      const [help, setHelp] = useState(false);
      return h(
        "div",
        {},
        h(
          "fieldset",
          { role: "toolbar", disabled: help },
          menu(
            "File",
            [button("Help", { onClick: () => setHelp(true) })],
            help,
          ),
        ),
        help &&
          h(KeyboardShortcutsDialog, {
            platform: "linux",
            onClose: () => setHelp(false),
          }),
      );
    }
    act(() => root.render(h(Fixture)));
    click(summary("File"));
    click(action("File", "Help"));
    expect(
      host.querySelector("[role=dialog]")?.contains(document.activeElement),
    ).toBe(true);
    key(document.activeElement as HTMLElement, "Escape");
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(summary("File"));
  });

  it("lets Tab leave naturally and closes on outside pointer or focus without stealing focus", () => {
    render(menu("File"), h("input", { "aria-label": "Outside" }));
    const outside = host.querySelector<HTMLInputElement>("input")!;
    click(summary("File"));
    expect(key(action("File", "Open"), "Tab").defaultPrevented).toBe(false);
    focus(outside);
    expect(opened("File")).toBe(false);
    expect(document.activeElement).toBe(outside);
    click(summary("File"));
    act(() =>
      outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    );
    focus(outside);
    expect(opened("File")).toBe(false);
    expect(document.activeElement).toBe(outside);
  });

  it("preserves native input keys and supports persistent menu controls", () => {
    render(
      menu("View", [
        button("Toggle grid", { "data-keep-open": true }),
        h("input", { key: "search", "aria-label": "Search" }),
        button("Done"),
      ]),
    );
    click(summary("View"));
    click(action("View", "Toggle grid"));
    expect(opened("View")).toBe(true);
    const input = panel("View").querySelector("input")!;
    focus(input);
    for (const value of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "a",
      "Enter",
    ])
      expect(key(input, value).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    key(input, "Escape");
    expect(opened("View")).toBe(false);
    expect(document.activeElement).toBe(summary("View"));
  });

  it("keeps disabled triggers out of Tab order and moves focus out of a disabled open menu", () => {
    render(menu("File", undefined, true), menu("Edit"));
    expect(summary("File").tabIndex).toBe(-1);
    click(summary("File"));
    key(summary("File"), "Enter");
    expect(opened("File")).toBe(false);
    render(menu("File"), menu("Edit"));
    click(summary("File"));
    expect(document.activeElement).toBe(action("File", "Open"));
    render(menu("File", undefined, true), menu("Edit"));
    expect(opened("File")).toBe(false);
    expect(document.activeElement).toBe(summary("Edit"));
  });

  it("positions a bottom-right popup inside the viewport and updates it on resize", () => {
    render(menu("File"));
    Object.defineProperty(panel("File"), "scrollHeight", {
      configurable: true,
      value: 300,
    });
    vi.spyOn(summary("File"), "getBoundingClientRect").mockReturnValue({
      left: 1000,
      top: 700,
      bottom: 730,
    } as DOMRect);
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);
    click(summary("File"));
    expect(panel("File").style.left).toBe("776px");
    expect(panel("File").style.top).toBe("392px");
    vi.stubGlobal("innerWidth", 320);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(panel("File").style.left).toBe("72px");
    expect(panel("File").style.maxWidth).toBe("296px");
  });
});
