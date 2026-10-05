// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EquationLibraryDialog } from "../src/components/EquationLibraryDialog";
import {
  createEquationLibraryEntry,
  parseEquationLibrary,
  saveEquationLibrary,
} from "../src/lib/equation-library";
import { downloadBlob } from "../src/lib/persistence";

const { saveExport } = vi.hoisted(() => ({ saveExport: vi.fn() }));
vi.mock("../src/lib/desktop", () => ({
  desktop: { saveExport },
  DEFAULT_LOCAL_PREAMBLE: "",
}));
vi.mock("../src/lib/equations", () => ({
  renderEquation: vi.fn(),
  MATH_PROFILE_REVISION: "test",
  DEFAULT_TEX_PACKAGES: [],
}));
vi.mock("../src/lib/persistence", async (original) => ({
  ...(await original<typeof import("../src/lib/persistence")>()),
  downloadBlob: vi.fn(),
}));

describe("desktop equation library export", () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    saveExport.mockReset();
    vi.mocked(downloadBlob).mockReset();
    const entry = createEquationLibraryEntry("Reusable", {
      latex: "a+b",
      style: {},
      displayMode: true,
      description: "Example",
    });
    saveEquationLibrary([entry]);
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
  async function render() {
    await act(async () =>
      root.render(
        createElement(EquationLibraryDialog, {
          onClose: vi.fn(),
          onInsert: vi.fn(),
        }),
      ),
    );
  }
  function exportButton() {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Export library",
    )!;
  }
  async function exportLibrary() {
    await act(async () => exportButton().click());
  }

  it("exports validated JSON through the native save dialog and reports success only after saving", async () => {
    let finish!: (value: { path: string; name: string }) => void;
    saveExport.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await exportLibrary();
    expect(saveExport).toHaveBeenCalledOnce();
    const request = saveExport.mock.calls[0][0];
    expect(request.kind).toBe("json");
    expect(request.suggestedName).toBe("scislide-equations.json");
    expect(
      parseEquationLibrary(new TextDecoder().decode(request.bytes))[0].name,
    ).toBe("Reusable");
    expect(exportButton().disabled).toBe(true);
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(downloadBlob).not.toHaveBeenCalled();
    await act(async () =>
      finish({
        path: "/tmp/scislide-equations.json",
        name: "scislide-equations.json",
      }),
    );
    expect(exportButton().disabled).toBe(false);
    expect(host.querySelector("[role=status]")?.textContent).toContain(
      "내보냈습니다",
    );
  });

  it("does not report success after cancellation and preserves the library on save failure", async () => {
    saveExport.mockResolvedValueOnce(null);
    await render();
    await exportLibrary();
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(host.querySelector("[role=alert]")).toBeNull();
    saveExport.mockRejectedValueOnce(new Error("Disk is full"));
    await exportLibrary();
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "Disk is full",
    );
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(exportButton().disabled).toBe(false);
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
