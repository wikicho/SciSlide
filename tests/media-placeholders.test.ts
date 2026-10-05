import { describe, expect, it } from "vitest";
import { createThemeDeck, createThemedSlide } from "../src/lib/deck-themes";
import { cloneObjectsWithGroups } from "../src/lib/drawing";
import {
  fillMediaPlaceholder,
  mediaPlaceholderCrop,
  selectedMediaPlaceholder,
} from "../src/lib/media-placeholders";
import type { FigureObject, ShapeObject, VideoObject } from "../src/lib/model";

function photoLayout() {
  return createThemedSlide(
    "keynote-white-three-photos",
    createThemeDeck("keynote-white"),
  );
}

function photoFrames(slide: ReturnType<typeof photoLayout>) {
  return slide.objects.filter(
    (object): object is ShapeObject =>
      object.type === "shape" && object.metadata.mediaPlaceholder === "photo",
  );
}

function media(type: "figure"): FigureObject;
function media(type: "video"): VideoObject;
function media(type: "figure" | "video"): FigureObject | VideoObject {
  const base = {
    id: "imported-media",
    name: "Imported media",
    transform: { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
    assetId: "media-asset",
    alt: "An original media file",
  };
  return type === "figure"
    ? { ...base, type }
    : {
        ...base,
        type,
        autoplay: false,
        loop: false,
        muted: false,
        controls: true,
      };
}

describe("theme media placeholders", () => {
  it("accepts a frame or its decorations, and leaves ambiguous selections alone", () => {
    const slide = photoLayout();
    const [frame, second] = photoFrames(slide);
    const label = slide.objects.find(
      (object) => object.metadata.mediaPlaceholderFor === frame.id,
    )!;
    expect(selectedMediaPlaceholder(slide, [frame.id], "photo")).toBe(frame);
    expect(selectedMediaPlaceholder(slide, [label.id], "photo")).toBe(frame);
    expect(selectedMediaPlaceholder(slide, [frame.id, label.id], "photo")).toBe(
      frame,
    );
    expect(selectedMediaPlaceholder(slide, [], "photo")).toBeUndefined();
    expect(
      selectedMediaPlaceholder(slide, [frame.id, second.id], "photo"),
    ).toBeUndefined();
    expect(
      selectedMediaPlaceholder(slide, [frame.id], "video"),
    ).toBeUndefined();
    expect(
      selectedMediaPlaceholder(slide, ["deleted-object"], "photo"),
    ).toBeUndefined();
  });

  it.each([
    {
      source: { width: 1600, height: 900 },
      expected: { x: 0, y: 0, width: 1, height: 1 },
    },
    {
      source: { width: 3200, height: 900 },
      expected: { x: 0.25, y: 0, width: 0.5, height: 1 },
    },
    {
      source: { width: 1600, height: 1800 },
      expected: { x: 0, y: 0.25, width: 1, height: 0.5 },
    },
  ])(
    "fills landscape, wide and tall images without stretching ($source)",
    ({ source, expected }) => {
      const frame = photoFrames(photoLayout())[0];
      frame.transform.width = 1600;
      frame.transform.height = 900;
      expect(mediaPlaceholderCrop(frame, source)).toEqual(expected);
    },
  );

  it("preserves the selected slot's layer, transform, appearance, animation and sibling photos", () => {
    const slide = photoLayout();
    const [frame, second, third] = photoFrames(slide);
    const oldIndex = slide.objects.indexOf(frame);
    const siblings = structuredClone([second, third]);
    frame.transform.rotation = 13;
    frame.opacity = 0.8;
    frame.build = { step: 2, effect: "fade", durationMs: 400 };
    frame.metadata.custom = "Retain user metadata";
    const figure = media("figure");
    figure.crop = mediaPlaceholderCrop(frame, { width: 1600, height: 900 });
    fillMediaPlaceholder(slide, frame.id, figure);
    expect(slide.objects[oldIndex]).toBe(figure);
    expect(figure.transform).toEqual(frame.transform);
    expect(figure.transform).not.toBe(frame.transform);
    expect(figure.opacity).toBe(0.8);
    expect(figure.build).toEqual(frame.build);
    expect(figure.metadata.custom).toBe("Retain user metadata");
    expect(figure.metadata.mediaPlaceholder).toBeUndefined();
    expect(
      slide.objects.some(
        (object) => object.metadata.mediaPlaceholderFor === frame.id,
      ),
    ).toBe(false);
    expect(photoFrames(slide)).toEqual(siblings);
  });

  it("uses the video frame and removes its avatar without converting unrelated text", () => {
    const slide = createThemedSlide(
      "keynote-white-large-video",
      createThemeDeck("keynote-white"),
    );
    const frame = slide.objects.find(
      (object) =>
        object.type === "shape" && object.metadata.mediaPlaceholder === "video",
    ) as ShapeObject;
    const text = structuredClone(
      slide.objects.filter(
        (object) =>
          object.type === "text" && !object.metadata.mediaPlaceholderFor,
      ),
    );
    const video = media("video");
    fillMediaPlaceholder(slide, frame.id, video);
    expect(video.transform).toEqual(frame.transform);
    expect(
      slide.objects.some(
        (object) => object.metadata.mediaPlaceholderFor === frame.id,
      ),
    ).toBe(false);
    expect(slide.objects.filter((object) => object.type === "text")).toEqual(
      text,
    );
  });

  it("rejects stale, mismatched and locked slots without modifying the slide", () => {
    const slide = photoLayout();
    const [frame] = photoFrames(slide);
    let before = structuredClone(slide);
    expect(() =>
      fillMediaPlaceholder(slide, "deleted-frame", media("figure")),
    ).toThrow(/changed/);
    expect(() => fillMediaPlaceholder(slide, frame.id, media("video"))).toThrow(
      /changed/,
    );
    expect(slide).toEqual(before);
    frame.locked = true;
    before = structuredClone(slide);
    expect(
      selectedMediaPlaceholder(slide, [frame.id], "photo"),
    ).toBeUndefined();
    expect(() =>
      fillMediaPlaceholder(slide, frame.id, media("figure")),
    ).toThrow(/changed/);
    expect(slide).toEqual(before);
    frame.locked = false;
    frame.groupId = "locked-slot-group";
    const label = slide.objects.find(
      (object) => object.metadata.mediaPlaceholderFor === frame.id,
    )!;
    label.locked = true;
    expect(
      selectedMediaPlaceholder(slide, [frame.id], "photo"),
    ).toBeUndefined();
    expect(() =>
      fillMediaPlaceholder(slide, frame.id, media("figure")),
    ).toThrow(/changed/);
    label.groupId = frame.groupId;
    expect(
      selectedMediaPlaceholder(slide, [frame.id], "photo"),
    ).toBeUndefined();
  });

  it("remaps slot references when copying a slide or a frame with its decoration", () => {
    const original = photoLayout();
    const copied = {
      ...original,
      objects: cloneObjectsWithGroups(original.objects),
    };
    const originalIds = new Set(original.objects.map((object) => object.id));
    for (const decoration of copied.objects.filter(
      (object) => object.metadata.mediaPlaceholderFor,
    )) {
      expect(
        originalIds.has(decoration.metadata.mediaPlaceholderFor as string),
      ).toBe(false);
      expect(
        selectedMediaPlaceholder(copied, [decoration.id], "photo"),
      ).toBeDefined();
    }
    const [copiedFrame] = photoFrames(copied);
    fillMediaPlaceholder(copied, copiedFrame.id, media("figure"));
    expect(photoFrames(original)).toHaveLength(3);
    expect(photoFrames(copied)).toHaveLength(2);
    const label = original.objects.find(
      (object) => object.metadata.mediaPlaceholderFor,
    )!;
    const [standaloneLabel] = cloneObjectsWithGroups([label]);
    expect(standaloneLabel.metadata.mediaPlaceholderFor).toBeUndefined();
  });
});
