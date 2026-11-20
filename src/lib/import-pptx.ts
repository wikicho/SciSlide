import {
  createBlankSlide,
  newId,
  validateDeck,
  type Asset,
  type BaseSlideObject,
  type Deck,
  type FigureCrop,
  type ShapeObject,
  type Slide,
  type TextObject,
  type Transform,
} from "./model";
import { importFigure, MAX_FIGURE_BYTES } from "./persistence";
import {
  PptxPackage,
  attr,
  child,
  children,
  relationshipId,
} from "./pptx-package";
import {
  emu,
  flag,
  numeric,
  readTheme,
  slideStyle,
  type Warn,
} from "./pptx-style";

export type PptxImportWarning = { slide: number; messages: string[] };
type Style = ReturnType<typeof slideStyle>;
type Frame = Transform & { flipH: boolean; flipV: boolean };
type Group = {
  parent?: Group;
  frame: Frame;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
};

const tree = (root?: Element) => child(child(root, "cSld"), "spTree");
const drawingMetadata = (node: Element) => child(children(node)[0], "cNvPr");
const placeholder = (node: Element) =>
  child(child(children(node)[0], "nvPr"), "ph");
const placeholderType = (node: Element | undefined) =>
  attr(node, "type") ?? "obj";
const primaryTitle = (type: string) => type === "title" || type === "ctrTitle";

function matchPlaceholder(
  root: Element | undefined,
  source: Element | undefined,
  useIndex: boolean,
) {
  if (!source) return undefined;
  const index = attr(source, "idx");
  const type = placeholderType(source);
  const candidates = children(tree(root)).filter((node) => placeholder(node));
  return (
    (useIndex &&
      index !== undefined &&
      candidates.find(
        (node) => (attr(placeholder(node), "idx") ?? "0") === index,
      )) ||
    candidates.find((node) => placeholderType(placeholder(node)) === type) ||
    (!useIndex &&
      candidates.find((node) => {
        const candidate = placeholderType(placeholder(node));
        return primaryTitle(type)
          ? primaryTitle(candidate)
          : type === "obj" && candidate === "body";
      })) ||
    (useIndex &&
      index === undefined &&
      candidates.find(
        (node) => (attr(placeholder(node), "idx") ?? "0") === "0",
      )) ||
    undefined
  );
}

function frameOf(node: Element | undefined): Frame | undefined {
  const offset = child(node, "off");
  const extent = child(node, "ext");
  const x = emu(attr(offset, "x"));
  const y = emu(attr(offset, "y"));
  const width = emu(attr(extent, "cx"));
  const height = emu(attr(extent, "cy"));
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    width < 0 ||
    height < 0
  )
    return undefined;
  return {
    x,
    y,
    width: Math.max(0.01, width),
    height: Math.max(0.01, height),
    rotation: ((numeric(attr(node, "rot")) ?? 0) / 60_000) % 360,
    flipH: flag(attr(node, "flipH")),
    flipV: flag(attr(node, "flipV")),
  };
}

