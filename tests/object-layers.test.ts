// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectLayers } from "../src/components/ObjectLayers";
import type { ObjectLayersProps } from "../src/components/ObjectLayers";
import { shapeFromDrag } from "../src/lib/drawing";
import type { SlideObject } from "../src/lib/model";

function object(name: string) {
  return { ...shapeFromDrag("rect", { x: 0, y: 0 }, { x: 100, y: 80 }), name };
}

describe("object and layer panel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: ObjectLayersProps;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      objects: [],
      selected: [],
      onSelect: vi.fn(),
      onRename: vi.fn(),
      onVisibility: vi.fn(),
      onLock: vi.fn(),
      onMove: vi.fn(),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function render(objects: SlideObject[], selected: string[] = []) {
    props.objects = objects;
    props.selected = selected;
    await act(async () => root.render(createElement(ObjectLayers, props)));
  }

  function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    );
    if (!found) throw new Error(`Missing layer control: ${label}`);
    return found;
  }

  async function click(label: string, shiftKey = false) {
    await act(async () =>
      button(label).dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey }),
      ),
    );
  }

  it("lists frontmost objects first and makes hidden group members selectable", async () => {
    const a = object("Plot");
    const b = object("Annotation");
    const c = object("Hidden label");
    b.groupId = c.groupId = "labels";
    c.visible = false;
    await render([a, b, c]);
    expect(
      [...host.querySelectorAll(".object-layer-select strong")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Hidden label", "Annotation", "Plot"]);
    expect(button("Select Hidden label").textContent).toContain(
      "Group · 2 objects · Hidden",
    );
    await click("Select Hidden label");
    expect(props.onSelect).toHaveBeenCalledWith([b.id, c.id]);
    expect(host.querySelector("button button")).toBeNull();
  });

  it("adds or removes complete groups with Shift-click", async () => {
    const a = object("Plot");
    const b = object("Annotation");
    const c = object("Caption");
    b.groupId = c.groupId = "pair";
    await render([a, b, c], [a.id]);
    await click("Select Annotation", true);
    expect(props.onSelect).toHaveBeenLastCalledWith([a.id, b.id, c.id]);
    await render([a, b, c], [a.id, b.id]);
    expect(button("Select Caption").getAttribute("aria-pressed")).toBe("true");
    await click("Select Caption", true);
    expect(props.onSelect).toHaveBeenLastCalledWith([a.id]);
  });

  it("renames by keyboard and dispatches individual visibility and lock controls", async () => {
    const a = object("Plot");
    await render([a]);
    await click("Hide Plot");
    expect(props.onVisibility).toHaveBeenCalledWith(a.id, false);
    await click("Lock Plot");
    expect(props.onLock).toHaveBeenCalledWith(a.id, true);
    await click("Rename Plot");
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Updated plot");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(props.onRename).toHaveBeenCalledOnce();
    expect(props.onRename).toHaveBeenCalledWith(a.id, "Updated plot");
    expect(host.querySelector("input")).toBeNull();
  });

  it("protects locked groups from movement while retaining access to unlocking members", async () => {
    const a = object("Background");
    const b = object("Plot");
    const c = object("Caption");
    b.groupId = c.groupId = "locked";
    c.locked = true;
    await render([a, b, c]);
    expect(button("Move Plot forward").disabled).toBe(true);
    expect(button("Move Plot backward").disabled).toBe(true);
    expect(button("Lock Plot").title).toContain(
      "locked by another group member",
    );
    await click("Unlock Caption");
    expect(props.onLock).toHaveBeenCalledWith(c.id, false);
    c.locked = false;
    await render([a, b, c]);
    expect(button("Move Plot forward").disabled).toBe(true);
    expect(button("Move Plot backward").disabled).toBe(false);
    await click("Move Plot backward");
    expect(props.onMove).toHaveBeenCalledWith(b.id, "down");
  });

  it("shows a useful empty state", async () => {
    await render([]);
    expect(host.textContent).toContain("Add an object");
    expect(host.querySelector("ul")).toBeNull();
  });
});
