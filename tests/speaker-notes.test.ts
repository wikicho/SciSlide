// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakerNotes } from "../src/components/SpeakerNotes";

describe("responsive speaker notes", () => {
  let host: HTMLDivElement;
  let root: Root;
  let change: ReturnType<typeof vi.fn>;
  let geometry: {
    parent: number;
    heading: number;
    footer: number;
    toggle: number;
    viewportMinimum: number;
    viewportActual: number;
  };
  const observers: {
    callback: ResizeObserverCallback;
    targets: Set<Element>;
    disconnected: boolean;
  }[] = [];
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    geometry = {
      parent: 700,
      heading: 56,
      footer: 38,
      toggle: 42,
      viewportMinimum: 80,
      viewportActual: 450,
    };
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        record: (typeof observers)[number];
        constructor(callback: ResizeObserverCallback) {
          this.record = { callback, targets: new Set(), disconnected: false };
          observers.push(this.record);
        }
        observe(target: Element) {
          this.record.targets.add(target);
        }
        disconnect() {
          this.record.disconnected = true;
        }
      },
    );
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
      function () {
        return this.classList.contains("editor-area")
          ? geometry.parent
          : this.classList.contains("canvas-viewport")
            ? geometry.viewportActual
            : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function () {
        return this.classList.contains("canvas-heading")
          ? geometry.heading
          : this.classList.contains("canvas-footer")
            ? geometry.footer
            : this.classList.contains("notes-toggle")
              ? geometry.toggle
              : 0;
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          paddingTop: "0px",
          paddingBottom: "0px",
          borderTopWidth: element.classList.contains("speaker-notes")
            ? "1px"
            : "0px",
          borderBottomWidth: "0px",
          minHeight: element.classList.contains("canvas-viewport")
            ? `${geometry.viewportMinimum}px`
            : "0px",
        }) as CSSStyleDeclaration,
    );
    change = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function mount(layout = true) {
    const notes = h(SpeakerNotes, {
      value: "Keep this reminder 한글",
      onChange: change,
    });
    await act(async () =>
      root.render(
        layout
          ? h(
              "main",
              { className: "editor-area" },
              h("div", { className: "canvas-heading" }),
              h("div", { className: "canvas-viewport" }),
              h("div", { className: "canvas-footer" }),
              notes,
            )
          : notes,
      ),
    );
  }
  const toggle = () => host.querySelector<HTMLButtonElement>(".notes-toggle")!;
  const content = () => host.querySelector<HTMLDivElement>(".notes-content")!;
  const handle = () => host.querySelector<HTMLElement>("[role=separator]")!;
  const field = () => host.querySelector<HTMLTextAreaElement>("textarea")!;
  async function click() {
    await act(async () => toggle().click());
  }
  async function key(value: string, shiftKey = false) {
    await act(async () =>
      handle().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  }
  async function resize() {
    await act(async () => {
      for (const observer of observers.filter((item) => !item.disconnected))
        observer.callback([], observer as unknown as ResizeObserver);
    });
  }
  function range(min: number, max: number, value: number) {
    expect(handle().getAttribute("aria-valuemin")).toBe(String(min));
    expect(handle().getAttribute("aria-valuemax")).toBe(String(max));
    expect(handle().getAttribute("aria-valuenow")).toBe(String(value));
    expect(content().style.height).toBe(`${value}px`);
  }

  it("preserves the standalone resize range and preferred height across collapse and reopen", async () => {
    await mount(false);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await click();
    range(90, 320, 140);
    await key("ArrowUp");
    range(90, 320, 150);
    await key("End");
    range(90, 320, 320);
    await click();
    expect(content().hidden).toBe(true);
    await click();
    range(90, 320, 320);
    expect(field().value).toBe("Keep this reminder 한글");
    expect(change).not.toHaveBeenCalled();
  });

  it("uses the remaining parent budget, including the toggle and border, below the usual minimum", async () => {
    geometry.parent = 280;
    await mount();
    await click();
    range(63, 63, 63);
    await key("End");
    geometry.parent = 250;
    await resize();
    range(33, 33, 33);
    geometry.parent = 700;
    await resize();
    range(90, 320, 140);
    expect(change).not.toHaveBeenCalled();
  });

  it("restores the user's larger preference after shrinking, reopening and growing the window", async () => {
    await mount();
    await click();
    await key("End");
    geometry.parent = 300;
    await resize();
    range(83, 83, 83);
    await click();
    await click();
    range(83, 83, 83);
    geometry.parent = 700;
    await resize();
    range(90, 320, 320);
    await key("Home");
    geometry.parent = 250;
    await resize();
    range(33, 33, 33);
    geometry.parent = 700;
    await resize();
    range(90, 320, 90);
    expect(field().value).toBe("Keep this reminder 한글");
    expect(change).not.toHaveBeenCalled();
  });

  it("recomputes fixed control and CSS minimum changes without observing the dynamic canvas height", async () => {
    geometry.parent = 400;
    await mount();
    await click();
    range(90, 183, 140);
    geometry.heading = 100;
    await resize();
    range(90, 139, 139);
    geometry.footer = 60;
    geometry.toggle = 50;
    await resize();
    range(90, 109, 109);
    geometry.viewportMinimum = 110;
    await act(async () => window.dispatchEvent(new Event("resize")));
    range(79, 79, 79);
    geometry.viewportActual = 12;
    await resize();
    range(79, 79, 79);
    const active = observers.find((item) => !item.disconnected)!;
    expect([...active.targets].map((target) => target.className)).toEqual([
      "editor-area",
      "canvas-heading",
      "canvas-footer",
      "notes-toggle",
    ]);
    expect(change).not.toHaveBeenCalled();
  });

  it("reaches a zero body budget without padding overflow or changing notes", async () => {
    geometry.parent = 200;
    await mount();
    await click();
    range(0, 0, 0);
    expect(content().hidden).toBe(true);
    expect(field().disabled).toBe(true);
    expect(content().style.paddingBottom).toBe("0px");
    expect(content().style.overflow).toBe("hidden");
    await key("ArrowUp", true);
    geometry.parent = 700;
    await resize();
    range(90, 320, 140);
    expect(field().value).toBe("Keep this reminder 한글");
    expect(change).not.toHaveBeenCalled();
  });

  it("moves a focused field to the toggle before a zero budget hides it, then restores keyboard access and the preference", async () => {
    await mount();
    await click();
    await key("End");
    await act(async () => field().focus());
    expect(document.activeElement).toBe(field());
    geometry.parent = 200;
    await resize();
    range(0, 0, 0);
    expect(content().hidden).toBe(true);
    expect(field().disabled).toBe(true);
    expect(document.activeElement).toBe(toggle());
    await act(async () => field().focus());
    expect(document.activeElement).toBe(toggle());
    expect(field().value).toBe("Keep this reminder 한글");
    geometry.parent = 700;
    await resize();
    range(90, 320, 320);
    expect(content().hidden).toBe(false);
    expect(field().disabled).toBe(false);
    expect(document.activeElement).toBe(toggle());
    await act(async () => field().focus());
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe("Keep this reminder 한글");
    expect(change).not.toHaveBeenCalled();
  });

  it("keeps outside focus through a zero budget and later growth", async () => {
    await mount();
    await click();
    const outside = document.createElement("input");
    host.append(outside);
    await act(async () => outside.focus());
    geometry.parent = 200;
    await resize();
    expect(content().hidden).toBe(true);
    expect(field().disabled).toBe(true);
    expect(document.activeElement).toBe(outside);
    geometry.parent = 700;
    await resize();
    range(90, 320, 140);
    expect(content().hidden).toBe(false);
    expect(field().disabled).toBe(false);
    expect(document.activeElement).toBe(outside);
    expect(field().value).toBe("Keep this reminder 한글");
    expect(change).not.toHaveBeenCalled();
  });
});
