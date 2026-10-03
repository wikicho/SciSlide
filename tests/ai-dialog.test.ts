// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIDraftDialog } from "../src/components/AIDraftDialog";
import type { AIDraftApplication } from "../src/components/AIDraftDialog";
import type { AiCapabilities, AiRequest, AiResult } from "../src/lib/desktop";
import { createDemoDeck, validateDeck } from "../src/lib/model";
import type { Deck, Slide } from "../src/lib/model";
import { renderEquation } from "../src/lib/equations";
import type { RenderedEquation } from "../src/lib/equations";

// Keep the dialog's real schema, conversion, state and preflight logic. Rendering
// outlines and canvas previews belongs to the equation/scene tests and browser QA.
vi.mock("../src/lib/equations", () => ({ renderEquation: vi.fn() }));
vi.mock("../src/components/SlideScene", () => ({
  SlideScene: ({ slide }: { slide: Slide }) =>
    createElement("div", { "data-slide-preview": slide.id }, slide.title),
}));

function response(
  request: AiRequest,
  title = "Generated explanation",
): AiResult {
  return {
    provider: request.provider,
    text: JSON.stringify({
      title,
      slides: Array.from({ length: request.slideCount }, (_, index) => ({
        title: `${title} ${index + 1}`,
        bullets: ["A concise scientific point.", "An editable second point."],
        equation: "E = mc^2",
        notes: "Verify this scientific explanation before presenting.",
      })),
    }),
  };
}

