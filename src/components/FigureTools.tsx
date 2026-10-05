import { useEffect, useState } from "react";
import type { Asset, FigureCrop, FigureObject } from "../lib/model";
import { validateFigureCrop } from "../lib/model";
import { FULL_FIGURE_CROP, hasFigureCrop } from "../lib/figure-editing";
import { FigureView } from "./FigureView";

const cropFields = [
  ["x", "Left"],
  ["y", "Top"],
  ["width", "Width"],
  ["height", "Height"],
] as const;

function percentages(crop: FigureCrop): Record<keyof FigureCrop, string> {
  return Object.fromEntries(
    cropFields.map(([key]) => [
      key,
      String(Number((crop[key] * 100).toFixed(6))),
    ]),
  ) as Record<keyof FigureCrop, string>;
}

export function FigureTools({
  object,
  asset,
  disabled = false,
  onCropChange,
  onCreateInset,
}: {
  object: FigureObject;
  asset?: Asset;
  disabled?: boolean;
  onCropChange: (crop: FigureCrop | undefined) => void;
  onCreateInset: (crop: FigureCrop) => void;
}) {
  const [draft, setDraft] = useState(() =>
    percentages(object.crop ?? FULL_FIGURE_CROP),
  );
  useEffect(() => {
    setDraft(percentages(object.crop ?? FULL_FIGURE_CROP));
  }, [
    object.id,
    object.crop?.x,
    object.crop?.y,
    object.crop?.width,
    object.crop?.height,
  ]);
  let crop: FigureCrop | undefined;
  let error = "";
  try {
    if (cropFields.some(([key]) => !draft[key].trim()))
      throw new Error("Enter all four crop percentages.");
    crop = validateFigureCrop(
      Object.fromEntries(
        cropFields.map(([key]) => [key, Number(draft[key]) / 100]),
      ),
    );
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  const unchanged =
    crop &&
    cropFields.every(
      ([key]) =>
        Math.abs(crop![key] - (object.crop ?? FULL_FIGURE_CROP)[key]) < 1e-8,
    );
  const unavailable = disabled || !asset;
  return (
    <div className="figure-tools">
      <div className="section-label">CROP &amp; INSET</div>
      <p className="field-hint">
        Choose a region as percentages of the original image.
      </p>
      <div className="field-row">
        {cropFields.map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label} (%)</span>
            <input
              type="number"
              min={key === "width" || key === "height" ? 0.0001 : 0}
              max="100"
              step="0.1"
              aria-label={`Crop ${label.toLowerCase()} (%)`}
              value={draft[key]}
              disabled={unavailable}
              onChange={(event) =>
                setDraft({ ...draft, [key]: event.target.value })
              }
            />
          </label>
        ))}
      </div>
      {asset && crop && (
        <svg
          className="figure-crop-preview"
          viewBox="0 0 240 140"
          role="img"
          aria-label="Crop preview"
        >
          <rect width="240" height="140" fill="#f1f5f9" />
          <FigureView
            object={{
              ...object,
              crop,
              transform: { ...object.transform, width: 240, height: 140 },
            }}
            asset={asset}
          />
        </svg>
      )}
      {error && (
        <p className="field-hint error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button
          className="button"
          disabled={unavailable || !crop || !!unchanged}
          onClick={() => {
            if (!crop) return;
            const full = cropFields.every(
              ([key]) => crop![key] === FULL_FIGURE_CROP[key],
            );
            onCropChange(full ? undefined : crop);
          }}
        >
          Apply crop
        </button>
        <button
          className="button"
          disabled={unavailable || !object.crop}
          onClick={() => onCropChange(undefined)}
        >
          Reset crop
        </button>
      </div>
      <button
        className="button"
        disabled={unavailable || !crop || !hasFigureCrop({ ...object, crop })}
        onClick={() => {
          if (crop) onCreateInset(crop);
        }}
      >
        Create enlarged inset
      </button>
      <p className="field-hint">
        {disabled
          ? "Unlock or ungroup the figure to edit its crop."
          : "Create an inset from the preview without changing this figure. Apply crop changes this figure; the original image is retained."}
      </p>
    </div>
  );
}
