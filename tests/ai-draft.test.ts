import { describe, expect, it } from "vitest";
import {
  aiSlideContext,
  createAISlides,
  MAX_AI_CONTEXT_CHARACTERS,
  MAX_AI_DRAFT_BYTES,
  validateAIDraft,
} from "../src/lib/ai-draft";
import type { AiDraft } from "../src/lib/ai-draft";
import { createDemoDeck, validateDeck } from "../src/lib/model";
import type {
  EquationObject,
  FigureObject,
  TextObject,
  VideoObject,
} from "../src/lib/model";

function draft(): AiDraft {
  return {
    title: "An introduction to cosmology",
    slides: [
      {
        title: "The expansion of the universe",
        bullets: [
          "Define the scale factor.",
          "Compare observations with a model.",
        ],
        equation: "H^2 = \\frac{8\\pi G}{3} \\rho",
        notes: "Explain the assumptions and verify all scientific claims.",
      },
    ],
  };
}

describe("AI draft content boundary", () => {
  it("accepts a complete JSON object or one outer JSON fence and returns independent content", () => {
    const value = draft();
    const json = JSON.stringify(value);
    expect(validateAIDraft(json, 1)).toEqual(value);
    expect(validateAIDraft(` \n\`\`\`json\n${json}\n\`\`\` \n`)).toEqual(value);
    expect(validateAIDraft(`\`\`\`\n${json}\n\`\`\``)).toEqual(value);
    const approved = validateAIDraft(json);
    approved.slides[0].bullets.push("New text");
    expect(value.slides[0].bullets).toHaveLength(2);
  });

  it.each([
    (json: string) => `Here is your draft: ${json}`,
    (json: string) => `${json}\nThank you!`,
    (json: string) => `${json}\n${json}`,
    (json: string) => JSON.stringify(json),
    (json: string) => `\`\`\`javascript\n${json}\n\`\`\``,
    (json: string) => `\`\`\`json\n${json}\n\`\`\`\nextra`,
    () => "{broken json}",
  ])(
    "does not extract plausible JSON from unapproved surrounding output",
    (wrap) => {
      expect(() => validateAIDraft(wrap(JSON.stringify(draft())))).toThrow();
    },
  );

  it("rejects unknown, missing, nested, and prototype-related fields", () => {
    const valid = draft();
    for (const extra of [
      "assets",
      "scripts",
      "theme",
      "__proto__",
      "constructor",
    ])
      expect(() =>
        validateAIDraft(JSON.stringify({ ...valid, [extra]: {} })),
      ).toThrow("only these fields");
    for (const extra of [
      "objects",
      "html",
      "svg",
      "localTex",
      "transform",
      "metadata",
    ])
      expect(() =>
        validateAIDraft(
          JSON.stringify({
            ...valid,
            slides: [{ ...valid.slides[0], [extra]: {} }],
          }),
        ),
      ).toThrow("only these fields");
    const { notes: _notes, ...missingNotes } = valid.slides[0];
    expect(() =>
      validateAIDraft(JSON.stringify({ ...valid, slides: [missingNotes] })),
    ).toThrow("only these fields");
    expect(() =>
      validateAIDraft(
        JSON.stringify({ ...valid, slides: [[valid.slides[0]]] }),
      ),
    ).toThrow("must be an object");
    expect(() =>
      validateAIDraft(
        JSON.stringify({
          ...valid,
          slides: [{ ...valid.slides[0], title: { text: "Nested" } }],
        }),
      ),
    ).toThrow("must be text");
    expect(() => validateAIDraft("null")).toThrow("must be an object");
  });

  it("rejects duplicate keys before overwritten values can hide them", () => {
    const valid = draft();
    const json = JSON.stringify(valid);
    expect(() =>
      validateAIDraft(json.replace('"title":', '"title":"Discarded","title":')),
    ).toThrow("duplicate field");
    expect(() =>
      validateAIDraft(
        json.replace('"notes":', '"no\\u0074es":"Discarded","notes":'),
      ),
    ).toThrow("duplicate field");
    valid.slides[0].notes = 'A quoted string: "title": { [ ] }';
    expect(validateAIDraft(JSON.stringify(valid))).toEqual(valid);
  });

  it("bounds response bytes, not only JavaScript string length", () => {
    expect(() => validateAIDraft(" ".repeat(MAX_AI_DRAFT_BYTES + 1))).toThrow(
      "128 KB",
    );
    expect(() => validateAIDraft("あ".repeat(45_000))).toThrow("128 KB");
  });

  it("enforces requested count, slide count, and independent bullet limits", () => {
    const valid = draft();
    expect(() => validateAIDraft(JSON.stringify(valid), 2)).toThrow(
      "exactly 2",
    );
    for (const count of [0, 13, 1.5, NaN])
      expect(() => validateAIDraft(JSON.stringify(valid), count)).toThrow(
        "Requested slide count",
      );
    for (const count of [0, 13])
      expect(() =>
        validateAIDraft(
          JSON.stringify({
            ...valid,
            slides: Array.from({ length: count }, () => valid.slides[0]),
          }),
        ),
      ).toThrow("between 1 and 12");
    valid.slides = Array.from({ length: 12 }, () => ({
      ...draft().slides[0],
      bullets: Array.from({ length: 6 }, () => "A point"),
    }));
    expect(validateAIDraft(JSON.stringify(valid), 12).slides).toHaveLength(12);
    valid.slides[0].bullets.push("A seventh point");
    expect(() => validateAIDraft(JSON.stringify(valid))).toThrow("at most 6");
  });

  it("enforces field lengths and nonempty titles and bullet text while allowing optional empty content", () => {
    const valid = draft();
    const checks = [
      { field: "title", limit: 160 },
      { field: "equation", limit: 2000 },
      { field: "notes", limit: 3000 },
    ] as const;
    for (const { field, limit } of checks) {
      valid.slides[0][field] = "x".repeat(limit);
      expect(() => validateAIDraft(JSON.stringify(valid))).not.toThrow();
      valid.slides[0][field] += "x";
      expect(() => validateAIDraft(JSON.stringify(valid))).toThrow(
        `at most ${limit}`,
      );
      valid.slides[0] = draft().slides[0];
    }
    valid.title = "x".repeat(161);
    expect(() => validateAIDraft(JSON.stringify(valid))).toThrow("Draft title");
    valid.title = " ";
    expect(() => validateAIDraft(JSON.stringify(valid))).toThrow(
      "cannot be empty",
    );
    valid.title = "Deck";
    valid.slides[0].bullets = [" "];
    expect(() => validateAIDraft(JSON.stringify(valid))).toThrow(
      "cannot be empty",
    );
    valid.slides[0].bullets = ["x".repeat(241)];
    expect(() => validateAIDraft(JSON.stringify(valid))).toThrow("at most 240");
    valid.slides[0] = {
      title: "A title",
      bullets: [],
      equation: "",
      notes: "",
    };
    expect(validateAIDraft(JSON.stringify(valid)).slides[0].bullets).toEqual(
      [],
    );
  });

  it.each([
    "\\documentclass{article}",
    "\\usepackage{amsmath}",
    "\\require{html}",
    "\\input{secret.tex}",
    "\\includegraphics{image.svg}",
    "\\htmlClass{danger}{x}",
    "\\href{https://example.org}{x}",
    "\\begin{document} x \\end{document}",
    '<svg><script>alert("x")</script></svg>',
  ])(
    "rejects executable, external, and full-document equation output: %s",
    (equation) => {
      const valid = draft();
      valid.slides[0].equation = equation;
      expect(() => validateAIDraft(JSON.stringify(valid))).toThrow(
        "MathJax math only",
      );
    },
  );

  it("keeps AMS math source and multiline notes as content and rejects invisible control characters", () => {
    const valid = draft();
    valid.slides[0].equation = "\\mathbb{R} \\subseteq \\mathbb{C}";
    valid.slides[0].notes = "  First paragraph.\r\nSecond paragraph.  ";
    expect(validateAIDraft(JSON.stringify(valid)).slides[0].notes).toBe(
      "First paragraph.\nSecond paragraph.",
    );
    valid.slides[0].title = "Hidden\u0000control";
    expect(() => validateAIDraft(JSON.stringify(valid))).toThrow(
      "control characters",
    );
  });
});

