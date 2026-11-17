// @vitest-environment jsdom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TextFormattingTools } from "../src/components/TextFormattingTools";
import type { TextStyleRange } from "../src/lib/model";

let host: HTMLDivElement, root: Root;
const changed = vi.fn();
function Harness({
  initial = "Red blue",
  initialStyles = [],
}: {
  initial?: string;
  initialStyles?: TextStyleRange[];
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  const [styles, setStyles] = useState(initialStyles);
  return createElement(
    "div",
    null,
    createElement(TextFormattingTools, {
      fieldRef: field,
      value,
      styles,
      onChange(next, ranges) {
        changed(next, ranges);
        setValue(next);
        setStyles(ranges);
      },
    }),
    createElement("textarea", { ref: field, value, readOnly: true }),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  changed.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const field = () => host.querySelector("textarea")!;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find(
    (item) => item.textContent === name,
  )!;
async function mount(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(createElement(Harness, props)));
}
async function select(start: number, end: number) {
  await act(async () => {
    field().focus();
    field().setSelectionRange(start, end);
    field().dispatchEvent(new Event("select", { bubbles: true }));
  });
}
async function click(name: string) {
  await act(async () => button(name).click());
}

it("paints only the selected prose, preserves the caret, and resets only that range", async () => {
  await mount();
  expect(button("Color selection").disabled).toBe(true);
  await select(4, 8);
  await click("Color selection");
  expect(changed).toHaveBeenLastCalledWith("Red blue", [
    { start: 4, end: 8, color: "#c43131" },
  ]);
  expect(document.activeElement).toBe(field());
  expect([field().selectionStart, field().selectionEnd]).toEqual([4, 8]);
  await select(5, 7);
  await click("Reset color");
  expect(changed).toHaveBeenLastCalledWith("Red blue", [
    { start: 4, end: 5, color: "#c43131" },
    { start: 7, end: 8, color: "#c43131" },
  ]);
});
it("adds and removes bullets across selected lines without moving existing colors", async () => {
  await mount({
    initial: "Red\nblue",
    initialStyles: [{ start: 4, end: 8, color: "#123456" }],
  });
  await select(0, 8);
  await click("• Bullets");
  expect(field().value).toBe("• Red\n• blue");
  expect(changed.mock.lastCall?.[1]).toEqual([
    { start: 8, end: 12, color: "#123456" },
  ]);
  await click("• Bullets");
  expect(field().value).toBe("Red\nblue");
  expect(changed.mock.lastCall?.[1]).toEqual([
    { start: 4, end: 8, color: "#123456" },
  ]);
});
it("colors a selected inline formula term with portable LaTeX and keeps delimiters", async () => {
  await mount({ initial: "Value $x+y$ remains" });
  await select(9, 10);
  await click("Color selection");
  expect(field().value).toBe(
    String.raw`Value $x+\textcolor[RGB]{196,49,49}{y}$ remains`,
  );
  expect(
    field().value.slice(field().selectionStart, field().selectionEnd),
  ).toBe("y");
});
it("reports an incomplete LaTeX selection without changing the source", async () => {
  await mount({ initial: String.raw`Value $\frac{x}{y}$` });
  await select(8, 11);
  await click("Color selection");
  expect(changed).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
});