function localFrame(
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

function validFrame(frame: Transform) {
  return [frame.x, frame.y, frame.width, frame.height].every(
    (value) => Math.abs(value) <= 1_000_000,
  );
}

function place(frame: Frame, group: Group | undefined, warn: Warn): Frame {
  if (!group) return frame;
  if (group.scaleX !== group.scaleY && frame.rotation % 180 !== 0)
    warn("Rotation inside a stretched group was approximated.");
  const outer = localFrame(
    group.frame,
    (frame.x - group.x) * group.scaleX,
    (frame.y - group.y) * group.scaleY,
    Math.max(0.01, frame.width * group.scaleX),
    Math.max(0.01, frame.height * group.scaleY),
  );
  return place(
    {
      ...outer,
      rotation: (outer.rotation + frame.rotation) % 360,
      flipH: frame.flipH,
      flipV: frame.flipV,
    },
    group.parent,
    warn,
  );
}

function base(
  name: string,
  frame: Frame,
  metadata?: Element,
): Omit<BaseSlideObject, "type"> {
  const { x, y, width, height, rotation } = frame;
  return {
    id: newId(),
    name: name.slice(0, 2000),
    transform: { x, y, width, height, rotation },
    opacity: 1,
    visible: !flag(attr(metadata, "hidden")),
    locked: false,
    metadata: {},
  };
}

function textNodes(paragraph: Element) {
  return children(paragraph).flatMap<{ text: string; properties?: Element }>(
    (node) => {
      if (node.localName === "br")
        return [{ text: "\n", properties: undefined }];
      if (node.localName !== "r" && node.localName !== "fld") return [];
      return [
        {
          text: child(node, "t")?.textContent ?? "",
          properties: child(node, "rPr"),
        },
      ];
    },
  );
}

function textValue(body: Element | undefined) {
  return children(body, "p")
    .map((p) =>
      textNodes(p)
        .map((run) => run.text)
        .join(""),
    )
    .join("\n");
}

function addText(
  slide: Slide,
  body: Element,
  inherited: Element[],
  defaultTextStyle: Element | undefined,
  fontRef: Element | undefined,
  source: Omit<BaseSlideObject, "type">,
  style: Style,
  title: boolean,
  warn: Warn,
) {
  const bodies = [body, ...inherited];
  const bodyProps = bodies.map((node) => child(node, "bodyPr"));
  const bodyAttr = (name: string) =>
    bodyProps
      .map((node) => attr(node, name))
      .find((value) => value !== undefined);
  const paragraphs = children(body, "p");
  let first:
    | Pick<
        TextObject,
        "fontFamily" | "fontSize" | "fontWeight" | "color" | "align"
      >
    | undefined;
  const textStyles: NonNullable<TextObject["textStyles"]> = [];
  let text = "";
  for (const [index, paragraph] of paragraphs.entries()) {
    if (index) text += "\n";
    const direct = child(paragraph, "pPr");
    const level = Math.min(8, Math.max(0, numeric(attr(direct, "lvl")) ?? 0));
    const levelStyle = `lvl${level + 1}pPr`;
    const defaults = [
      direct,
      ...bodies.map((node) => child(child(node, "lstStyle"), levelStyle)),
      child(defaultTextStyle, levelStyle),
      child(defaultTextStyle, "defPPr"),
    ];
    const paragraphAlign = defaults
      .map((node) => attr(node, "algn"))
      .find(Boolean);
    if (paragraphAlign && !["l", "ctr", "r"].includes(paragraphAlign))
      warn("Justified or distributed text alignment was simplified.");
    const align =
      paragraphAlign === "ctr"
        ? "center"
        : paragraphAlign === "r"
          ? "right"
          : "left";
    const bullet = defaults
      .flatMap((node) => children(node))
      .find((node) =>
        ["buNone", "buChar", "buAutoNum", "buBlip"].includes(node.localName),
      );
    if (bullet && bullet.localName !== "buNone") {
      text += `${"  ".repeat(level)}${attr(bullet, "char") || "•"} `;
      warn("List formatting was converted to plain text.");
    }
    if (children(paragraph, "fld").length)
      warn("Text fields were imported as their saved text.");
    for (const run of textNodes(paragraph)) {
      if (!run.text) continue;
      const props = [
        run.properties,
        ...defaults.map((node) => child(node, "defRPr")),
      ];
      const property = (name: string) =>
        props
          .map((node) => attr(node, name))
          .find((value) => value !== undefined);
      const typeface = props
        .map((node) => attr(child(node, "latin"), "typeface"))
        .find(Boolean);
      const fontSize = Math.max(
        4,
        Math.min(500, (numeric(property("sz")) ?? (title ? 3200 : 1800)) / 75),
      );
      const fontFamily = style.font(
        typeface,
        attr(fontRef, "idx") === "major" || title,
      );
      const fontWeight = flag(property("b")) ? 700 : 400;
      const color = style.paint(
        props,
        warn,
        style.color(children(fontRef)[0], warn) ?? "#000000",
      );
      if (run.text !== "\n") {
        first ??= { fontFamily, fontSize, fontWeight, color, align };
        if (
          first.fontFamily !== fontFamily ||
          first.fontSize !== fontSize ||
          first.fontWeight !== fontWeight ||
          first.align !== align
        )
          warn(
            "Mixed fonts, sizes, weights, or alignments in a text box were simplified.",
          );
        if (
          flag(property("i")) ||
          (property("u") && property("u") !== "none") ||
          (property("strike") && property("strike") !== "noStrike") ||
          Number(property("baseline") ?? 0) !== 0
        )
          warn(
            "Italic, underlined, struck-through, or raised/lowered text was simplified.",
          );
        if (child(run.properties, "hlinkClick"))
          warn("Text hyperlinks were omitted.");
      }
      // Dollar signs in a PowerPoint text run are literal in the source.
      const literal = run.text.replace(/(?<!\\)\$/g, "\\$");
      const start = text.length;
      text += literal;
      if (first && color !== first.color && literal !== "\n") {
        const prior = textStyles.at(-1);
        if (prior?.color === color && prior.end === start)
          prior.end = text.length;
        else textStyles.push({ start, end: text.length, color });
      }
    }
  }
  if (!first || !text.trim()) return;
  if (text.length > 100_000) {
    warn("A text box exceeded the editable text limit and was omitted.");
    return;
  }
  if (textStyles.length > 4096) {
    warn("Some text color ranges were omitted.");
    textStyles.length = 4096;
  }
  const width = source.transform.width;
  const height = source.transform.height;
  const left = emu(bodyAttr("lIns")) ?? 9.6;
  const top = emu(bodyAttr("tIns")) ?? 4.8;
  const right = emu(bodyAttr("rIns")) ?? 9.6;
  const bottom = emu(bodyAttr("bIns")) ?? 4.8;
  const innerWidth = Math.max(0.01, width - left - right);
  const innerHeight = Math.max(0.01, height - top - bottom);
  const anchor = bodyAttr("anchor");
  const isCentered = anchor === "ctr" || anchor === "b";
  const estimate = Math.min(
    innerHeight,
    Math.max(1, text.split("\n").length) * first.fontSize * 1.3,
  );
  const y =
    top +
    (anchor === "ctr"
      ? (innerHeight - estimate) / 2
      : anchor === "b"
        ? innerHeight - estimate
        : 0);
  if (
    (bodyAttr("vert") && bodyAttr("vert") !== "horz") ||
    (numeric(bodyAttr("numCol")) ?? 1) > 1 ||
    flag(bodyAttr("rtlCol")) ||
    (anchor && !["t", "ctr", "b"].includes(anchor))
  )
    warn(
      "Vertical, multi-column, right-to-left, or distributed text layout was simplified.",
    );
  const transform = localFrame(
    source.transform,
    left,
    y,
    innerWidth,
    isCentered ? estimate : innerHeight,
  );
  if (!validFrame(transform)) {
    warn("A text box with invalid coordinates was omitted.");
    return;
  }
  slide.objects.push({
    ...source,
    type: "text",
    transform,
    text,
    ...first,
    ...(textStyles.length ? { textStyles } : {}),
  });
}

function addShape(
  slide: Slide,
  node: Element,
  sources: (Element | undefined)[],
  styleReference: Element | undefined,
  source: Omit<BaseSlideObject, "type">,
  frame: Frame,
  style: Style,
  warn: Warn,
) {
  if (sources.some((properties) => child(properties, "custGeom"))) {
    warn("A custom shape or path was omitted.");
    return;
  }
  const geometry = sources
    .map((properties) => child(properties, "prstGeom"))
    .find(Boolean);
  const preset =
    attr(geometry, "prst") ?? (node.localName === "cxnSp" ? "line" : "rect");
  const line = ["line", "lineInv", "straightConnector1"].includes(preset);
  const shape = line
    ? "line"
    : preset === "ellipse"
      ? "ellipse"
      : ["rect", "roundRect"].includes(preset)
        ? "rect"
        : undefined;
  const fills = child(styleReference, "fillRef");
  const lineRef = child(styleReference, "lnRef");
  const lineIndex = numeric(attr(lineRef, "idx")) ?? 0;
  const themeLine = children(child(style.theme.styles, "lnStyleLst"))[
    lineIndex - 1
  ];
  const lineProperties = sources.map((properties) => child(properties, "ln"));
  const lines = [...lineProperties, themeLine];
  const lineColor =
    lineIndex > 0 ? style.color(children(lineRef)[0], warn) : undefined;
  const stroke = style.paint(
    lines,
    warn,
    lineColor ?? (line ? "#000000" : "none"),
    lineColor,
  );
  const fill = line
    ? "none"
    : style.paint(sources, warn, style.themeFill(fills, warn, "none"));
  if (stroke === "none" && fill === "none" && shape && preset === "rect")
    return;
  if (!shape) {
    warn(`An unsupported shape (${preset.slice(0, 60)}) was omitted.`);
    return;
  }
  const effectIndex =
    numeric(attr(child(styleReference, "effectRef"), "idx")) ?? 0;
  const themeEffect = children(child(style.theme.styles, "effectStyleLst"))[
    effectIndex - 1
  ];
  if (
    [...sources, themeEffect].some(
      (properties) =>
        child(properties, "effectLst")?.childElementCount ||
        child(properties, "effectDag") ||
        child(properties, "scene3d") ||
        child(properties, "sp3d"),
    )
  )
    warn("Shape effects such as shadows were omitted.");
  const lineAttribute = (key: string) =>
    lines
      .map((element) => attr(element, key))
      .find((value) => value !== undefined);
  const lineChild = (name: string) =>
    lines.map((element) => child(element, name)).find(Boolean);
  const dash = attr(lineChild("prstDash"), "val") ?? "solid";
  if (
    !["solid", "dot", "sysDot", "dash", "sysDash"].includes(dash) ||
    lineChild("custDash")
  )
    warn("A custom stroke pattern was simplified.");
  const start = attr(lineChild("headEnd"), "type"),
    end = attr(lineChild("tailEnd"), "type");
  if (
    [start, end].some((value) => value && !["none", "triangle"].includes(value))
  )
    warn("An arrowhead style was simplified.");
  const startArrow = !!start && start !== "none";
  const endArrow = !!end && end !== "none";
  const inverse = preset === "lineInv";
  const startPoint = {
    x: frame.flipH ? 1 : 0,
    y: frame.flipV !== inverse ? 1 : 0,
  };
  const adjustment = children(child(geometry, "avLst"), "gd").find(
    (guide) => attr(guide, "name") === "adj",
  );
  const radius =
    (numeric(attr(adjustment, "fmla")?.match(/^val (-?\d+)$/)?.[1]) ?? 16667) /
    100_000;
  const object: ShapeObject = {
    ...source,
    type: "shape",
    shape: line && (startArrow || endArrow) ? "arrow" : shape,
    fill,
    stroke,
    strokeWidth:
      stroke === "none"
        ? 0
        : Math.min(1000, Math.max(0, emu(lineAttribute("w")) ?? 1)),
    strokeStyle: /dot/i.test(dash)
      ? "dotted"
      : dash === "solid"
        ? "solid"
        : "dashed",
    ...(line
      ? {
          line: {
            start: startPoint,
            end: { x: 1 - startPoint.x, y: 1 - startPoint.y },
          },
          startArrow,
          endArrow,
        }
      : {}),
    ...(shape === "rect"
      ? {
          cornerRadius:
            preset === "rect"
              ? 0
              : Math.min(frame.width, frame.height) *
                Math.min(0.5, Math.max(0, radius)),
        }
      : {}),
  };
  slide.objects.push(object);
}

function imageCrop(
  fill: Element | undefined,
  warn: Warn,
): FigureCrop | undefined {
  const rect = child(fill, "srcRect");
  if (!rect) return undefined;
  const [l, t, r, b] = ["l", "t", "r", "b"].map(
    (key) => (numeric(attr(rect, key)) ?? 0) / 100_000,
  );
  if (Math.min(l, t, r, b) < 0 || l + r >= 1 || t + b >= 1) {
    warn("An image crop with extended or empty bounds was omitted.");
    return undefined;
  }
  return l || t || r || b
    ? { x: l, y: t, width: 1 - (l + r), height: 1 - (t + b) }
    : undefined;
}

const unsupported = (node: Element) => {
  if (node.localName === "graphicFrame") {
    const uri = attr(child(child(node, "graphic"), "graphicData"), "uri") ?? "";
    if (uri.endsWith("/table")) return "A table was omitted.";
    if (uri.endsWith("/chart")) return "A chart was omitted.";
    if (uri.endsWith("/diagram")) return "A SmartArt diagram was omitted.";
    return "An embedded graphic or object was omitted.";
  }
  return "An unsupported slide object was omitted.";
};

export async function importPptx(
  file: Blob,
  filename: string,
): Promise<{ deck: Deck; warnings: PptxImportWarning[] }> {
  const pptx = await PptxPackage.open(file);
  const presentationPart = await pptx.related("", "officeDocument");
  if (!presentationPart)
    throw new Error("The PowerPoint presentation part is missing.");
  const root = await pptx.xml(presentationPart);
  if (root.localName !== "presentation")
    throw new Error("The archive is not a PowerPoint presentation.");
  const size = child(root, "sldSz");
  const width = emu(attr(size, "cx"));
  const height = emu(attr(size, "cy"));
  if (
    width === undefined ||
    height === undefined ||
    width < 100 ||
    height < 100 ||
    width > 20_000 ||
    height > 20_000
  )
    throw new Error(
      "The PowerPoint slide size is outside SciSlide's supported range.",
    );
  const order = children(child(root, "sldIdLst"), "sldId");
  if (!order.length || order.length > 1000)
    throw new Error(
      "The PowerPoint presentation must contain between 1 and 1,000 slides.",
    );
  const deck: Deck = {
    id: newId(),
    formatVersion: "0.5.0",
    title:
      filename.replace(/\.pptx$/i, "").slice(0, 2000) ||
      "Imported presentation",
    slideSize: { width, height, unit: "px96" },
    theme: {
      fontFamily: "Arial",
      equation: { fontSetId: "mathjax-stix2", fontSize: 48, color: "#000000" },
    },
    slides: [],
    assets: [],
  };
  const warnings: PptxImportWarning[] = [];
  const images = new Map<string, Promise<Asset>>();
  let totalObjects = 0;

  for (const [index, entry] of order.entries()) {
    const slide = createBlankSlide();
    slide.title = `Slide ${index + 1}`;
    const messages = new Set<string>();
    let unlistedMessages = false;
    const warn: Warn = (message) => {
      if (messages.has(message)) return;
      if (messages.size >= 32) unlistedMessages = true;
      else messages.add(message);
    };
    const part = await pptx.reference(
      presentationPart,
      relationshipId(entry),
      "slide",
    );
    if (part) {
      const slideXml = await pptx.xml(part).catch(() => undefined);
      if (slideXml?.localName === "sld")
        await readSlide(part, slideXml, slide, warn);
      else warn("The slide XML could not be read.");
    } else {
      warn("The slide's content part was missing.");
    }
    if (
      slide.objects.length > 1000 ||
      totalObjects + slide.objects.length > 10_000
    )
      throw new Error(`Slide ${index + 1} exceeds SciSlide's object limit.`);
    totalObjects += slide.objects.length;
    deck.slides.push(slide);
    if (unlistedMessages)
      messages.add("Additional unsupported elements were omitted.");
    if (messages.size)
      warnings.push({ slide: index + 1, messages: [...messages] });
  }
  return { deck: validateDeck(deck), warnings };

  async function readSlide(
    part: string,
    xml: Element,
    slide: Slide,
    warn: Warn,
  ) {
    async function readRelated(
      source: string | undefined,
      kind: string,
      label: string,
    ) {
      try {
        const related = source && (await pptx.related(source, kind));
        const element = related ? await pptx.xml(related) : undefined;
        return { part: related || undefined, element };
      } catch {
        warn(`The ${label} could not be read.`);
        return {};
      }
    }
    const layout = await readRelated(part, "slideLayout", "slide layout");
    const master = await readRelated(
      layout.part,
      "slideMaster",
      "slide master",
    );
    const theme = await readRelated(master.part, "theme", "theme");
    const style = slideStyle(
      readTheme(theme.element),
      master.element,
      layout.element,
      xml,
    );
    const background = [xml, layout.element, master.element]
      .map((item) => child(child(item, "cSld"), "bg"))
      .find(Boolean);
    slide.background = style.paint(
      [child(background, "bgPr")],
      warn,
      style.themeFill(child(background, "bgRef"), warn, "#ffffff"),
    );
    if (slide.background === "none") slide.background = "#ffffff";
    if (attr(xml, "show") === "0" || attr(xml, "show") === "false")
      warn("A hidden slide was imported as a visible slide.");
    if (child(xml, "transition")) warn("The slide transition was omitted.");
    if (child(xml, "timing"))
      warn("Slide animations or timed media were omitted.");
    if (
      attr(xml, "showMasterSp") !== "0" &&
      attr(xml, "showMasterSp") !== "false" &&
      [layout.element, master.element].some((item) =>
        children(tree(item)).some(
          (node) =>
            !["nvGrpSpPr", "grpSpPr", "extLst"].includes(node.localName) &&
            !placeholder(node),
        ),
      )
    )
      warn(
        "Decorations inherited from the slide layout or master were omitted.",
      );

    const notes = await readRelated(part, "notesSlide", "speaker notes");
    const notesBody = children(tree(notes.element), "sp")
      .filter((node) => placeholderType(placeholder(node)) === "body")
      .map((node) => textValue(child(node, "txBody")))
      .join("\n");
    if (notesBody.length > 100_000)
      warn("Speaker notes were shortened to SciSlide's text limit.");
    slide.notes = notesBody.slice(0, 100_000);

    const slideTree = tree(xml);
    if (!slideTree) warn("The slide object tree is missing.");
    await addObjects(slideTree);
    const namedTitle = attr(child(xml, "cSld"), "name");
    if (namedTitle) slide.title = namedTitle.slice(0, 2000);

    async function addObjects(container?: Element, group?: Group, depth = 0) {
      for (const node of children(container)) {
        if (
          slide.objects.length > 1000 ||
          totalObjects + slide.objects.length > 10_000
        )
          break;
        const kind = node.localName;
        if (["nvGrpSpPr", "grpSpPr", "extLst"].includes(kind)) continue;
        if (kind === "grpSp") {
          const xfrm = child(child(node, "grpSpPr"), "xfrm");
          const frame = frameOf(xfrm);
          const offset = child(xfrm, "chOff"),
            extent = child(xfrm, "chExt");
          const width = emu(attr(extent, "cx")),
            height = emu(attr(extent, "cy"));
          if (
            depth >= 16 ||
            !frame ||
            !width ||
            !height ||
            width < 0 ||
            height < 0 ||
            frame.flipH ||
            frame.flipV
          ) {
            warn("A flipped or unsupported group was omitted.");
          } else {
            await addObjects(
              node,
              {
                parent: group,
                frame,
                x: emu(attr(offset, "x")) ?? 0,
                y: emu(attr(offset, "y")) ?? 0,
                scaleX: frame.width / width,
                scaleY: frame.height / height,
              },
              depth + 1,
            );
            warn("Grouped objects were imported as individual objects.");
          }
          continue;
        }
        if (kind === "AlternateContent") {
          const math =
            node.getElementsByTagNameNS("*", "oMath").length ||
            node.getElementsByTagNameNS("*", "oMathPara").length;
          const fallback = child(node, "Fallback");
          if (fallback?.childElementCount && depth < 16) {
            await addObjects(fallback, group, depth + 1);
            warn(
              math
                ? "A PowerPoint equation used its fallback representation."
                : "An alternate PowerPoint element used its fallback representation.",
            );
          } else
            warn(
              math ? "A PowerPoint equation was omitted." : unsupported(node),
            );
          continue;
        }
        const metadata = drawingMetadata(node);
        const name = attr(metadata, "name")?.trim();
        const warnObject: Warn = name
          ? (message) => warn(`${name.slice(0, 120)} — ${message}`)
          : warn;
        if (!["sp", "cxnSp", "pic"].includes(kind)) {
          warnObject(unsupported(node));
          continue;
        }
        const ph = placeholder(node);
        const layoutObject = matchPlaceholder(layout.element, ph, true);
        const masterObject = matchPlaceholder(
          master.element,
          layoutObject ? placeholder(layoutObject) : ph,
          false,
        );
        const objects = [node, layoutObject, masterObject];
        const shapeProps = objects.map((item) => child(item, "spPr"));
        const body = child(node, "txBody");
        const rawText = textValue(body);
        // Unfilled placeholders are editor prompts, not slide content.
        if (
          ph &&
          kind === "sp" &&
          !rawText.trim() &&
          !child(shapeProps[0], "xfrm") &&
          !body?.getElementsByTagNameNS("*", "oMath").length
        )
          continue;
        const shapeFrame = shapeProps
          .map((item) => frameOf(child(item, "xfrm")))
          .find(Boolean);
        if (!shapeFrame) {
          warnObject("An object without usable size or position was omitted.");
          continue;
        }
        const frame = place(shapeFrame, group, warn);
        if (!validFrame(frame)) {
          warnObject("An object with invalid coordinates was omitted.");
          continue;
        }
        const baseObject = base(
          name || (kind === "pic" ? "Image" : "Shape"),
          frame,
          metadata,
        );
        if (kind === "pic") {
          await addImage(node, baseObject, frame, warnObject);
          continue;
        }
        const reference = objects
          .map((item) => child(item, "style"))
          .find(Boolean);
        addShape(
          slide,
          node,
          shapeProps,
          reference,
          baseObject,
          frame,
          style,
          warnObject,
        );
        if (body) {
          if (
            body.getElementsByTagNameNS("*", "oMath").length ||
            body.getElementsByTagNameNS("*", "oMathPara").length
          )
            warnObject("An editable PowerPoint equation was omitted.");
          if (rawText && (frame.flipH || frame.flipV))
            warnObject("Mirrored text was imported without mirroring.");
          const title = primaryTitle(
            placeholderType(ph ?? placeholder(layoutObject ?? node)),
          );
          const inherited = [
            child(layoutObject, "txBody"),
            child(masterObject, "txBody"),
          ].filter((value) => value !== undefined);
          const masterStyles = child(master.element, "txStyles");
          const textDefaults =
            child(
              masterStyles,
              title ? "titleStyle" : ph ? "bodyStyle" : "otherStyle",
            ) ?? child(root, "defaultTextStyle");
          addText(
            slide,
            body,
            inherited,
            textDefaults,
            child(reference, "fontRef"),
            { ...baseObject, id: newId() },
            style,
            title,
            warnObject,
          );
          if (title && rawText.trim())
            slide.title = rawText.trim().split("\n")[0].slice(0, 2000);
        }
      }
    }

    async function addImage(
      node: Element,
      source: Omit<BaseSlideObject, "type">,
      frame: Frame,
      warn: Warn,
    ) {
      const fill = child(node, "blipFill");
      const blip = child(fill, "blip");
      const svg = blip?.getElementsByTagNameNS("*", "svgBlip")[0];
      const metadata = drawingMetadata(node);
      if (
        child(child(children(node)[0], "nvPr"), "videoFile") ||
        child(child(children(node)[0], "nvPr"), "audioFile")
      )
        warn(
          "Embedded audio or video was omitted; its poster image was used if available.",
        );
      for (const id of new Set([
        relationshipId(svg, "embed"),
        relationshipId(blip, "embed"),
      ])) {
        try {
          const target = await pptx.reference(part, id, "image");
          if (!target || !/\.(svg|png|jpe?g)$/i.test(target)) continue;
          let pending = images.get(target);
          if (!pending) {
            if (deck.assets.length >= 500)
              throw new Error("Asset limit reached.");
            pending = pptx
              .bytes(target, MAX_FIGURE_BYTES)
              .then((bytes) =>
                importFigure(
                  new File(
                    [bytes],
                    (target.split("/").at(-1) ?? "Image").slice(0, 2000),
                  ),
                ),
              );
            images.set(target, pending);
          }
          const asset = await pending;
          if (!deck.assets.includes(asset)) deck.assets.push(asset);
          if (svg && id !== relationshipId(svg, "embed"))
            warn("An SVG image was replaced by its raster fallback.");
          if (frame.flipH || frame.flipV)
            warn("A mirrored image was imported without mirroring.");
          const mask = attr(child(child(node, "spPr"), "prstGeom"), "prst");
          if (
            child(fill, "tile") ||
            (mask && mask !== "rect") ||
            child(child(node, "spPr"), "custGeom")
          )
            warn("Tiling or non-rectangular image masking was simplified.");
          if (
            children(blip).some(
              (effect) => !["extLst"].includes(effect.localName),
            )
          )
            warn("PowerPoint image effects were omitted.");
          const crop = imageCrop(fill, warn);
          slide.objects.push({
            ...source,
            type: "figure",
            assetId: asset.id,
            alt: (
              attr(metadata, "descr") ||
              attr(metadata, "title") ||
              source.name
            ).slice(0, 10_000),
            ...(crop ? { crop } : {}),
          });
          return;
        } catch {
          // A PowerPoint SVG can include a separately stored PNG fallback.
        }
      }
      warn(
        "An image was omitted because it was linked, unreadable, or in an unsupported format.",
      );
    }
  }
}
