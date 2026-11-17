import { expect, it, vi } from "vitest";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { renderEquation } from "../src/lib/equations";

it("shares active failures without caching errors or leaking equation-local macros", async () => {
  await renderEquation("x+0.31237891", "mathjax-modern", 31, "#123456");
  const convert = vi.spyOn(mathjax, "document");
  try {
    const recursive = String.raw`\newcommand{\queueRetryMacro}{\queueRetryMacro}\queueRetryMacro`;
    const requests = await Promise.allSettled(
      Array.from({ length: 40 }, () =>
        renderEquation(recursive, "mathjax-modern", 31, "#123456"),
      ),
    );
    expect(requests.every((result) => result.status === "rejected")).toBe(true);
    expect(convert).toHaveBeenCalledTimes(1);
    await expect(
      renderEquation(recursive, "mathjax-modern", 31, "#123456"),
    ).rejects.toThrow();
    expect(convert).toHaveBeenCalledTimes(2);
    const defined = String.raw`\newcommand{\queueRetryMacro}{x^2}\queueRetryMacro`;
    const isolated = await Promise.allSettled([
      renderEquation(defined, "mathjax-modern", 31, "#123456"),
      renderEquation(defined, "mathjax-modern", 31, "#123456"),
      renderEquation(
        String.raw`\queueRetryMacro`,
        "mathjax-modern",
        31,
        "#123456",
      ),
    ]);
    expect(isolated.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(convert).toHaveBeenCalledTimes(4);
  } finally {
    convert.mockRestore();
  }
});

it("returns independent metadata to active callers and leaves cached output intact", async () => {
  const latex = String.raw`\Finv+\Game+\nleqslant+\mathbb{01}+\digamma+0.31237891`;
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      renderEquation(latex, "mathjax-modern", 31, "#182736"),
    ),
  );
  const original = structuredClone(results[1]);
  expect(results[0]).not.toBe(results[1]);
  expect(results[0].fallbackGlyphs?.length).toBeGreaterThan(0);
  results[0].svg = "mutated";
  results[0].width = 0;
  results[0].fallbackGlyphs!.push(123456);
  expect(results[1]).toEqual(original);
  expect(await renderEquation(latex, "mathjax-modern", 31, "#182736")).toEqual(
    original,
  );
});
