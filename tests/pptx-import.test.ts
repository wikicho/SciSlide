// @vitest-environment jsdom
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { describe, expect, it } from "vitest";
import { importPptx } from "../src/lib/import-pptx";
import { buildDeckArchive, readDeckArchive } from "../src/lib/persistence";
import { getInlineMathSpans, inlinePlainText } from "../src/lib/inline-math";
import { renderEquation } from "../src/lib/equations";

const office =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationships =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";

function relationships(entries: [string, string, string, string?][]) {
  return `<Relationships xmlns="${packageRelationships}">${entries
    .map(
      ([id, kind, target, mode]) =>
        `<Relationship Id="${id}" Type="${office}/${kind}" Target="${target}" ${mode ? `TargetMode="${mode}"` : ""}/>`,
    )
    .join("")}</Relationships>`;
}

function xml(name: string, body: string) {
  return `<p:${name} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${office}">${body}</p:${name}>`;
}

const transform = `<a:xfrm rot="1800000"><a:off x="952500" y="1905000"/><a:ext cx="2857500" cy="952500"/></a:xfrm>`;
const emptyTransforms = "<p:nvGrpSpPr/><p:grpSpPr/>";
const slideTree = (items: string) =>
  `<p:cSld><p:spTree>${emptyTransforms}${items}</p:spTree></p:cSld>`;

function packageFixture(
  options: { invalidSlide?: boolean; invalidRoot?: boolean } = {},
) {
  const zip = new JSZip();
  zip.file(
    "_rels/.rels",
    relationships([["presentation", "officeDocument", "/deck/main.xml"]]),
  );
  zip.file(
    "deck/main.xml",
    (options.invalidRoot ? "<!DOCTYPE x>" : "") +
      xml(
        "presentation",
        '<p:sldIdLst><p:sldId id="501" r:id="second"/><p:sldId id="500" r:id="first"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/>',
      ),
  );
  zip.file(
    "deck/_rels/main.xml.rels",
    relationships([
      ["first", "slide", "pages/slide1.xml"],
      ["second", "slide", "pages/slide2.xml"],
    ]),
  );
  zip.file(
    "deck/pages/slide2.xml",
    options.invalidSlide
      ? "<broken"
      : xml(
          "sld",
          slideTree(`
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr/><p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:p><a:pPr algn="ctr"/>
        <a:r><a:rPr sz="2400" b="1"><a:latin typeface="Inter"/></a:rPr><a:t>첫 슬라이드 &amp; $5 / $9</a:t></a:r>
      </a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Box"/></p:nvSpPr><p:spPr>${transform}
      <a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="334455"/></a:solidFill></a:ln>
    </p:spPr></p:sp>
    <p:pic><p:nvPicPr><p:cNvPr id="4" name="Plot" descr="Signal plot"/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="img"/><a:srcRect l="25000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr>${transform}<a:prstGeom prst="rect"/></p:spPr></p:pic>
    <p:graphicFrame><a:graphic><a:graphicData uri="${a}/chart"/></a:graphic></p:graphicFrame>
  `) + "<p:timing/>",
        ),
  );
  zip.file(
    "deck/pages/_rels/slide2.xml.rels",
    relationships([
      ["layout", "slideLayout", "../layouts/layout.xml"],
      ["notes", "notesSlide", "../notes/notes.xml"],
      ["img", "image", "../media/signal%20plot.svg"],
    ]),
  );
  zip.file(
    "deck/layouts/layout.xml",
    xml(
      "sldLayout",
      slideTree(`
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${transform}</p:spPr></p:sp>
  `),
    ),
  );
  zip.file(
    "deck/layouts/_rels/layout.xml.rels",
    relationships([["master", "slideMaster", "../master.xml"]]),
  );
  zip.file("deck/master.xml", xml("sldMaster", slideTree("")));
  zip.file(
    "deck/_rels/master.xml.rels",
    relationships([["theme", "theme", "theme.xml"]]),
  );
  zip.file(
    "deck/theme.xml",
    `<a:theme xmlns:a="${a}"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="AABBCC"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`,
  );
  zip.file(
    "deck/media/signal plot.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>',
  );
  zip.file(
    "deck/notes/notes.xml",
    xml(
      "notes",
      slideTree(`
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody>
      <a:p><a:r><a:t>발표자 노트</a:t></a:r><a:br/><a:r><a:t>Speaker note</a:t></a:r></a:p>
      <a:p><a:r><a:t>Second paragraph</a:t></a:r></a:p>
    </p:txBody></p:sp>`),
    ),
  );
  zip.file(
    "deck/pages/slide1.xml",
    xml(
      "sld",
      slideTree(`
    <p:pic><p:nvPicPr><p:cNvPr id="2" name="Linked figure"/></p:nvPicPr>
      <p:blipFill><a:blip r:link="remote"/></p:blipFill><p:spPr>${transform}</p:spPr></p:pic>
    <p:sp><p:spPr>${transform}<a:prstGeom prst="star5"/></p:spPr></p:sp>
  `),
    ),
  );
  zip.file(
    "deck/pages/_rels/slide1.xml.rels",
    relationships([
      ["remote", "image", "https://example.invalid/figure.png", "External"],
    ]),
  );
  return zip;
}