describe("AI draft native slide conversion", () => {
  it("produces valid native, independently editable slides with fresh IDs and inherited equation styling", () => {
    const deck = createDemoDeck();
    deck.theme.fontFamily = "Custom font";
    deck.theme.equation = {
      fontSetId: "mathjax-fira",
      fontSize: 47,
      color: "#a34f72",
    };
    deck.slides[0].background = "#f6f8fa";
    const before = structuredClone(deck);
    const content = draft();
    const first = createAISlides(content, deck, "codex");
    const second = createAISlides(content, deck, "claude");
    expect(() =>
      validateDeck({ ...deck, slides: [...deck.slides, ...first, ...second] }),
    ).not.toThrow();
    expect(deck).toEqual(before);
    expect(first[0].notes).toBe(content.slides[0].notes);
    expect(first[0].background).toBe("#f6f8fa");
    const ids = [...first, ...second].flatMap((slide) => [
      slide.id,
      ...slide.objects.map((object) => object.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const object of first[0].objects) {
      expect(["text", "equation"]).toContain(object.type);
      expect(object.locked).toBe(false);
      expect(object.visible).toBe(true);
      expect(object.metadata).toEqual({ ai: { provider: "codex" } });
      if (object.type === "text") {
        expect(object.fontFamily).toBe("Custom font");
        expect(object.color).toBe("#a34f72");
      } else if (object.type === "equation") {
        expect(object.renderer).toBe("mathjax");
        expect(object.style).toEqual({});
        expect(object.localTex).toBeUndefined();
      }
    }
    first[0].objects[0].metadata.changed = true;
    first[0].objects[0].transform.y = 999;
    expect(second[0].objects[0].metadata.changed).toBeUndefined();
    expect(second[0].objects[0].transform.y).not.toBe(999);
  });

  it.each([
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 800, height: 600 },
  ])(
    "scales dense titles and bullet rows within %j without overlapping the footer or each other",
    (size) => {
      const deck = createDemoDeck();
      deck.slideSize = { ...size, unit: "px96" };
      const content = draft();
      content.slides[0].title = "題".repeat(160);
      content.slides[0].bullets = Array.from({ length: 6 }, () =>
        "文".repeat(240),
      );
      for (const equation of ["x^2", ""]) {
        content.slides[0].equation = equation;
        const slides = createAISlides(content, deck, "gemini");
        expect(() => validateDeck({ ...deck, slides })).not.toThrow();
        const objects = slides[0].objects;
        for (let index = 0; index < objects.length; index++) {
          const { transform } = objects[index];
          expect(transform.x).toBeGreaterThan(0);
          expect(transform.x + transform.width).toBeLessThan(size.width);
          expect(transform.y + transform.height).toBeLessThanOrEqual(
            (size.height * 804) / 900 + 0.01,
          );
          if (index > 0) {
            const previous = objects[index - 1].transform;
            expect(transform.y + 0.01).toBeGreaterThanOrEqual(
              previous.y + previous.height,
            );
          }
        }
      }
    },
  );

  it("revalidates programmatically supplied drafts rather than copying arbitrary objects or fields", () => {
    const deck = createDemoDeck();
    expect(() =>
      createAISlides(
        { ...draft(), scripts: "danger" } as AiDraft,
        deck,
        "codex",
      ),
    ).toThrow("only these fields");
    expect(() => createAISlides(draft(), deck, "other" as "codex")).toThrow(
      "supported AI provider",
    );
  });
});

describe("opt-in AI slide context", () => {
  it("includes visible text, math source and notes while excluding assets, paths, compiler settings and metadata", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0];
    const text = slide.objects.find(
      (object): object is TextObject => object.type === "text",
    )!;
    const equation = slide.objects.find(
      (object): object is EquationObject => object.type === "equation",
    )!;
    const figure = slide.objects.find(
      (object): object is FigureObject => object.type === "figure",
    )!;
    text.text = "Visible scientific result";
    text.metadata = {
      source: "/secret/private-source.txt",
      hidden: "hidden metadata",
    };
    equation.renderer = "local-latex";
    equation.localTex = {
      engine: "xelatex",
      preamble: "secret compiler preamble",
      render: {
        svg: "private cached SVG",
        width: 100,
        height: 20,
        inputFingerprint: "private hash",
        profile: {
          engine: "xelatex",
          engineVersion: "private version",
          converterVersion: "private converter",
          dependencies: [
            { name: "/secret/style.sty", sha256: "private dependency" },
          ],
        },
        warnings: ["private warning"],
      },
    };
    figure.alt = "Private image alternative text";
    figure.assetId = "/secret/figure.svg";
    deck.assets[0].dataUrl = "private media bytes";
    const hidden = structuredClone(text);
    hidden.id = "hidden-text";
    hidden.text = "Invisible slide text";
    hidden.visible = false;
    const video: VideoObject = {
      ...figure,
      type: "video",
      alt: "Private video text",
      autoplay: false,
      loop: false,
      muted: true,
      controls: true,
    };
    slide.objects.push(hidden, video);
    const context = aiSlideContext(deck, slide);
    expect(context).toContain(deck.title);
    expect(context).toContain(slide.title);
    expect(context).toContain("Visible scientific result");
    expect(context).toContain(JSON.stringify(equation.latex).slice(1, -1));
    expect(context).toContain(JSON.stringify(slide.notes).slice(1, -1));
    expect(context).not.toMatch(
      /private|secret|metadata|dataUrl|assetId|localTex|Invisible|Private/,
    );
    expect(aiSlideContext(deck, slide)).toBe(context);
  });

  it("bounds large contexts deterministically with an explicit truncation marker", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0];
    slide.notes = "Long notes ".repeat(10_000);
    const context = aiSlideContext(deck, slide);
    expect(context.length).toBeLessThanOrEqual(MAX_AI_CONTEXT_CHARACTERS);
    expect(context).toContain("[Context truncated]");
    expect(context).toBe(aiSlideContext(deck, slide));
  });
});
