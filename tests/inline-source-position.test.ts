// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineTextEditor } from "../src/components/InlineTextEditor";
import { createDemoDeck, type TextObject } from "../src/lib/model";

vi.mock("../src/components/InlineMathText", () => ({
  InlineMathText: () =>
    createElement("text", null, "Rendered equation preview"),
}));

describe("inline source panel visibility", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      "get",
    ).mockReturnValue(4000);
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

  it.each([0, 45, -60, 180])(
    "keeps a tall frame's scrollable source inside the slide at %d degrees",
    async (rotation) => {
      const deck = createDemoDeck();
      deck.slideSize = { width: 1600, height: 900, unit: "px96" };
      const object: TextObject = {
        id: "tall-text",
        type: "text",
        name: "Tall paragraph",
        transform: { x: 1450, y: 100, width: 1400, height: 800, rotation },
        text: "Long paragraph $x^2$",
        fontFamily: "Inter",
        fontSize: 32,
        fontWeight: 400,
        color: "#123456",
        align: "left",
        opacity: 1,
        visible: true,
        locked: false,
        metadata: {},
      };
      const onFinish = vi.fn();
      await act(async () =>
        root.render(
          createElement(
            "svg",
            null,
            createElement(InlineTextEditor, {
              object,
              deck,
              editing: {
                objectId: object.id,
                value: object.text,
                onChange: vi.fn(),
                onFinish,
              },
            }),
          ),
        ),
      );
      const field = host.querySelector("textarea")!;
      const viewport = field.closest("foreignObject")!;
      const x = Number(viewport.getAttribute("x"));
      const y = Number(viewport.getAttribute("y"));
      const width = Number(viewport.getAttribute("width"));
      const height = Number(viewport.getAttribute("height"));
      expect(x).toBeGreaterThanOrEqual(16);
      expect(y).toBeGreaterThanOrEqual(40);
      expect(x + width).toBeLessThanOrEqual(1584);
      expect(y + height).toBeLessThanOrEqual(884);
      expect(height).toBeLessThanOrEqual(320);
      expect(field.classList.contains("inline-text-source-editor")).toBe(true);
      expect(
        viewport
          .closest("[data-inline-text-editor]")
          ?.hasAttribute("transform"),
      ).toBe(false);
      expect(
        host
          .querySelector("[data-inline-text-preview]")
          ?.getAttribute("transform"),
      ).toContain(`rotate(${rotation} `);
      expect(document.activeElement).toBe(field);
      field.setSelectionRange(5, 5);
      expect(field.selectionStart).toBe(5);
      expect(object.transform.height).toBe(800);
      expect(onFinish).not.toHaveBeenCalled();
    },
  );
});
