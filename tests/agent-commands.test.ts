import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentSchema,
  applyAgentOperations,
  createAgentDeck,
  inspectDeck,
  validateAgentOperationsInput,
} from "../src/cli/commands";
import type { CreateAgentDeckOptions } from "../src/cli/commands";
import { validateDeck } from "../src/lib/model";
import type { Asset, Deck, EquationObject } from "../src/lib/model";
import { DECK_THEMES } from "../src/lib/deck-themes";
import { selectedMediaPlaceholder } from "../src/lib/media-placeholders";

const image: Asset = {
  id: "image-asset",
  name: "plot.svg",
  mime: "image/svg+xml",
  dataUrl:
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><path d="M0 0L600 300"/></svg>',
    ),
  width: 600,
  height: 300,
};
const video: Asset = {
  id: "video-asset",
  name: "demo.mp4",
  mime: "video/mp4",
  dataUrl: "data:video/mp4;base64,AAAA",
  width: 640,
  height: 360,
};
const vector =
  '<svg width="100" height="30" viewBox="0 0 100 30"><path d="M0 0L100 30"/></svg>';

function blank(): Deck {
  return createAgentDeck({ layout: "blank", title: "Original deck" });
}

function cachedDeck(style: EquationObject["style"] = {}) {
  const created = applyAgentOperations(blank(), [
    {
      op: "object.add",
      slide: 1,
      object: {
        id: "saved-equation",
        type: "equation",
        latex: "x",
        renderer: "local-latex",
        style,
        metadata: { notebook: "derivation.ipynb", parameters: { alpha: 0.5 } },
        localTex: {
          engine: "latex",
          preamble: "",
          render: {
            svg: vector,
            width: 100,
            height: 30,
            inputFingerprint: JSON.stringify([
              "scislide-local-tex-v1",
              "x",
              "latex",
              "",
              true,
              style.fontSize ?? 48,
              style.color ?? "#17263c",
            ]),
            profile: {
              engine: "latex",
              engineVersion: "fixture",
              converterVersion: "fixture",
              dependencies: [{ name: "amsmath.sty", sha256: "a".repeat(64) }],
            },
            warnings: ["Keep this cache metadata."],
          },
        },
      },
    },
  ]).deck;
  return {
    deck: created,
    equation: created.slides[0].objects[0] as EquationObject,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("native agent deck creation and discovery", () => {
  it("creates native editable decks for every theme without DOM or filesystem APIs", () => {
    expect(typeof document).toBe("undefined");
    for (const theme of DECK_THEMES) {
      const deck = createAgentDeck({
        title: "Scientific result",
        theme: theme.id,
      });
      expect(validateDeck(deck)).toEqual(deck);
      expect(deck.title).toBe("Scientific result");
      expect(deck.assets).toEqual([]);
      expect(deck.slides).toHaveLength(1);
      expect(
        deck.slides[0].objects.some((object) => object.type === "text"),
      ).toBe(true);
      expect(inspectDeck(deck).themeId).toBe(theme.id);
    }
  });

  it("supports blank/native templates and scales template geometry to the requested canvas", () => {
    const original = createAgentDeck({
      theme: "keynote-white",
      layout: "keynote-white-title",
    });
    const resized = createAgentDeck({
      theme: "keynote-white",
      layout: "keynote-white-title",
      width: 800,
      height: 450,
    });
    expect(resized.slideSize).toEqual({
      width: 800,
      height: 450,
      unit: "px96",
    });
    expect(resized.slides[0].objects[0].transform.x).toBe(
      original.slides[0].objects[0].transform.x / 2,
    );
    expect(resized.slides[0].objects[0].transform.width).toBe(
      original.slides[0].objects[0].transform.width / 2,
    );
    expect(blank().slides[0].objects).toEqual([]);
    for (const options of [
      { theme: "missing" },
      { layout: "missing" },
      { width: 50 },
      { height: 30_000 },
      { title: 42 },
      { script: "run" },
    ])
      expect(() =>
        createAgentDeck(options as unknown as CreateAgentDeckOptions),
      ).toThrow();
  });

  it("publishes a serializable version-1 schema whose example batch edits the native model", () => {
    const schema = JSON.parse(JSON.stringify(agentSchema));
    expect(schema.properties.version.const).toBe(1);
    expect(schema.$defs.operation.oneOf).toHaveLength(12);
    expect(
      schema["x-scislide"].themes.map((theme: { id: string }) => theme.id),
    ).toEqual(DECK_THEMES.map((theme) => theme.id));
    const { deck, results } = applyAgentOperations(
      createAgentDeck(),
      schema.examples[0],
    );
    expect(deck.title).toBe("Research talk");
    expect(deck.slides[0].id).toBe("results-slide");
    expect(
      deck.slides[0].objects.find((object) => object.id === "results-equation"),
    ).toMatchObject({ latex: "E^2=p^2c^2+m^2c^4", style: { fontSize: 56 } });
    expect(results).toHaveLength(6);
  });

  it("preflights a complete operations batch without a deck or asset file reads", () => {
    expect(() =>
      validateAgentOperationsInput(agentSchema.examples[0]),
    ).not.toThrow();
    expect(() =>
      validateAgentOperationsInput({ version: 2, operations: [] }),
    ).toThrow(/version/);
    expect(() =>
      validateAgentOperationsInput([
        { op: "asset.add", asset: image },
        { op: "object.add", slide: 1, object: { type: "text", fontSize: -1 } },
      ]),
    ).toThrow(/Operation 2/);
    expect(() =>
      validateAgentOperationsInput([
        {
          op: "deck.update",
          patch: {
            theme: { equation: { color: "url(https://external.test/color)" } },
          },
        },
      ]),
    ).toThrow();
    expect(() =>
      validateAgentOperationsInput([{ op: "run", script: "not supported" }]),
    ).toThrow(/Unknown agent operation/);
  });
});

describe("atomic native agent operations", () => {
  it("roundtrips slide/object ordering, stable IDs and partial transforms through native JSON", () => {
    const original = blank();
    const originalSnapshot = structuredClone(original);
    const { deck, results } = applyAgentOperations(original, {
      version: 1,
      operations: [
        {
          op: "deck.update",
          patch: {
            title: "Edited deck",
            pageNumbers: { format: "number-total", enabled: true },
          },
        },
        { op: "slide.add", id: "second", after: { index: 1 }, title: "Second" },
        {
          op: "slide.add",
          id: "third",
          index: 1,
          layout: "blank",
          notes: "Speaker's notes",
        },
        {
          op: "slide.update",
          slide: { index: 3 },
          patch: { title: "Results", background: "#ffffff" },
        },
        { op: "slide.reorder", slide: "second", index: 1 },
        {
          op: "object.add",
          slide: "second",
          object: { id: "a", type: "text", text: "A" },
        },
        {
          op: "object.add",
          slide: "second",
          index: 1,
          object: {
            id: "b",
            type: "text",
            text: "B",
            metadata: { source: { file: "analysis.py" } },
          },
        },
        {
          op: "object.add",
          slide: "second",
          after: "b",
          object: { id: "c", type: "shape", shape: "arrow" },
        },
        { op: "object.reorder", slide: "second", id: "a", index: 1 },
        {
          op: "object.update",
          slide: "second",
          id: "b",
          patch: { transform: { x: 340 }, fontWeight: 700 },
        },
        { op: "object.remove", slide: "second", id: "c" },
        { op: "slide.remove", slide: "third" },
      ],
    });
    expect(original).toEqual(originalSnapshot);
    expect(deck.slides.map((slide) => slide.id)).toEqual([
      "second",
      original.slides[0].id,
    ]);
    expect(deck.slides[0].objects.map((object) => object.id)).toEqual([
      "a",
      "b",
    ]);
    expect(deck.slides[0].objects[1]).toMatchObject({
      fontWeight: 700,
      transform: { x: 340, y: 250, width: 600, height: 120, rotation: 0 },
      metadata: { source: { file: "analysis.py" } },
    });
    expect(deck.pageNumbers).toMatchObject({
      enabled: true,
      format: "number-total",
      startAt: 1,
    });
    expect(results[1]).toMatchObject({
      op: "slide.add",
      slideId: "second",
      index: 2,
    });
    expect(results[9]).toMatchObject({
      objectId: "b",
      slideId: "second",
      index: 2,
    });
    expect(validateDeck(JSON.parse(JSON.stringify(deck)))).toEqual(deck);
  });

  it("keeps numeric-looking IDs distinct from explicit 1-based slide indexes", () => {
    const original = blank();
    original.slides[0].id = "1";
    const first = applyAgentOperations(original, [
      { op: "slide.add", id: "second" },
      { op: "slide.update", slide: "1", patch: { title: "By stable ID" } },
      { op: "slide.update", slide: { index: 2 }, patch: { title: "By index" } },
    ]).deck;
    expect(first.slides.map((slide) => slide.title)).toEqual([
      "By stable ID",
      "By index",
    ]);
    expect(() =>
      applyAgentOperations(first, [
        { op: "slide.update", slide: "2", patch: {} },
      ]),
    ).toThrow(/Numeric strings are IDs/);
    expect(() =>
      applyAgentOperations(first, [
        { op: "slide.update", slide: 3, patch: {} },
      ]),
    ).toThrow(/1-based/);
    expect(() =>
      applyAgentOperations(first, [
        { op: "slide.update", slide: { id: "1", index: 1 }, patch: {} },
      ]),
    ).toThrow();
  });

  it("rolls back earlier edits when any operation or final native model is invalid", () => {
    const original = blank();
    const snapshot = structuredClone(original);
    for (const invalid of [
      {
        op: "object.add",
        slide: 1,
        object: { type: "text", transform: { width: -10 } },
      },
      { op: "slide.remove", slide: 1 },
      { op: "slide.update", slide: "missing", patch: { title: "No" } },
      {
        op: "slide.update",
        slide: 1,
        patch: { background: "url(https://evil.test/image)" },
      },
      { op: "code.run", source: "arbitrary code" },
    ]) {
      expect(() =>
        applyAgentOperations(original, [
          { op: "deck.update", patch: { title: "Should be rolled back" } },
          invalid,
        ]),
      ).toThrow();
      expect(original).toEqual(snapshot);
    }
    expect(() =>
      applyAgentOperations(original, [
        { op: "slide.update", slide: 1, patch: { title: 42 } },
        { op: "slide.update", slide: 1, patch: { title: "Repaired later" } },
      ]),
    ).toThrow(/Operation 1/);
  });

  it("strictly rejects unknown batch, operation, patch and nested fields", () => {
    const original = blank();
    for (const operations of [
      { version: 2, operations: [] },
      { version: 1, operations: [], execute: "not allowed" },
      [{ op: "deck.update", patch: {}, script: "not allowed" }],
      [{ op: "deck.update", patch: { theme: { equation: { surprise: 42 } } } }],
      [{ op: "slide.add", title: "X", unexpected: true }],
      [
        {
          op: "object.add",
          slide: 1,
          object: { type: "text", nonsense: true },
        },
      ],
      [
        {
          op: "object.add",
          slide: 1,
          object: { type: "text", transform: { code: "run" } },
        },
      ],
      [{ op: "asset.add", asset: { ...image, path: "/some/external/file" } }],
    ])
      expect(() => applyAgentOperations(original, operations)).toThrow();
    expect(() =>
      applyAgentOperations(
        original,
        Array.from({ length: 1001 }, () => ({ op: "deck.update", patch: {} })),
      ),
    ).toThrow(/at most 1000/);
  });

  it("rejects non-JSON values and getters without invoking user code", () => {
    const original = blank();
    const callback = vi.fn();
    expect(() =>
      applyAgentOperations(original, [
        { op: "deck.update", patch: { title: callback } },
      ]),
    ).toThrow(/JSON/);
    const operation = { op: "deck.update", patch: {} };
    Object.defineProperty(operation, "execute", {
      enumerable: true,
      get: callback,
    });
    expect(() => applyAgentOperations(original, [operation])).toThrow(
      /ordinary JSON/,
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it("checks batch wrappers and array descriptors before reading getters or methods", () => {
    const original = blank();
    const callback = vi.fn(() => [{ op: "deck.update", patch: {} }]);
    const wrapper = { version: 1 };
    Object.defineProperty(wrapper, "operations", {
      enumerable: true,
      get: callback,
    });
    expect(() => applyAgentOperations(original, wrapper)).toThrow(
      /ordinary JSON/,
    );
    const getterArray: unknown[] = [];
    Object.defineProperty(getterArray, "0", {
      enumerable: true,
      get: callback,
    });
    expect(() => applyAgentOperations(original, getterArray)).toThrow(
      /ordinary JSON/,
    );
    const overridden = [{ op: "deck.update", patch: {} }];
    Object.defineProperty(overridden, "forEach", {
      enumerable: true,
      value: callback,
    });
    expect(() => applyAgentOperations(original, overridden)).toThrow(
      /JSON list/,
    );
    expect(() =>
      applyAgentOperations(original, [
        {
          op: "object.add",
          slide: 1,
          object: { type: "text", metadata: { rows: getterArray } },
        },
      ]),
    ).toThrow(/ordinary JSON/);
    expect(() =>
      applyAgentOperations(original, [
        {
          op: "object.add",
          slide: 1,
          object: { type: "text", metadata: { nested: { value: NaN } } },
        },
      ]),
    ).toThrow(/JSON/);
    expect(callback).not.toHaveBeenCalled();
  });

  it("retains arbitrary JSON metadata keys without prototype pollution or schema inheritance", () => {
    const metadata = JSON.parse(
      '{"constructor":{"seed":1},"toString":"label","hasOwnProperty":"data","__proto__":{"agentPollution":true}}',
    );
    const result = applyAgentOperations(blank(), [
      {
        op: "object.add",
        slide: 1,
        object: { id: "metadata-text", type: "text", metadata },
      },
    ]);
    expect(result.deck.slides[0].objects[0].metadata).toEqual(metadata);
    expect(
      Object.getPrototypeOf(result.deck.slides[0].objects[0].metadata),
    ).toBe(Object.prototype);
    expect(
      (Object.prototype as Record<string, unknown>).agentPollution,
    ).toBeUndefined();
  });

  it("requires globally unique IDs and does not recycle removed IDs within a batch", () => {
    const original = blank();
    expect(() =>
      applyAgentOperations(original, [{ op: "slide.add", id: original.id }]),
    ).toThrow(/already used/);
    expect(() =>
      applyAgentOperations(original, [
        { op: "asset.add", asset: image },
        { op: "object.add", slide: 1, object: { id: image.id, type: "text" } },
      ]),
    ).toThrow(/already used/);
    expect(() =>
      applyAgentOperations(original, [
        { op: "slide.add", id: "do-not-recycle" },
        { op: "slide.remove", slide: "do-not-recycle" },
        { op: "slide.add", id: "do-not-recycle" },
      ]),
    ).toThrow(/already used/);
    vi.stubGlobal("crypto", { randomUUID: () => original.id });
    expect(() =>
      applyAgentOperations(original, [
        { op: "object.add", slide: 1, object: { type: "text" } },
      ]),
    ).toThrow(/globally unique/);
  });

  it("generates distinct IDs for native template slides and all new object types", () => {
    const { deck, results } = applyAgentOperations(blank(), [
      { op: "slide.add", layout: "keynote-white-title-bullets" },
      { op: "slide.add", layout: "equation" },
      { op: "asset.add", asset: image },
      { op: "asset.add", asset: video },
      { op: "object.add", slide: 1, object: { type: "text" } },
      { op: "object.add", slide: 1, object: { type: "equation" } },
      {
        op: "object.add",
        slide: 1,
        object: { type: "shape", shape: "ellipse" },
      },
      {
        op: "object.add",
        slide: 1,
        object: { type: "figure", assetId: image.id },
      },
      {
        op: "object.add",
        slide: 1,
        object: { type: "video", assetId: video.id },
      },
    ]);
    const identifiers = [
      deck.id,
      ...deck.assets.map((asset) => asset.id),
      ...deck.slides.flatMap((slide) => [
        slide.id,
        ...slide.objects.map((object) => object.id),
      ]),
    ];
    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect(results[0].objectIds).toEqual(
      deck.slides[1].objects.map((object) => object.id),
    );
    expect(deck.slides[0].objects.map((object) => object.type)).toEqual([
      "text",
      "equation",
      "shape",
      "figure",
      "video",
    ]);
    expect(validateDeck(deck)).toEqual(deck);
  });

  it("retains native template photo/video decoration references when allocating slide IDs", () => {
    const { deck } = applyAgentOperations(blank(), [
      {
        op: "slide.add",
        id: "native-photo",
        layout: "keynote-white-title-photo-alternate",
      },
      {
        op: "slide.add",
        id: "native-video",
        layout: "keynote-white-small-video",
      },
    ]);
    for (const slide of deck.slides.slice(1)) {
      const decoration = slide.objects.find(
        (object) => typeof object.metadata.mediaPlaceholderFor === "string",
      )!;
      expect(decoration).toBeDefined();
      const frame = slide.objects.find(
        (object) => object.id === decoration.metadata.mediaPlaceholderFor,
      )!;
      expect(frame).toBeDefined();
      expect(
        selectedMediaPlaceholder(
          slide,
          [decoration.id],
          frame.metadata.mediaPlaceholder as "photo" | "video",
        )?.id,
      ).toBe(frame.id);
    }
  });

  it("validates embedded asset references atomically, including forward references and removals", () => {
    const created = applyAgentOperations(blank(), [
      {
        op: "object.add",
        slide: 1,
        object: { id: "figure", type: "figure", assetId: image.id },
      },
      { op: "asset.add", asset: image },
    ]).deck;
    expect(created.slides[0].objects[0]).toMatchObject({
      type: "figure",
      assetId: image.id,
    });
    expect(() =>
      applyAgentOperations(created, [{ op: "asset.remove", id: image.id }]),
    ).toThrow(/Missing figure asset/);
    expect(() =>
      applyAgentOperations(created, [
        {
          op: "asset.update",
          id: image.id,
          patch: { mime: video.mime, dataUrl: video.dataUrl },
        },
      ]),
    ).toThrow(/reference an image/);
    expect(() =>
      applyAgentOperations(blank(), [
        {
          op: "asset.add",
          asset: { ...image, dataUrl: "https://external.test/image.svg" },
        },
      ]),
    ).toThrow(/Media content/);
    const removed = applyAgentOperations(created, [
      { op: "asset.remove", id: image.id },
      { op: "object.remove", slide: 1, id: "figure" },
    ]).deck;
    expect(removed.assets).toEqual([]);
    expect(removed.slides[0].objects).toEqual([]);
    expect(created.assets).toEqual([image]);
  });

  it("preserves metadata, unknown native extensions and embedded assets on unrelated edits", () => {
    const { deck, equation } = cachedDeck();
    deck.assets.push(image);
    (deck as Deck & { scientificMetadata: unknown }).scientificMetadata = {
      simulation: { seed: 124 },
    };
    const snapshot = structuredClone(deck);
    const operations = [
      { op: "deck.update", patch: { title: "Only a new title" } },
      {
        op: "object.update",
        slide: 1,
        id: equation.id,
        patch: { transform: { x: 450 } },
      },
    ];
    const next = applyAgentOperations(deck, operations).deck;
    expect(next.assets).toEqual(snapshot.assets);
    expect(
      (next as Deck & { scientificMetadata: unknown }).scientificMetadata,
    ).toEqual({ simulation: { seed: 124 } });
    expect(next.slides[0].objects[0].metadata).toEqual(equation.metadata);
    expect((next.slides[0].objects[0] as EquationObject).localTex).toEqual(
      equation.localTex,
    );
    expect(deck).toEqual(snapshot);
  });
});

describe("native equation cache handling", () => {
  it.each([
    { latex: "x^2" },
    { displayMode: false },
    { renderer: "mathjax" },
    { style: { fontSize: 56 } },
    { style: { color: "#ff0000" } },
    { localTex: { engine: "xelatex" } },
    { localTex: { preamble: "\\usepackage{amsmath}" } },
  ])(
    "invalidates a Local LaTeX render when compile inputs change: %j",
    (patch) => {
      const { deck, equation } = cachedDeck();
      const next = applyAgentOperations(deck, [
        { op: "object.update", slide: 1, id: equation.id, patch },
      ]).deck.slides[0].objects[0] as EquationObject;
      expect(next.localTex?.render).toBeUndefined();
      expect(equation.localTex?.render?.svg).toBe(vector);
      expect(next.metadata).toEqual(equation.metadata);
    },
  );

  it("merges style/local settings, inherits cleared overrides and preserves caches for noncompile edits", () => {
    const { deck, equation } = cachedDeck({ fontSize: 56, color: "#123456" });
    const changed = applyAgentOperations(deck, [
      {
        op: "object.update",
        slide: 1,
        id: equation.id,
        patch: {
          style: { fontSize: null },
          localTex: { preamble: "\\usepackage{amsmath}" },
        },
      },
    ]).deck.slides[0].objects[0] as EquationObject;
    expect(changed.style).toEqual({ color: "#123456" });
    expect(changed.localTex).toEqual({
      engine: "latex",
      preamble: "\\usepackage{amsmath}",
    });
    const unchanged = applyAgentOperations(deck, [
      {
        op: "object.update",
        slide: 1,
        id: equation.id,
        patch: {
          style: { fontSetId: "mathjax-fira" },
          transform: { rotation: 15 },
          description: "Same compile inputs",
        },
      },
    ]).deck.slides[0].objects[0] as EquationObject;
    expect(unchanged.localTex?.render).toEqual(equation.localTex?.render);
    expect(unchanged.style).toMatchObject({
      fontSetId: "mathjax-fira",
      fontSize: 56,
      color: "#123456",
    });
  });

  it("theme changes invalidate inherited compile inputs but preserve explicit equation overrides", () => {
    const inherited = cachedDeck();
    const changed = applyAgentOperations(inherited.deck, [
      { op: "deck.update", patch: { theme: { equation: { fontSize: 64 } } } },
    ]).deck;
    expect(
      (changed.slides[0].objects[0] as EquationObject).localTex?.render,
    ).toBeUndefined();
    const overridden = cachedDeck({ fontSize: 48, color: "#17263c" });
    const preserved = applyAgentOperations(overridden.deck, [
      { op: "deck.update", patch: { theme: "minimal-black" } },
    ]).deck;
    expect(
      (preserved.slides[0].objects[0] as EquationObject).localTex?.render,
    ).toEqual(overridden.equation.localTex?.render);
    expect(preserved.slides[0].objects[0].metadata).toEqual(
      overridden.equation.metadata,
    );
  });

  it("rejects executable cached SVG even when another patch would invalidate that cache", () => {
    const { deck, equation } = cachedDeck();
    expect(() =>
      applyAgentOperations(deck, [
        {
          op: "object.update",
          slide: 1,
          id: equation.id,
          patch: {
            latex: "y",
            localTex: {
              render: {
                ...equation.localTex!.render,
                svg: "<svg><script>alert(1)</script></svg>",
              },
            },
          },
        },
      ]),
    ).toThrow(/self-contained vector/);
    expect(equation.localTex?.render?.svg).toBe(vector);
  });

  it("inspect includes editable scientific content and IDs without embedded media or cached SVG", () => {
    const { deck, equation } = cachedDeck();
    const next = applyAgentOperations(deck, [
      { op: "asset.add", asset: image },
      {
        op: "object.add",
        slide: 1,
        object: {
          id: "prose",
          type: "text",
          text: "Energy $E=mc^2$ remains.",
          metadata: { experiment: "A" },
        },
      },
      {
        op: "slide.update",
        slide: 1,
        patch: { notes: "Keep the precise assumptions." },
      },
    ]).deck;
    const summary = inspectDeck(next);
    expect(summary.slides[0].objects[0]).toMatchObject({
      id: equation.id,
      index: 1,
      latex: "x",
      localTex: {
        engine: "latex",
        render: { width: 100, height: 30, svgCharacters: vector.length },
      },
    });
    expect(summary.slides[0].objects[1]).toMatchObject({
      id: "prose",
      text: "Energy $E=mc^2$ remains.",
      metadata: { experiment: "A" },
    });
    expect(summary.slides[0]).toMatchObject({
      id: next.slides[0].id,
      index: 1,
      notes: "Keep the precise assumptions.",
    });
    expect(summary.assets[0]).toMatchObject({
      id: image.id,
      mime: image.mime,
      dataUrlCharacters: image.dataUrl.length,
    });
    expect(JSON.stringify(summary)).not.toContain(vector);
    expect(summary.assets[0]).not.toHaveProperty("dataUrl");
    expect(
      (summary.slides[0].objects[0] as { localTex: { render: unknown } })
        .localTex.render,
    ).not.toHaveProperty("svg");
  });
});
