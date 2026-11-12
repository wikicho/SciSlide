import { useId } from "react";

export type InspectorTab = "style" | "arrange" | "layers" | "document";
const tabs = [
  { id: "style", label: "Style" },
  { id: "arrange", label: "Arrange" },
  { id: "layers", label: "Layers" },
  { id: "document", label: "Document" },
] as const;
export function InspectorTabs({
  active,
  onChange,
}: {
  active: InspectorTab;
  onChange: (tab: InspectorTab) => void;
}) {
  const id = useId();
  return (
    <div
      className="inspector-tabs"
      role="tablist"
      aria-label="Format panel tabs"
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          id={`${id}-${tab.id}`}
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            event.stopPropagation();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index +
                      (event.key === "ArrowLeft" ? -1 : 1) +
                      tabs.length) %
                    tabs.length;
            onChange(tabs[next].id);
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>("button")
              [next].focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
