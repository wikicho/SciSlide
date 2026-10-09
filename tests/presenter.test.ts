// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresenterApp } from "../src/components/PresenterApp";
import { createDemoDeck } from "../src/lib/model";
import type { Deck } from "../src/lib/model";
import { presenterChannelName, presenterToken } from "../src/lib/presenter";
import type { PresenterMessage, PresenterState } from "../src/lib/presenter";

const nativeBridge = vi.hoisted(() => ({
  platform: undefined as string | undefined,
}));
vi.mock("../src/lib/desktop", async (original) => ({
  ...(await original<typeof import("../src/lib/desktop")>()),
  get desktop() {
    return nativeBridge.platform
      ? { platform: nativeBridge.platform }
      : undefined;
  },
}));

// Playback semantics are already covered by the real scene/media tests. Inspect
// the presenter boundary here so both previews explicitly suppress video audio.
vi.mock("../src/components/SlideScene", () => ({
  SlideScene: ({
    slide,
    playback,
    playMedia,
    presentationStep,
  }: {
    slide: { id: string };
    playback?: boolean;
    playMedia?: boolean;
    presentationStep?: number;
  }) =>
    createElement("div", {
      "data-scene-slide": slide.id,
      "data-playback": String(playback ?? false),
      "data-media": String(playMedia),
      "data-build-step": presentationStep,
    }),
}));

class TestBroadcastChannel {
  static instances: TestBroadcastChannel[] = [];
  readonly sent: PresenterMessage[] = [];
  closed = false;
  onmessage: ((event: MessageEvent<PresenterMessage>) => void) | null = null;
  constructor(readonly name: string) {
    TestBroadcastChannel.instances.push(this);
  }
  postMessage(message: PresenterMessage) {
    if (this.closed)
      throw new DOMException("Channel closed", "InvalidStateError");
    this.sent.push(structuredClone(message));
    for (const peer of TestBroadcastChannel.instances) {
      if (peer === this || peer.closed || peer.name !== this.name) continue;
      queueMicrotask(() => {
        if (!peer.closed)
          peer.onmessage?.({
            data: structuredClone(message),
          } as MessageEvent<PresenterMessage>);
      });
    }
  }
  close() {
    this.closed = true;
  }
}

