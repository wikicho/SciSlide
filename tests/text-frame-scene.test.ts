// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideScene } from "../src/components/SlideScene";
import { createThemeDeck } from "../src/lib/deck-themes";
import * as equations from "../src/lib/equations";
import type { TextObject } from "../src/lib/model";

function textObject(source: string): TextObject {
  return {
    id: "growing-text",
    type: "text",
    name: "Growing text",
    text: source,
    transform: { x: 100, y: 150, width: 160, height: 26, rotation: 18 },
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
}

describe("text frames follow their displayed content", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onMetrics = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        const context = {
          font: "",
          measureText(value: string) {
            const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 20);
            return { width: [...value].length * size * 0.5 };
          },
        };
        return context as unknown as CanvasRenderingContext2D;
      },
    );
    onMetrics.mockClear();
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

  async function render(object: TextObject) {
    const deck = createThemeDeck("keynote-white");
    deck.pageNumbers = undefined;
    deck.slides[0].objects = [object];
    await act(async () => {
      root.render(
        createElement(SlideScene, {
          deck,
          slide: deck.slides[0],
          selected: [object.id],
          onPointer: () => undefined,
          onMetrics,
        }),
      );
    });
  }

  function frame() {
    const selection = host.querySelector<SVGRectElement>(".selection > rect");
    const hit = host.querySelector<SVGRectElement>(
      '.canvas-object > rect[fill="transparent"]',
    );
    if (!selection || !hit)
      throw new Error("Missing text selection or hit frame");
    return { selection, hit, group: selection.parentElement!.parentElement! };
  }

  function expectFrame(object: TextObject, height: number) {
    const { selection, hit, group } = frame();
    for (const rectangle of [selection, hit]) {
      expect(Number(rectangle.getAttribute("height"))).toBeCloseTo(height);
      expect(Number(rectangle.getAttribute("width"))).toBe(
        object.transform.width,
      );
    }
    const { x, y, width, rotation } = object.transform;
    // Overflow enlarges the editing frame without moving already rendered
    // content around a new rotation center or diverging from SVG exports.
    expect(group.getAttribute("transform")).toBe(
      `translate(${x} ${y}) rotate(${rotation} ${width / 2} ${object.transform.height / 2})`,
    );
    expect(onMetrics).toHaveBeenLastCalledWith(
      object.id,
      object.transform.width,
      height,
    );
  }

  it.each<[string, number]>([
    ["First\nSecond", 2],
    ["First\nSecond\n", 3],
    ["First\n\nSecond", 3],
  ])(
    "includes all displayed lines of %j in its frame",
    async (source, lines) => {
      const object = textObject(source);
      await render(object);
      expect(
        host.querySelectorAll(".canvas-object > text > tspan"),
      ).toHaveLength(lines);
      expectFrame(object, lines * object.fontSize * 1.3);
      expect(object.transform.height).toBe(26);
    },
  );

  it("retains a manually enlarged frame when text needs less height", async () => {
    const object = textObject("Short");
    object.transform.height = 140;
    await render(object);
    expectFrame(object, 140);
  });

  it("recalculates its selection and hit area when its width narrows and widens", async () => {
    const original = textObject("one two three");
    await render(original);
    expectFrame(original, 26);
    const narrow = {
      ...original,
      transform: { ...original.transform, width: 50 },
    };
    await render(narrow);
    expect(host.querySelectorAll(".canvas-object > text > tspan")).toHaveLength(
      3,
    );
    expectFrame(narrow, 78);
    await render(original);
    expect(host.querySelectorAll(".canvas-object > text > tspan")).toHaveLength(
      1,
    );
    expectFrame(original, 26);
  });

  it("recalculates wrapping and frame height when the font size changes", async () => {
    const original = textObject("one two three");
    await render(original);
    expectFrame(original, 26);
    const larger = { ...original, fontSize: 40 };
    await render(larger);
    expect(host.querySelectorAll(".canvas-object > text > tspan")).toHaveLength(
      2,
    );
    expectFrame(larger, 104);
  });

  it("uses actual tall inline equation layout, including empty and trailing lines", async () => {
    vi.spyOn(equations, "renderEquation").mockResolvedValue({
      width: 40,
      height: 130,
      baseline: 95,
      svg: '<svg width="40" height="130"><path d="M0 0L1 1"/></svg>',
    });
    const object = textObject("A $\\frac{1}{2}$\n\nB\n");
    object.fontSize = 40;
    await render(object);
    expect(host.querySelectorAll("[data-inline-math-line]")).toHaveLength(4);
    const fraction = host.querySelector<SVGGElement>(
      "[data-inline-math-fragment]",
    );
    expect(fraction?.getAttribute("transform")).toBe("translate(40 0)");
    expectFrame(object, 130 + 3 * 52);
    expect(object.transform.height).toBe(26);
  });

  it("replaces inline math measurements after the current width or source changes", async () => {
    vi.spyOn(equations, "renderEquation").mockResolvedValue({
      width: 40,
      height: 44,
      baseline: 32,
      svg: '<svg width="40" height="44"><path d="M0 0L1 1"/></svg>',
    });
    const original = { ...textObject("A $x$ B"), fontSize: 40 };
    await render(original);
    expectFrame(original, 52);
    const narrow = {
      ...original,
      transform: { ...original.transform, width: 70 },
    };
    await render(narrow);
    expect(host.querySelectorAll("[data-inline-math-line]")).toHaveLength(3);
    expectFrame(narrow, 156);
    await render(original);
    expectFrame(original, 52);
    const plain = { ...original, text: "A" };
    await render(plain);
    expect(host.querySelector("[data-inline-math]")).toBeNull();
    expectFrame(plain, 52);
  });
});
