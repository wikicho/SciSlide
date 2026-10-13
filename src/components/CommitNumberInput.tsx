import { useLayoutEffect, useRef, useState } from "react";
import type { InputHTMLAttributes, Key } from "react";

type CommitNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | "value"
  | "defaultValue"
  | "type"
  | "min"
  | "max"
  | "step"
  | "onChange"
  | "onInput"
  | "onBlur"
  | "onKeyDown"
> & {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Change this when the field starts editing a different object. */
  resetKey?: Key;
  /** Reset a draft when the saved value changes behind a computed display value. */
  syncKey?: Key;
  onCommit: (value: number) => void;
};

/** Keep incomplete numbers local until the user finishes entering them. */
export function CommitNumberInput({
  resetKey,
  ...props
}: CommitNumberInputProps) {
  return <NumberDraft key={resetKey} {...props} />;
}

function NumberDraft({
  value,
  syncKey,
  min,
  max,
  step = 1,
  onCommit,
  ...inputProps
}: Omit<CommitNumberInputProps, "resetKey">) {
  const [draft, setDraft] = useState(String(value));
  const committed = useRef(value);

  useLayoutEffect(() => {
    committed.current = value;
    setDraft(String(value));
  }, [value, syncKey]);

  const restore = () => setDraft(String(committed.current));
  const commit = (candidate: number) => {
    const next = Math.max(min, Math.min(max, candidate));
    setDraft(String(next));
    if (next === committed.current) return;
    committed.current = next;
    onCommit(next);
  };
  const parsedDraft = () => (draft.trim() === "" ? NaN : Number(draft));
  const finish = () => {
    const candidate = parsedDraft();
    if (Number.isFinite(candidate)) commit(candidate);
    else restore();
  };

  return (
    <input
      {...inputProps}
      data-commit-number-input=""
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (
          inputProps.readOnly ||
          event.nativeEvent.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Enter") finish();
          else restore();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          const candidate = parsedDraft();
          const startingValue = Number.isFinite(candidate)
            ? candidate
            : committed.current;
          commit(startingValue + (event.key === "ArrowUp" ? step : -step));
        }
      }}
    />
  );
}
