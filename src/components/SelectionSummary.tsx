import type { SlideObject } from "../lib/model";
import { isObjectLocked } from "../lib/drawing";

export interface SelectionSummaryProps {
  objects: SlideObject[];
  arranging: boolean;
  onArrange: () => void;
  onEdit: (id: string) => void;
}

/** Explain selection-wide actions before showing an individual object's fields. */
export function SelectionSummary({
  objects,
  arranging,
  onArrange,
  onEdit,
}: SelectionSummaryProps) {
  const groups = new Set(
    objects.flatMap((object) => (object.groupId ? [object.groupId] : [])),
  );
  const unlocked = objects.filter(
    (object) => !isObjectLocked(object, objects),
  ).length;
  const hidden = objects.filter((object) => !object.visible).length;
  const locked = objects.length - unlocked;
  const status = [
    groups.size
      ? `${groups.size} ${groups.size === 1 ? "group" : "groups"}`
      : "Ungrouped",
    `${unlocked} unlocked`,
    ...(locked ? [`${locked} locked`] : []),
    ...(hidden ? [`${hidden} hidden`] : ["All visible"]),
  ];
  return (
    <section
      className="selection-summary"
      data-mode={arranging ? "arrange" : "style"}
      aria-label="Selected objects"
    >
      <h3 className="selection-summary-title">
        {objects.length} {objects.length === 1 ? "object" : "objects"} selected
      </h3>
      <p className="selection-summary-status">{status.join(" · ")}</p>
      <p className="selection-summary-hint">
        {arranging
          ? "Arrange tools below apply to all unlocked selected objects. Edit one object to change its style or size."
          : "Choose one object to edit its style and size, or arrange the selection together."}
      </p>
      {!arranging && (
        <button
          type="button"
          className="selection-summary-arrange"
          onClick={onArrange}
        >
          Arrange selection
        </button>
      )}
      <details className="selection-summary-members">
        <summary>Edit one object</summary>
        <ul className="selection-summary-list">
          {objects.map((object) => {
            const name = object.name || "Untitled object";
            const state = [
              object.type === "figure"
                ? "Figure"
                : object.type.charAt(0).toUpperCase() + object.type.slice(1),
              ...(object.groupId ? ["Grouped"] : []),
              isObjectLocked(object, objects) ? "Locked" : "Unlocked",
              ...(!object.visible ? ["Hidden"] : []),
            ];
            return (
              <li
                key={object.id}
                className="selection-summary-object"
                data-object-id={object.id}
              >
                <button
                  type="button"
                  className="selection-summary-edit"
                  onClick={() => onEdit(object.id)}
                >
                  Edit {name}
                </button>
                <small className="selection-summary-object-state">
                  {state.join(" · ")}
                </small>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
