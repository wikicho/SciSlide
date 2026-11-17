// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideScene } from "../src/components/SlideScene";
import { InlineMathText } from "../src/components/InlineMathText";
import * as model from "../src/lib/model";
import * as inlineMath from "../src/lib/inline-math";
import * as equations from "../src/lib/equations";
import type { Deck, TextObject } from "../src/lib/model";

let glyphWidth = 10;
const measure = vi.fn((value: string) => ({
  width: [...value].length * glyphWidth,
}));

function text(
  id: string,
  source = "A scientific paragraph with several meaningful measured words",
): TextObject {
  return {
    id,
    name: id,
    type: "text",
    text: source,
    transform: { x: 100, y: 100, width: 400, height: 50, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    fontFamily: "Inter",
    fontSize: 20,
    fontWeight: 400,
    color: "#123456",
    align: "left",
  };
}

function deckWith(objects: TextObject[]): Deck {
  const deck = model.createDemoDeck();
  deck.pageNumbers = undefined;
  deck.assets = [];
  deck.slides = [{ ...deck.slides[0], objects }];
  return deck;
}

describe("text rendering avoids repeated layout work", () => {
  let host: HTMLDivElement;
  let root: Root;
  let fonts: EventTarget;
  let load: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    glyphWidth = 10;
    measure.mockClear();
    load = vi.fn(async () => []);
    fonts = new EventTarget();
    Object.defineProperties(fonts, {
      status: { value: "loaded" },
      ready: { value: Promise.resolve() },
      load: { value: load },
      check: { value: () => true },
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: measure,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(equations, "renderEquation").mockResolvedValue({
      width: 30,
      height: 24,
      baseline: 18,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="24"><path d="M0 0L10 10"/></svg>',
    });
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

  it("does no text measurement or bounds reporting during position-only drag previews", async () => {
    const objects = Array.from({ length: 30 }, (_, index) =>
      text(`paragraph-${index}`),
    );
    const deck = deckWith(objects);
    const onMetrics = vi.fn();
    const onPointer = () => undefined;
    const render = async (preview: Record<string, TextObject>) => {
      await act(async () =>
        root.render(
          createElement(SlideScene, {
            deck,
            slide: deck.slides[0],
            preview,
            onPointer,
            onMetrics,
          }),
        ),
      );
    };
    await render({});
    expect(measure.mock.calls.length).toBeGreaterThan(200);
    measure.mockClear();
    onMetrics.mockClear();
    for (let index = 1; index <= 12; index++)
      await render({
        [objects[0].id]: {
          ...objects[0],
          transform: { ...objects[0].transform, x: index * 10 },
        },
      });
    expect(measure).not.toHaveBeenCalled();
    expect(onMetrics).not.toHaveBeenCalled();
    expect(
      host.querySelector(".canvas-object")?.getAttribute("transform"),
    ).toContain("translate(120 100)");
  });

  it("skips unchanged thumbnail scene renders and reuses measurements across unrelated deck snapshots", async () => {
    const deck = deckWith([text("thumbnail-text")]);
    const numbers = vi.spyOn(model, "resolvePageNumber");
    const render = async (revision: number, snapshot = deck) => {
      await act(async () =>
        root.render(
          createElement(
            "section",
            { "data-revision": revision },
            createElement(SlideScene, {
              deck: snapshot,
              slide: snapshot.slides[0],
              slideIndex: 0,
            }),
          ),
        ),
      );
    };
    await render(0);
    const scenes = numbers.mock.calls.length;
    measure.mockClear();
    for (let revision = 1; revision <= 12; revision++) await render(revision);
    expect(numbers).toHaveBeenCalledTimes(scenes);
    expect(measure).not.toHaveBeenCalled();
    await render(13, structuredClone(deck));
    expect(numbers).toHaveBeenCalledTimes(scenes + 1);
    expect(measure).not.toHaveBeenCalled();
  });

  it("shares in-flight inline layouts and fonts across duplicate previews and later slide remounts", async () => {
    const object = text("mixed", "Read $x$ carefully");
    const deck = deckWith([object]);
    const layout = vi.spyOn(inlineMath, "layoutInlineText");
    const render = async () => {
      await act(async () =>
        root.render(
          createElement(
            "svg",
            null,
            ...Array.from({ length: 4 }, (_, index) =>
              createElement(InlineMathText, {
                key: index,
                object: { ...object, id: `preview-${index}` },
                deck,
              }),
            ),
          ),
        ),
      );
    };
    await render();
    expect(layout).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(
      host.querySelectorAll('[data-inline-math][aria-busy="false"]'),
    ).toHaveLength(4);
    measure.mockClear();
    await act(async () => root.render(createElement("div")));
    await render();
    expect(layout).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(measure).not.toHaveBeenCalled();
  });

  it("invalidates reused inline layout for text, style and loaded-font changes", async () => {
    const object = text("changing", "Read $x$ carefully");
    const deck = deckWith([object]);
    const layout = vi.spyOn(inlineMath, "layoutInlineText");
    const render = async (value: TextObject) => {
      await act(async () =>
        root.render(
          createElement(
            "svg",
            null,
            createElement(InlineMathText, { object: value, deck }),
          ),
        ),
      );
    };
    await render(object);
    await render({ ...object, transform: { ...object.transform, x: 300 } });
    expect(layout).toHaveBeenCalledTimes(1);
    const changed = { ...object, text: "Read $y$ carefully" };
    await render(changed);
    expect(layout).toHaveBeenCalledTimes(2);
    const colored = {
      ...changed,
      textStyles: [{ start: 0, end: 4, color: "#ff0000" }],
    };
    await render(colored);
    expect(layout).toHaveBeenCalledTimes(3);
    expect(
      [...host.querySelectorAll("text")]
        .find((run) => run.textContent === "Read")
        ?.getAttribute("fill"),
    ).toBe("#ff0000");
    glyphWidth = 15;
    await act(async () => fonts.dispatchEvent(new Event("loadingdone")));
    expect(layout).toHaveBeenCalledTimes(4);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("evicts old completed layouts while keeping recent remounts reusable", async () => {
    const object = text("bounded", "entry 0");
    const deck = deckWith([object]);
    const layout = vi.spyOn(inlineMath, "layoutInlineText");
    const render = async (index: number) => {
      await act(async () =>
        root.render(
          createElement(
            "svg",
            null,
            createElement(InlineMathText, {
              object: { ...object, text: `entry ${index}` },
              deck,
            }),
          ),
        ),
      );
    };
    for (let index = 0; index <= 128; index++) await render(index);
    expect(layout).toHaveBeenCalledTimes(129);
    await act(async () => root.render(createElement("div")));
    await render(128);
    expect(layout).toHaveBeenCalledTimes(129);
    await render(0);
    expect(layout).toHaveBeenCalledTimes(130);
  });

  it("keeps the latest equation editing callback while reusing rendered fragments", async () => {
    const object = text("editable", "A $x$ B");
    const deck = deckWith([object]);
    const first = vi.fn();
    const latest = vi.fn();
    const render = async (onEditEquation: typeof first) => {
      await act(async () =>
        root.render(
          createElement(
            "svg",
            null,
            createElement(InlineMathText, { object, deck, onEditEquation }),
          ),
        ),
      );
    };
    await render(first);
    await render(latest);
    await act(async () =>
      host
        .querySelector("[data-inline-math-fragment]")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith(2, 5);
  });
});
