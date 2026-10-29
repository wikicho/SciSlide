import type PptxGenJS from "pptxgenjs";
import type { Deck, ShapeObject, TextObject, Transform } from "./model";
import { resolvePageNumber } from "./model";
import { renderSlideSvg } from "./export";
import { renderObjectEquation } from "./equation-renderer";
import {
  hasInlineMath,
  inlinePlainText,
  layoutInlineText,
} from "./inline-math";
import { wrapText } from "./layout";
import { shapeGeometry } from "./shape-geometry";
import {
  exportTextFontFamily,
  exportTextFontWeight,
  firstFontFamily,
  normalizeRenderedText,
} from "./text-fonts";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SVG_NS = "http://www.w3.org/2000/svg";
const inches = (pixels: number) => pixels / 96;
// PptxGenJS treats numeric coordinates >=100 as EMU instead of inches.
// Switch explicitly at that threshold so oversized/off-canvas objects retain
// their geometry instead of producing fractional or unexpectedly tiny extents.
const coordinate = (pixels: number) =>
  inches(pixels) >= 100 ? Math.round(pixels * 9525) : inches(pixels);
const points = (pixels: number) => pixels * 0.75;
const transparency = (opacity: number) => (1 - opacity) * 100;
const rotation = (degrees: number) => ((degrees % 360) + 360) % 360;
const colors = new Map<string, { color: string; alpha: number }>();

/** Resolve the same CSS paints accepted by the native deck to DrawingML RGB. */
function paint(value: string, opacity = 1) {
  let resolved = colors.get(value);
  if (!resolved) {
    if (value === "none" || value === "transparent") {
      resolved = { color: "000000", alpha: 0 };
    } else if (/^#[\da-f]{6}$/i.test(value)) {
      resolved = { color: value.slice(1).toUpperCase(), alpha: 1 };
    } else {
      const probe = document.createElement("span");
      probe.style.color = value;
      if (!probe.style.color) throw new Error(`Unsupported color “${value}”.`);
      probe.style.visibility = "hidden";
      document.body.append(probe);
      let normalized: string;
      try {
        normalized = getComputedStyle(probe).color;
      } finally {
        probe.remove();
      }
      const rgb =
        /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
          normalized,
        );
      if (!rgb) throw new Error(`Unsupported color “${value}”.`);
      resolved = {
        color: rgb
          .slice(1, 4)
          .map((channel) =>
            Math.round(Number(channel)).toString(16).padStart(2, "0"),
          )
          .join("")
          .toUpperCase(),
        alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
      };
    }
    colors.set(value, resolved);
  }
  return {
    color: resolved.color,
    transparency: transparency(opacity * resolved.alpha),
  };
}

function position(t: Transform) {
  return {
    x: coordinate(t.x),
    y: coordinate(t.y),
    w: coordinate(t.width),
    h: coordinate(t.height),
    rotate: rotation(t.rotation),
  };
}

/** Rotate each inline fragment around its parent's center, just as SVG does. */
function fragmentTransform(
  parent: Transform,
  x: number,
  y: number,
  width: number,
  height: number,
): Transform {
  const angle = (parent.rotation * Math.PI) / 180;
  const dx = x + width / 2 - parent.width / 2;
  const dy = y + height / 2 - parent.height / 2;
  return {
    x:
      parent.x +
      parent.width / 2 +
      dx * Math.cos(angle) -
      dy * Math.sin(angle) -
      width / 2,
    y:
      parent.y +
      parent.height / 2 +
      dx * Math.sin(angle) +
      dy * Math.cos(angle) -
      height / 2,
    width,
    height,
    rotation: parent.rotation,
  };
}

function textOptions(
  object: TextObject,
  family: string,
  weight: number,
): PptxGenJS.TextPropsOptions {
  return {
    // DrawingML exact line spacing adds leading above the first baseline.
    // Compensate in local coordinates so text stays aligned with SVG, even
    // when its source frame is rotated. Inline fragments override this below.
    ...position(
      fragmentTransform(
        object.transform,
        0,
        -object.fontSize * 0.1,
        object.transform.width,
        object.transform.height,
      ),
    ),
    objectName: object.name,
    fontFace: firstFontFamily(family),
    fontSize: points(object.fontSize),
    bold: weight >= 600,
    ...paint(object.color, object.opacity),
    align: object.align,
    valign: "top",
    margin: 0,
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
    lineSpacing: points(object.fontSize * 1.3),
    // SciSlide supplies its measured line breaks. PowerPoint must not wrap a
    // second time, shrink text, or resize the frame and its rotation center.
    wrap: false,
    fit: "none",
    isTextBox: true,
  };
}

