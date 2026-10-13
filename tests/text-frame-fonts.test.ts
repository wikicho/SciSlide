// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideScene } from "../src/components/SlideScene";
import { createThemeDeck } from "../src/lib/deck-themes";
import type { TextObject } from "../src/lib/model";

let glyphWidth = 10;

describe("text frames after font loading", () => {
  let host: HTMLDivElement;
  let root: Root;
  let fonts: EventTarget;
  let ready: () => void;
  const onMetrics = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    glyphWidth = 10;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (value: string) => ({
        width: [...value].length * glyphWidth,
      }),
    } as CanvasRenderingContext2D);
    fonts = new EventTarget();
    Object.defineProperty(fonts, "ready", {
      value: new Promise<void>((resolve) => {
        ready = resolve;
      }),
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    });
    onMetrics.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(document, "fonts");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    const object: TextObject = {
      id: "font-loading-text",
      type: "text",
      name: "Font loading text",
      text: "one two three",
      transform: { x: 100, y: 150, width: 160, height: 26, rotation: 0 },
      opacity: 1,
      visible: true,
      locked: false,
      metadata: {},
      fontFamily: "Inter",
      fontWeight: 400,
      fontSize: 20,
      color: "#17263c",
      align: "left",
    };
    const deck = createThemeDeck("keynote-white");
    deck.pageNumbers = undefined;
    deck.slides[0].objects = [object];
    await act(async () =>
      root.render(
        createElement(SlideScene, {
          deck,
          slide: deck.slides[0],
          selected: [object.id],
          onPointer: () => undefined,
          onMetrics,
        }),
      ),
    );
    return object;
  }

  function expectFrame(lines: number, height: number) {
    expect(host.querySelectorAll(".canvas-object > text > tspan")).toHaveLength(
      lines,
    );
    for (const rectangle of host.querySelectorAll(
      '.selection > rect[fill="none"], .canvas-object > rect[fill="transparent"]',
    )) {
      expect(Number(rectangle.getAttribute("height"))).toBe(height);
    }
    expect(onMetrics).toHaveBeenLastCalledWith(
      "font-loading-text",
      160,
      height,
    );
  }

  it("recomputes wrapping and selection height after fonts become ready and later loads finish", async () => {
    const object = await render();
    const original = structuredClone(object);
    expectFrame(1, 26);
    glyphWidth = 20;
    await act(async () => ready());
    expectFrame(2, 52);
    glyphWidth = 10;
    await act(async () => fonts.dispatchEvent(new Event("loadingdone")));
    expectFrame(1, 26);
    expect(object).toEqual(original);
  });

  it("supports font sets that only expose the ready promise", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: (fonts as EventTarget & { ready: Promise<void> }).ready },
    });
    const object = await render();
    glyphWidth = 20;
    await act(async () => ready());
    expectFrame(2, 52);
    expect(object.transform.height).toBe(26);
  });
});
