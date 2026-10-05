// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EquationLibraryDialog } from "../src/components/EquationLibraryDialog";
import { renderEquation } from "../src/lib/equations";
import {
  createEquationLibraryEntry,
  EQUATION_LIBRARY_KEY,
  loadEquationLibrary,
  saveEquationLibrary,
  serializeEquationLibrary,
} from "../src/lib/equation-library";
import type {
  EquationLibraryEntry,
  EquationLibraryEquation,
} from "../src/lib/equation-library";

vi.mock("../src/lib/equations", () => ({
  renderEquation: vi.fn(),
  MATH_PROFILE_REVISION: "test",
  DEFAULT_TEX_PACKAGES: [],
}));

function formula(): EquationLibraryEquation {
  return {
    latex: String.raw`H^2 = \frac{8\pi G}{3}\rho`,
    description: "Cosmic expansion",
    displayMode: true,
    renderer: "mathjax",
    style: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#111827" },
  };
}

describe("personal equation library dialog", () => {
  let root: Root, host: HTMLDivElement, opener: HTMLButtonElement;
  let onInsert: ReturnType<
    typeof vi.fn<
      (entry: EquationLibraryEntry) => boolean | void | Promise<boolean | void>
    >
  >;
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(renderEquation).mockReset();
    vi.mocked(renderEquation).mockResolvedValue({
      svg: '<svg viewBox="0 0 100 50"><path d="M0 0L100 50"/></svg>',
      width: 100,
      height: 50,
    });
    host = document.createElement("div");
    opener = document.createElement("button");
    document.body.append(opener, host);
    opener.focus();
    root = createRoot(host);
    onInsert = vi.fn();
    onClose = vi.fn();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    opener.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(initialEquation?: EquationLibraryEquation) {
    await act(async () =>
      root.render(
        createElement(EquationLibraryDialog, {
          onClose,
          onInsert,
          initialEquation,
        }),
      ),
    );
  }
  function field(label: string) {
    return host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[aria-label='${label}']`,
    )!;
  }
  async function input(label: string, value: string) {
    const element = field(label);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function button(label: string) {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) =>
        item.textContent?.trim() === label ||
        item.getAttribute("aria-label") === label,
    );
    if (!result) throw new Error(`Missing equation-library button: ${label}`);
    return result;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function importJson(source: string) {
    const upload = host.querySelector<HTMLInputElement>("input[type=file]")!;
    const file = new File([source], "equations.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(source),
    });
    Object.defineProperty(upload, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      upload.dispatchEvent(new Event("change", { bubbles: true })),
    );
  }

  it("saves current source, filters saved equations by tags, and inserts the selected equation", async () => {
    await render(formula());
    await input("Saved equation name", "Friedmann");
    await input("Saved equation tags", "cosmology, expansion");
    await click("Save equation");
    expect(loadEquationLibrary()).toHaveLength(1);
    expect(loadEquationLibrary()[0].equation.latex).toBe(formula().latex);
    await click("New equation");
    await input("Saved equation name", "Mass energy");
    await input("Library LaTeX source", "E=mc^2");
    await input("Saved equation tags", "relativity");
    await click("Save equation");
    expect(loadEquationLibrary()).toHaveLength(2);
    await input("Search saved equations", "cosmology");
    const matches = host.querySelectorAll(
      "nav[aria-label='Saved equations'] button",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent).toContain("Friedmann");
    await act(async () => (matches[0] as HTMLButtonElement).click());
    await click("Insert into slide");
    expect(onInsert).toHaveBeenCalledOnce();
    expect(onInsert.mock.calls[0][0].equation.latex).toBe(formula().latex);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("merges a JSON import and keeps saved entries when an import is invalid", async () => {
    const existing = createEquationLibraryEntry("Existing", formula());
    saveEquationLibrary([existing]);
    await render();
    const additional = createEquationLibraryEntry(
      "Imported",
      { ...formula(), latex: "a+b" },
      ["algebra"],
    );
    await importJson(serializeEquationLibrary([additional]));
    expect(loadEquationLibrary().map((entry) => entry.name)).toEqual([
      "Existing",
      "Imported",
    ]);
    await importJson(serializeEquationLibrary([additional]));
    expect(loadEquationLibrary()).toHaveLength(2);
    await importJson('{"format":"bad","version":1,"entries":[]}');
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "라이브러리",
    );
    expect(loadEquationLibrary()).toHaveLength(2);
  });

  it("keeps local source and preamble editable and never compiles them automatically", async () => {
    const local = {
      ...formula(),
      renderer: "local-latex" as const,
      localTex: {
        engine: "xelatex" as const,
        preamble: String.raw`\usepackage{unicode-math}`,
      },
    };
    await render(local);
    await input("Saved equation name", "Local formula");
    await input("Library LaTeX preamble", String.raw`\usepackage{amsmath}`);
    await click("Save equation");
    expect(vi.mocked(renderEquation)).not.toHaveBeenCalled();
    expect(loadEquationLibrary()[0].equation.localTex?.preamble).toBe(
      String.raw`\usepackage{amsmath}`,
    );
    await click("Insert into slide");
    expect(onInsert.mock.calls[0][0].equation.renderer).toBe("local-latex");
    expect(onInsert.mock.calls[0][0].equation.localTex).not.toHaveProperty(
      "render",
    );
  });

  it("closes on Escape and restores the opener focus", async () => {
    await render();
    expect(document.activeElement).toBe(field("Search saved equations"));
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it("waits for insertion and preserves unsaved source when insertion fails", async () => {
    await render(formula());
    await input("Saved equation name", "Unsaved formula");
    let finish!: (result: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    onInsert.mockReturnValueOnce(pending);
    await click("Insert into slide");
    expect(button("Insert into slide").disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish(false));
    expect(button("Insert into slide").disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(field("Library LaTeX source").value).toBe(formula().latex);
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "삽입하지 못했습니다",
    );
    onInsert.mockRejectedValueOnce(new Error("Typesetting failed"));
    await click("Insert into slide");
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "Typesetting failed",
    );
    expect(onClose).not.toHaveBeenCalled();
    onInsert.mockResolvedValueOnce(true);
    await click("Insert into slide");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves a corrupt saved library until an explicit valid import recovers it", async () => {
    localStorage.setItem(EQUATION_LIBRARY_KEY, "{broken");
    await render(formula());
    await input("Saved equation name", "Unsaved formula");
    expect(button("Save equation").disabled).toBe(true);
    expect(localStorage.getItem(EQUATION_LIBRARY_KEY)).toBe("{broken");
    const recovered = createEquationLibraryEntry("Recovered", formula());
    await importJson(serializeEquationLibrary([recovered]));
    expect(loadEquationLibrary()).toEqual([recovered]);
    expect(button("Save equation").disabled).toBe(false);
  });
});
