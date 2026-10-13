// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineTextEditor } from "../src/components/InlineTextEditor";
import type { TextObject } from "../src/lib/model";

function textObject(): TextObject {
  return {
    id: "autosize-text",
    type: "text",
    name: "Autosize text",
    text: "",
    transform: { x: 150, y: 180, width: 100, height: 20, rotation: 12 },
    fontFamily: "Inter",
    fontSize: 20,
    fontWeight: 400,
    color: "#123456",
    align: "left",
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
  };
}

describe("inline text box autosizing", () => {
  let host: HTMLDivElement;
  let root: Root;
  let object: TextObject;
  let onHeightChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const context = {
      font: "",
      measureText(text: string) {
        const size = Number(this.font.match(/([\d.]+)px/)?.[1]);
        return { width: [...text].length * size * 0.5 };
      },
    } as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    object = textObject();
    onHeightChange = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(document, "fonts");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(value: string) {
    await act(async () =>
      root.render(
        createElement(
          "svg",
          null,
          createElement(InlineTextEditor, {
            object,
            editing: {
              objectId: object.id,
              value,
              onChange: vi.fn(),
              onFinish: vi.fn(),
            },
            onHeightChange,
          }),
        ),
      ),
    );
  }

  function height() {
    return Number(host.querySelector("foreignObject")!.getAttribute("height"));
  }

  it("grows for explicit newlines including an empty last line, then shrinks", async () => {
    await render("one");
    expect(height()).toBe(32);
    const field = host.querySelector("textarea")!;
    field.setSelectionRange(1, 1);
    await render("one\ntwo\nthree\n");
    expect(height()).toBe(104);
    expect(document.activeElement).toBe(field);
    expect(onHeightChange).toHaveBeenLastCalledWith(104);
    await render("one");
    expect(height()).toBe(32);
    expect(onHeightChange).toHaveBeenLastCalledWith(32);
    expect(object.transform.height).toBe(20);
  });

  it("keeps the manually sized box as its minimum after deleting text", async () => {
    object.transform.height = 180;
    await render(Array(10).fill("line").join("\n"));
    expect(height()).toBe(260);
    await render("");
    expect(height()).toBe(180);
  });

  it("grows for width wrapping and remeasures when width or font size changes", async () => {
    await render("abcdefghijkl");
    expect(height()).toBe(52);
    object = {
      ...object,
      transform: { ...object.transform, width: 50 },
    };
    await render("abcdefghijkl");
    expect(height()).toBe(78);
    object = { ...object, fontSize: 40 };
    await render("abcdefghijkl");
    expect(height()).toBe(312);
  });

  it("uses actual textarea height and clears its height before measuring shrinkage", async () => {
    let contentHeight = 117;
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLTextAreaElement) {
        expect(this.style.height).toBe("0px");
        return contentHeight;
      },
    );
    await render("short text with real browser metrics");
    expect(height()).toBe(117);
    contentHeight = 26;
    await render("short");
    expect(height()).toBe(32);
    expect(host.querySelector("textarea")!.style.height).toBe("100%");
  });

  it("remeasures font family and weight without changing the rotation pivot", async () => {
    let contentHeight = 40;
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
      () => contentHeight,
    );
    await render("text");
    contentHeight = 80;
    object = { ...object, fontFamily: "serif" };
    await render("text");
    expect(height()).toBe(80);
    contentHeight = 120;
    object = { ...object, fontWeight: 700 };
    await render("text");
    expect(height()).toBe(120);
    expect(host.querySelector("g")!.getAttribute("transform")).toBe(
      "translate(150 180) rotate(12 50 10)",
    );
  });

  it("remeasures after fonts become ready or finish loading", async () => {
    const fonts = new EventTarget();
    let ready!: () => void;
    Object.defineProperty(fonts, "ready", {
      value: new Promise<void>((resolve) => {
        ready = resolve;
      }),
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    });
    let contentHeight = 40;
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
      () => contentHeight,
    );
    await render("text");
    expect(height()).toBe(40);
    contentHeight = 80;
    await act(async () => ready());
    expect(height()).toBe(80);
    contentHeight = 120;
    await act(async () => fonts.dispatchEvent(new Event("loadingdone")));
    expect(height()).toBe(120);
  });
});
