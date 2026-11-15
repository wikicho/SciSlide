// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionSummary } from "../src/components/SelectionSummary";
import { shapeFromDrag } from "../src/lib/drawing";
import type { SlideObject } from "../src/lib/model";

function object(id: string, name = id): SlideObject {
  return {
    ...shapeFromDrag("rect", { x: 10, y: 10 }, { x: 80, y: 80 }),
    id,
    name,
  };
}

describe("multiple selection summary", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onArrange: ReturnType<typeof vi.fn<() => void>>;
  let onEdit: ReturnType<typeof vi.fn<(id: string) => void>>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onArrange = vi.fn();
    onEdit = vi.fn();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  async function render(objects: SlideObject[], arranging = false) {
    await act(async () =>
      root.render(
        createElement(SelectionSummary, {
          objects,
          arranging,
          onArrange,
          onEdit,
        }),
      ),
    );
  }
  function button(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing selection action: ${label}`);
    return found;
  }

  it("explains group, effective lock, and hidden states without showing individual fields", async () => {
    const first = object("first");
    const second = object("second");
    const third = object("third");
    first.groupId = second.groupId = "one-group";
    second.locked = true;
    third.visible = false;
    await render([first, second, third]);
    expect(
      host.querySelector('section[aria-label="Selected objects"]'),
    ).toBeTruthy();
    expect(host.querySelector("h3")?.textContent?.trim()).toBe(
      "3 objects selected",
    );
    expect(host.querySelector(".selection-summary-status")?.textContent).toBe(
      "1 group · 1 unlocked · 2 locked · 1 hidden",
    );
    expect(host.textContent).toContain(
      "Choose one object to edit its style, or arrange the selection together.",
    );
    expect(host.querySelector("input,textarea,select")).toBeNull();
    expect(host.querySelector("details")?.open).toBe(false);
  });

  it("routes Arrange selection to the parent without editing or mutating an object", async () => {
    const objects = [object("first"), object("second")];
    const before = structuredClone(objects);
    await render(objects);
    await act(async () => button("Arrange selection").click());
    expect(onArrange).toHaveBeenCalledOnce();
    expect(onEdit).not.toHaveBeenCalled();
    expect(objects).toEqual(before);
    expect(host.querySelector(".selection-summary-status")?.textContent).toBe(
      "Ungrouped · 2 unlocked · All visible",
    );
  });

  it("opens the style of the requested group member by ID, including hidden or locked members", async () => {
    const first = object("plot", "Plot");
    const second = object("annotation", "Annotation");
    first.groupId = second.groupId = "one-group";
    second.visible = false;
    second.locked = true;
    const objects = [first, second];
    const before = structuredClone(objects);
    await render(objects);
    await act(async () => host.querySelector("summary")!.click());
    expect(host.querySelector("details")?.open).toBe(true);
    await act(async () => button("Edit Annotation").click());
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("annotation");
    expect(onArrange).not.toHaveBeenCalled();
    expect(
      host.querySelector('[data-object-id="annotation"] small')?.textContent,
    ).toBe("Shape · Grouped · Locked · Hidden");
    expect(objects).toEqual(before);
  });

  it("describes the scope of existing Arrange tools and retains individual style entry points", async () => {
    await render([object("plot", "Plot"), object("frame", "Frame")], true);
    expect(host.querySelector("section")?.getAttribute("data-mode")).toBe(
      "arrange",
    );
    expect(host.textContent).toContain(
      "Arrange tools below apply to all unlocked selected objects",
    );
    expect(
      [...host.querySelectorAll("button")].some(
        (candidate) => candidate.textContent?.trim() === "Arrange selection",
      ),
    ).toBe(false);
    await act(async () => button("Edit Plot").click());
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("plot");
  });

  it("uses an accessible fallback for unnamed objects and natural singular wording", async () => {
    await render([object("unnamed", "")]);
    expect(host.querySelector("h3")?.textContent?.trim()).toBe(
      "1 object selected",
    );
    await act(async () => button("Edit Untitled object").click());
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("unnamed");
  });
});
