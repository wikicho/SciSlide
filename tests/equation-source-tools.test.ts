// @vitest-environment jsdom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EquationSourceTools } from "../src/components/EquationSourceTools";
import { EquationEditorDialog } from "../src/components/EquationEditorDialog";
import { EQUATION_MACROS_KEY } from "../src/lib/equation-macros";

let host: HTMLDivElement, root: Root;
const compile = vi.fn(),
  changed = vi.fn();
function Harness({
  renderer = "mathjax",
  dialog = false,
  initial = "x+y+z",
}: {
  renderer?: "mathjax" | "local-latex";
  dialog?: boolean;
  initial?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null),
    [source, setSource] = useState(initial),
    [preamble, setPreamble] = useState("");
  const callback = (value: string, next?: string) => {
    changed(value, next);
    setSource(value);
    if (next !== undefined) setPreamble(next);
  };
  const textarea = createElement("textarea", {
    ref,
    value: source,
    "aria-label": "Test source",
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
      setSource(event.target.value),
  });
  const props = {
    sourceRef: ref,
    source,
    preamble,
    renderer,
    onSourceChange: callback,
  };
  return dialog
    ? createElement(
        EquationEditorDialog,
        {
          ...props,
          platform: "linux",
          canApply: true,
          applying: false,
          onApply: vi.fn(),
          onCompile: compile,
          onClose: vi.fn(),
        },
        textarea,
      )
    : createElement(
        "div",
        null,
        createElement(EquationSourceTools, props),
        textarea,
        createElement("output", { "aria-label": "Test preamble" }, preamble),
      );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  compile.mockReset();
  changed.mockReset();
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
const source = () =>
  host.querySelector<HTMLTextAreaElement>('[aria-label="Test source"]')!;
const button = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name,
  )!;
async function mount(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(createElement(Harness, props)));
}
async function select(start: number, end: number) {
  await act(async () => {
    source().focus();
    source().setSelectionRange(start, end);
    source().dispatchEvent(new Event("select", { bubbles: true }));
  });
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function setInput(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => source().dispatchEvent(event));
  return event;
}

describe("equation source tools", () => {
  it("colors the selected source and restores source plus caret through typing/Undo/Redo", async () => {
    await mount();
    expect(button("Color selected LaTeX").disabled).toBe(true);
    await select(2, 3);
    await click("Color selected LaTeX");
    const colored = String.raw`x+\textcolor[RGB]{198,40,40}{y}+z`;
    expect(source().value).toBe(colored);
    expect(document.activeElement).toBe(source());
    expect(
      source().value.slice(source().selectionStart, source().selectionEnd),
    ).toBe("y");
    await setInput("Test source", colored + "+q");
    await key("z");
    expect(source().value).toBe(colored);
    await key("z");
    expect(source().value).toBe("x+y+z");
    expect(source().selectionStart).toBe(2);
    expect(source().selectionEnd).toBe(3);
    await key("z", { shiftKey: true });
    expect(source().value).toBe(colored);
    expect(
      source().value.slice(source().selectionStart, source().selectionEnd),
    ).toBe("y");
  });
  it("saves a local favorite, reuses its definitions, and leaves equations intact when favorite is removed", async () => {
    await mount();
    await click("Save favorite");
    expect(
      JSON.parse(localStorage.getItem(EQUATION_MACROS_KEY)!).entries,
    ).toHaveLength(1);
    await select(5, 5);
    await click("Insert command");
    const applied = source().value;
    expect(applied).toContain(String.raw`\newcommand{\RR}{\mathbb{R}}`);
    expect(applied).toContain(String.raw`x+y+z\RR`);
    await click("Remove favorite");
    expect(source().value).toBe(applied);
    expect(
      JSON.parse(localStorage.getItem(EQUATION_MACROS_KEY)!).entries,
    ).toEqual([]);
  });
  it("adds Local LaTeX definitions to preamble as one undoable edit and never compiles automatically", async () => {
    await mount({ renderer: "local-latex", dialog: true });
    await select(2, 3);
    await click("Apply definitions");
    expect(source().value).toBe("x+y+z");
    expect(changed).toHaveBeenLastCalledWith(
      "x+y+z",
      String.raw`\newcommand{\RR}{\mathbb{R}}` + "\n",
    );
    expect(compile).not.toHaveBeenCalled();
    await key("z");
    expect(changed).toHaveBeenLastCalledWith("x+y+z", "");
    await key("y");
    expect(changed).toHaveBeenLastCalledWith(
      "x+y+z",
      String.raw`\newcommand{\RR}{\mathbb{R}}` + "\n",
    );
    expect(compile).not.toHaveBeenCalled();
  });
  it("does not overwrite a corrupt store or lose edits when persistence fails", async () => {
    localStorage.setItem(EQUATION_MACROS_KEY, "{broken");
    await mount();
    expect(button("Save favorite").disabled).toBe(true);
    expect(localStorage.getItem(EQUATION_MACROS_KEY)).toBe("{broken");
    expect(host.textContent).toContain("could not be loaded");
    localStorage.removeItem(EQUATION_MACROS_KEY);
    await click("Reload favorites");
    await setInput("Command favorite name", "My command");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await click("Save favorite");
    expect(host.textContent).toContain("quota exceeded");
    expect(
      host.querySelector<HTMLInputElement>(
        '[aria-label="Command favorite name"]',
      )!.value,
    ).toBe("My command");
    expect(localStorage.getItem(EQUATION_MACROS_KEY)).toBeNull();
  });
  it("keeps clipboard and IME shortcuts native while source undo stays inside the editor", async () => {
    await mount();
    expect((await key("c")).defaultPrevented).toBe(false);
    expect((await key("z", { isComposing: true })).defaultPrevented).toBe(
      false,
    );
    expect((await key("z")).defaultPrevented).toBe(true);
    expect(source().value).toBe("x+y+z");
  });
  it("preserves another window's newly saved favorites and rejects stale replacement", async () => {
    await mount();
    const other = {
      id: "other",
      name: "Other window",
      definitions: String.raw`\newcommand{\otherWindow}{x}`,
      invocation: String.raw`\otherWindow`,
    };
    localStorage.setItem(
      EQUATION_MACROS_KEY,
      JSON.stringify({ version: 1, entries: [other] }),
    );
    await click("Save favorite");
    const saved = JSON.parse(localStorage.getItem(EQUATION_MACROS_KEY)!);
    expect(saved.entries).toHaveLength(2);
    expect(saved.entries[0]).toEqual(other);
    saved.entries[1].name = "Changed elsewhere";
    localStorage.setItem(EQUATION_MACROS_KEY, JSON.stringify(saved));
    await click("Save favorite");
    expect(host.textContent).toContain("changed in another window");
    expect(
      JSON.parse(localStorage.getItem(EQUATION_MACROS_KEY)!).entries[1].name,
    ).toBe("Changed elsewhere");
  });
  it("treats IME composition as one undo unit and accepts native history input commands", async () => {
    await mount({ initial: "" });
    await act(async () =>
      source().dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    await setInput("Test source", "ㅎ");
    await setInput("Test source", "한");
    await act(async () =>
      source().dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "한" }),
      ),
    );
    const undo = new InputEvent("beforeinput", {
      inputType: "historyUndo",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => source().dispatchEvent(undo));
    expect(undo.defaultPrevented).toBe(true);
    expect(source().value).toBe("");
    const redo = new InputEvent("beforeinput", {
      inputType: "historyRedo",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => source().dispatchEvent(redo));
    expect(redo.defaultPrevented).toBe(true);
    expect(source().value).toBe("한");
  });
});
