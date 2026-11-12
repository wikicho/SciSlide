import type { Deck, Slide } from "./model";
import { newId } from "./model";
import {
  captureObjectClipboard,
  pasteObjectClipboard,
  type ObjectClipboard,
} from "./object-clipboard";

export interface SlideClipboard {
  slide: Omit<Slide, "objects">;
  content: ObjectClipboard;
}

/** Keep notes, appearance and embedded media even after the source is deleted. */
export function captureSlideClipboard(
  deck: Deck,
  slide: Slide,
): SlideClipboard {
  const { objects, ...settings } = slide;
  return {
    slide: structuredClone(settings),
    content: captureObjectClipboard(
      deck,
      slide,
      objects.map((object) => object.id),
    ) ?? { sourceDeckId: deck.id, objects: [], assets: [] },
  };
}

/** Insert after the target with fresh object/group IDs and unchanged geometry. */
export function pasteSlideClipboard(
  deck: Deck,
  afterSlideId: string,
  clipboard: SlideClipboard,
): Slide {
  const index = deck.slides.findIndex((slide) => slide.id === afterSlideId);
  if (index < 0) throw new Error("The slide for pasting is unavailable.");
  const slide: Slide = {
    ...structuredClone(clipboard.slide),
    id: newId(),
    objects: [],
  };
  // Resolve media before inserting, so missing assets leave the deck untouched.
  const target = { ...deck, slides: [slide], assets: [...deck.assets] };
  pasteObjectClipboard(target, slide.id, clipboard.content, { x: 0, y: 0 });
  deck.assets = target.assets;
  deck.slides.splice(index + 1, 0, slide);
  return slide;
}
