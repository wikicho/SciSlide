import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Group,
  LockKeyhole,
  MousePointer2,
  Pencil,
  UnlockKeyhole,
} from "lucide-react";
import { expandSelection, isObjectLocked } from "../lib/drawing";
import type { SlideObject } from "../lib/model";
import { getKeyboardPlatform, type KeyboardPlatform } from "../lib/shortcuts";

export interface ObjectLayersProps {
  platform?: KeyboardPlatform;
  objects: SlideObject[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onRename: (id: string, name: string) => void;
  onVisibility: (id: string, visible: boolean) => void;
  onLock: (id: string, locked: boolean) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}

/** Direct access to obscured and hidden objects, in front-to-back layer order. */
export function ObjectLayers({
  platform = getKeyboardPlatform(),
  objects,
  selected,
  onSelect,
  onRename,
  onVisibility,
  onLock,
  onMove,
}: ObjectLayersProps) {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const selection = new Set(expandSelection(objects, selected));
  const frontToBack = [...objects].reverse();
  const unitKey = (object: SlideObject) =>
    object.groupId ? `group:${object.groupId}` : `object:${object.id}`;
  const order = [...new Set(frontToBack.map(unitKey))];
  return (
    <section className="object-layers" aria-label="Objects and layers">
      <div className="object-layers-heading">
        <span>OBJECTS & LAYERS</span>
        <small>{objects.length}</small>
      </div>
      {!objects.length ? (
        <p className="object-layers-empty">
          Add an object to start arranging this slide.
        </p>
      ) : (
        <ul className="object-layer-list">
          {frontToBack.map((object) => {
            const name = object.name || "Untitled object";
            const count = object.groupId
              ? objects.filter((member) => member.groupId === object.groupId)
                  .length
              : 0;
            const locked = isObjectLocked(object, objects);
            const unitIndex = order.indexOf(unitKey(object));
            return (
              <li
                className={`object-layer-row${selection.has(object.id) ? " selected" : ""}${!object.visible ? " hidden" : ""}${locked ? " locked" : ""}`}
                key={object.id}
                data-object-id={object.id}
              >
                <button
                  type="button"
                  className="object-layer-select"
                  aria-label={`Select ${name}`}
                  aria-pressed={selection.has(object.id)}
                  onClick={(event) => {
                    const clicked = expandSelection(objects, [object.id]);
                    onSelect(
                      event.shiftKey ||
                        (platform === "mac" &&
                          event.metaKey &&
                          !event.ctrlKey &&
                          !event.altKey)
                        ? selection.has(object.id)
                          ? [...selection].filter((id) => !clicked.includes(id))
                          : expandSelection(objects, [...selection, ...clicked])
                        : clicked,
                    );
                  }}
                >
                  {object.groupId ? (
                    <Group size={14} />
                  ) : (
                    <MousePointer2 size={14} />
                  )}
                  <span>
                    <strong>{name}</strong>
                    <small>
                      {object.type}
                      {count > 0 ? ` · Group · ${count} objects` : ""}
                      {!object.visible ? " · Hidden" : ""}
                      {locked ? " · Locked" : ""}
                    </small>
                  </span>
                </button>
                {renaming?.id === object.id ? (
                  <input
                    className="object-layer-name"
                    aria-label={`Rename ${name}`}
                    autoFocus
                    maxLength={2000}
                    value={renaming.name}
                    onChange={(event) =>
                      setRenaming({ id: object.id, name: event.target.value })
                    }
                    onBlur={() => {
                      if (renaming.name !== object.name)
                        onRename(object.id, renaming.name);
                      setRenaming(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="object-layer-action"
                    aria-label={`Rename ${name}`}
                    title={`Rename ${name}`}
                    onClick={() =>
                      setRenaming({ id: object.id, name: object.name })
                    }
                  >
                    <Pencil size={13} />
                  </button>
                )}
                <div className="object-layer-actions">
                  <button
                    type="button"
                    className="object-layer-action"
                    aria-label={`${object.visible ? "Hide" : "Show"} ${name}`}
                    title={`${object.visible ? "Hide" : "Show"} ${name}`}
                    onClick={() => onVisibility(object.id, !object.visible)}
                  >
                    {object.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    type="button"
                    className="object-layer-action"
                    aria-label={`${object.locked ? "Unlock" : "Lock"} ${name}`}
                    title={
                      locked && !object.locked
                        ? `${name} is locked by another group member`
                        : `${object.locked ? "Unlock" : "Lock"} ${name}`
                    }
                    aria-pressed={object.locked}
                    onClick={() => onLock(object.id, !object.locked)}
                  >
                    {locked ? (
                      <LockKeyhole size={14} />
                    ) : (
                      <UnlockKeyhole size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="object-layer-action"
                    aria-label={`Move ${name} forward`}
                    title={`Move ${count > 0 ? "group" : name} forward`}
                    disabled={locked || unitIndex === 0}
                    onClick={() => onMove(object.id, "up")}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="object-layer-action"
                    aria-label={`Move ${name} backward`}
                    title={`Move ${count > 0 ? "group" : name} backward`}
                    disabled={locked || unitIndex === order.length - 1}
                    onClick={() => onMove(object.id, "down")}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="object-layers-hint">
        Frontmost first ·{" "}
        {platform === "mac" ? "Shift-click or ⌘-click" : "Shift-click"} selects
        multiple · A locked group moves after all members are unlocked.
      </p>
    </section>
  );
}
