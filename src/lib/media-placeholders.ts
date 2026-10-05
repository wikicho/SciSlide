import { cleanupGroups, isObjectLocked } from "./drawing";
import type {
  Asset,
  FigureCrop,
  FigureObject,
  ShapeObject,
  Slide,
  VideoObject,
} from "./model";

export type MediaPlaceholderKind = "photo" | "video";

function placeholderIsLocked(slide: Slide, frame: ShapeObject): boolean {
  return (
    isObjectLocked(frame, slide.objects) ||
    slide.objects.some(
      (object) =>
        object.metadata.mediaPlaceholderFor === frame.id &&
        isObjectLocked(object, slide.objects),
    )
  );
}

/** Labels and icons select the same slot as its frame. Ambiguous selections
 * retain the normal free placement behavior of the media import tools. */
export function selectedMediaPlaceholder(
  slide: Slide,
  selected: readonly string[],
  kind: MediaPlaceholderKind,
): ShapeObject | undefined {
  if (!selected.length) return;
  const frames = new Set<string>();
  for (const id of selected) {
    const object = slide.objects.find((candidate) => candidate.id === id);
    if (!object) return;
    const frameId =
      object.metadata.mediaPlaceholderFor ??
      (object.type === "shape" && object.metadata.mediaPlaceholder === kind
        ? object.id
        : undefined);
    if (typeof frameId !== "string") return;
    frames.add(frameId);
  }
  if (frames.size !== 1) return;
  const frame = slide.objects.find((object) => frames.has(object.id));
  return frame?.type === "shape" &&
    frame.metadata.mediaPlaceholder === kind &&
    !placeholderIsLocked(slide, frame)
    ? frame
    : undefined;
}

/** A reversible centered crop fills the frame without distorting the image. */
export function mediaPlaceholderCrop(
  frame: ShapeObject,
  asset: Pick<Asset, "width" | "height">,
): FigureCrop {
  const sourceRatio = asset.width / asset.height;
  const frameRatio = frame.transform.width / frame.transform.height;
  const width = Math.min(1, frameRatio / sourceRatio);
  const height = Math.min(1, sourceRatio / frameRatio);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

/** Replace a slot in place, retaining its layer, geometry and animation. */
export function fillMediaPlaceholder(
  slide: Slide,
  frameId: string,
  media: FigureObject | VideoObject,
): void {
  const frame = slide.objects.find((object) => object.id === frameId);
  const kind = media.type === "figure" ? "photo" : "video";
  if (
    frame?.type !== "shape" ||
    frame.metadata.mediaPlaceholder !== kind ||
    placeholderIsLocked(slide, frame)
  )
    throw new Error("The selected media placeholder changed. Select it again.");
  media.transform = { ...frame.transform };
  media.opacity = frame.opacity;
  media.visible = frame.visible;
  media.locked = frame.locked;
  media.metadata = { ...frame.metadata, ...media.metadata };
  delete media.metadata.mediaPlaceholder;
  if (frame.groupId) media.groupId = frame.groupId;
  if (frame.build) media.build = { ...frame.build };
  slide.objects = slide.objects
    .filter((object) => object.metadata.mediaPlaceholderFor !== frameId)
    .map((object) => (object.id === frameId ? media : object));
  cleanupGroups(slide.objects);
}