describe("presenter window", () => {
  const token = "f2da6d13-686a-49ad-838f-51d2927b1e82";
  let deck: Deck, state: PresenterState, audience: TestBroadcastChannel;
  let root: Root, host: HTMLDivElement;

  beforeEach(() => {
    nativeBridge.platform = undefined;
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    vi.useFakeTimers({
      toFake: [
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
        "Date",
      ],
    });
    vi.setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    TestBroadcastChannel.instances = [];
    deck = createDemoDeck();
    deck.slides[0].notes = "Explain the signal, then reveal the equation.";
    deck.slides[0].objects[0].build = {
      step: 2,
      effect: "appear",
      durationMs: 300,
    };
    state = { slideId: deck.slides[0].id, step: 0, startedAt: Date.now() };
    audience = new TestBroadcastChannel(presenterChannelName(token));
    audience.onmessage = (event) => {
      if (event.data.type === "ready")
        audience.postMessage(
          event.data.needsDeck
            ? { type: "deck", deck, state }
            : { type: "state", state },
        );
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    audience.close();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  async function render() {
    await act(async () => root.render(createElement(PresenterApp, { token })));
  }
  async function tick(milliseconds: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }
  async function send(message: PresenterMessage) {
    await act(async () => audience.postMessage(message));
  }
  async function key(
    value: string,
    init: KeyboardEventInit = {},
    target: EventTarget = window,
  ) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event;
  }
  function button(label: string) {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === label,
    );
    if (!result) throw new Error(`Missing presenter button: ${label}`);
    return result;
  }
  async function click(label: string) {
    await act(async () =>
      button(label).dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  }
  function elapsed() {
    return host.querySelector("output[aria-label='Elapsed time']")?.textContent;
  }
  function actions() {
    return audience.sent.length
      ? TestBroadcastChannel.instances.flatMap((item) =>
          item === audience
            ? []
            : item.sent.filter((message) => message.type === "action"),
        )
      : [];
  }

  it("accepts only a complete presenter token and keeps each session on its own channel", () => {
    expect(presenterToken(`#presenter=${token}`)).toBe(token);
    expect(presenterToken("#presenter=short")).toBeNull();
    expect(presenterToken(`#presenter=${token}&other=value`)).toBeNull();
    expect(presenterToken("#presenter=<script>alert(1)</script>")).toBeNull();
    expect(presenterToken(`#presenter=${"a".repeat(101)}`)).toBeNull();
    expect(presenterChannelName(token)).not.toBe(
      presenterChannelName("different-session-token"),
    );
  });

  it("handshakes a complete deck and shows current builds, next slide, and speaker notes without playing media", async () => {
    await render();
    const presenter = TestBroadcastChannel.instances.find(
      (item) => item !== audience,
    )!;
    expect(presenter.name).toBe(presenterChannelName(token));
    expect(presenter.sent[0]).toEqual({ type: "ready", needsDeck: true });
    expect(host.textContent).toContain(deck.title);
    expect(host.querySelector(".presenter-notes")?.textContent).toContain(
      deck.slides[0].notes,
    );
    const scenes = [...host.querySelectorAll("[data-scene-slide]")];
    expect(scenes).toHaveLength(2);
    expect(scenes[0].getAttribute("data-scene-slide")).toBe(deck.slides[0].id);
    expect(scenes[0].getAttribute("data-build-step")).toBe("0");
    expect(scenes[0].getAttribute("data-playback")).toBe("true");
    expect(scenes[1].getAttribute("data-scene-slide")).toBe(deck.slides[1].id);
    expect(scenes[1].getAttribute("data-build-step")).toBeNull();
    expect(
      scenes.every((scene) => scene.getAttribute("data-media") === "false"),
    ).toBe(true);
    expect(button("Previous").disabled).toBe(true);
    state = { ...state, step: 2 };
    await send({ type: "state", state });
    expect(
      host.querySelector("[data-build-step]")?.getAttribute("data-build-step"),
    ).toBe("2");
    expect(button("Previous").disabled).toBe(false);
    await tick(3000);
    expect(presenter.sent.at(-1)).toEqual({ type: "ready", needsDeck: false });
  });

  it("sends remote navigation controls and updates the final slide boundary", async () => {
    await render();
    await click("Next step / slide");
    expect(actions().at(-1)).toEqual({ type: "action", action: "next" });
    state = { ...state, slideId: deck.slides[1].id, step: 0 };
    await send({ type: "state", state });
    await click("Previous");
    expect(actions().at(-1)).toEqual({ type: "action", action: "previous" });
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Home",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(actions().at(-1)).toEqual({ type: "action", action: "first" });
    const input = host.querySelector("input")!;
    const count = actions().length;
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(actions()).toHaveLength(count);
    state = { ...state, slideId: deck.slides.at(-1)!.id, step: 0 };
    await send({ type: "state", state });
    expect(host.textContent).toContain("Last slide");
    expect(button("Next step / slide").disabled).toBe(true);
    await click("End presentation");
    expect(actions().at(-1)).toEqual({ type: "action", action: "exit" });
  });

  it.each([
    ["MacIntel", undefined],
    ["Linux x86_64", "darwin"],
  ])(
    "sends Q to end the presentation on macOS using browser %s and host %s",
    async (browserPlatform, nativePlatform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(browserPlatform);
      nativeBridge.platform = nativePlatform;
      await render();
      expect((await key("q")).defaultPrevented).toBe(true);
      expect(actions()).toEqual([{ type: "action", action: "exit" }]);
    },
  );

  it.each(["Linux x86_64", "Win32"])(
    "leaves Q alone on %s while Escape still ends the presentation",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await render();
      expect((await key("q")).defaultPrevented).toBe(false);
      expect(actions()).toEqual([]);
      expect((await key("Escape")).defaultPrevented).toBe(true);
      expect(actions()).toEqual([{ type: "action", action: "exit" }]);
    },
  );

  it.each([
    ["Win32", "n", "next"],
    ["Win32", "p", "previous"],
    ["Win32", "Enter", "next"],
    ["Win32", "Backspace", "previous"],
    ["Linux x86_64", "Enter", "next"],
    ["Linux x86_64", "Backspace", "previous"],
    ["Linux x86_64", "-", "exit"],
  ] as const)(
    "routes %s presenter key %s to %s while protecting fields and media",
    async (platform, value, action) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await render();
      const input = host.querySelector("input")!;
      const video = document.createElement("video");
      host.append(video);
      expect((await key(value, {}, input)).defaultPrevented).toBe(false);
      expect((await key(value, {}, video)).defaultPrevented).toBe(false);
      expect((await key(value, { isComposing: true })).defaultPrevented).toBe(
        false,
      );
      expect(actions()).toEqual([]);
      expect((await key(value)).defaultPrevented).toBe(true);
      expect(actions()).toEqual([{ type: "action", action }]);
    },
  );

  it("preserves composing text, typing, media controls and OS commands before macOS Q exit", async () => {
    nativeBridge.platform = "darwin";
    await render();
    const input = host.querySelector("input")!;
    expect((await key("q", {}, input)).defaultPrevented).toBe(false);
    for (const tag of ["textarea", "select", "video", "audio", "div"]) {
      const element = document.createElement(tag);
      if (tag === "div") element.setAttribute("contenteditable", "true");
      host.append(element);
      expect((await key("q", {}, element)).defaultPrevented).toBe(false);
      expect((await key("ArrowRight", {}, element)).defaultPrevented).toBe(
        false,
      );
      element.remove();
    }
    for (const init of [
      { isComposing: true },
      { keyCode: 229 },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      expect((await key("q", init)).defaultPrevented).toBe(false);
      expect((await key("ArrowRight", init)).defaultPrevented).toBe(false);
    }
    expect((await key(" ", {}, button("Pause timer"))).defaultPrevented).toBe(
      false,
    );
    expect(actions()).toEqual([]);
    expect((await key("Q", { shiftKey: true })).defaultPrevented).toBe(false);
    expect(actions()).toEqual([]);
    expect((await key("q")).defaultPrevented).toBe(true);
    expect(actions()).toEqual([{ type: "action", action: "exit" }]);
  });

  it("gives Escape to editable and media controls while allowing buttons to end playback", async () => {
    await render();
    expect(
      (await key("Escape", {}, host.querySelector("input")!)).defaultPrevented,
    ).toBe(false);
    for (const tag of ["textarea", "select", "video", "audio", "div"]) {
      const element = document.createElement(tag);
      if (tag === "div") element.setAttribute("contenteditable", "true");
      host.append(element);
      expect((await key("Escape", {}, element)).defaultPrevented).toBe(false);
      element.remove();
    }
    const media = document.createElement("div");
    media.className = "video-player";
    const mediaButton = document.createElement("button");
    media.append(mediaButton);
    host.append(media);
    expect((await key("Escape", {}, mediaButton)).defaultPrevented).toBe(false);
    media.remove();
    expect(actions()).toEqual([]);
    expect(
      (await key("Escape", {}, button("Pause timer"))).defaultPrevented,
    ).toBe(true);
    expect(actions()).toEqual([{ type: "action", action: "exit" }]);
  });

  it("ignores repeated playback actions after consuming their keys", async () => {
    await render();
    for (const value of [
      "ArrowRight",
      "ArrowLeft",
      "Home",
      "End",
      "Escape",
      "-",
    ])
      expect((await key(value, { repeat: true })).defaultPrevented).toBe(true);
    expect(actions()).toEqual([]);
    expect((await key("ArrowRight")).defaultPrevented).toBe(true);
    expect(actions()).toEqual([{ type: "action", action: "next" }]);
    expect((await key("ArrowRight", { repeat: true })).defaultPrevented).toBe(
      true,
    );
    expect(actions()).toEqual([{ type: "action", action: "next" }]);
  });

  it("keeps Shift+arrow build navigation but rejects other modified playback keys", async () => {
    await render();
    for (const value of ["Escape", "-", "Enter", "Home", "End", "PageDown"])
      expect((await key(value, { shiftKey: true })).defaultPrevented).toBe(
        false,
      );
    expect(actions()).toEqual([]);
    expect((await key("ArrowRight", { shiftKey: true })).defaultPrevented).toBe(
      true,
    );
    expect((await key("ArrowLeft", { shiftKey: true })).defaultPrevented).toBe(
      true,
    );
    expect(actions()).toEqual([
      { type: "action", action: "next" },
      { type: "action", action: "previous" },
    ]);
  });

  it("keeps a paused or reset timer intact across repeated deck heartbeats", async () => {
    // Retry snapshots can arrive even after a successful handshake.
    audience.onmessage = (event) => {
      if (event.data.type === "ready")
        audience.postMessage({ type: "deck", deck, state });
    };
    await render();
    await tick(5000);
    expect(elapsed()).toBe("00:05");
    await click("Pause timer");
    await tick(12_000);
    expect(elapsed()).toBe("00:05");
    await click("Resume timer");
    await tick(2000);
    expect(elapsed()).toBe("00:07");
    await click("Reset timer");
    expect(elapsed()).toBe("00:00");
    await click("Pause timer");
    await tick(6000);
    expect(elapsed()).toBe("00:00");
    await click("Reset timer");
    await click("Resume timer");
    await tick(1000);
    expect(elapsed()).toBe("00:01");
  });

  it("retains the last preview while disconnected, reconnects, and handles ending and cleanup", async () => {
    await render();
    audience.onmessage = null;
    await tick(9000);
    expect(host.querySelector("[role=status]")?.textContent).toContain(
      "Connection interrupted",
    );
    expect(host.querySelectorAll("[data-scene-slide]")).toHaveLength(2);
    const actionCount = actions().length;
    await click("Next step / slide");
    expect(actions()).toHaveLength(actionCount);
    await send({ type: "state", state });
    expect(host.querySelector("[role=status]")).toBeNull();
    await send({ type: "ended" });
    expect(host.textContent).toContain("Presentation ended");
    expect(host.querySelectorAll("[data-scene-slide]")).toHaveLength(0);
    const presenter = TestBroadcastChannel.instances.find(
      (item) => item !== audience,
    )!;
    const endedCount = presenter.sent.length;
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    await tick(9000);
    expect(presenter.sent).toHaveLength(endedCount);
    await act(async () => root.render(null));
    expect(presenter.closed).toBe(true);
  });

  it("keeps the previous valid deck when a malformed deck snapshot arrives", async () => {
    await render();
    await send({ type: "deck", deck: { ...deck, slides: [] }, state });
    expect(host.querySelectorAll("[data-scene-slide]")).toHaveLength(2);
    expect(host.querySelector(".presenter-notes")?.textContent).toContain(
      deck.slides[0].notes,
    );
  });

  it("rejects malformed state messages without crashing or replacing the current position", async () => {
    await render();
    for (const bad of [
      undefined,
      { ...state, slideId: "missing-slide" },
      { ...state, step: -1 },
      { ...state, step: 1.5 },
      { ...state, step: 100 },
      { ...state, startedAt: Number.NaN },
    ]) {
      await send({ type: "state", state: bad as unknown as PresenterState });
      expect(
        host
          .querySelector("[data-scene-slide]")
          ?.getAttribute("data-scene-slide"),
      ).toBe(deck.slides[0].id);
      expect(
        host
          .querySelector("[data-build-step]")
          ?.getAttribute("data-build-step"),
      ).toBe("0");
    }
    await send({
      type: "deck",
      deck: { ...deck, title: "Should not replace deck" },
      state: undefined as unknown as PresenterState,
    });
    expect(host.textContent).toContain(deck.title);
    expect(host.textContent).not.toContain("Should not replace deck");
    await tick(1000);
    expect(elapsed()).toBe("00:01");
  });
});
