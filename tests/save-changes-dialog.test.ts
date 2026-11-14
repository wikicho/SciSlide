// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveChangesDialog } from "../src/components/SaveChangesDialog";

describe("save confirmation with unfinished equation drafts", () => {
  let host: HTMLDivElement;
  let opener: HTMLButtonElement;
  let root: Root;
  let onChoose: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    opener = document.createElement("button");
    opener.textContent = "Open another document";
    document.body.append(opener, host);
    opener.focus();
    root = createRoot(host);
    onChoose = vi.fn();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    opener.remove();
    vi.unstubAllGlobals();
  });
  async function render(draftCount?: number, allowRecovery = true) {
    await act(async () =>
      root.render(
        createElement(SaveChangesDialog, {
          title: "Physics talk",
          onChoose,
          allowRecovery,
          ...(draftCount === undefined ? {} : { draftCount }),
        }),
      ),
    );
  }
  function button(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!found) throw new Error(`Missing save confirmation action: ${label}`);
    return found;
  }
  async function key(target: Element, value: string, shiftKey = false) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  it("keeps normal file saving and the original primary action when no draft count is supplied", async () => {
    await render();
    expect(button("Save changes").disabled).toBe(false);
    expect(button("Save changes").classList.contains("primary-button")).toBe(
      true,
    );
    expect(
      button("Keep recovery and continue").classList.contains("primary-button"),
    ).toBe(false);
    expect(host.querySelector("#save-changes-drafts")).toBeNull();
    expect(document.activeElement).toBe(button("Cancel"));
    await act(async () => button("Save changes").click());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("save");
  });

  it("explains Apply, blocks an impossible file save, and emphasizes keeping a recovery copy", async () => {
    await render(1);
    const notice = host.querySelector("#save-changes-drafts")!;
    expect(notice.textContent).toContain(
      "1 unfinished equation draft has not been applied",
    );
    expect(notice.textContent).toContain(
      "Apply it before saving to a .scislide file",
    );
    expect(
      host
        .querySelector('[role="alertdialog"]')
        ?.getAttribute("aria-describedby"),
    ).toContain("save-changes-drafts");
    expect(button("Save changes").disabled).toBe(true);
    expect(button("Save changes").classList.contains("primary-button")).toBe(
      false,
    );
    expect(
      button("Keep recovery and continue").classList.contains("primary-button"),
    ).toBe(true);
    await act(async () => button("Save changes").click());
    expect(onChoose).not.toHaveBeenCalled();
    await act(async () => button("Keep recovery and continue").click());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("recover");
  });

  it("keeps cancellation available with plural drafts when local recovery is not offered", async () => {
    await render(2, false);
    expect(host.textContent).toContain(
      "2 unfinished equation drafts have not been applied",
    );
    expect(host.textContent).toContain("Apply them before saving");
    expect(host.textContent).not.toContain("Keep a recovery copy");
    expect(button("Save changes").disabled).toBe(true);
    await act(async () => button("Cancel").click());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("cancel");
  });

  it("wraps Tab between enabled actions while skipping the disabled Save button", async () => {
    await render(2);
    const recovery = button("Keep recovery and continue");
    await act(async () => recovery.focus());
    expect((await key(recovery, "Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("Cancel"));
    expect((await key(button("Cancel"), "Tab", true)).defaultPrevented).toBe(
      true,
    );
    expect(document.activeElement).toBe(recovery);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("recovers keyboard focus if an active Save action becomes disabled", async () => {
    await render(0);
    const save = button("Save changes");
    await act(async () => save.focus());
    await render(1);
    expect(button("Save changes").disabled).toBe(true);
    expect((await key(save, "Tab")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("Cancel"));
  });

  it("cancels on Escape without passing it to the editor and restores the opener on close", async () => {
    await render(1);
    const background = vi.fn();
    window.addEventListener("keydown", background);
    try {
      expect((await key(button("Cancel"), "Escape")).defaultPrevented).toBe(
        true,
      );
      expect(onChoose).toHaveBeenCalledExactlyOnceWith("cancel");
      expect(background).not.toHaveBeenCalled();
      await act(async () => root.render(null));
      expect(document.activeElement).toBe(opener);
    } finally {
      window.removeEventListener("keydown", background);
    }
  });
});
