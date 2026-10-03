// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideTemplateDialog } from "../src/components/SlideTemplateDialog";
import { renderObjectEquation } from "../src/lib/equation-renderer";
import { createDemoDeck, type Deck } from "../src/lib/model";
import {
  SLIDE_TEMPLATES,
  type SlideTemplateId,
} from "../src/lib/slide-templates";

// Keep the real layouts and SVG scene. Equation typesetting has its own vector
// tests; the gallery needs only an asynchronous equation preview here.
vi.mock("../src/lib/equation-renderer", () => ({
  renderObjectEquation: vi.fn(),
}));

describe("slide template gallery", () => {
  let deck: Deck;
  let host: HTMLDivElement;
  let root: Root;
  let opener: HTMLButtonElement;
  let onChoose: ReturnType<typeof vi.fn<(id: SlideTemplateId) => void>>;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: [...text].length * 10 }),
    } as CanvasRenderingContext2D);
    vi.mocked(renderObjectEquation).mockReset();
    vi.mocked(renderObjectEquation).mockResolvedValue({
      svg: '<svg viewBox="0 0 200 50"><path d="M 0 10 H 180" /></svg>',
      width: 200,
      height: 50,
    });
    deck = createDemoDeck();
    onChoose = vi.fn();
    onClose = vi.fn();
    opener = document.createElement("button");
    opener.textContent = "Open slide templates";
    host = document.createElement("div");
    document.body.append(opener, host);
    opener.focus();
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    opener.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () =>
      root.render(
        createElement(SlideTemplateDialog, { deck, onChoose, onClose }),
      ),
    );
  }

  function button(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === label ||
        candidate.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing template button: ${label}`);
    return found;
  }

  async function click(element: Element) {
    await act(async () =>
      element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  }

  async function key(value: string, shiftKey = false) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => window.dispatchEvent(event));
    return event;
  }

  it("shows all eight editable layouts using the real slide scenes", async () => {
    await render();
    const layouts = SLIDE_TEMPLATES.filter(({ id }) => id !== "blank");
    expect(layouts).toHaveLength(8);
    const cards = [
      ...host.querySelectorAll<HTMLButtonElement>(".template-card"),
    ];
    expect(cards).toHaveLength(8);
    expect(host.querySelector(".template-count")?.textContent).toBe(
      "8 layouts",
    );
    expect(
      host.querySelector("[role=dialog]")?.getAttribute("aria-modal"),
    ).toBe("true");
    expect(
      host.querySelector("#template-dialog-description")?.textContent,
    ).toContain("All objects are editable.");
    expect(host.querySelector("footer")?.textContent).toContain(
      "Inserted after the current slide.",
    );
    for (const [index, layout] of layouts.entries()) {
      expect(cards[index].getAttribute("aria-label")).toBe(
        `Use ${layout.name} layout`,
      );
      const svg = cards[index].querySelector("svg.slide-scene");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 1600 900");
      expect(svg?.getAttribute("aria-label")).toBe(layout.name);
      expect(svg?.querySelectorAll("g").length).toBeGreaterThan(0);
    }
    expect(renderObjectEquation).toHaveBeenCalled();
    expect(host.querySelector(".template-thumbnail path")).not.toBeNull();
    expect(document.activeElement).toBe(cards[0]);
  });

  it.each([
    ["section", "Section divider"],
    ["methods", "Methods pipeline"],
    ["results", "Results spotlight"],
    ["closing", "Takeaways + next steps"],
  ] as const)(
    "chooses the %s layout without dismissing through the backdrop",
    async (id, name) => {
      await render();
      await click(button(`Use ${name} layout`));
      expect(onChoose).toHaveBeenCalledExactlyOnceWith(id);
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("keeps a blank slide available in the footer", async () => {
    await render();
    await click(button("Blank slide"));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("blank");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("wraps keyboard focus at both ends of the dialog", async () => {
    await render();
    const first = button("Close slide templates");
    const last = button("Blank slide");
    first.focus();
    expect((await key("Tab", true)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect((await key("Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("closes on Escape and restores focus when dismissed", async () => {
    await render();
    expect((await key("Escape")).defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
    await key("Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes from the backdrop and close button", async () => {
    await render();
    await click(host.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledOnce();
    await click(button("Close slide templates"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onChoose).not.toHaveBeenCalled();
  });
});
