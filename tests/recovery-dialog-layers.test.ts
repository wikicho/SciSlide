// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const themeCss = readFileSync("src/components/ThemeChooser.css", "utf8");
const saveCss = readFileSync("src/components/SaveChangesDialog.css", "utf8");
const historyCss = readFileSync(
  "src/components/RecoveryHistoryDialog.css",
  "utf8",
);
const globalCss = readFileSync("src/styles.css", "utf8");

// jsdom 26 deliberately omits selector specificity. Resolve matching layer
// rules by class/ID specificity rather than its order-only computed style.
function layer(element: HTMLElement, sheet: CSSStyleSheet): number {
  const matching = [...sheet.cssRules].flatMap((rule, order) => {
    if (!("selectorText" in rule) || !("style" in rule)) return [];
    const styleRule = rule as CSSStyleRule;
    const value = styleRule.style.getPropertyValue("z-index");
    if (!value) return [];
    return styleRule.selectorText
      .split(",")
      .filter((selector) => element.matches(selector))
      .map((selector) => ({
        value: Number(value),
        order,
        specificity:
          (selector.match(/#[\w-]+/g)?.length ?? 0) * 100 +
          (selector.match(/\.[\w-]+/g)?.length ?? 0) * 10,
      }));
  });
  matching.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  return matching.at(-1)?.value ?? 0;
}

describe("document safety modal visibility", () => {
  it("keeps recovery and save confirmation above the chooser regardless of stylesheet order", () => {
    for (const css of [
      themeCss + saveCss + historyCss + globalCss,
      globalCss + themeCss + historyCss + saveCss,
    ]) {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
      const chooser = document.createElement("div"),
        recovery = document.createElement("div"),
        save = document.createElement("div");
      chooser.className = "theme-chooser";
      recovery.className = "modal-backdrop recovery-history-backdrop";
      save.className = "modal-backdrop save-changes-backdrop";
      document.body.append(chooser, recovery, save);
      expect(layer(recovery, style.sheet!)).toBeGreaterThan(
        layer(chooser, style.sheet!),
      );
      expect(layer(save, style.sheet!)).toBeGreaterThan(
        layer(recovery, style.sheet!),
      );
      chooser.remove();
      recovery.remove();
      save.remove();
      style.remove();
    }
  });
});
