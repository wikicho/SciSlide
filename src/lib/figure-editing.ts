import { newId, validateFigureCrop } from "./model";
import type { Asset, Deck, FigureCrop, FigureObject } from "./model";

export const FULL_FIGURE_CROP: Readonly<FigureCrop> = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

export function hasFigureCrop(object: FigureObject): boolean {
  const crop = object.crop;
  return (
    !!crop &&
    (crop.x !== 0 || crop.y !== 0 || crop.width !== 1 || crop.height !== 1)
  );
}

/** Shared crop geometry for the editor, player and vector/raster exporters. */
export function figureViewport(object: FigureObject, asset: Asset) {
  const crop = object.crop ? validateFigureCrop(object.crop) : FULL_FIGURE_CROP;
  const sourceWidth = asset.width;
  const sourceHeight = asset.height;
  const region = {
    x: crop.x * sourceWidth,
    y: crop.y * sourceHeight,
    width: crop.width * sourceWidth,
    height: crop.height * sourceHeight,
  };
  return {
    sourceWidth,
    sourceHeight,
    region,
    attributes: {
      width: object.transform.width,
      height: object.transform.height,
      viewBox: `${region.x} ${region.y} ${region.width} ${region.height}`,
      preserveAspectRatio: "xMidYMid meet",
      overflow: "hidden",
    },
  };
}

/** Create an independent, enlarged object sharing the immutable source asset. */
export function createFigureInset(
  object: FigureObject,
  asset: Asset,
  slideSize: Deck["slideSize"],
): FigureObject {
  if (!hasFigureCrop(object))
    throw new Error("Select a cropped region before creating an inset.");
  if (asset.id !== object.assetId)
    throw new Error("The inset source image is missing.");
  const { region } = figureViewport(object, asset);
  const scale = Math.min(
    object.transform.width / region.width,
    object.transform.height / region.height,
  );
  const insetScale = Math.min(
    scale * 1.5,
    (slideSize.width - 64) / region.width,
    (slideSize.height - 64) / region.height,
  );
  const width = region.width * insetScale;
  const height = region.height * insetScale;
  const candidateX = object.transform.x + object.transform.width + 32;
  const inset: FigureObject = {
    ...structuredClone(object),
    id: newId(),
    name: `${object.name} (inset)`,
    locked: false,
    visible: true,
    transform: {
      x: Math.max(32, Math.min(candidateX, slideSize.width - width - 32)),
      y: Math.max(
        32,
        Math.min(object.transform.y + 32, slideSize.height - height - 32),
      ),
      width,
      height,
      rotation: 0,
    },
  };
  delete inset.groupId;
  return inset;
}