/** Unicode SVG data must be UTF-8, including Korean figure labels and alt text. */
function svgData(svg: SVGSVGElement): string {
  const bytes = new TextEncoder().encode(
    new XMLSerializer().serializeToString(svg),
  );
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function imageSvg(width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  // PptxGenJS uses these intrinsic dimensions for its PNG fallback canvas.
  // Bound that allocation even when an imported object is huge or subpixel.
  // The logical viewBox and PowerPoint frame retain the original dimensions.
  const scale = Math.min(1, 4096 / Math.max(width, height));
  svg.setAttribute("width", String(Math.max(1, Math.ceil(width * scale))));
  svg.setAttribute("height", String(Math.max(1, Math.ceil(height * scale))));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  return svg;
}

async function addText(
  target: PptxGenJS.Slide,
  object: TextObject,
  deck: Deck,
) {
  if (!hasInlineMath(object.text)) {
    const text = normalizeRenderedText(inlinePlainText(object.text));
    const family = exportTextFontFamily(text, object.fontFamily);
    const weight = exportTextFontWeight(
      text,
      object.fontFamily,
      object.fontWeight,
    );
    target.addText(
      wrapText(
        text,
        object.transform.width,
        object.fontSize,
        family,
        weight,
      ).join("\n"),
      textOptions(object, family, weight),
    );
    return;
  }

  const layout = await layoutInlineText(object, deck);
  const options = textOptions(object, layout.fontFamily, layout.fontWeight);
  for (const [lineIndex, line] of layout.lines.entries()) {
    for (const [runIndex, run] of line.runs.entries()) {
      const objectName = `${object.name} (${lineIndex + 1}.${runIndex + 1})`;
      if (run.type === "text") {
        target.addText(normalizeRenderedText(run.text), {
          ...options,
          ...position(
            fragmentTransform(
              object.transform,
              run.x,
              line.baseline - object.fontSize,
              Math.max(0.01, run.width),
              object.fontSize * 1.3,
            ),
          ),
          align: "left",
          // Each fragment has one line. Exact paragraph leading would push
          // its baseline down relative to the neighboring SVG equation.
          lineSpacing: undefined,
          objectName,
        });
      } else {
        const svg = imageSvg(run.width, run.height);
        const parsed = new DOMParser().parseFromString(
          run.svg,
          "image/svg+xml",
        );
        svg.append(document.importNode(parsed.documentElement, true));
        target.addImage({
          data: svgData(svg),
          ...position(
            fragmentTransform(
              object.transform,
              run.x,
              run.y,
              run.width,
              run.height,
            ),
          ),
          transparency: transparency(object.opacity),
          altText: run.latex,
          objectName,
        });
      }
    }
  }
}

function shapePaint(value: string, opacity: number): PptxGenJS.ShapeFillProps {
  return paint(value, opacity);
}

function addShape(
  pptx: PptxGenJS,
  target: PptxGenJS.Slide,
  object: ShapeObject,
) {
  for (const [index, primitive] of shapeGeometry(object).entries()) {
    const a = primitive.attributes;
    const options: PptxGenJS.ShapeProps = {
      ...position(object.transform),
      objectName: index ? `${object.name} (arrowhead ${index})` : object.name,
      fill: shapePaint(String(a.fill), object.opacity),
      line: {
        ...shapePaint(String(a.stroke), object.opacity),
        width: points(Number(a["stroke-width"]) || 0),
        dashType:
          a["stroke-dasharray"] && object.strokeStyle === "dashed"
            ? "dash"
            : a["stroke-dasharray"] && object.strokeStyle === "dotted"
              ? "sysDot"
              : "solid",
      },
    };
    if (object.strokeWidth <= 0) options.line!.transparency = 100;
    if (primitive.tag === "rect") {
      // shapeGeometry uses a 12px horizontal radius, clamped by SVG's bounds.
      options.rectRadius = inches(
        Math.min(12, object.transform.width / 2, object.transform.height / 2),
      );
      target.addShape(pptx.ShapeType.roundRect, options);
    } else if (primitive.tag === "ellipse") {
      target.addShape(pptx.ShapeType.ellipse, options);
    } else {
      // Native custom paths retain SciSlide's exact shortened arrow shaft and
      // solid tips, including reversed, axial and rotated line endpoints.
      const coordinates = String(primitive.tag === "path" ? a.d : a.points)
        .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
        .map(Number);
      options.points = [];
      for (let i = 0; i < coordinates.length; i += 2)
        options.points.push({
          x: coordinate(coordinates[i]),
          y: coordinate(coordinates[i + 1]),
        });
      if (primitive.tag === "polygon") options.points.push({ close: true });
      // PptxGenJS supports this OOXML geometry but omits it from its enum type.
      target.addShape("custGeom" as PptxGenJS.ShapeType, options);
    }
  }
}

/**
 * Editable PowerPoint text and shapes, with individual SVG graphics and PNG
 * compatibility previews. Static exports show the final build and passive
 * video frames. Native equations, playback and font embedding are not emitted.
 */
export async function exportDeckPptx(deck: Deck): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  if (!deck.slides.length)
    throw new Error("Add a slide before exporting PowerPoint.");
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "SCISLIDE",
    width: inches(deck.slideSize.width),
    height: inches(deck.slideSize.height),
  });
  pptx.layout = "SCISLIDE";
  pptx.title = deck.title;
  pptx.subject = "Scientific presentation";
  pptx.author = "SciSlide";
  pptx.company = "SciSlide";
  pptx.theme = {
    headFontFace: firstFontFamily(deck.theme.fontFamily),
    bodyFontFace: firstFontFamily(deck.theme.fontFamily),
  };

  // Work sequentially to limit peak media memory on decks with large figures.
  // No downloadable file is created until all equations/assets have passed the
  // same validation and crop/layout rendering as the SVG exporter.
  for (const [index, slide] of deck.slides.entries()) {
    try {
      const scene = await renderSlideSvg(deck, slide, index);
      const groups = [...scene.children].filter(
        (node) => node.localName === "g",
      );
      const target = pptx.addSlide();
      target.background = paint(slide.background);
      if (slide.notes) target.addNotes(slide.notes);
      const objects = slide.objects.filter(
        (object) => object.visible && object.opacity > 0,
      );
      for (const [objectIndex, object] of objects.entries()) {
        if (object.type === "text") {
          await addText(target, object, deck);
        } else if (object.type === "shape") {
          addShape(pptx, target, object);
        } else {
          const bounds =
            object.type === "equation"
              ? await renderObjectEquation(object, deck)
              : object.transform;
          const svg = imageSvg(bounds.width, bounds.height);
          svg.setAttribute("font-family", deck.theme.fontFamily);
          const group = groups[objectIndex].cloneNode(true) as SVGGElement;
          group.removeAttribute("transform");
          svg.append(group);
          target.addImage({
            data: svgData(svg),
            ...position({
              ...object.transform,
              width: bounds.width,
              height: bounds.height,
            }),
            objectName: object.name,
            altText:
              object.type === "equation"
                ? object.description || object.latex
                : object.alt || object.name,
          });
        }
      }
      const number = resolvePageNumber(deck, index);
      if (number) {
        target.addText(number.text, {
          x: coordinate(32),
          y: coordinate(number.y - number.fontSize),
          w: coordinate(deck.slideSize.width - 64),
          h: coordinate(number.fontSize * 1.3),
          fontFace: firstFontFamily(deck.theme.fontFamily),
          fontSize: points(number.fontSize),
          ...paint(number.color),
          align:
            number.anchor === "middle"
              ? "center"
              : number.anchor === "end"
                ? "right"
                : "left",
          valign: "top",
          margin: 0,
          wrap: false,
          fit: "none",
          objectName: "Page number",
        });
      }
    } catch (error) {
      throw new Error(
        `Slide “${slide.title}” cannot be exported to PowerPoint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const data = await pptx.write({
    outputType: "arraybuffer",
    compression: true,
  });
  return new Blob([data as ArrayBuffer], { type: PPTX_MIME });
}
