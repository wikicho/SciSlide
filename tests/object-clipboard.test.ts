import { describe, expect, it } from "vitest";
import { shapeFromDrag } from "../src/lib/drawing";
import { pruneUnusedAssets } from "../src/lib/deck-editing";
import {
  localTexInputFingerprint,
  localTexInputs,
} from "../src/lib/equation-renderer";
import {
  createBlankSlide,
  createDemoDeck,
  newId,
  validateDeck,
} from "../src/lib/model";
import type {
  EquationObject,
  FigureObject,
  VideoObject,
} from "../src/lib/model";
import {
  captureObjectClipboard,
  pasteObjectClipboard,
} from "../src/lib/object-clipboard";

const rectangle = (x = 100, y = 100) =>
  shapeFromDrag("rect", { x, y }, { x: x + 100, y: y + 80 });

describe("object clipboard snapshots", () => {
  it("reads a complete locked group without changing source objects or metadata", () => {
    const deck = createDemoDeck();
    const slide = createBlankSlide();
    const first = rectangle();
    const second = rectangle(300);
    first.groupId = second.groupId = "source-group";
    second.locked = true;
    second.visible = false;
    first.metadata = { annotation: { value: "source" } };
    slide.objects = [first, second];
    const before = structuredClone(slide);
    const clipboard = captureObjectClipboard(deck, slide, [first.id])!;
    expect(clipboard.objects).toHaveLength(2);
    expect(slide).toEqual(before);
    (clipboard.objects[0].metadata.annotation as { value: string }).value =
      "copy";
    expect(first.metadata).toEqual({ annotation: { value: "source" } });
    expect(clipboard.objects[1].locked).toBe(true);
    expect(captureObjectClipboard(deck, slide, ["missing"])).toBeNull();
  });

  it("keeps copied figure/video bytes after cutting and pruning the source, including shared assets", () => {
    const source = createDemoDeck();
    const slide = createBlankSlide();
    const asset = { ...source.assets[0], id: newId() };
    const videoAsset = {
      ...asset,
      id: newId(),
      mime: "video/mp4",
      dataUrl: "data:video/mp4;base64,AAAA",
      name: "experiment.mp4",
    };
    const figure: FigureObject = {
      ...rectangle(),
      type: "figure",
      assetId: asset.id,
      alt: "plot",
    };
    const second: FigureObject = {
      ...figure,
      id: newId(),
      transform: { ...figure.transform, x: 300 },
    };
    const video: VideoObject = {
      ...rectangle(500),
      type: "video",
      assetId: videoAsset.id,
      alt: "experiment",
      autoplay: false,
      loop: false,
      muted: true,
      controls: true,
    };
    slide.objects = [figure, second, video];
    source.slides = [slide];
    source.assets = [asset, videoAsset];
    const clipboard = captureObjectClipboard(
      source,
      slide,
      slide.objects.map((object) => object.id),
    )!;
    expect(clipboard.assets).toHaveLength(2);
    slide.objects = [];
    pruneUnusedAssets(source);
    expect(source.assets).toEqual([]);
    const target = createDemoDeck();
    target.slides = [createBlankSlide()];
    target.assets = [];
    const pasted = pasteObjectClipboard(
      target,
      target.slides[0].id,
      clipboard,
      { x: 0, y: 0 },
    );
    expect(pasted).toHaveLength(3);
    expect(target.assets).toHaveLength(2);
    const objects = target.slides[0].objects as (FigureObject | VideoObject)[];
    expect(objects[0].assetId).toBe(objects[1].assetId);
    expect(objects[0].assetId).not.toBe(asset.id);
    expect(target.assets[0].dataUrl).toBe(asset.dataUrl);
    expect(target.assets[1].dataUrl).toBe(videoAsset.dataUrl);
    expect(validateDeck(target).slides[0].objects).toEqual(objects);
  });

  it("makes every paste independent while preserving geometry, build settings and group membership", () => {
    const deck = createDemoDeck();
    const slide = createBlankSlide();
    const first = rectangle();
    const second = rectangle(300);
    first.groupId = second.groupId = "original";
    first.build = { step: 2, effect: "fade", durationMs: 300 };
    slide.objects = [first, second];
    deck.slides = [slide];
    const clipboard = captureObjectClipboard(deck, slide, [first.id])!;
    const before = structuredClone(clipboard);
    const firstIds = pasteObjectClipboard(deck, slide.id, clipboard);
    const secondIds = pasteObjectClipboard(deck, slide.id, clipboard, {
      x: 64,
      y: -10,
    });
    const firstPaste = slide.objects.slice(2, 4);
    const secondPaste = slide.objects.slice(4);
    expect(new Set([...firstIds, ...secondIds, first.id, second.id]).size).toBe(
      6,
    );
    expect(firstPaste[0].groupId).toBe(firstPaste[1].groupId);
    expect(secondPaste[0].groupId).toBe(secondPaste[1].groupId);
    expect(firstPaste[0].groupId).not.toBe(secondPaste[0].groupId);
    expect(firstPaste[0].groupId).not.toBe("original");
    expect(firstPaste[0].transform).toEqual({
      ...first.transform,
      x: 132,
      y: 132,
    });
    expect(secondPaste[0].transform).toEqual({
      ...first.transform,
      x: 164,
      y: 90,
    });
    expect(firstPaste[0].build).toEqual(first.build);
    firstPaste[0].build!.step = 8;
    expect(secondPaste[0].build!.step).toBe(2);
    expect(clipboard).toEqual(before);
  });

  it("shares figure and video data across repeated pastes while keeping objects and groups independent", () => {
    const source = createDemoDeck();
    const asset = source.assets[0];
    const videoAsset = {
      ...asset,
      id: newId(),
      mime: "video/mp4",
      dataUrl: `data:video/mp4;base64,${"A".repeat(4096)}`,
      name: "experiment.mp4",
    };
    const figure: FigureObject = {
      ...rectangle(),
      type: "figure",
      assetId: asset.id,
      alt: "plot",
      groupId: "source",
    };
    const video: VideoObject = {
      ...rectangle(300),
      type: "video",
      assetId: videoAsset.id,
      alt: "experiment",
      groupId: "source",
      autoplay: false,
      loop: false,
      muted: true,
      controls: true,
    };
    source.slides = [{ ...createBlankSlide(), objects: [figure, video] }];
    source.assets = [asset, videoAsset];
    const clipboard = captureObjectClipboard(source, source.slides[0], [
      figure.id,
    ])!;
    const target = createDemoDeck();
    target.slides = [createBlankSlide(), createBlankSlide()];
    const existingAsset = {
      ...asset,
      id: newId(),
      name: "Already imported plot",
    };
    target.assets = [existingAsset];
    const firstIds = pasteObjectClipboard(
      target,
      target.slides[0].id,
      clipboard,
    );
    const secondIds = pasteObjectClipboard(
      target,
      target.slides[1].id,
      clipboard,
    );
    const first = target.slides[0].objects as (FigureObject | VideoObject)[];
    const second = target.slides[1].objects as (FigureObject | VideoObject)[];
    expect(target.assets).toHaveLength(2);
    expect(target.assets[0]).toEqual(existingAsset);
    expect(first[0].assetId).toBe(existingAsset.id);
    expect(first.map((object) => object.assetId)).toEqual(
      second.map((object) => object.assetId),
    );
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    expect(first[0].groupId).toBe(first[1].groupId);
    expect(second[0].groupId).toBe(second[1].groupId);
    expect(first[0].groupId).not.toBe(second[0].groupId);
    expect(
      target.assets.reduce((size, item) => size + item.dataUrl.length, 0),
    ).toBe(asset.dataUrl.length + videoAsset.dataUrl.length);
    expect(validateDeck(target).assets).toHaveLength(2);
  });

  it("uses the captured media and remaps a cross-deck ID collision without changing existing data", () => {
    const source = createDemoDeck();
    const asset = {
      ...source.assets[0],
      mime: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
    };
    const figure: FigureObject = {
      ...rectangle(),
      type: "figure",
      assetId: asset.id,
      alt: "captured",
    };
    source.assets = [asset];
    source.slides = [{ ...createBlankSlide(), objects: [figure] }];
    const clipboard = captureObjectClipboard(source, source.slides[0], [
      figure.id,
    ])!;
    const capturedAsset = { ...asset };
    asset.dataUrl = "data:image/png;base64,CCCC";
    asset.width = 10;
    figure.transform.x = 1000;
    const target = createDemoDeck();
    target.slides = [createBlankSlide()];
    const collision = {
      ...capturedAsset,
      dataUrl: "data:image/png;base64,BBBB",
    };
    target.assets = [collision];
    const [id] = pasteObjectClipboard(target, target.slides[0].id, clipboard);
    const pasted = target.slides[0].objects.find(
      (object) => object.id === id,
    ) as FigureObject;
    expect(target.assets).toHaveLength(2);
    expect(target.assets[0]).toEqual(collision);
    expect(target.assets[1]).toEqual({ ...capturedAsset, id: pasted.assetId });
    expect(pasted.assetId).not.toBe(collision.id);
    expect(pasted.transform.x).toBe(132);
    expect(validateDeck(target).slides[0].objects).toHaveLength(1);
  });

  it.each(["mime", "width", "height", "dataUrl"] as const)(
    "does not merge media with different %s",
    (field) => {
      const source = createDemoDeck();
      const asset = source.assets[0];
      const figure: FigureObject = {
        ...rectangle(),
        type: "figure",
        assetId: asset.id,
        alt: "source",
      };
      source.slides = [{ ...createBlankSlide(), objects: [figure] }];
      const clipboard = captureObjectClipboard(source, source.slides[0], [
        figure.id,
      ])!;
      const target = createDemoDeck();
      target.slides = [createBlankSlide()];
      const different = { ...asset, id: newId() };
      if (field === "mime") different.mime = "image/png";
      else if (field === "dataUrl")
        different.dataUrl = "data:image/svg+xml;base64,AAAA";
      else different[field] += 1;
      target.assets = [different];
      pasteObjectClipboard(target, target.slides[0].id, clipboard);
      expect(target.assets).toHaveLength(2);
      expect((target.slides[0].objects[0] as FigureObject).assetId).not.toBe(
        different.id,
      );
    },
  );

  it("merges identical media records within one clipboard snapshot", () => {
    const source = createDemoDeck();
    const asset = source.assets[0];
    const sameData = { ...asset, id: newId(), name: "Another name" };
    const first: FigureObject = {
      ...rectangle(),
      type: "figure",
      assetId: asset.id,
      alt: "first",
    };
    const second: FigureObject = {
      ...rectangle(300),
      type: "figure",
      assetId: sameData.id,
      alt: "second",
    };
    source.assets = [asset, sameData];
    source.slides = [{ ...createBlankSlide(), objects: [first, second] }];
    const clipboard = captureObjectClipboard(source, source.slides[0], [
      first.id,
      second.id,
    ])!;
    const target = createDemoDeck();
    target.assets = [];
    target.slides = [createBlankSlide()];
    pasteObjectClipboard(target, target.slides[0].id, clipboard);
    expect(target.assets).toHaveLength(1);
    expect(
      (target.slides[0].objects as FigureObject[]).map(
        (object) => object.assetId,
      ),
    ).toEqual([target.assets[0].id, target.assets[0].id]);
  });

  it("resolves inherited equation typography so a different deck theme keeps the local render valid", () => {
    const source = createDemoDeck();
    const equation = source.slides[0].objects.find(
      (object) => object.type === "equation",
    ) as EquationObject;
    equation.style = { color: "#263449" };
    equation.renderer = "local-latex";
    equation.localTex = { engine: "latex", preamble: "" };
    equation.localTex.render = {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><path d="M0 0L10 10"/></svg>',
      width: 40,
      height: 20,
      inputFingerprint: localTexInputFingerprint(
        localTexInputs(equation, source),
      ),
      profile: {
        engine: "latex",
        engineVersion: "test",
        converterVersion: "test",
        dependencies: [],
      },
      warnings: [],
    };
    const clipboard = captureObjectClipboard(source, source.slides[0], [
      equation.id,
    ])!;
    const target = createDemoDeck();
    target.theme.equation = {
      fontSetId: "mathjax-fira",
      fontSize: 80,
      color: "#ff0000",
    };
    const [id] = pasteObjectClipboard(target, target.slides[1].id, clipboard);
    const pasted = target.slides[1].objects.find(
      (object) => object.id === id,
    ) as EquationObject;
    expect(pasted.style).toEqual({
      ...source.theme.equation,
      color: "#263449",
    });
    expect(localTexInputFingerprint(localTexInputs(pasted, target))).toBe(
      pasted.localTex!.render!.inputFingerprint,
    );
    expect(equation.style).toEqual({ color: "#263449" });
  });

  it("rejects missing media or invalid targets atomically", () => {
    const deck = createDemoDeck();
    const clipboard = captureObjectClipboard(
      deck,
      deck.slides[0],
      deck.slides[0].objects.map((object) => object.id),
    )!;
    clipboard.assets = [];
    const before = structuredClone(deck);
    expect(() =>
      pasteObjectClipboard(deck, deck.slides[1].id, clipboard),
    ).toThrow("copied media");
    expect(() => pasteObjectClipboard(deck, "missing", clipboard)).toThrow(
      "unavailable",
    );
    expect(() =>
      pasteObjectClipboard(deck, deck.slides[1].id, clipboard, {
        x: NaN,
        y: 0,
      }),
    ).toThrow("finite");
    expect(deck).toEqual(before);
    deck.assets = [];
    expect(() =>
      captureObjectClipboard(
        deck,
        deck.slides[0],
        deck.slides[0].objects.map((object) => object.id),
      ),
    ).toThrow("missing");
  });
});
