// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlideScene } from "../src/components/SlideScene";
import { createDemoDeck, type Deck, type VideoObject } from "../src/lib/model";
import { renderSlideSvg } from "../src/lib/export";

// These tests exercise the shared static scene, not the browser-only PDF converter.
vi.mock("svg2pdf.js", () => ({ svg2pdf: vi.fn() }));

function mediaDeck(): Deck {
  const deck = createDemoDeck();
  const video: VideoObject = {
    id: "video-test",
    type: "video",
    name: "Simulation clip",
    alt: "Simulation",
    transform: { x: 100, y: 100, width: 640, height: 360, rotation: 0 },
    opacity: 0.5,
    visible: true,
    locked: false,
    metadata: {},
    assetId: "media-test",
    autoplay: true,
    loop: false,
    muted: true,
    controls: true,
    build: { step: 2, effect: "fade", durationMs: 500 },
  };
  deck.slides[0].objects = [video];
  deck.slides[1].objects = [];
  deck.slides[2].objects = [];
  deck.assets = [
    {
      id: "media-test",
      name: "demo.webm",
      mime: "video/webm",
      dataUrl: "data:video/webm;base64,GkXfow==",
      width: 640,
      height: 360,
    },
  ];
  return deck;
}

describe("media and page numbering in shared scenes", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
      new Error("User gesture needed"),
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
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

  it("shows static media while editing, reveals only at its step, and pauses on leaving", async () => {
    const deck = mediaDeck();
    const render = async (playback: boolean, presentationStep?: number) => {
      await act(async () =>
        root.render(
          createElement(SlideScene, {
            deck,
            slide: deck.slides[0],
            playback,
            presentationStep,
          }),
        ),
      );
    };
    await render(false);
    expect(host.querySelector("video")).toBeNull();
    expect(host.textContent).toContain("Video");
    expect(host.querySelector(".slide-page-number")?.textContent).toBe("1");
    await render(true, 0);
    expect(host.querySelector("video")).toBeNull();
    await render(true, 2);
    const player = host.querySelector("video")!;
    expect(player.src).toMatch(/^data:video\/webm;/);
    expect(host.querySelector(".video-play-action")).not.toBeNull();
    expect(host.querySelector(".build-fade")?.getAttribute("style")).toContain(
      "--build-opacity: 0.5",
    );
    await render(true, 0);
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("exports final builds and a passive video frame with numbering after reordering", async () => {
    const deck = mediaDeck();
    deck.pageNumbers!.format = "number-total";
    // Static exports preserve objects that have not yet appeared in the player.
    const svg = await renderSlideSvg(deck, deck.slides[0], 0);
    expect(svg.querySelector("[data-page-number]")?.textContent).toBe("1 / 3");
    expect(svg.textContent).toContain("Video (presentation only)");
    expect(svg.querySelector("video,foreignObject,animate")).toBeNull();
    expect(new XMLSerializer().serializeToString(svg)).not.toContain(
      "data:video/",
    );
    deck.slides.reverse();
    await act(async () =>
      root.render(createElement(SlideScene, { deck, slide: deck.slides[2] })),
    );
    expect(host.querySelector(".slide-page-number")?.textContent).toBe("3 / 3");
    deck.assets = [];
    await expect(renderSlideSvg(deck, deck.slides[2], 2)).rejects.toThrow(
      "missing",
    );
  });
});
