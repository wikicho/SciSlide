// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryHistoryDialog } from "../src/components/RecoveryHistoryDialog";
import { SaveChangesDialog } from "../src/components/SaveChangesDialog";
import type { DocumentRecoverySummary } from "../src/lib/recovery-history";

const entries: DocumentRecoverySummary[] = [
  {
    id: "session-a",
    deckId: "deck-a",
    title: "Talk A",
    savedAt: "2026-11-14T00:00:00.000Z",
    slideCount: 2,
    draftCount: 1,
    bytes: 1024,
  },
];

describe("recovery dialog keyboard focus", () => {
  let host: HTMLDivElement;
  let launcher: HTMLButtonElement;
  let root: Root;
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const onRestore = vi.fn();
  const onRemove = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onChoose.mockClear();
    onClose.mockClear();
    onRestore.mockClear();
    onRemove.mockClear();
    launcher = document.createElement("button");
    launcher.textContent = "Recovered documents";
    host = document.createElement("div");
    document.body.append(launcher, host);
    launcher.focus();
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    launcher.remove();
    vi.unstubAllGlobals();
  });

  async function render({ save = false, busy = false, loading = false } = {}) {
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          save
            ? createElement(SaveChangesDialog, {
                key: "save",
                title: "Talk A",
                allowRecovery: true,
                onChoose,
              })
            : null,
          createElement(RecoveryHistoryDialog, {
            key: "history",
            entries,
            unavailableCount: 0,
            loading,
            busy,
            suspended: save,
            error: "",
            onRestore,
            onRemove,
            onClose,
          }),
        ),
      ),
    );
  }
  function button(label: string, container: Element = host) {
    const found = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (node) =>
        node.getAttribute("aria-label") === label ||
        node.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  async function click(label: string, container: Element = host) {
    await act(async () => button(label, container).click());
  }
  async function key(
    key: string,
    shiftKey = false,
    target: Element = document.activeElement!,
  ) {
    const event = new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }
  const history = () =>
    host.querySelector<HTMLDivElement>(".recovery-history-dialog")!;
  const save = () =>
    host.querySelector<HTMLDivElement>(".save-changes-dialog")!;

  it("keeps focus on the top Save Cancel while the lower history dialog becomes busy", async () => {
    await render();
    button("Open recovery for Talk A").focus();
    await render({ save: true, busy: true });
    expect(document.activeElement).toBe(button("Cancel", save()));
    expect(history().getAttribute("aria-hidden")).toBe("true");
    expect(history().hasAttribute("inert")).toBe(true);
    await render({ save: true, busy: false, loading: true });
    expect(document.activeElement).toBe(button("Cancel", save()));
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(["Cancel", "Keep recovery and continue"])(
    "returns focus to history after top %s, and traps history Tab/Escape",
    async (choice) => {
      await render();
      const original = button("Open recovery for Talk A");
      original.focus();
      await render({ save: true, busy: true });
      expect((await key("Tab", true)).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(button("Save changes", save()));
      expect((await key("Tab")).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(button("Cancel", save()));
      await click(choice, save());
      expect(onChoose).toHaveBeenCalledExactlyOnceWith(
        choice === "Cancel" ? "cancel" : "recover",
      );
      await render();
      expect(history().contains(document.activeElement)).toBe(true);
      expect(history().hasAttribute("inert")).toBe(false);
      const first = button("Close recovered documents"),
        last = button("Remove recovery for Talk A");
      last.focus();
      expect((await key("Tab")).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);
      expect((await key("Tab", true)).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);
      expect((await key("Escape")).defaultPrevented).toBe(true);
      expect(onClose).toHaveBeenCalledExactlyOnceWith();
      expect(onRemove).not.toHaveBeenCalled();
    },
  );

  it("keeps top Escape inside Save and restores history focus when confirmation closes", async () => {
    await render();
    button("Open recovery for Talk A").focus();
    await render({ save: true, busy: true });
    expect((await key("Escape")).defaultPrevented).toBe(true);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("cancel");
    expect(onClose).not.toHaveBeenCalled();
    await render();
    expect(history().contains(document.activeElement)).toBe(true);
  });

  it.each(["Cancel removal", "Escape"])(
    "keeps the original copy when inline Remove is cancelled with %s",
    async (choice) => {
      const original = structuredClone(entries);
      await render();
      const remove = button("Remove recovery for Talk A");
      remove.focus();
      await click("Remove recovery for Talk A");
      expect(
        host.querySelector(".recovery-history-remove-confirm"),
      ).toBeTruthy();
      expect(document.activeElement).toBe(button("Cancel removal"));
      expect(onRemove).not.toHaveBeenCalled();
      if (choice === "Escape") {
        button("Cancel removal").focus();
        expect((await key("Escape")).defaultPrevented).toBe(true);
      } else await click("Cancel removal");
      expect(host.querySelector(".recovery-history-remove-confirm")).toBeNull();
      expect(button("Open recovery for Talk A")).toBeTruthy();
      expect(history().contains(document.activeElement)).toBe(true);
      expect(entries).toEqual(original);
      expect(onRemove).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("allows Close while reading the list and blocks Close/Escape during restore work", async () => {
    await render({ loading: true });
    expect(history().getAttribute("aria-busy")).toBe("true");
    expect(button("Close recovered documents").disabled).toBe(false);
    await click("Close recovered documents");
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    await render({ busy: true });
    expect(button("Close recovered documents").disabled).toBe(true);
    expect(document.activeElement).toBe(history());
    await click("Close recovered documents");
    expect((await key("Escape")).defaultPrevented).toBe(true);
    expect((await key("Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(history());
    expect(onClose).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
  });
});
