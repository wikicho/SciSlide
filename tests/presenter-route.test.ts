// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom/client", () => ({
  default: { createRoot: () => ({ render }) },
}));
vi.mock("../src/App", () => ({
  default: () => createElement("div", { "data-editor": true }),
}));
vi.mock("../src/components/PresenterApp", () => ({
  PresenterApp: (props: { token: string }) =>
    createElement("div", { "data-presenter-token": props.token }),
}));
vi.mock("../src/components/AudienceApp", () => ({
  AudienceApp: (props: { token: string }) =>
    createElement("div", { "data-audience-token": props.token }),
}));

describe("separate presenter window routing", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "#");
    render.mockClear();
    document.body.innerHTML = "";
  });
  it.each([
    ["#presenter=01234567-89ab-cdef-0123-456789abcdef", "presenter"],
    ["#audience=01234567-89ab-cdef-0123-456789abcdef", "audience"],
    ["#audience=short", "editor"],
    ["#audience=01234567-89ab-cdef-0123-456789abcdef&extra=true", "editor"],
    ["#presenter=short", "editor"],
    ["#presenter=01234567-89ab-cdef-0123-456789abcdef&extra=true", "editor"],
    ["#", "editor"],
  ])("routes %s to the %s view", async (hash, destination) => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState(null, "", hash);
    await import("../src/main");
    const strictMode = render.mock.calls[0][0];
    const element = strictMode.props.children;
    if (destination !== "editor")
      expect(element.props.token).toBe("01234567-89ab-cdef-0123-456789abcdef");
    else expect(element.props.token).toBeUndefined();
    const rendered = element.type(element.props);
    expect(Boolean(rendered.props["data-editor"])).toBe(
      destination === "editor",
    );
    expect(Boolean(rendered.props["data-presenter-token"])).toBe(
      destination === "presenter",
    );
    expect(Boolean(rendered.props["data-audience-token"])).toBe(
      destination === "audience",
    );
  });
});
