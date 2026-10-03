// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlideScene } from "../src/components/SlideScene";
import type { SceneGuide } from "../src/components/SmartGuideOverlay";
import { renderSlideSvg } from "../src/lib/export";
import { createDemoDeck } from "../src/lib/model";

vi.mock("svg2pdf.js", () => import("svg2pdf.js/dist/svg2pdf.es.js"));

function deck() {
  const result = createDemoDeck();
  result.slides = [{ ...result.slides[0], objects: [] }];
  result.pageNumbers = undefined;
  return result;
}

function scene(
  guides: SceneGuide[],
  options: { guideScale?: number; playback?: boolean } = {},
) {
  const documentDeck = deck();
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(SlideScene, {
      deck: documentDeck,
      slide: documentDeck.slides[0],
      guides,
      ...options,
    }),
  );
  return host;
}

describe("smart guide editor overlay", () => {
  beforeEach(() => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
  });

  it("bounds alignment lines to the aligned objects and distinguishes center lines", () => {
    const host = scene([
      {
        kind: "alignment",
        axis: "x",
        position: 400,
        from: 100,
        to: 500,
        anchor: "center",
      },
      {
        kind: "alignment",
        axis: "y",
        position: 200,
        from: 80,
        to: 720,
        anchor: "edge",
      },
    ]);
    const center = host.querySelector('[data-guide-anchor="center"]')!;
    const edge = host.querySelector('[data-guide-anchor="edge"]')!;
    expect(center.querySelector("[data-guide-line]")?.getAttribute("d")).toBe(
      "M 400 100 V 500",
    );
    expect(edge.querySelector("[data-guide-line]")?.getAttribute("d")).toBe(
      "M 80 200 H 720",
    );
    expect(center.querySelector("[data-guide-center]")).not.toBeNull();
    expect(edge.querySelector("[data-guide-center]")).toBeNull();
    expect(
      host
        .querySelector("[data-alignment-guides]")
        ?.getAttribute("pointer-events"),
    ).toBe("none");
  });

  it("shows equal gap measurements and matching size badges in both directions", () => {
    const host = scene([
      {
        kind: "spacing",
        axis: "x",
        position: 240,
        from: 160,
        to: 240,
        label: "80 px",
      },
      {
        kind: "spacing",
        axis: "x",
        position: 240,
        from: 480,
        to: 560,
        label: "80 px",
      },
      {
        kind: "size",
        axis: "y",
        position: 620,
        from: 100,
        to: 260,
        label: "Height 160 px",
      },
    ]);
    const gaps = host.querySelectorAll('[data-guide-kind="spacing"]');
    expect(
      [...gaps].map((gap) => gap.querySelector("text")?.textContent),
    ).toEqual(["80 px", "80 px"]);
    expect(gaps[0].querySelector("[data-guide-line]")?.getAttribute("d")).toBe(
      "M 160 240 H 240",
    );
    const height = host.querySelector('[data-guide-kind="size"]')!;
    expect(height.querySelector("[data-guide-line]")?.getAttribute("d")).toBe(
      "M 620 100 V 260",
    );
    expect(height.querySelector("text")?.textContent).toBe("Height 160 px");
    expect(height.querySelector("[data-guide-ticks]")).not.toBeNull();
    expect(height.querySelector("path")?.getAttribute("stroke")).not.toBe(
      gaps[0].querySelector("path")?.getAttribute("stroke"),
    );
  });

  it("keeps labels and ticks readable when the slide is zoomed out", () => {
    const host = scene(
      [
        {
          kind: "size",
          axis: "x",
          position: 500,
          from: 100,
          to: 400,
          label: "Width 300 px",
        },
      ],
      { guideScale: 0.5 },
    );
    expect(host.querySelector("text")?.getAttribute("font-size")).toBe("24");
    expect(
      host.querySelector("[data-guide-label] rect")?.getAttribute("height"),
    ).toBe("44");
    expect(host.querySelector("[data-guide-ticks]")?.getAttribute("d")).toBe(
      "M 100 490 V 510 M 400 490 V 510",
    );
    expect(host.querySelector("path")?.getAttribute("vector-effect")).toBe(
      "non-scaling-stroke",
    );
    const invalidScale = scene(
      [
        {
          kind: "size",
          axis: "x",
          position: 500,
          from: 100,
          to: 400,
          label: "300 px",
        },
      ],
      { guideScale: Number.NaN },
    );
    expect(invalidScale.innerHTML).not.toContain("NaN");
    expect(invalidScale.querySelector("text")?.getAttribute("font-size")).toBe(
      "12",
    );
  });

  it("keeps badges inside the slide when objects are near its edges", () => {
    const host = scene(
      [
        {
          kind: "size",
          axis: "y",
          position: 1612,
          from: 10,
          to: 150,
          label: "140 px",
        },
        {
          kind: "spacing",
          axis: "x",
          position: 0,
          from: 0,
          to: 80,
          label: "80 px",
        },
      ],
      { guideScale: 0.5 },
    );
    for (const badge of host.querySelectorAll("[data-guide-label] rect")) {
      const x = Number(badge.getAttribute("x"));
      const y = Number(badge.getAttribute("y"));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + Number(badge.getAttribute("width"))).toBeLessThanOrEqual(1600);
      expect(y + Number(badge.getAttribute("height"))).toBeLessThanOrEqual(900);
    }
  });

  it("preserves legacy full-slide guides and leaves clean playback and exports", async () => {
    const guides: SceneGuide[] = [
      { axis: "x", position: 400 },
      { axis: "y", position: 300 },
      {
        kind: "size",
        axis: "x",
        position: 240,
        from: 160,
        to: 460,
        label: "Width 300 px",
      },
    ];
    const host = scene(guides);
    expect(host.querySelector("[data-guide-line]")?.getAttribute("d")).toBe(
      "M 400 0 V 900",
    );
    expect(host.querySelector('[data-guide-axis="y"]')?.getAttribute("d")).toBe(
      "M 0 300 H 1600",
    );
    expect(
      scene(guides, { playback: true }).querySelector(
        "[data-alignment-guides]",
      ),
    ).toBeNull();
    expect(scene([]).querySelector("[data-alignment-guides]")).toBeNull();
    const documentDeck = deck();
    const exported = await renderSlideSvg(
      documentDeck,
      documentDeck.slides[0],
      0,
    );
    expect(
      exported.querySelector("[data-alignment-guides],[data-guide-kind]"),
    ).toBeNull();
    expect(exported.textContent).not.toContain("Width 300 px");
  });
});
