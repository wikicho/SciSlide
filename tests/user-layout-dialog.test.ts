// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserLayoutDialog } from "../src/components/UserLayoutDialog";
import { SlideTemplateDialog } from "../src/components/SlideTemplateDialog";
import { createBlankSlide, createDemoDeck, type Deck } from "../src/lib/model";
import {
  captureUserSlideLayout,
  type UserSlideLayout,
} from "../src/lib/user-layouts";

vi.mock("../src/components/SlideScene", () => ({
  SlideScene: ({
    deck,
    slide,
  }: {
    deck: Deck;
    slide: Deck["slides"][number];
  }) =>
    createElement("svg", {
      className: "slide-scene",
      viewBox: `0 0 ${deck.slideSize.width} ${deck.slideSize.height}`,
      "aria-label": slide.title,
    }),
}));

describe("user layout management and template selection", () => {
  let root: Root,
    host: HTMLDivElement,
    opener: HTMLButtonElement,
    deck: Deck,
    entry: UserSlideLayout;
  let save: ReturnType<typeof vi.fn>,
    remove: ReturnType<typeof vi.fn>,
    edit: ReturnType<typeof vi.fn>,
    close: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    deck = { ...createDemoDeck(), slides: [createBlankSlide()], assets: [] };
    deck.slides[0].title = "Current canvas";
    entry = captureUserSlideLayout(deck, deck.slides[0], "Saved results");
    save = vi.fn();
    remove = vi.fn();
    edit = vi.fn();
    close = vi.fn();
    host = document.createElement("div");
    opener = document.createElement("button");
    document.body.append(opener, host);
    opener.focus();
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    opener.remove();
    vi.unstubAllGlobals();
  });
  async function render(
    options: Partial<Parameters<typeof UserLayoutDialog>[0]> = {},
  ) {
    await act(async () =>
      root.render(
        createElement(UserLayoutDialog, {
          deck,
          slide: deck.slides[0],
          entries: [entry],
          onSave: save,
          onDelete: remove,
          onEdit: edit,
          onClose: close,
          ...options,
        }),
      ),
    );
  }
  function button(label: string) {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) =>
        item.getAttribute("aria-label") === label ||
        item.textContent?.trim() === label,
    );
    if (!result) throw new Error(`Missing button ${label}`);
    return result;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function name(value: string) {
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Layout name"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function key(key: string, shiftKey = false) {
    const event = new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    await act(async () =>
      (
        document.activeElement ?? host.querySelector('[role="dialog"]')!
      ).dispatchEvent(event),
    );
    return event;
  }

  it("saves the current canvas under a name and offers updating only for the explicitly edited saved layout", async () => {
    const before = structuredClone(deck);
    await render({ editingLayoutId: entry.id });
    expect(document.activeElement).toBe(host.querySelector("input"));
    await name(" Revised layout ");
    await click(`Update ${entry.name}`);
    expect(save).toHaveBeenCalledExactlyOnceWith("Revised layout", entry.id);
    expect(deck).toEqual(before);
    await click("Save as new layout");
    expect(save).toHaveBeenLastCalledWith("Revised layout", undefined);
    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "does not change slides already created",
    );
  });

  it("delegates editing a copy and requires a separate confirmation before deletion", async () => {
    await render();
    await click(`Edit ${entry.name} layout`);
    expect(edit).toHaveBeenCalledExactlyOnceWith(entry.id);
    expect(save).not.toHaveBeenCalled();
    await click(`Delete ${entry.name} layout`);
    expect(remove).not.toHaveBeenCalled();
    await click("Cancel deletion");
    expect(remove).not.toHaveBeenCalled();
    await click(`Delete ${entry.name} layout`);
    await click("Delete saved layout");
    expect(remove).toHaveBeenCalledExactlyOnceWith(entry.id);
    expect(deck.slides).toHaveLength(1);
  });

  it("retains the editor and explains a storage failure without reporting a successful save", async () => {
    save.mockRejectedValueOnce(new Error("Layout storage is full"));
    await render();
    await click("Save as new layout");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Layout storage is full",
    );
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    await name("  ");
    await click("Save as new layout");
    expect(save).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter a name",
    );
  });

  it("traps enabled controls, blocks Escape while busy, and restores the opener after closing", async () => {
    await render();
    const controls = [...host.querySelectorAll<HTMLElement>("button,input")];
    await act(async () => controls[0].focus());
    expect((await key("Tab", true)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls.at(-1));
    expect((await key("Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(controls[0]);
    await render({ busy: true });
    expect(
      [...host.querySelectorAll<HTMLButtonElement>("button")].every(
        (item) => item.disabled,
      ),
    ).toBe(true);
    await key("Escape");
    expect(close).not.toHaveBeenCalled();
    await render();
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it("keeps differently sized layouts visible but disables editing and insertion into the wrong canvas", async () => {
    entry.slideSize = { width: 900, height: 1600, unit: "px96" };
    await render();
    expect(button(`Edit ${entry.name} layout`).disabled).toBe(true);
    const choose = vi.fn();
    await act(async () =>
      root.render(
        createElement(SlideTemplateDialog, {
          deck,
          userLayouts: [entry],
          onChoose: vi.fn(),
          onChooseUserLayout: choose,
          onClose: close,
        }),
      ),
    );
    const card = button(`Use ${entry.name} user layout`);
    expect(card.disabled).toBe(true);
    expect(card.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 900 1600",
    );
    await click(`Use ${entry.name} user layout`);
    expect(choose).not.toHaveBeenCalled();
  });

  it("adds saved layouts to the existing picker without replacing built-in callbacks", async () => {
    const choose = vi.fn(),
      builtIn = vi.fn(),
      manage = vi.fn();
    await act(async () =>
      root.render(
        createElement(SlideTemplateDialog, {
          deck,
          userLayouts: [entry],
          onChoose: builtIn,
          onChooseUserLayout: choose,
          onManageUserLayouts: manage,
          onClose: close,
        }),
      ),
    );
    await click(`Use ${entry.name} user layout`);
    expect(choose).toHaveBeenCalledExactlyOnceWith(entry.id);
    expect(builtIn).not.toHaveBeenCalled();
    await click("Blank slide");
    expect(builtIn).toHaveBeenCalledExactlyOnceWith("blank");
    await click("Manage user layouts");
    expect(manage).toHaveBeenCalledOnce();
  });
});
