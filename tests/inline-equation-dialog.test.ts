// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { InlineEquationDialog } from "../src/components/InlineEquationDialog";
import type { InlineEquationDialogProps } from "../src/components/InlineEquationDialog";
import * as equations from "../src/lib/equations";
import type { RenderedEquation } from "../src/lib/equations";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function preview(label = "current"): RenderedEquation {
  return {
    svg: `<svg width="40" height="20" data-equation="${label}"><path d="M0 0L1 1" /></svg>`,
    width: 40,
    height: 20,
    baseline: 14,
    xHeight: 8,
  };
}

describe("inline equation dialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: InlineEquationDialogProps;
  let renderer: MockInstance<typeof equations.renderEquation>;
  const parentPointer = vi.fn();
  const parentKey = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    renderer = vi.spyOn(equations, "renderEquation");
    parentPointer.mockClear();
    parentKey.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      initialLatex: "U(1)",
      font: "mathjax-stix2",
      fontSize: 32,
      color: "#17263c",
      platform: "linux",
      onApply: vi.fn(),
      onCancel: vi.fn(),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(overrides: Partial<InlineEquationDialogProps> = {}) {
    props = { ...props, ...overrides };
    await act(async () =>
      root.render(
        createElement(
          "div",
          { onPointerDown: parentPointer, onKeyDown: parentKey },
          createElement(InlineEquationDialog, props),
        ),
      ),
    );
  }

  function source() {
    return host.querySelector<HTMLTextAreaElement>(
      '[aria-label="Inline equation source"]',
    )!;
  }

  function button(label: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === label ||
        candidate.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing equation control: ${label}`);
    return found;
  }

  async function input(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(source(), value);
      source().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function key(
    value: string,
    options: KeyboardEventInit = {},
    target: EventTarget = source(),
  ) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  it("renders real inline MathJax, selects the source once, and applies raw LaTeX", async () => {
    await mount();
    await act(async () => renderer.mock.results[0].value);
    const dialog = host.querySelector("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      document.getElementById(dialog.getAttribute("aria-labelledby")!)
        ?.textContent,
    ).toBe("Insert inline equation");
    expect(document.activeElement).toBe(source());
    expect(source().selectionStart).toBe(0);
    expect(source().selectionEnd).toBe(4);
    expect(renderer).toHaveBeenCalledWith(
      "U(1)",
      "mathjax-stix2",
      32,
      "#17263c",
      false,
    );
    expect(
      host.querySelector('[aria-label="Inline equation preview"] svg path'),
    ).not.toBeNull();
    expect(button("Insert equation").disabled).toBe(false);
    source().setSelectionRange(2, 2);
    await mount();
    expect(source().selectionStart).toBe(2);
    expect(source().selectionEnd).toBe(2);
    await act(async () => button("Insert equation").click());
    expect(props.onApply).toHaveBeenCalledExactlyOnceWith("U(1)");
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("keeps white equation glyphs visible on a contrasting preview surface", async () => {
    await mount({ color: "#ffffff" });
    await act(async () => renderer.mock.results[0].value);
    const container = host.querySelector(
      '[aria-label="Inline equation preview"]',
    )!;
    expect(container.classList.contains("is-dark")).toBe(true);
    expect(container.innerHTML).toContain('fill="#ffffff"');
    expect(button("Insert equation").disabled).toBe(false);
  });

  it("discards stale render results and requires a current preview before applying", async () => {
    const first = deferred<RenderedEquation>();
    const latest = deferred<RenderedEquation>();
    renderer
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latest.promise);
    await mount();
    expect(button("Insert equation").disabled).toBe(true);
    await input("x^2");
    expect(button("Insert equation").disabled).toBe(true);
    await key("Enter", { ctrlKey: true });
    expect(props.onApply).not.toHaveBeenCalled();
    await act(async () => first.resolve(preview("old")));
    expect(host.querySelector("[data-equation]")).toBeNull();
    expect(button("Insert equation").disabled).toBe(true);
    await act(async () => latest.resolve(preview("new")));
    expect(
      host.querySelector("[data-equation]")?.getAttribute("data-equation"),
    ).toBe("new");
    await key("Enter", { ctrlKey: true });
    expect(props.onApply).toHaveBeenCalledExactlyOnceWith("x^2");
  });

  it("discards stale render errors and replaces the preview after style changes", async () => {
    const first = deferred<RenderedEquation>();
    renderer.mockReturnValueOnce(first.promise).mockResolvedValue(preview());
    await mount();
    await input("x");
    await act(async () => first.reject(new Error("Outdated error")));
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(button("Insert equation").disabled).toBe(false);
    const styled = deferred<RenderedEquation>();
    renderer.mockReturnValueOnce(styled.promise);
    await mount({ font: "mathjax-fira", fontSize: 40, color: "#123456" });
    expect(button("Insert equation").disabled).toBe(true);
    expect(host.querySelector("[data-equation]")).toBeNull();
    expect(renderer).toHaveBeenLastCalledWith(
      "x",
      "mathjax-fira",
      40,
      "#123456",
      false,
    );
    await act(async () => styled.resolve(preview("styled")));
    expect(button("Insert equation").disabled).toBe(false);
  });

  it("uses edit labels and the platform shortcut to apply the current equation", async () => {
    renderer.mockResolvedValue(preview());
    await mount({ editing: true, platform: "mac", initialLatex: "  U(1)  " });
    expect(host.querySelector("h2")?.textContent).toBe("Edit inline equation");
    expect(button("Apply equation").disabled).toBe(false);
    await key("Enter", { ctrlKey: true });
    expect(props.onApply).not.toHaveBeenCalled();
    await key("Enter", { metaKey: true });
    await key("Enter", { metaKey: true, repeat: true });
    expect(props.onApply).toHaveBeenCalledExactlyOnceWith("U(1)");
  });

  it("allows editing and canceling after the parent rejects an insertion", async () => {
    renderer.mockResolvedValue(preview());
    const onApply = vi.fn().mockReturnValue(false);
    await mount({ onApply });
    await act(async () => button("Insert equation").click());
    expect(onApply).toHaveBeenCalledExactlyOnceWith("U(1)");
    await input("SU(2)");
    await key("Enter", { ctrlKey: true });
    expect(onApply.mock.calls).toEqual([["U(1)"], ["SU(2)"]]);
    await act(async () => button("Cancel").click());
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it.each(["$U(1)$", String.raw`\(U(1)\)`, String.raw`\[U(1)\]`])(
    "rejects math delimiters in %s before rendering",
    async (initialLatex) => {
      await mount({ initialLatex });
      expect(renderer).not.toHaveBeenCalled();
      expect(button("Insert equation").disabled).toBe(true);
      expect(host.querySelector("[role=alert]")?.textContent).toContain(
        "without",
      );
    },
  );

  it("accepts an aligned row break followed by parentheses as real LaTeX", async () => {
    const initialLatex = String.raw`\begin{aligned}a\\(b)\end{aligned}`;
    await mount({ initialLatex });
    await act(async () => renderer.mock.results[0].value);
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(button("Insert equation").disabled).toBe(false);
    expect(
      host.querySelector('[aria-label="Inline equation preview"] svg path'),
    ).not.toBeNull();
  });

  it("requires nonempty source, reports render errors, and enforces the renderer source limit", async () => {
    renderer.mockRejectedValue(new Error("Undefined control sequence"));
    await mount({ initialLatex: "  " });
    expect(renderer).not.toHaveBeenCalled();
    expect(button("Insert equation").disabled).toBe(true);
    await input(String.raw`\unknowncommand`);
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      "Undefined control sequence",
    );
    expect(button("Insert equation").disabled).toBe(true);
    const calls = renderer.mock.calls.length;
    await input("x".repeat(12_001));
    expect(source().maxLength).toBe(12_000);
    expect(host.querySelector("[role=alert]")?.textContent).toContain("12,000");
    expect(renderer).toHaveBeenCalledTimes(calls);
  });

  it("traps Tab and preserves native clipboard and text undo while keeping events inside the modal", async () => {
    renderer.mockResolvedValue(preview());
    await mount();
    button("Insert equation").focus();
    expect(
      (await key("Tab", {}, button("Insert equation"))).defaultPrevented,
    ).toBe(true);
    expect(document.activeElement).toBe(button("Close inline equation"));
    await key("Tab", { shiftKey: true }, button("Close inline equation"));
    expect(document.activeElement).toBe(button("Insert equation"));
    source().focus();
    for (const value of ["a", "c", "v", "z"]) {
      expect((await key(value, { ctrlKey: true })).defaultPrevented).toBe(
        false,
      );
    }
    for (const value of ["ArrowLeft", "Home", "PageDown", "Backspace"]) {
      expect((await key(value)).defaultPrevented).toBe(false);
    }
    expect((await key("s", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(
      (await key("p", { ctrlKey: true, altKey: true })).defaultPrevented,
    ).toBe(true);
    expect(parentKey).not.toHaveBeenCalled();
    await act(async () =>
      source().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    );
    expect(parentPointer).not.toHaveBeenCalled();
    expect(props.onApply).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("ignores Escape and apply shortcuts during IME composition, then cancels normally", async () => {
    renderer.mockResolvedValue(preview());
    await mount();
    await act(async () =>
      source().dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    expect((await key("Escape")).defaultPrevented).toBe(false);
    await key("Enter", { ctrlKey: true });
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onApply).not.toHaveBeenCalled();
    await act(async () =>
      source().dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    await key("Escape", { isComposing: true });
    expect(props.onCancel).not.toHaveBeenCalled();
    expect((await key("Escape")).defaultPrevented).toBe(true);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels only for a direct backdrop click, close, or Cancel action", async () => {
    renderer.mockResolvedValue(preview());
    await mount();
    await act(async () => source().click());
    expect(props.onCancel).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLDivElement>(".inline-equation-backdrop")!.click(),
    );
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onApply).not.toHaveBeenCalled();
  });
});
