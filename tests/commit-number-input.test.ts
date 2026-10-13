// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommitNumberInput } from "../src/components/CommitNumberInput";

describe("committing an inspector number", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onCommit = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onCommit.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function render(
    value = 48,
    resetKey = "text-a",
    commit = onCommit,
    syncKey?: number,
  ) {
    await act(async () =>
      root.render(
        createElement(CommitNumberInput, {
          "aria-label": "Text size",
          value,
          min: 8,
          max: 180,
          resetKey,
          syncKey,
          onCommit: commit,
        }),
      ),
    );
    return host.querySelector<HTMLInputElement>("input")!;
  }

  async function input(field: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function blur(field: HTMLInputElement) {
    await act(async () =>
      field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
  }

  async function key(
    field: HTMLInputElement,
    value: string,
    options: KeyboardEventInit = {},
  ) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    await act(async () => field.dispatchEvent(event));
    return event;
  }

  it("allows replacing 48 with 12 without applying the intermediate 1", async () => {
    const field = await render();
    await input(field, "");
    expect(field.value).toBe("");
    await input(field, "1");
    expect(field.value).toBe("1");
    expect(onCommit).not.toHaveBeenCalled();
    await input(field, "12");
    expect(onCommit).not.toHaveBeenCalled();
    await blur(field);
    expect(field.value).toBe("12");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(12);
  });

  it("clamps only when a typed number is committed", async () => {
    const field = await render();
    await input(field, "3");
    expect(field.value).toBe("3");
    expect(onCommit).not.toHaveBeenCalled();
    await blur(field);
    expect(field.value).toBe("8");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(8);
    onCommit.mockClear();
    await input(field, "250");
    expect(field.value).toBe("250");
    await key(field, "Enter");
    expect(field.value).toBe("180");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(180);
    await blur(field);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("restores empty or invalid input without writing a minimum value", async () => {
    const field = await render();
    await input(field, "");
    await blur(field);
    expect(field.value).toBe("48");
    await input(field, "invalid");
    await key(field, "Enter");
    expect(field.value).toBe("48");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape restores the current value and does not commit on later blur", async () => {
    const field = await render();
    await input(field, "12");
    const event = await key(field, "Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(field.value).toBe("48");
    await blur(field);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits arrow steps immediately and keeps them inside the limits", async () => {
    const field = await render(8);
    await key(field, "ArrowDown");
    expect(field.value).toBe("8");
    expect(onCommit).not.toHaveBeenCalled();
    await key(field, "ArrowUp");
    expect(field.value).toBe("9");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(9);
    await input(field, "179");
    await key(field, "ArrowUp");
    expect(field.value).toBe("180");
    await key(field, "ArrowUp");
    await blur(field);
    expect(onCommit.mock.calls).toEqual([[9], [180]]);
  });

  it("starts an arrow step from the last committed value if the draft is empty", async () => {
    const field = await render();
    await input(field, "");
    await key(field, "ArrowDown");
    expect(field.value).toBe("47");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(47);
  });

  it("preserves an unfinished draft across unrelated rerenders and syncs external changes", async () => {
    const field = await render();
    await input(field, "1");
    await render();
    expect(field.value).toBe("1");
    await render(72);
    expect(field.value).toBe("72");
    await blur(field);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("discards a previous object's draft when selection changes, even at the same value", async () => {
    const previous = await render();
    await input(previous, "12");
    const nextCommit = vi.fn();
    const next = await render(48, "text-b", nextCommit);
    expect(next).not.toBe(previous);
    expect(next.value).toBe("48");
    await blur(previous);
    await blur(next);
    expect(onCommit).not.toHaveBeenCalled();
    expect(nextCommit).not.toHaveBeenCalled();
    await input(next, "24");
    await key(next, "Enter");
    expect(nextCommit).toHaveBeenCalledExactlyOnceWith(24);
  });

  it("resets a draft when its saved source changes without replacing the focused field", async () => {
    const field = await render(48, "text-a", onCommit, 24);
    expect(field.hasAttribute("data-commit-number-input")).toBe(true);
    await act(async () => field.focus());
    await input(field, "12");
    const updated = await render(48, "text-a", onCommit, 30);
    expect(updated).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("48");
    expect(field.hasAttribute("syncKey")).toBe(false);
    await blur(field);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("leaves native editing shortcuts and navigation keys available", async () => {
    const field = await render();
    for (const [value, options] of [
      ["z", { ctrlKey: true }],
      ["a", { metaKey: true }],
      ["ArrowLeft", {}],
      ["Backspace", {}],
      ["Tab", {}],
    ] as const) {
      const event = await key(field, value, options);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onCommit).not.toHaveBeenCalled();
  });
});