async function fixture(options?: Parameters<typeof packageFixture>[0]) {
  const bytes = await packageFixture(options).generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
  });
  return new File([bytes], "Research.PPTX");
}

describe("PowerPoint import", () => {
  it("keeps theme overrides, mapped text colors, and DrawingML color transforms", async () => {
    const zip = packageFixture();
    zip.file(
      "deck/pages/slide2.xml",
      xml(
        "sld",
        `<p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></p:bgPr></p:bg><p:spTree>
        <p:sp><p:spPr>${transform}</p:spPr><p:txBody><a:p>
          <a:r><a:t>Light text</a:t></a:r>
          <a:r><a:rPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50%"/><a:lumOff val="25000"/><a:alpha val="50%"/><a:alphaMod val="50000"/><a:alphaOff val="-5000"/></a:schemeClr></a:solidFill></a:rPr><a:t> accent</a:t></a:r>
        </a:p></p:txBody></p:sp>
        <p:sp><p:spPr>${transform}<a:solidFill><a:scrgbClr r="50000" g="50%" b="50000"/></a:solidFill>
          <a:ln><a:solidFill><a:hslClr hue="7200000" sat="100000" lum="50000"/></a:solidFill></a:ln>
        </p:spPr></p:sp>
        <p:sp><p:spPr>${transform}</p:spPr><p:style><a:fillRef idx="1"><a:schemeClr val="accent1"><a:alpha val="50000"/></a:schemeClr></a:fillRef></p:style></p:sp>
        </p:spTree></p:cSld>`,
      ),
    );
    zip.file(
      "deck/pages/_rels/slide2.xml.rels",
      relationships([
        ["layout", "slideLayout", "../layouts/layout.xml"],
        ["override", "themeOverride", "../override.xml"],
      ]),
    );
    zip.file(
      "deck/master.xml",
      xml(
        "sldMaster",
        slideTree("") + '<p:clrMap bg1="dk1" tx1="lt1" accent1="accent2"/>',
      ),
    );
    zip.file(
      "deck/override.xml",
      `<a:themeOverride xmlns:a="${a}"><a:clrScheme><a:accent2><a:srgbClr val="000080"/></a:accent2></a:clrScheme><a:fmtScheme>
        <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"><a:alphaMod val="50000"/></a:schemeClr></a:solidFill></a:fillStyleLst>
      </a:fmtScheme></a:themeOverride>`,
    );
    const { deck, warnings } = await importPptx(
      new Blob([await zip.generateAsync({ type: "arraybuffer" })]),
      "Dark theme.pptx",
    );
    expect(deck.slides[0].background).toBe("#000000");
    expect(deck.slides[0].objects).toMatchObject([
      {
        type: "text",
        color: "#ffffff",
        textStyles: [{ start: 10, end: 17, color: "rgba(0,0,192,0.2)" }],
      },
      { type: "shape", fill: "#bcbcbc", stroke: "#00ff00" },
      { type: "shape", fill: "rgba(0,0,128,0.25)" },
    ]);
    expect(warnings.some((warning) => warning.slide === 1)).toBe(false);
  });

  it("imports editable Office equations and keeps picture-filled fallback shapes", async () => {
    const zip = packageFixture();
    const math = "http://schemas.openxmlformats.org/officeDocument/2006/math";
    const shape = (id: number, name: string, content: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvSpPr>
        <p:spPr>${transform}</p:spPr><p:txBody><a:bodyPr/><a:p>${content}</a:p></p:txBody></p:sp>`;
    const equation = (content: string) =>
      `<a14:m><m:oMath>${content}</m:oMath></a14:m>`;
    const fraction = `<m:f><m:num><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:num><m:den>
      <m:rad><m:deg/><m:e><m:r><m:t>𝜋</m:t></m:r></m:e></m:rad></m:den></m:f>`;
    const alternate = (editable: string, fallback = "") =>
      `<mc:AlternateContent><mc:Choice Requires="a14">${editable}</mc:Choice>${fallback ? `<mc:Fallback>${fallback}</mc:Fallback>` : ""}</mc:AlternateContent>`;
    const picture = (id: number, name: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvSpPr>
        <p:spPr>${transform}<a:blipFill><a:blip r:embed="img"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr></p:sp>`;
    zip.file(
      "deck/pages/slide2.xml",
      xml(
        "sld",
        slideTree(
          [
            alternate(
              shape(2, "Fraction", equation(fraction)),
              picture(3, "Unused"),
            ),
            shape(
              4,
              "Inline",
              "<a:r><a:t>Energy </a:t></a:r>" +
                equation(
                  '<m:r><a:rPr><a:solidFill><a:srgbClr val="D02030"/></a:solidFill></a:rPr><m:t>E=mc</m:t></m:r>',
                ) +
                "<a:r><a:t> here</a:t></a:r>",
            ),
            alternate(
              shape(
                5,
                "Unsupported equation",
                equation(
                  "<m:phant><m:e><m:r><m:t>x</m:t></m:r></m:e></m:phant>",
                ),
              ),
              picture(6, "Fallback"),
            ),
            picture(7, "Picture-filled shape"),
          ].join(""),
        ),
      ).replace(
        "<p:sld ",
        `<p:sld xmlns:m="${math}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" `,
      ),
    );
    const { deck, warnings } = await importPptx(
      new Blob([await zip.generateAsync({ type: "arraybuffer" })]),
      "Equation export.pptx",
    );
    const [standalone, inline, fallback, pictureFill] = deck.slides[0].objects;
    expect(standalone).toMatchObject({ type: "text", name: "Fraction" });
    expect(inline).toMatchObject({
      type: "text",
      name: "Inline",
      text: "Energy \\(E=mc\\) here",
      textStyles: [{ start: 7, end: 15, color: "#d02030" }],
    });
    expect(fallback).toMatchObject({
      type: "figure",
      name: "Fallback",
      assetId: deck.assets[0].id,
    });
    expect(pictureFill).toMatchObject({
      type: "figure",
      name: "Picture-filled shape",
      assetId: deck.assets[0].id,
    });
    expect(deck.assets).toHaveLength(1);
    expect(warnings[0]).toEqual({
      slide: 1,
      messages: ["A PowerPoint equation used its fallback representation."],
    });
    if (standalone.type !== "text")
      throw new Error("Missing editable equation");
    const [expression] = getInlineMathSpans(standalone.text);
    expect(expression.latex).toBe("\\frac{{x}^{2}}{\\sqrt{π}}");
    const rendered = await renderEquation(
      expression.latex,
      "mathjax-stix2",
      24,
      "#111111",
      false,
    );
    expect(rendered.svg).toContain("<svg");
    expect(await readDeckArchive(await buildDeckArchive(deck))).toEqual(deck);
  });

  it("uses presentation order, follows relationships, and preserves editable objects and notes", async () => {
    const file = await fixture();
    const { deck, warnings } = await importPptx(file, file.name);
    expect(deck.title).toBe("Research");
    expect(deck.slideSize).toEqual({ width: 960, height: 720, unit: "px96" });
    expect(deck.slides.map((slide) => slide.title)).toEqual([
      "첫 슬라이드 & $5 / $9",
      "Slide 2",
    ]);
    const [slide] = deck.slides;
    expect(slide.notes).toBe("발표자 노트\nSpeaker note\nSecond paragraph");
    expect(slide.objects.map((object) => object.type)).toEqual([
      "text",
      "shape",
      "figure",
    ]);
    const [text, shape, figure] = slide.objects;
    expect(text).toMatchObject({
      fontFamily: "Inter",
      fontSize: 32,
      fontWeight: 700,
      align: "center",
      transform: { x: 100, y: 200, width: 300, height: 100, rotation: 30 },
    });
    expect(text.type === "text" && inlinePlainText(text.text)).toBe(
      "첫 슬라이드 & $5 / $9",
    );
    expect(shape).toMatchObject({
      shape: "rect",
      cornerRadius: 0,
      fill: "#aabbcc",
      stroke: "#334455",
      strokeWidth: 2,
    });
    expect(figure).toMatchObject({
      alt: "Signal plot",
      assetId: deck.assets[0].id,
      crop: { x: 0.25, y: 0, width: 0.75, height: 1 },
    });
    expect(deck.assets[0]).toMatchObject({
      mime: "image/svg+xml",
      width: 40,
      height: 20,
    });
    expect(warnings).toEqual([
      {
        slide: 1,
        messages: [
          "Slide animations or timed media were omitted.",
          "A chart was omitted.",
        ],
      },
      {
        slide: 2,
        messages: [
          expect.stringContaining("Linked figure — An image was omitted"),
          "An unsupported shape (star5) was omitted.",
        ],
      },
    ]);
    expect(await readDeckArchive(await buildDeckArchive(deck))).toEqual(deck);
  });

  it("keeps a numbered placeholder for an unreadable slide and rejects invalid package XML", async () => {
    const damaged = await fixture({ invalidSlide: true });
    const result = await importPptx(damaged, damaged.name);
    expect(result.deck.slides[0].objects).toHaveLength(0);
    expect(result.warnings[0]).toEqual({
      slide: 1,
      messages: ["The slide XML could not be read."],
    });
    const invalid = await fixture({ invalidRoot: true });
    await expect(importPptx(invalid, invalid.name)).rejects.toThrow(
      "document type",
    );
    await expect(importPptx(new Blob(["invalid"]), "bad.pptx")).rejects.toThrow(
      ".pptx archive",
    );
  });

  it("reads standard native geometry, text and notes from a generated PowerPoint file", async () => {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    const slide = pptx.addSlide();
    slide.addText("Editable title", {
      x: 1,
      y: 1,
      w: 4,
      h: 1,
      margin: 0,
      fontSize: 27,
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 2,
      y: 3,
      w: 4,
      h: 2,
      fill: { color: "ff0000" },
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 2,
      y: 6,
      w: 4,
      h: 0,
      line: { color: "0000ff", endArrowType: "triangle" },
    });
    slide.addNotes("Editable notes");
    const bytes = (await pptx.write({
      outputType: "arraybuffer",
    })) as ArrayBuffer;
    const loaded = await importPptx(new Blob([bytes]), "Generated.pptx");
    expect(loaded.deck.slides[0].notes).toBe("Editable notes");
    expect(loaded.deck.slides[0].objects).toMatchObject([
      { type: "text", text: "Editable title", fontSize: 36 },
      { type: "shape", shape: "ellipse", fill: "#ff0000" },
      { type: "shape", shape: "arrow", stroke: "#0000ff", endArrow: true },
    ]);
  });
});