function bridge() {
  return {
    detectAi: vi.fn(async (): Promise<AiCapabilities> => ({
      providers: [
        { id: "codex", label: "Codex", available: true, version: "Test CLI" },
        {
          id: "claude",
          label: "Claude Code",
          available: true,
          version: "Test CLI",
        },
        {
          id: "gemini",
          label: "Gemini CLI",
          available: false,
          reason: "Not installed",
        },
      ],
    })),
    generateAi: vi.fn(async (request: AiRequest): Promise<AiResult> =>
      response(request),
    ),
    cancelAi: vi.fn(async (_jobId: string): Promise<void> => {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("AI draft dialog and desktop bridge integration", () => {
  let host: HTMLDivElement;
  let root: Root;
  let deck: Deck;
  let api: ReturnType<typeof bridge>;
  let onApply: ReturnType<
    typeof vi.fn<(application: AIDraftApplication) => boolean>
  >;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(renderEquation).mockReset();
    vi.mocked(renderEquation).mockResolvedValue({
      svg: "<svg />",
      width: 200,
      height: 50,
    });
    deck = createDemoDeck();
    api = bridge();
    onApply = vi.fn(() => true);
    onClose = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function render(nextDeck = deck, nextSlide = nextDeck.slides[0]) {
    await act(async () =>
      root.render(
        createElement(AIDraftDialog, {
          deck: nextDeck,
          slide: nextSlide,
          api,
          onApply,
          onClose,
        }),
      ),
    );
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(host.querySelectorAll("button")).find(
      (element) =>
        element.textContent?.includes(label) ||
        element.getAttribute("aria-label") === label,
    );
    if (!found) throw new Error(`Missing dialog button: ${label}`);
    return found;
  }

  async function click(element: HTMLElement) {
    await act(async () => element.click());
  }

  async function instructions(
    text = "Explain this result to physics students.",
  ) {
    const input = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="AI slide instructions"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function finish<T>(pending: ReturnType<typeof deferred<T>>, result: T) {
    await act(async () => pending.resolve(result));
  }

  it("detects installed CLIs and leaves the document unchanged until the reviewed draft is inserted", async () => {
    const before = structuredClone(deck);
    await render();
    expect(api.detectAi).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Ready",
    );
    expect(button("Generate draft").disabled).toBe(true);
    await instructions();
    expect(button("Generate draft").disabled).toBe(false);
    await click(button("Generate draft"));
    expect(api.generateAi).toHaveBeenCalledOnce();
    expect(host.querySelectorAll("[data-slide-preview]")).toHaveLength(3);
    expect(deck).toEqual(before);
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await click(button("Insert 3 slides"));
    expect(onApply).toHaveBeenCalledOnce();
    const application = onApply.mock.calls[0][0];
    expect(application.deckId).toBe(deck.id);
    expect(application.anchorId).toBe(deck.slides[0].id);
    expect(application.slides).toHaveLength(3);
    expect(() =>
      validateDeck({
        ...deck,
        slides: [...deck.slides, ...application.slides],
      }),
    ).not.toThrow();
    expect(
      application.slides[0].objects.every(
        (object) =>
          !object.locked && ["text", "equation"].includes(object.type),
      ),
    ).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends no existing slide content by default and sends only the bounded preview when explicitly selected", async () => {
    deck.slides[0].notes = "Current slide notes. ".repeat(2000);
    await render();
    await instructions();
    await click(button("Generate draft"));
    const first = api.generateAi.mock.calls[0][0];
    expect(first.prompt).toBe("Explain this result to physics students.");
    expect(first).not.toHaveProperty("context");
    await click(
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
    );
    expect(button("Insert draft slides").disabled).toBe(true);
    const preview = host.querySelector(".ai-context pre")?.textContent;
    expect(preview).toContain(deck.title);
    expect(preview).toContain("[Context truncated]");
    await click(button("Generate draft"));
    const second = api.generateAi.mock.calls[1][0];
    expect(second.context).toBe(preview);
    expect(second.context!.length).toBeLessThanOrEqual(16_000);
    expect(second.context).not.toMatch(/data:image|assetId|dataUrl/);
  });

  it.each([
    "malformed JSON",
    "unexpected provider",
    "equation syntax",
    "oversized equation",
  ])("cannot apply a response rejected for %s", async (failure) => {
    if (failure === "malformed JSON")
      api.generateAi.mockImplementation(async (request) => ({
        provider: request.provider,
        text: "Here is a draft: {invalid}",
      }));
    else if (failure === "unexpected provider")
      api.generateAi.mockImplementation(async (request) => ({
        ...response(request),
        provider: "claude",
      }));
    else if (failure === "equation syntax")
      vi.mocked(renderEquation).mockRejectedValue(
        new Error("Unknown MathJax command"),
      );
    else
      vi.mocked(renderEquation).mockResolvedValue({
        svg: "<svg />",
        width: 100_000,
        height: 1000,
      });
    await render();
    await instructions();
    await click(button("Generate draft"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(host.querySelectorAll("[data-slide-preview]")).toHaveLength(0);
    expect(button("Insert draft slides").disabled).toBe(true);
    await click(button("Insert draft slides"));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores an older canceled CLI response while a newer request remains active", async () => {
    const older = deferred<AiResult>();
    const newer = deferred<AiResult>();
    api.generateAi
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    await render();
    await instructions();
    await click(button("Generate draft"));
    const first = api.generateAi.mock.calls[0][0];
    await click(button("Cancel generation"));
    expect(api.cancelAi).toHaveBeenCalledWith(first.jobId);
    await click(button("Generate draft"));
    const second = api.generateAi.mock.calls[1][0];
    expect(second.jobId).not.toBe(first.jobId);
    await finish(older, response(first, "Canceled response"));
    expect(button("Cancel generation")).toBeDefined();
    expect(host.textContent).not.toContain("Canceled response");
    expect(onApply).not.toHaveBeenCalled();
    await finish(newer, response(second, "Current response"));
    expect(host.textContent).toContain("Current response");
    expect(host.textContent).not.toContain("Canceled response");
    await click(button("Insert 3 slides"));
    expect(onApply.mock.calls[0][0].slides[0].title).toBe("Current response 1");
  });

  it("also ignores a canceled draft whose mathematical preflight completes later", async () => {
    const outlines = deferred<RenderedEquation>();
    vi.mocked(renderEquation).mockImplementation(() => outlines.promise);
    await render();
    await instructions();
    await click(button("Generate draft"));
    expect(renderEquation).toHaveBeenCalledOnce();
    await click(button("Cancel generation"));
    await finish(outlines, { svg: "<svg />", width: 200, height: 50 });
    expect(host.querySelectorAll("[data-slide-preview]")).toHaveLength(0);
    expect(button("Insert draft slides").disabled).toBe(true);
    expect(host.textContent).toContain("Generation canceled.");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("cancels the active desktop job when the dialog closes and ignores its eventual response", async () => {
    const pending = deferred<AiResult>();
    api.generateAi.mockImplementation(() => pending.promise);
    onClose.mockImplementation(() => root.render(null));
    await render();
    await instructions();
    await click(button("Generate draft"));
    const request = api.generateAi.mock.calls[0][0];
    await click(button("Close AI assistant"));
    expect(api.cancelAi).toHaveBeenCalledWith(request.jobId);
    expect(onClose).toHaveBeenCalledOnce();
    await finish(pending, response(request));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it.each([
    "slide content",
    "slide selection",
    "theme",
    "slide dimensions",
    "deck identity",
  ])("disables insertion when the captured %s changes", async (change) => {
    await render();
    await instructions();
    await click(button("Generate draft"));
    expect(button("Insert 3 slides").disabled).toBe(false);
    const modified = structuredClone(deck);
    let anchor = modified.slides[0];
    if (change === "slide content") anchor.notes += "An intervening edit";
    else if (change === "slide selection") anchor = modified.slides[1];
    else if (change === "theme") modified.theme.equation.color = "#a34f72";
    else if (change === "slide dimensions") modified.slideSize.width = 1920;
    else modified.id = "another-deck";
    await render(modified, anchor);
    expect(button("Insert 3 slides").disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "changed",
    );
    await click(button("Insert 3 slides"));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps a reviewed draft open if the document rejects insertion", async () => {
    onApply.mockReturnValue(false);
    await render();
    await instructions();
    await click(button("Generate draft"));
    await click(button("Insert 3 slides"));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
