// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { renderEquation } from "../src/lib/equations";
import {
  createDemoDeck,
  type Deck,
  type EquationObject,
  type TextObject,
} from "../src/lib/model";
import { loadRecovery } from "../src/lib/persistence";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
} from "../src/lib/workspace-recovery";
import { effectiveTextFontFamily } from "../src/lib/text-fonts";

vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  loadRecovery: vi.fn(),
}));
vi.mock("../src/lib/workspace-recovery", async (original) => ({
  ...(await original<typeof import("../src/lib/workspace-recovery")>()),
  loadWorkspaceRecovery: vi.fn(),
  saveWorkspaceRecovery: vi.fn(),
}));
vi.mock("../src/lib/equations", async (original) => ({
  ...(await original<typeof import("../src/lib/equations")>()),
  renderEquation: vi.fn(),
}));
vi.mock("../src/lib/export", () => ({
  exportDeckPdf: vi.fn(),
  exportSlideSvg: vi.fn(),
}));

function typographyDeck(): Deck {
  const deck = createDemoDeck();
  const text = deck.slides[0].objects.find(
    (object): object is TextObject => object.type === "text",
  )!;
  const equation = deck.slides[0].objects.find(
    (object): object is EquationObject => object.type === "equation",
  )!;
  deck.id = "typography-deck";
  deck.theme.fontFamily = "Inter";
  deck.theme.inlineMathFontSetId = "mathjax-modern";
  deck.theme.equation = {
    fontSetId: "mathjax-stix2",
    fontSize: 40,
    color: "#123456",
  };
  deck.slides = [
    {
      ...deck.slides[0],
      objects: [
        {
          ...text,
          id: "inherited",
          name: "Inherited prose",
          text: "Inherited prose",
          fontFamily: "Inter",
          fontFamilySource: "deck",
        },
        {
          ...text,
          id: "legacy",
          name: "Legacy prose",
          text: "Legacy prose",
          fontFamily: "Inter",
          fontFamilySource: undefined,
        },
        {
          ...equation,
          id: "equation",
          name: "Styled equation",
          latex: "x^2",
          style: { fontSetId: "mathjax-fira", fontSize: 52, color: "#654321" },
        },
      ],
    },
  ];
  deck.assets = [];
  deck.pageNumbers = undefined;
  return deck;
}

describe("independent document and object typography", () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: Deck;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1600);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "0",
      paddingRight: "0",
      paddingTop: "0",
      paddingBottom: "0",
    } as CSSStyleDeclaration);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (value: string) => ({ width: value.length * 10 }),
    } as CanvasRenderingContext2D);
    vi.mocked(renderEquation)
      .mockReset()
      .mockResolvedValue({
        svg: '<svg width="100" height="40"><path d="M0 20L100 20"/></svg>',
        width: 100,
        height: 40,
        baseline: 30,
      });
    vi.mocked(loadRecovery).mockReset().mockReturnValue(typographyDeck());
    vi.mocked(loadWorkspaceRecovery).mockReset().mockResolvedValue(null);
    vi.mocked(saveWorkspaceRecovery)
      .mockReset()
      .mockImplementation(async (deck) => {
        saved = structuredClone(deck);
        return "localStorage";
      });
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) =>
        element.getAttribute("aria-label") === label ||
        element.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function persist() {
    await act(async () => vi.advanceTimersByTimeAsync(750));
    return saved;
  }
  async function render() {
    await act(async () => root.render(createElement(App)));
    await click("Resume previous work");
    await persist();
  }
  async function select(label: string, value: string) {
    const field = host.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    );
    if (!field) throw new Error(`Missing select: ${label}`);
    await act(async () => {
      field.value = value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  function text(id: string) {
    return saved.slides[0].objects.find(
      (object) => object.id === id,
    ) as TextObject;
  }
  function canvasFamily(value: string) {
    return [...host.querySelectorAll(".slide-paper svg text")]
      .find((node) => node.textContent === value)
      ?.getAttribute("font-family");
  }

  it("changes prose and equation defaults independently and keeps legacy prose explicit", async () => {
    await render();
    await click("Document");
    await select("Default text font", "Nanum Gothic");
    await persist();
    expect(saved.theme.fontFamily).toBe("Nanum Gothic");
    expect(saved.theme.equation).toEqual(typographyDeck().theme.equation);
    expect(saved.theme.inlineMathFontSetId).toBe("mathjax-modern");
    expect(canvasFamily("Inherited prose")).toBe("Nanum Gothic");
    expect(canvasFamily("Legacy prose")).toBe("Inter");
    await select("Default math font", "mathjax-fira");
    await persist();
    expect(saved.theme.fontFamily).toBe("Nanum Gothic");
    expect(saved.theme.equation.fontSetId).toBe("mathjax-fira");
    expect(effectiveTextFontFamily(saved, text("inherited"))).toBe(
      "Nanum Gothic",
    );
  });

  it("applies the deck family only to selected legacy text and retains continuing inheritance", async () => {
    await render();
    await click("Select Legacy prose");
    await click("Document");
    await select("Default text font", "Nanum Gothic");
    expect(canvasFamily("Legacy prose")).toBe("Inter");
    await click("Use deck text font for selected text");
    await persist();
    expect(text("legacy").fontFamilySource).toBe("deck");
    expect(canvasFamily("Legacy prose")).toBe("Nanum Gothic");
    await select("Default text font", "Inter");
    await persist();
    expect(effectiveTextFontFamily(saved, text("legacy"))).toBe("Inter");
    expect(saved.theme.equation).toEqual(typographyDeck().theme.equation);
  });

  it("distinguishes an object override from restoring the deck default", async () => {
    await render();
    await click("Select Inherited prose");
    await click("Style");
    await select("Text font", "Nanum Gothic");
    await persist();
    expect(text("inherited").fontFamilySource).toBeUndefined();
    expect(canvasFamily("Inherited prose")).toBe("Nanum Gothic");
    await select("Text font", "deck");
    await persist();
    expect(text("inherited").fontFamilySource).toBe("deck");
    expect(canvasFamily("Inherited prose")).toBe("Inter");
    await click("Document");
    await select("Default text font", "Nanum Gothic");
    await persist();
    expect(canvasFamily("Inherited prose")).toBe("Nanum Gothic");
    expect(canvasFamily("Legacy prose")).toBe("Inter");
  });

  it("removes equation overrides on Reset and Apply, then follows later deck math settings", async () => {
    await render();
    await click("Select Styled equation");
    await click("Edit equation");
    await persist();
    await click("Reset to deck typography");
    await persist();
    expect(button("Apply equation").disabled).toBe(false);
    await click("Apply equation");
    await persist();
    const equation = saved.slides[0].objects.find(
      (object) => object.id === "equation",
    ) as EquationObject;
    expect(equation.style).toEqual({});
    expect(host.querySelector(".equation-editor-dialog")).toBeNull();
    await click("Document");
    await select("Default math font", "mathjax-modern");
    await persist();
    expect(
      (
        saved.slides[0].objects.find(
          (object) => object.id === "equation",
        ) as EquationObject
      ).style,
    ).toEqual({});
    expect(renderEquation).toHaveBeenCalledWith(
      "x^2",
      "mathjax-modern",
      40,
      "#123456",
      equation.displayMode,
    );
    expect(saved.theme.fontFamily).toBe("Inter");
  });
});
