import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import {
  Atom,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  ImagePlus,
  Video,
  Layers,
  LockKeyhole,
  Maximize2,
  MoreHorizontal,
  Plus,
  Presentation,
  Redo2,
  Save,
  Settings2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
  AlignLeft,
  AlignCenter,
  AlignRight,
  GripVertical,
  MousePointer2,
  Sigma,
  CircleHelp,
  Sparkles,
  Minus,
  ArrowUpRight,
  Group,
  Ungroup,
  Magnet,
} from "lucide-react";
import {
  createDemoDeck,
  createBlankSlide,
  newId,
  DEFAULT_PAGE_NUMBERS,
  validateDeck,
} from "./lib/model";
import type {
  Deck,
  SlideObject,
  EquationObject,
  TextObject,
  ShapeObject,
  VideoObject,
} from "./lib/model";
import {
  buildDeckArchive,
  readDeckArchive,
  importFigure,
  importVideo,
  MAX_VIDEO_BYTES,
  downloadBlob,
  loadRecovery,
  saveRecovery,
} from "./lib/persistence";
import { renderEquation, FONT_OPTIONS } from "./lib/equations";
import { exportDeckPdf, exportSlideSvg } from "./lib/export";
import {
  maxBuildStep,
  nextBuildStep,
  previousBuildStep,
} from "./lib/presentation";
import { cloneDeck, pruneUnusedAssets } from "./lib/deck-editing";
import {
  shapeFromDrag,
  isLineShape,
  lineWorldEndpoints,
  moveLineEndpoint,
  expandSelection,
  editableSelection,
  isObjectLocked,
  groupObjects,
  ungroupObjects,
  cleanupGroups,
  cloneObjectsWithGroups,
  duplicateSelectedObjects,
  objectBounds,
  selectionBounds,
} from "./lib/drawing";
import { snapMove, snapResize, type SmartGuide } from "./lib/smart-guides";
import { SlideScene } from "./components/SlideScene";
import { MathSupportDialog } from "./components/MathSupportDialog";
import { SlideTemplateDialog } from "./components/SlideTemplateDialog";
import { AIDraftDialog, aiAnchorFingerprint } from "./components/AIDraftDialog";
import type { AIDraftApplication } from "./components/AIDraftDialog";
import { createTemplateSlide } from "./lib/slide-templates";
import type { SlideTemplateId } from "./lib/slide-templates";
import type { EquationFontId } from "./lib/equations";
import { desktop, DEFAULT_LOCAL_PREAMBLE } from "./lib/desktop";
import type { TexCapabilities } from "./lib/desktop";
import { localTexInputFingerprint } from "./lib/equation-renderer";
import { sanitizeLocalEquationSvg } from "./lib/local-equation-svg";
import {
  assertEquationDocumentLimits,
  MAX_EQUATION_SOURCE_CHARACTERS,
  MAX_LOCAL_PREAMBLE_CHARACTERS,
  moveLeadingPackagesToPreamble,
} from "./lib/local-tex-draft";

interface EquationDraft {
  latex: string;
  font: string;
  size: number;
  color: string;
  renderer: "mathjax" | "local-latex";
  engine: "latex" | "xelatex";
  preamble: string;
}
type LocalRender = NonNullable<
  NonNullable<EquationObject["localTex"]>["render"]
>;

const clone = <T,>(v: T): T => structuredClone(v);
const numeric = (n: number) => Math.round(n * 10) / 10;
function IconButton({
  title,
  onClick,
  children,
  disabled = false,
  active = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function App() {
  const [deck, setDeck] = useState<Deck>(
    () => loadRecovery() ?? createDemoDeck(),
  );
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const [slideId, setSlideId] = useState(deck.slides[0].id),
    [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, SlideObject>>({});
  const [drawingTool, setDrawingTool] = useState<ShapeObject["shape"] | null>(
    null,
  );
  const [draftShape, setDraftShape] = useState<ShapeObject | undefined>();
  const [smartGuides, setSmartGuides] = useState(true);
  const [guides, setGuides] = useState<SmartGuide[]>([]);
  const [metrics, setMetrics] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const undo = useRef<Deck[]>([]),
    redo = useRef<Deck[]>([]),
    lastCommit = useRef({ key: "", time: 0 });
  const [, setHistoryTick] = useState(0),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(""),
    [recoveryStatus, setRecoveryStatus] = useState("Local workspace");
  const [exportMenu, setExportMenu] = useState(false),
    [presenting, setPresenting] = useState(false),
    [presentationStep, setPresentationStep] = useState(0),
    [showHelp, setShowHelp] = useState(false),
    [showSlideTemplates, setShowSlideTemplates] = useState(false),
    [showAiDraft, setShowAiDraft] = useState(false),
    [showMathLibrary, setShowMathLibrary] = useState(false),
    [zoom, setZoom] = useState(100),
    [grid, setGrid] = useState(false),
    [fitWidth, setFitWidth] = useState(650);
  const [draft, setDraft] = useState<EquationDraft>({
      latex: "",
      font: "mathjax-stix2",
      size: 48,
      color: "#111827",
      renderer: "mathjax",
      engine: "latex",
      preamble: DEFAULT_LOCAL_PREAMBLE,
    }),
    [draftSvg, setDraftSvg] = useState(""),
    [draftError, setDraftError] = useState(""),
    [draftFallbackCount, setDraftFallbackCount] = useState(0),
    [draftBusy, setDraftBusy] = useState(false);
  const [draftTexRender, setDraftTexRender] = useState<
      LocalRender | undefined
    >(),
    [compileBusy, setCompileBusy] = useState(false),
    [texCapabilities, setTexCapabilities] = useState<TexCapabilities | null>(
      null,
    ),
    [texDetectionError, setTexDetectionError] = useState(""),
    [documentFilename, setDocumentFilename] = useState("");
  const compileJob = useRef<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    desktop
      .detectTex()
      .then((r) => {
        if (live) setTexCapabilities(r);
      })
      .catch((e) => {
        if (live) setTexDetectionError(String(e.message));
      });
    return () => {
      live = false;
    };
  }, []);
  const closeMathLibrary = useCallback(() => setShowMathLibrary(false), []);
  const closeAiDraft = useCallback(() => setShowAiDraft(false), []);
  const closeSlideTemplates = useCallback(
    () => setShowSlideTemplates(false),
    [],
  );
  const openInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    videoInput = useRef<HTMLInputElement>(null),
    canvasRef = useRef<HTMLDivElement>(null),
    sourceRef = useRef<HTMLTextAreaElement>(null);
  const slide = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];
  const slideIndex = deck.slides.indexOf(slide),
    object = slide.objects.find((o) => o.id === selected[0]);
  const pageNumbers = {
    ...DEFAULT_PAGE_NUMBERS,
    ...deck.pageNumbers,
    enabled: deck.pageNumbers?.enabled ?? false,
  };
  const gesture = useRef<{
    mode: "drag" | "resize" | "draw" | "endpoint";
    kind?: ShapeObject["shape"];
    endpoint?: "start" | "end";
    slideId: string;
    deckId: string;
    start: { x: number; y: number };
    objects: SlideObject[];
    current: Record<string, SlideObject>;
    svg: SVGSVGElement;
    pointerId: number;
  } | null>(null);
  const cancelGesture = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    setPreview({});
    setDraftShape(undefined);
    setGuides([]);
    if (g?.svg.hasPointerCapture(g.pointerId))
      g.svg.releasePointerCapture(g.pointerId);
  }, []);
  useEffect(() => {
    cancelGesture();
    setDrawingTool(null);
  }, [slide.id, deck.id, cancelGesture]);
  useEffect(() => {
    const host = canvasRef.current;
    if (!host) return;
    const resize = () => {
      const c = getComputedStyle(host),
        w =
          host.clientWidth -
          parseFloat(c.paddingLeft) -
          parseFloat(c.paddingRight),
        h =
          host.clientHeight -
          parseFloat(c.paddingTop) -
          parseFloat(c.paddingBottom);
      setFitWidth(Math.max(160, Math.min(w, (h * 1600) / 900)));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => observer.disconnect();
  }, [presenting]);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        saveRecovery(deck);
        setRecoveryStatus("Recovered locally");
      } catch {
        setRecoveryStatus("Recovery unavailable");
        notify("브라우저 저장 공간이 부족합니다. 파일로 저장해주세요.");
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [deck, notify]);
  const commit = useCallback((next: Deck, key = "") => {
    const now = Date.now();
    if (
      key !== lastCommit.current.key ||
      !key ||
      now - lastCommit.current.time > 650
    ) {
      undo.current.push(cloneDeck(deckRef.current));
      if (undo.current.length > 60) undo.current.shift();
    }
    lastCommit.current = { key, time: now };
    redo.current = [];
    deckRef.current = next;
    setDeck(next);
    setHistoryTick((t) => t + 1);
  }, []);
  const change = useCallback(
    (fn: (d: Deck) => void, key = "") => {
      const next = cloneDeck(deckRef.current);
      fn(next);
      commit(next, key);
    },
    [commit],
  );
  const applyAiDraft = (application: AIDraftApplication) => {
    const current = deckRef.current;
    const anchor = current.slides.find((s) => s.id === application.anchorId);
    if (
      current.id !== application.deckId ||
      !anchor ||
      aiAnchorFingerprint(current, anchor) !== application.fingerprint
    ) {
      notify("The source slide changed. Generate a fresh AI draft.");
      return false;
    }
    const next = cloneDeck(current);
    const index = next.slides.findIndex((s) => s.id === anchor.id);
    next.slides.splice(index + 1, 0, ...structuredClone(application.slides));
    try {
      validateDeck(next);
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "The generated slides could not be inserted.",
      );
      return false;
    }
    commit(next);
    setSlideId(application.slides[0].id);
    setSelected([]);
    notify(`${application.slides.length} editable AI slides inserted.`);
    return true;
  };
  const updateObject = (id: string, fn: (o: SlideObject) => void, key = "") =>
    change(
      (d) => {
        const o = d.slides
          .find((s) => s.id === slide.id)
          ?.objects.find((o) => o.id === id);
        if (o) fn(o);
      },
      key ? `${slide.id}:${id}:${key}` : "",
    );
  const updatePosition = (axis: "x" | "y", value: number) => {
    if (!object) return;
    const ids = editableSelection(slide.objects, [object.id]);
    if (!ids.length) return;
    const delta =
      Math.max(-1_000_000, Math.min(1_000_000, value)) - object.transform[axis];
    change(
      (d) =>
        d.slides
          .find((s) => s.id === slide.id)!
          .objects.filter((o) => ids.includes(o.id))
          .forEach((o) => {
            o.transform[axis] += delta;
          }),
      `${slide.id}:${object.id}:${axis}`,
    );
  };
  const history = (direction: "undo" | "redo") => {
    cancelGesture();
    setDrawingTool(null);
    const from = direction === "undo" ? undo.current : redo.current,
      to = direction === "undo" ? redo.current : undo.current;
    const next = from.pop();
    if (!next) return;
    to.push(cloneDeck(deckRef.current));
    deckRef.current = next;
    setDeck(next);
    setSelected([]);
    lastCommit.current = { key: "", time: 0 };
    setHistoryTick((t) => t + 1);
  };
  const activeEquation = object?.type === "equation" ? object : undefined;
  useEffect(() => {
    if (!activeEquation) return;
    setDraft({
      latex: activeEquation.latex,
      font: activeEquation.style.fontSetId ?? deck.theme.equation.fontSetId,
      size: activeEquation.style.fontSize ?? deck.theme.equation.fontSize,
      color: activeEquation.style.color ?? deck.theme.equation.color,
      renderer: activeEquation.renderer ?? "mathjax",
      engine: activeEquation.localTex?.engine ?? "latex",
      preamble: activeEquation.localTex?.preamble ?? DEFAULT_LOCAL_PREAMBLE,
    });
    setDraftTexRender(activeEquation.localTex?.render);
  }, [
    activeEquation?.id,
    activeEquation?.latex,
    activeEquation?.style.fontSetId,
    activeEquation?.style.fontSize,
    activeEquation?.style.color,
    activeEquation?.renderer,
    activeEquation?.localTex?.engine,
    activeEquation?.localTex?.preamble,
    activeEquation?.localTex?.render?.inputFingerprint,
    activeEquation?.localTex?.render?.svg,
    activeEquation?.localTex?.render?.width,
    activeEquation?.localTex?.render?.height,
    deck.theme.equation.fontSetId,
    deck.theme.equation.fontSize,
    deck.theme.equation.color,
  ]);
  useEffect(() => {
    if (!activeEquation) return;
    let live = true;
    if (draft.renderer === "local-latex") {
      setDraftBusy(false);
      setDraftFallbackCount(0);
      const fingerprint = localTexInputFingerprint({
        source: draft.latex,
        engine: draft.engine,
        preamble: draft.preamble,
        displayMode: activeEquation.displayMode,
        fontSize: draft.size,
        color: draft.color,
      });
      if (draftTexRender?.inputFingerprint === fingerprint) {
        setDraftSvg(draftTexRender.svg);
        setDraftError("");
      } else {
        setDraftSvg("");
        setDraftError("수식을 컴파일한 뒤 Apply equation을 눌러주세요.");
      }
      return;
    }
    setDraftBusy(true);
    setDraftFallbackCount(0);
    const timer = setTimeout(() => {
      renderEquation(
        draft.latex,
        draft.font as EquationObject["style"]["fontSetId"] & string,
        draft.size,
        draft.color,
        activeEquation.displayMode,
      )
        .then((r) => {
          if (live) {
            setDraftSvg(r.svg);
            setDraftError("");
            setDraftFallbackCount(r.fallbackGlyphs?.length ?? 0);
          }
        })
        .catch((e) => {
          if (live) {
            setDraftError(e.message);
            setDraftSvg("");
            setDraftFallbackCount(0);
          }
        })
        .finally(() => {
          if (live) setDraftBusy(false);
        });
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft, draftTexRender, activeEquation?.id, activeEquation?.displayMode]);
  useEffect(() => {
    const previous = compileJob.current;
    if (previous) {
      compileJob.current = null;
      setCompileBusy(false);
      void desktop?.cancelCompile(previous).catch(() => {});
    }
  }, [draft, activeEquation?.id, activeEquation?.displayMode]);
  const compileEquation = async () => {
    if (!desktop || !activeEquation) return;
    try {
      assertEquationDocumentLimits(draft.latex, draft.preamble);
    } catch (error) {
      setDraftError((error as Error).message);
      notify((error as Error).message);
      return;
    }
    const jobId = newId();
    compileJob.current = jobId;
    setCompileBusy(true);
    const snapshot = {
      source: draft.latex,
      engine: draft.engine,
      preamble: draft.preamble,
      displayMode: activeEquation.displayMode,
      fontSize: draft.size,
      color: draft.color,
    };
    try {
      const result = await desktop.compileTex({ jobId, ...snapshot });
      if (compileJob.current !== jobId) return;
      const current = draftRef.current;
      if (
        localTexInputFingerprint({
          source: current.latex,
          engine: current.engine,
          preamble: current.preamble,
          displayMode: snapshot.displayMode,
          fontSize: current.size,
          color: current.color,
        }) !== localTexInputFingerprint(snapshot)
      )
        return;
      setDraftTexRender({
        svg: sanitizeLocalEquationSvg(result.svg),
        width: result.width,
        height: result.height,
        inputFingerprint: localTexInputFingerprint(snapshot),
        profile: result.profile,
        warnings: result.warnings,
      });
      notify("LaTeX 컴파일을 마쳤습니다. Apply equation으로 반영하세요.");
    } catch (e) {
      if (compileJob.current === jobId) {
        setDraftError((e as Error).message);
        notify((e as Error).message);
      }
    } finally {
      if (compileJob.current === jobId) {
        compileJob.current = null;
        setCompileBusy(false);
      }
    }
  };
  const onMetrics = useCallback(
    (id: string, width: number, height: number) =>
      setMetrics((m) =>
        m[id]?.width === width && m[id]?.height === height
          ? m
          : { ...m, [id]: { width, height } },
      ),
    [],
  );
  const applyEquation = async () => {
    if (!activeEquation) return;
    try {
      assertEquationDocumentLimits(
        draft.latex,
        draft.renderer === "local-latex" ? draft.preamble : undefined,
      );
      const r =
        draft.renderer === "local-latex"
          ? (() => {
              const fingerprint = localTexInputFingerprint({
                source: draft.latex,
                engine: draft.engine,
                preamble: draft.preamble,
                displayMode: activeEquation.displayMode,
                fontSize: draft.size,
                color: draft.color,
              });
              if (
                !draftTexRender ||
                draftTexRender.inputFingerprint !== fingerprint
              )
                throw new Error("먼저 LaTeX 수식을 컴파일해주세요.");
              return draftTexRender;
            })()
          : await renderEquation(
              draft.latex,
              draft.font as NonNullable<EquationObject["style"]["fontSetId"]>,
              draft.size,
              draft.color,
              activeEquation.displayMode,
            );
      updateObject(activeEquation.id, (o) => {
        if (o.type === "equation") {
          o.latex = draft.latex;
          o.renderer = draft.renderer;
          if (draft.renderer === "local-latex")
            o.localTex = {
              engine: draft.engine,
              preamble: draft.preamble,
              render: draftTexRender,
            };
          else delete o.localTex;
          o.style = {
            fontSetId: draft.font as NonNullable<
              EquationObject["style"]["fontSetId"]
            >,
            fontSize: draft.size,
            color: draft.color,
          };
          o.transform.width = r.width;
          o.transform.height = r.height;
        }
      });
      notify("수식을 적용했습니다.");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const switchSlide = (id: string) => {
    cancelGesture();
    setDrawingTool(null);
    setSlideId(id);
    setPresentationStep(0);
    setSelected([]);
    setPreview({});
  };
  const addSlide = () => {
    setShowHelp(false);
    setExportMenu(false);
    setShowSlideTemplates(true);
  };
  const addTemplateSlide = (id: SlideTemplateId) => {
    const s = createTemplateSlide(id, deck.theme);
    change((d) => {
      d.slides.splice(slideIndex + 1, 0, s);
    });
    switchSlide(s.id);
    setShowSlideTemplates(false);
  };
  const duplicateSlide = () => {
    const s = clone(slide);
    s.id = newId();
    s.title += " · copy";
    s.objects = cloneObjectsWithGroups(s.objects);
    change((d) => d.slides.splice(slideIndex + 1, 0, s));
    switchSlide(s.id);
  };
  const removeSlide = () => {
    if (deck.slides.length === 1) {
      notify("슬라이드는 하나 이상 필요합니다.");
      return;
    }
    change((d) => {
      d.slides = d.slides.filter((s) => s.id !== slide.id);
      pruneUnusedAssets(d);
    });
    switchSlide(deck.slides[slideIndex ? slideIndex - 1 : 1].id);
  };
  const moveSlide = (delta: number) => {
    const target = slideIndex + delta;
    if (target < 0 || target >= deck.slides.length) return;
    change((d) => {
      [d.slides[slideIndex], d.slides[target]] = [
        d.slides[target],
        d.slides[slideIndex],
      ];
    });
  };
  const base = (type: SlideObject["type"]) => ({
    id: newId(),
    type,
    name:
      type === "equation"
        ? "Equation"
        : type === "text"
          ? "Text"
          : type === "figure"
            ? "Figure"
            : type === "video"
              ? "Video"
              : "Shape",
    transform: { x: 140, y: 250, width: 600, height: 120, rotation: 0 },
    opacity: 1,
    visible: true,
    locked: false,
    metadata: {},
  });
  const insert = async (type: "text" | "equation" | "rect" | "ellipse") => {
    cancelGesture();
    setDrawingTool(null);
    let o: SlideObject;
    if (type === "text")
      o = {
        ...base("text"),
        type: "text",
        text: "Write your idea here",
        fontFamily: "Inter",
        fontSize: 40,
        fontWeight: 400,
        color: "#132d40",
        align: "left",
      } as TextObject;
    else if (type === "equation") {
      const r = await renderEquation(
        "E = mc^2",
        deck.theme.equation.fontSetId,
        48,
        "#132d40",
      );
      o = {
        ...base("equation"),
        type: "equation",
        latex: "E = mc^2",
        style: {},
        description: "",
        displayMode: true,
      } as EquationObject;
      o.transform.width = r.width;
      o.transform.height = r.height;
    } else
      o = {
        ...base("shape"),
        type: "shape",
        shape: type,
        fill: "#dcf2eb",
        stroke: "#259f87",
        strokeWidth: 2,
      } as ShapeObject;
    change((d) => d.slides.find((s) => s.id === slide.id)!.objects.push(o));
    setSelected([o.id]);
  };
  const deleteObjects = () => {
    const ids = editableSelection(slide.objects, selected);
    if (!ids.length) return;
    change((d) => {
      const s = d.slides.find((s) => s.id === slide.id)!;
      s.objects = s.objects.filter((o) => !ids.includes(o.id));
      cleanupGroups(s.objects);
      pruneUnusedAssets(d);
    });
    setSelected([]);
  };
  const duplicateObjects = () => {
    if (!selected.length) return;
    const copies = duplicateSelectedObjects(slide.objects, selected, {
      x: 32,
      y: 32,
    });
    if (!copies.length) return;
    change((d) =>
      d.slides.find((s) => s.id === slide.id)!.objects.push(...copies),
    );
    setSelected(copies.map((o) => o.id));
  };
  const groupSelection = () => {
    const ids = editableSelection(slide.objects, selected);
    if (ids.length < 2) return;
    change((d) =>
      groupObjects(d.slides.find((s) => s.id === slide.id)!.objects, ids),
    );
    setSelected(ids);
    notify("Objects grouped. Drag any member to move the group.");
  };
  const ungroupSelection = () => {
    const ids = editableSelection(slide.objects, selected);
    if (!slide.objects.some((o) => ids.includes(o.id) && o.groupId)) return;
    change((d) =>
      ungroupObjects(d.slides.find((s) => s.id === slide.id)!.objects, ids),
    );
    notify("Objects ungrouped.");
  };
  const align = (where: "left" | "center" | "right") => {
    change((d) => {
      const s = d.slides.find((s) => s.id === slide.id)!;
      const ids = editableSelection(s.objects, selected);
      const units = new Map<string, SlideObject[]>();
      for (const o of s.objects.filter((o) => ids.includes(o.id))) {
        const key = o.groupId ?? o.id;
        units.set(key, [...(units.get(key) ?? []), o]);
      }
      const bounds = [...units.values()].map((objects) => ({
        objects,
        bounds: selectionBounds(
          objects,
          objects.map((o) => o.id),
          metrics,
        )!,
      }));
      if (!bounds.length) return;
      const left = Math.min(...bounds.map((u) => u.bounds.x));
      const right = Math.max(...bounds.map((u) => u.bounds.x + u.bounds.width));
      for (const unit of bounds) {
        const b = unit.bounds;
        const x =
          bounds.length === 1
            ? where === "left"
              ? 80
              : where === "right"
                ? deck.slideSize.width - 80 - b.width
                : (deck.slideSize.width - b.width) / 2
            : where === "left"
              ? left
              : where === "right"
                ? right - b.width
                : (left + right - b.width) / 2;
        unit.objects.forEach((o) => {
          o.transform.x += x - b.x;
        });
      }
    });
  };
  const layer = (front: boolean) => {
    if (!object) return;
    change((d) => {
      const s = d.slides.find((s) => s.id === slide.id)!;
      const ids = editableSelection(s.objects, selected);
      const moving = s.objects.filter((o) => ids.includes(o.id));
      s.objects = s.objects.filter((o) => !ids.includes(o.id));
      if (front) s.objects.push(...moving);
      else s.objects.unshift(...moving);
    });
  };
  const save = async (saveAs = false) => {
    if (busy) return;
    setBusy("Packaging deck");
    try {
      const archive = await buildDeckArchive(deckRef.current),
        suggestedName = `${deckRef.current.title || "Untitled"}.scislide`;
      if (desktop) {
        const result = await desktop.saveDocument({
          bytes: new Uint8Array(await archive.arrayBuffer()),
          suggestedName,
          saveAs,
        });
        if (result) {
          setDocumentFilename(result.name);
          notify("프레젠테이션을 저장했습니다.");
        }
      } else {
        downloadBlob(archive, suggestedName);
        notify(
          "다운로드를 시작했습니다. 브라우저 다운로드 폴더를 확인해주세요.",
        );
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const openDesktopDocument = async () => {
    if (busy) return;
    if (!desktop) {
      openInput.current?.click();
      return;
    }
    setBusy("Opening deck");
    try {
      const result = await desktop.openDocument();
      if (!result) return;
      const next = await readDeckArchive(
        new Blob([new Uint8Array(result.bytes).buffer]),
      );
      commit(next);
      switchSlide(next.slides[0].id);
      setDocumentFilename(result.name);
      notify("프레젠테이션을 불러왔습니다.");
    } catch (e) {
      await desktop.clearDocument();
      setDocumentFilename("");
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const newPresentation = () => {
    if (busy) return;
    const next = createDemoDeck();
    next.slides = [createBlankSlide()];
    next.assets = [];
    next.title = "Untitled presentation";
    commit(next);
    switchSlide(next.slides[0].id);
    setDocumentFilename("");
    void desktop?.clearDocument();
  };
  const open = async (file: File) => {
    setBusy("Opening deck");
    try {
      const next = await readDeckArchive(file);
      commit(next);
      switchSlide(next.slides[0].id);
      notify("프레젠테이션을 불러왔습니다.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const addFigure = async (file: File) => {
    setBusy("Importing figure");
    try {
      const a = await importFigure(file);
      const scale = Math.min(
          1,
          800 / (a.width || 800),
          600 / (a.height || 450),
        ),
        w = (a.width || 800) * scale,
        h = (a.height || 450) * scale,
        o: SlideObject = {
          ...base("figure"),
          type: "figure",
          assetId: a.id,
          alt: a.name,
          transform: {
            x: 180,
            y: 220,
            width: w,
            height: Math.min(h, 600),
            rotation: 0,
          },
        };
      change((d) => {
        d.assets.push(a);
        d.slides.find((s) => s.id === slide.id)!.objects.push(o);
      });
      setSelected([o.id]);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const addVideo = async (file: File) => {
    if (busy) return;
    setBusy("Importing video");
    // Keep the destination stable while the file is being read.
    const targetSlideId = slide.id;
    try {
      const asset = await importVideo(file);
      if (!deckRef.current.slides.some((s) => s.id === targetSlideId))
        throw new Error("The destination slide is no longer available.");
      const nativeWidth = asset.width || 800;
      const nativeHeight = asset.height || 450;
      const scale = Math.min(800 / nativeWidth, 600 / nativeHeight);
      const width = nativeWidth * scale;
      const height = nativeHeight * scale;
      const video: VideoObject = {
        ...base("video"),
        type: "video",
        name: "Video",
        assetId: asset.id,
        alt: asset.name,
        autoplay: false,
        loop: false,
        muted: false,
        controls: true,
        transform: { x: 180, y: 220, width, height, rotation: 0 },
      };
      change((d) => {
        d.assets.push(asset);
        d.slides.find((s) => s.id === targetSlideId)!.objects.push(video);
      });
      switchSlide(targetSlideId);
      setSelected([video.id]);
      notify(
        "Video added. Use Present to play it; save the deck to keep the embedded file.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const runExport = async (kind: "pdf" | "svg") => {
    if (busy) return;
    setExportMenu(false);
    setBusy(kind === "pdf" ? "Preparing vector PDF" : "Preparing SVG");
    try {
      const snapshot = cloneDeck(deckRef.current),
        blob =
          kind === "pdf"
            ? await exportDeckPdf(snapshot)
            : await exportSlideSvg(snapshot, slide);
      const suggestedName = `${snapshot.title}${kind === "svg" ? "-" + (slideIndex + 1) : ""}.${kind}`;
      if (desktop) {
        const result = await desktop.saveExport({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          suggestedName,
          kind,
        });
        if (result) notify(`${kind.toUpperCase()} 파일을 저장했습니다.`);
      } else {
        downloadBlob(blob, suggestedName);
        notify(`${kind.toUpperCase()} 다운로드를 시작했습니다.`);
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const startPresent = () => {
    cancelGesture();
    setDrawingTool(null);
    setPresentationStep(0);
    setPresenting(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const stopPresent = () => {
    setPresenting(false);
    setPresentationStep(0);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };
  const nextPresentation = () => {
    const next = nextBuildStep(slide, presentationStep);
    if (next !== null) setPresentationStep(next);
    else if (slideIndex < deck.slides.length - 1)
      switchSlide(deck.slides[slideIndex + 1].id);
  };
  const previousPresentation = () => {
    const previous = previousBuildStep(slide, presentationStep);
    if (previous !== null) setPresentationStep(previous);
    else if (slideIndex > 0) {
      const previousSlide = deck.slides[slideIndex - 1];
      switchSlide(previousSlide.id);
      setPresentationStep(maxBuildStep(previousSlide));
    }
  };
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  useEffect(() =>
    desktop?.onCommand((command) => {
      if (showAiDraft) return;
      if (showSlideTemplates) setShowSlideTemplates(false);
      const editing =
        document.activeElement instanceof HTMLElement &&
        (document.activeElement.matches("input,textarea") ||
          document.activeElement.isContentEditable);
      if (command === "new") newPresentation();
      else if (command === "open") void openDesktopDocument();
      else if (command === "save" || command === "saveAs")
        void save(command === "saveAs");
      else if (command === "undo" || command === "redo") {
        if (editing) document.execCommand(command);
        else history(command);
      } else if (command === "present") startPresent();
      else if (command === "exportPdf") void runExport("pdf");
    }),
  );
  useEffect(() => {
    const flush = () => {
      try {
        saveRecovery(deckRef.current);
      } catch {
        /* Existing recovery status reports storage failures. */
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);
  const position = (
    e: { clientX: number; clientY: number },
    svg: SVGSVGElement,
  ) => {
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * deckRef.current.slideSize.width) / r.width,
      y: ((e.clientY - r.top) * deckRef.current.slideSize.height) / r.height,
    };
  };
  const chooseDrawingTool = (kind: ShapeObject["shape"] | null) => {
    cancelGesture();
    setDrawingTool(kind);
    setSelected([]);
  };
  const startDrawing = (e: PointerEvent<SVGSVGElement>) => {
    if (!drawingTool || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    cancelGesture();
    const svg = e.currentTarget;
    const start = position(e, svg);
    const initial = shapeFromDrag(drawingTool, start, start);
    gesture.current = {
      mode: "draw",
      kind: drawingTool,
      slideId: slide.id,
      deckId: deck.id,
      start,
      objects: [initial],
      current: {},
      svg,
      pointerId: e.pointerId,
    };
    setSelected([]);
    setDraftShape(initial);
    svg.setPointerCapture(e.pointerId);
  };
  const startGesture = (
    e: PointerEvent<SVGGElement | SVGRectElement | SVGCircleElement>,
    o: SlideObject,
    mode: "drag" | "resize" | "endpoint",
    endpoint?: "start" | "end",
  ) => {
    e.stopPropagation();
    if (
      mode === "resize" &&
      o.type === "equation" &&
      o.renderer === "local-latex"
    )
      return;
    if (e.button !== 0) return;
    const svg = e.currentTarget.ownerSVGElement!;
    if (mode !== "drag" && o.groupId) return;
    const clicked = expandSelection(slide.objects, [o.id]);
    let ids = selected.includes(o.id)
      ? expandSelection(slide.objects, selected)
      : clicked;
    if (mode === "drag" && e.shiftKey) {
      ids = selected.includes(o.id)
        ? selected.filter((id) => !clicked.includes(id))
        : expandSelection(slide.objects, [...selected, ...clicked]);
      setSelected(ids);
      return;
    }
    setSelected(ids);
    if (isObjectLocked(o, slide.objects)) return;
    const editable = editableSelection(slide.objects, ids);
    const objects = slide.objects
      .filter(
        (v) =>
          (mode !== "drag" ? v.id === o.id : editable.includes(v.id)) &&
          !isObjectLocked(v, slide.objects),
      )
      .map((v) => {
        const c = clone(v),
          m = metrics[v.id];
        if (m) {
          c.transform.width = m.width;
          c.transform.height = m.height;
        }
        return c;
      });
    gesture.current = {
      mode,
      endpoint,
      slideId: slide.id,
      deckId: deck.id,
      start: position(e, svg),
      objects,
      current: {},
      svg,
      pointerId: e.pointerId,
    };
    svg.setPointerCapture(e.pointerId);
  };
  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      if (!g.svg.isConnected || !g.svg.getBoundingClientRect().width) {
        cancelGesture();
        return;
      }
      const p = position(e, g.svg);
      let dx = p.x - g.start.x,
        dy = p.y - g.start.y;
      const next: Record<string, SlideObject> = {};
      if (g.mode === "draw") {
        let end = {
          x: Math.max(0, Math.min(deck.slideSize.width, p.x)),
          y: Math.max(0, Math.min(deck.slideSize.height, p.y)),
        };
        if (grid)
          end = {
            x: Math.round(end.x / 20) * 20,
            y: Math.round(end.y / 20) * 20,
          };
        if (e.shiftKey) {
          const x = end.x - g.start.x,
            y = end.y - g.start.y;
          if (g.kind === "line" || g.kind === "arrow") {
            const angle =
              Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
            const length = Math.hypot(x, y);
            end = {
              x: g.start.x + Math.cos(angle) * length,
              y: g.start.y + Math.sin(angle) * length,
            };
          } else {
            const size = Math.max(Math.abs(x), Math.abs(y));
            end = {
              x: g.start.x + (x < 0 ? -size : size),
              y: g.start.y + (y < 0 ? -size : size),
            };
          }
        }
        const shape = shapeFromDrag(g.kind!, g.start, end);
        shape.id = g.objects[0].id;
        g.current = { [shape.id]: shape };
        setDraftShape(shape);
        return;
      }
      if (g.mode === "endpoint") {
        const o = g.objects[0];
        if (!isLineShape(o)) return;
        let end = grid
          ? { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 }
          : p;
        if (e.shiftKey) {
          const points = lineWorldEndpoints(o);
          const fixed = g.endpoint === "start" ? points.end : points.start;
          const x = end.x - fixed.x,
            y = end.y - fixed.y;
          const angle =
            Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
          const length = Math.hypot(x, y);
          end = {
            x: fixed.x + Math.cos(angle) * length,
            y: fixed.y + Math.sin(angle) * length,
          };
        }
        g.current = { [o.id]: moveLineEndpoint(o, g.endpoint!, end) };
        setPreview(g.current);
        return;
      }
      if (g.mode === "drag") {
        if (grid) {
          // Snap the selection as a unit so grouped members keep their offsets.
          const origin = selectionBounds(
            g.objects,
            g.objects.map((o) => o.id),
          );
          if (origin) {
            dx = Math.round((origin.x + dx) / 20) * 20 - origin.x;
            dy = Math.round((origin.y + dy) / 20) * 20 - origin.y;
          }
          setGuides([]);
        } else if (smartGuides && !e.altKey) {
          const origin = selectionBounds(
            g.objects.filter((o) => o.visible),
            g.objects.map((o) => o.id),
          );
          if (origin) {
            const ids = new Set(g.objects.map((o) => o.id));
            const stationary = slide.objects.filter(
              (o) => o.visible && !ids.has(o.id),
            );
            // Treat a group as one reference so spacing measures its outer box.
            const units = new Map<string, SlideObject[]>();
            for (const o of stationary) {
              const key = o.groupId ? `group:${o.groupId}` : `object:${o.id}`;
              units.set(key, [...(units.get(key) ?? []), o]);
            }
            const targets = [...units.values()].map((objects) =>
              selectionBounds(
                objects,
                objects.map((o) => o.id),
                metrics,
              )!,
            );
            const snap = snapMove(
              origin,
              { x: dx, y: dy },
              targets,
              deck.slideSize,
              (6 * deck.slideSize.width) / g.svg.getBoundingClientRect().width,
            );
            dx = snap.dx;
            dy = snap.dy;
            setGuides(snap.guides);
          } else setGuides([]);
        } else setGuides([]);
      } else setGuides([]);
      for (const o of g.objects) {
        const n = clone(o);
        if (g.mode === "drag") {
          n.transform.x = o.transform.x + dx;
          n.transform.y = o.transform.y + dy;
        } else {
          const w = o.transform.width,
            h = o.transform.height,
            ratio = Math.max(0.1, (w + dx) / w);
          if (o.type === "equation" && n.type === "equation")
            n.style.fontSize = Math.max(
              12,
              Math.min(
                180,
                (o.style.fontSize ?? deck.theme.equation.fontSize) * ratio,
              ),
            );
          else {
            const preserveRatio =
              o.type === "figure" || o.type === "video" || e.shiftKey;
            const minWidth = preserveRatio ? Math.max(24, (24 * w) / h) : 24;
            const width = Math.max(minWidth, w + dx);
            const proposed = {
              width,
              height: preserveRatio ? (width * h) / w : Math.max(24, h + dy),
            };
            if (
              smartGuides &&
              !grid &&
              !e.altKey &&
              o.transform.rotation === 0
            ) {
              const targets = slide.objects
                .filter(
                  (target) =>
                    target.visible &&
                    target.id !== o.id &&
                    !target.groupId &&
                    target.transform.rotation === 0 &&
                    target.type !== "equation" &&
                    !isLineShape(target),
                )
                .map((target) => objectBounds(target));
              const snap = snapResize(
                objectBounds(o),
                proposed,
                targets,
                deck.slideSize,
                (6 * deck.slideSize.width) /
                  g.svg.getBoundingClientRect().width,
                {
                  aspectRatio: preserveRatio ? w / h : undefined,
                  minWidth,
                  minHeight: 24,
                },
              );
              n.transform.width = snap.width;
              n.transform.height = snap.height;
              setGuides(snap.guides);
            } else {
              n.transform.width = proposed.width;
              n.transform.height = proposed.height;
            }
          }
        }
        next[o.id] = n;
      }
      g.current = next;
      setPreview(next);
    };
    const end = (e: globalThis.PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      if (!g.svg.isConnected || !g.svg.getBoundingClientRect().width) {
        cancelGesture();
        return;
      }
      const distance = Math.hypot(
        position(e, g.svg).x - g.start.x,
        position(e, g.svg).y - g.start.y,
      );
      if (g.mode === "draw" || Object.keys(g.current).length || distance > 0)
        move(e);
      gesture.current = null;
      const validDocument =
        deckRef.current.id === g.deckId &&
        deckRef.current.slides.some((s) => s.id === g.slideId);
      if (g.mode === "draw") {
        const shape = Object.values(g.current)[0];
        if (
          validDocument &&
          shape &&
          distance >=
            (4 * deck.slideSize.width) / g.svg.getBoundingClientRect().width
        ) {
          change((d) =>
            d.slides.find((s) => s.id === g.slideId)!.objects.push(shape),
          );
          setSelected([shape.id]);
          setDrawingTool(null);
        }
      } else if (
        validDocument &&
        Object.keys(g.current).length &&
        g.objects.some(
          (o) => JSON.stringify(o) !== JSON.stringify(g.current[o.id] ?? o),
        )
      )
        change((d) => {
          const s = d.slides.find((s) => s.id === g.slideId)!;
          s.objects = s.objects.map((o) => g.current[o.id] ?? o);
        });
      setPreview({});
      setDraftShape(undefined);
      setGuides([]);
      if (g.svg.hasPointerCapture(g.pointerId))
        g.svg.releasePointerCapture(g.pointerId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    const cancel = (e: globalThis.PointerEvent) => {
      if (gesture.current?.pointerId === e.pointerId) cancelGesture();
    };
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("lostpointercapture", cancel);
    window.addEventListener("blur", cancelGesture);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("blur", cancelGesture);
    };
  }, [
    slide,
    deck.id,
    deck.slideSize,
    change,
    metrics,
    deck.theme.equation.fontSize,
    grid,
    smartGuides,
    cancelGesture,
  ]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (showMathLibrary || showSlideTemplates || showAiDraft) {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") e.preventDefault();
        return;
      }
      const input =
        e.target instanceof HTMLElement &&
        (e.target.matches("input,textarea,select") ||
          e.target.isContentEditable);
      if (presenting) {
        if (e.key === "Escape") {
          stopPresent();
          return;
        }
        const target = e.target instanceof Element ? e.target : null;
        const mediaControl = !!target?.closest(
          "video,audio,.video-player,input,select,textarea",
        );
        if (
          mediaControl ||
          (target?.closest("button") && [" ", "Enter"].includes(e.key))
        )
          return;
        if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(e.key)) {
          e.preventDefault();
          nextPresentation();
        } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
          e.preventDefault();
          previousPresentation();
        } else if (e.key === "Home") {
          e.preventDefault();
          switchSlide(deck.slides[0].id);
        } else if (e.key === "End") {
          e.preventDefault();
          const last = deck.slides[deck.slides.length - 1];
          switchSlide(last.id);
          setPresentationStep(maxBuildStep(last));
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (input) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        history(e.shiftKey ? "redo" : "undo");
      } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        history("redo");
      } else if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        duplicateObjects();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (["Delete", "Backspace"].includes(e.key)) {
        e.preventDefault();
        deleteObjects();
      } else if (e.key === "Escape") {
        cancelGesture();
        setDrawingTool(null);
        setSelected([]);
        setShowHelp(false);
        setExportMenu(false);
      } else if (
        selected.length &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const delta = e.shiftKey ? 10 : 1;
        const movable = editableSelection(slide.objects, selected);
        change(
          (d) =>
            d.slides
              .find((s) => s.id === slide.id)!
              .objects.filter((o) => movable.includes(o.id))
              .forEach((o) => {
                o.transform.x +=
                  e.key === "ArrowLeft"
                    ? -delta
                    : e.key === "ArrowRight"
                      ? delta
                      : 0;
                o.transform.y +=
                  e.key === "ArrowUp"
                    ? -delta
                    : e.key === "ArrowDown"
                      ? delta
                      : 0;
              }),
          "nudge",
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (presenting)
    return (
      <div className="presentation-view">
        <SlideScene
          key={slide.id}
          deck={deck}
          slide={slide}
          slideIndex={slideIndex}
          presentationStep={presentationStep}
          playback
        />
        <div className="presentation-controls">
          <IconButton
            title="Previous step or slide"
            onClick={previousPresentation}
            disabled={slideIndex === 0 && presentationStep === 0}
          >
            <ChevronLeft size={20} />
          </IconButton>
          <span>
            {slideIndex + 1} / {deck.slides.length}
            {maxBuildStep(slide) > 0 && (
              <small className="presentation-step">
                Step {presentationStep}
              </small>
            )}
          </span>
          <IconButton
            title="Next step or slide"
            onClick={nextPresentation}
            disabled={
              slideIndex === deck.slides.length - 1 &&
              presentationStep >= maxBuildStep(slide)
            }
          >
            <ChevronRight size={20} />
          </IconButton>
          <button onClick={stopPresent}>
            <X size={16} /> Exit
          </button>
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Atom size={23} />
          </span>
          <strong>
            SciSlide<span className="preview-badge">PREVIEW</span>
          </strong>
        </div>
        <div className="document-title">
          <input
            aria-label="Presentation title"
            value={deck.title}
            onChange={(e) =>
              change((d) => {
                d.title = e.target.value;
              }, "title")
            }
          />
          <span>
            <span className="status-dot" />
            {documentFilename || recoveryStatus}
            {desktop && <span className="desktop-badge">DESKTOP</span>}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="button light"
            disabled={!!busy}
            onClick={() => setShowAiDraft(true)}
          >
            <Sparkles size={16} /> AI draft
          </button>
          <IconButton
            title="Keyboard shortcuts"
            onClick={() => setShowHelp(true)}
          >
            <CircleHelp size={19} />
          </IconButton>
          <button className="button light" onClick={startPresent}>
            <Presentation size={16} /> Present
          </button>
          <div className="dropdown-wrap">
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => setExportMenu(!exportMenu)}
            >
              <Download size={16} /> Export <ChevronDown size={14} />
            </button>
            {exportMenu && (
              <div className="dropdown">
                <button onClick={() => void runExport("pdf")}>
                  <Download size={15} />
                  <span>
                    PDF presentation<small>All slides · vector equations</small>
                  </span>
                </button>
                <button onClick={() => void runExport("svg")}>
                  <ImagePlus size={15} />
                  <span>
                    Current slide as SVG<small>Editable vector format</small>
                  </span>
                </button>
              </div>
            )}
          </div>
          <span className="avatar">SC</span>
        </div>
      </header>
      <div className="toolbar">
        <div className="toolbar-group">
          <IconButton
            title="Open .scislide"
            onClick={() => void openDesktopDocument()}
          >
            <FolderOpen size={18} />
          </IconButton>
          <IconButton
            title="Save .scislide · Ctrl+S"
            onClick={() => void save()}
          >
            <Save size={18} />
          </IconButton>
          <IconButton title="New blank presentation" onClick={newPresentation}>
            <FilePlus2 size={18} />
          </IconButton>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <IconButton
            title="Undo · Ctrl+Z"
            onClick={() => history("undo")}
            disabled={!undo.current.length}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            title="Redo · Ctrl+Shift+Z"
            onClick={() => history("redo")}
            disabled={!redo.current.length}
          >
            <Redo2 size={18} />
          </IconButton>
        </div>
        <span className="toolbar-divider" />
        <button className="tool" onClick={() => void insert("text")}>
          <Type size={18} /> Text
        </button>
        <button
          className="tool equation-tool"
          onClick={() => void insert("equation")}
        >
          <Sigma size={20} /> Equation
        </button>
        <button
          className="tool"
          onClick={() => {
            chooseDrawingTool(null);
            imageInput.current?.click();
          }}
        >
          <ImagePlus size={18} /> Figure
        </button>
        <button
          className="tool"
          disabled={!!busy}
          onClick={() => {
            chooseDrawingTool(null);
            videoInput.current?.click();
          }}
          title={`Insert an MP4 or WebM video · up to ${MAX_VIDEO_BYTES / 1024 / 1024} MB`}
        >
          <Video size={18} /> Video
        </button>
        <IconButton
          title="Select objects · Escape"
          active={!drawingTool}
          onClick={() => chooseDrawingTool(null)}
        >
          <MousePointer2 size={17} />
        </IconButton>
        <IconButton
          title="Draw rectangle"
          active={drawingTool === "rect"}
          onClick={() =>
            chooseDrawingTool(drawingTool === "rect" ? null : "rect")
          }
        >
          <Square size={17} />
        </IconButton>
        <IconButton
          title="Draw ellipse"
          active={drawingTool === "ellipse"}
          onClick={() =>
            chooseDrawingTool(drawingTool === "ellipse" ? null : "ellipse")
          }
        >
          <Circle size={17} />
        </IconButton>
        <IconButton
          title="Draw line"
          active={drawingTool === "line"}
          onClick={() =>
            chooseDrawingTool(drawingTool === "line" ? null : "line")
          }
        >
          <Minus size={17} />
        </IconButton>
        <IconButton
          title="Draw arrow"
          active={drawingTool === "arrow"}
          onClick={() =>
            chooseDrawingTool(drawingTool === "arrow" ? null : "arrow")
          }
        >
          <ArrowUpRight size={17} />
        </IconButton>
        <IconButton
          title="Group objects · Ctrl+G"
          disabled={editableSelection(slide.objects, selected).length < 2}
          onClick={groupSelection}
        >
          <Group size={17} />
        </IconButton>
        <IconButton
          title="Ungroup objects · Ctrl+Shift+G"
          disabled={
            !slide.objects.some(
              (o) =>
                selected.includes(o.id) &&
                o.groupId &&
                !isObjectLocked(o, slide.objects),
            )
          }
          onClick={ungroupSelection}
        >
          <Ungroup size={17} />
        </IconButton>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <IconButton
            title="Align left"
            onClick={() => align("left")}
            disabled={!selected.length}
          >
            <AlignLeft size={18} />
          </IconButton>
          <IconButton
            title="Align center"
            onClick={() => align("center")}
            disabled={!selected.length}
          >
            <AlignCenter size={18} />
          </IconButton>
          <IconButton
            title="Align right"
            onClick={() => align("right")}
            disabled={!selected.length}
          >
            <AlignRight size={18} />
          </IconButton>
        </div>
        <div className="toolbar-end">
          <IconButton
            title="Smart alignment guides · Alt to bypass"
            active={smartGuides}
            onClick={() => setSmartGuides(!smartGuides)}
          >
            <Magnet size={18} />
          </IconButton>
          <IconButton
            title="Snap to 20 px grid"
            active={grid}
            onClick={() => setGrid(!grid)}
          >
            <GripVertical size={18} />
          </IconButton>
          <span>16:9</span>
        </div>
      </div>
      <div className="workspace">
        <aside className="slide-sidebar">
          <div className="sidebar-heading">
            <span>
              SLIDES <b>{deck.slides.length}</b>
            </span>
            <IconButton title="Add slide" onClick={addSlide}>
              <Plus size={18} />
            </IconButton>
          </div>
          <div className="slide-list">
            {deck.slides.map((s, i) => (
              <button
                className={`slide-card ${s.id === slide.id ? "selected" : ""}`}
                key={s.id}
                onClick={() => switchSlide(s.id)}
              >
                <span className="slide-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="thumbnail">
                  <SlideScene deck={deck} slide={s} slideIndex={i} />
                </span>
                <span className="thumbnail-title">
                  {s.title || "Untitled slide"}
                </span>
              </button>
            ))}
          </div>
          <button className="add-slide" onClick={addSlide}>
            <Plus size={17} /> New slide
          </button>
          <div className="sidebar-bottom">
            <IconButton title="Duplicate slide" onClick={duplicateSlide}>
              <Copy size={15} />
            </IconButton>
            <IconButton
              title="Move slide up"
              onClick={() => moveSlide(-1)}
              disabled={slideIndex === 0}
            >
              <ArrowUp size={16} />
            </IconButton>
            <IconButton
              title="Move slide down"
              onClick={() => moveSlide(1)}
              disabled={slideIndex === deck.slides.length - 1}
            >
              <ArrowDown size={16} />
            </IconButton>
            <IconButton title="Delete slide" onClick={removeSlide}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        </aside>
        <main className="editor-area">
          <div className="canvas-heading">
            <div>
              <span>WORKSPACE</span>
              <h1>{slide.title || "Untitled slide"}</h1>
              <div className="mobile-slide-nav">
                <select
                  aria-label="Slide navigator"
                  value={slide.id}
                  onChange={(e) => switchSlide(e.target.value)}
                >
                  {deck.slides.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      {i + 1}. {s.title || "Untitled slide"}
                    </option>
                  ))}
                </select>
                <IconButton title="Add mobile slide" onClick={addSlide}>
                  <Plus size={16} />
                </IconButton>
              </div>
            </div>
            <span className="canvas-hint">
              <MousePointer2 size={13} />{" "}
              {drawingTool
                ? `Drag to draw ${drawingTool === "rect" ? "rectangle" : drawingTool} · Shift to constrain · Escape to cancel`
                : "Select · Shift for multiple · drag to align"}
            </span>
          </div>
          <div
            className={`canvas-viewport ${grid ? "show-grid" : ""}`}
            ref={canvasRef}
          >
            <div
              className="slide-paper"
              style={{ width: `${(fitWidth * zoom) / 100}px` }}
            >
              <SlideScene
                deck={deck}
                slide={slide}
                slideIndex={slideIndex}
                selected={selected}
                preview={preview}
                drawing={!!drawingTool}
                draftShape={draftShape}
                guides={guides}
                guideScale={(fitWidth * zoom) / (100 * deck.slideSize.width)}
                onDrawStart={drawingTool ? startDrawing : undefined}
                metrics={metrics}
                onMetrics={onMetrics}
                onPointer={(e, o) => startGesture(e, o, "drag")}
                onResize={(e, o) => startGesture(e, o, "resize")}
                onEndpoint={(e, o, endpoint) =>
                  startGesture(e, o, "endpoint", endpoint)
                }
                onEdit={(o) => {
                  setSelected([o.id]);
                  setTimeout(() => {
                    if (o.type === "equation") sourceRef.current?.focus();
                    else document.getElementById("text-content")?.focus();
                  }, 0);
                }}
                onBackground={() => setSelected([])}
              />
            </div>
          </div>
          <div className="canvas-footer">
            <span>
              Slide {slideIndex + 1} of {deck.slides.length}
              <span className="footer-separator">·</span>
              {selected.length
                ? `${selected.length} selected`
                : `${slide.objects.length} objects`}
            </span>
            <div>
              <IconButton title="Fit slide" onClick={() => setZoom(100)}>
                <Maximize2 size={14} />
              </IconButton>
              <input
                aria-label="Canvas zoom"
                type="range"
                min="50"
                max="150"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
              <span>{zoom}%</span>
            </div>
          </div>
          <section className="notes-panel">
            <div>
              <span>Speaker notes</span>
              <small>Only visible to you</small>
            </div>
            <textarea
              aria-label="Speaker notes"
              value={slide.notes}
              placeholder="Add a reminder for your presentation…"
              onChange={(e) =>
                change((d) => {
                  d.slides.find((s) => s.id === slide.id)!.notes =
                    e.target.value;
                }, "notes")
              }
            />
          </section>
        </main>
        <aside className="inspector">
          <div className="inspector-heading">
            <span>
              <Settings2 size={17} /> Inspector
            </span>
            <MoreHorizontal size={18} />
          </div>
          {object ? (
            <>
              <div className="object-heading">
                <span className="object-type-icon">
                  {object.type === "equation" ? (
                    <Sigma size={22} />
                  ) : object.type === "text" ? (
                    <Type size={20} />
                  ) : object.type === "figure" ? (
                    <ImagePlus size={20} />
                  ) : object.type === "video" ? (
                    <Video size={20} />
                  ) : (
                    <Square size={20} />
                  )}
                </span>
                <div>
                  <h2>{object.name}</h2>
                  <span>
                    {object.groupId
                      ? `Group · ${slide.objects.filter((o) => o.groupId === object.groupId).length} objects`
                      : object.type === "equation"
                        ? "Native LaTeX object"
                        : `${object.type[0].toUpperCase() + object.type.slice(1)} object`}
                  </span>
                </div>
                <IconButton
                  title="Lock or unlock object"
                  active={object.locked}
                  onClick={() =>
                    updateObject(object.id, (o) => {
                      o.locked = !o.locked;
                    })
                  }
                >
                  <LockKeyhole size={15} />
                </IconButton>
              </div>
              {activeEquation && (
                <>
                  <div className="inspector-section">
                    <Field label="Equation renderer">
                      <select
                        aria-label="Equation renderer"
                        value={draft.renderer}
                        onChange={(e) => {
                          const renderer = e.target
                            .value as EquationDraft["renderer"];
                          try {
                            const converted =
                              renderer === "local-latex" &&
                              draft.renderer === "mathjax"
                                ? moveLeadingPackagesToPreamble(
                                    draft.latex,
                                    draft.preamble,
                                  )
                                : {
                                    source: draft.latex,
                                    preamble: draft.preamble,
                                  };
                            assertEquationDocumentLimits(
                              converted.source,
                              renderer === "local-latex"
                                ? converted.preamble
                                : undefined,
                            );
                            setDraft({
                              ...draft,
                              renderer,
                              latex: converted.source,
                              preamble: converted.preamble,
                            });
                          } catch (error) {
                            notify((error as Error).message);
                          }
                        }}
                      >
                        <option value="mathjax">MathJax · Live preview</option>
                        <option value="local-latex">
                          Local LaTeX · Installed packages
                        </option>
                      </select>
                    </Field>
                    <div className="section-label">
                      LATEX SOURCE{" "}
                      <span>
                        {draft.renderer === "mathjax"
                          ? "Live preview"
                          : "Local compile"}
                      </span>
                    </div>
                    <textarea
                      ref={sourceRef}
                      className="latex-input"
                      aria-label="LaTeX source"
                      value={draft.latex}
                      spellCheck={false}
                      maxLength={MAX_EQUATION_SOURCE_CHARACTERS}
                      onChange={(e) =>
                        setDraft({ ...draft, latex: e.target.value })
                      }
                    />
                    <button
                      className="math-library-button"
                      onClick={() => setShowMathLibrary(true)}
                      hidden={draft.renderer === "local-latex"}
                    >
                      <span>
                        <Check size={12} /> AMS fonts & symbols
                      </span>
                      <span>
                        Packages & examples <ChevronRight size={12} />
                      </span>
                    </button>
                    {draft.renderer === "local-latex" && (
                      <div className="local-tex-panel">
                        <Field label="TeX engine">
                          <select
                            aria-label="TeX engine"
                            value={draft.engine}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                engine: e.target
                                  .value as EquationDraft["engine"],
                              })
                            }
                          >
                            <option value="latex">
                              LaTeX · Classic math fonts
                            </option>
                            <option value="xelatex">
                              XeLaTeX · OpenType math fonts
                            </option>
                          </select>
                        </Field>
                        <div className="section-label">
                          PREAMBLE <span>Packages & fonts</span>
                        </div>
                        <textarea
                          className="latex-input preamble-input"
                          aria-label="LaTeX preamble"
                          value={draft.preamble}
                          spellCheck={false}
                          maxLength={MAX_LOCAL_PREAMBLE_CHARACTERS}
                          onChange={(e) =>
                            setDraft({ ...draft, preamble: e.target.value })
                          }
                        />
                        <p className="field-hint">
                          패키지·매크로·글꼴 설정은 여기에 입력하세요.
                          XeLaTeX에서는 unicode-math와 setmathfont를 사용할 수
                          있습니다.
                        </p>
                        {desktop ? (
                          <p
                            className={`tex-status ${texCapabilities?.available ? "ready" : ""}`}
                            aria-label="Local LaTeX status"
                          >
                            {texDetectionError ||
                              (texCapabilities
                                ? texCapabilities.available
                                  ? "Installed LaTeX is ready"
                                  : texCapabilities.message ||
                                    texCapabilities.sandbox.reason ||
                                    "로컬 LaTeX을 사용할 수 없습니다."
                                : "Checking installed LaTeX…")}
                          </p>
                        ) : (
                          <p className="field-hint">
                            저장된 결과는 웹에서도 볼 수 있습니다. 컴파일은
                            SciSlide 데스크톱 앱에서 사용할 수 있습니다.
                          </p>
                        )}
                        <button
                          className="button compile-button"
                          disabled={
                            !desktop ||
                            !texCapabilities?.available ||
                            !texCapabilities.engines.some(
                              (e) => e.id === draft.engine,
                            ) ||
                            compileBusy
                          }
                          onClick={() => void compileEquation()}
                        >
                          <Sigma size={14} />
                          {compileBusy ? "Compiling…" : "Compile with LaTeX"}
                        </button>
                        {compileBusy && (
                          <button
                            className="text-button"
                            onClick={() => {
                              const id = compileJob.current;
                              compileJob.current = null;
                              setCompileBusy(false);
                              if (id) void desktop?.cancelCompile(id);
                            }}
                          >
                            Cancel compile
                          </button>
                        )}
                        {!!draftTexRender?.warnings.length && (
                          <p className="field-hint">
                            {draftTexRender.warnings.join(" · ")}
                          </p>
                        )}
                      </div>
                    )}
                    <div
                      className={`equation-preview ${draftError ? "error" : ""}`}
                      aria-label="Equation preview"
                    >
                      {draftError ? (
                        <span>{draftError}</span>
                      ) : (
                        <div dangerouslySetInnerHTML={{ __html: draftSvg }} />
                      )}
                      {draftBusy && <small>Rendering…</small>}
                    </div>
                    {draftFallbackCount > 0 && !draftBusy && (
                      <p className="math-fallback-note">
                        일부 기호는 STIX Two의 벡터 글자로 보완했습니다.
                      </p>
                    )}
                    <button
                      className="button apply-button"
                      disabled={draftBusy || compileBusy || !!draftError}
                      onClick={() => void applyEquation()}
                    >
                      <Check size={15} /> Apply equation
                    </button>
                  </div>
                  <div className="inspector-section">
                    <div className="section-label">TYPOGRAPHY</div>
                    {draft.renderer === "mathjax" && (
                      <>
                        <Field label="Math font">
                          <select
                            aria-label="Math font"
                            value={draft.font}
                            onChange={(e) =>
                              setDraft({ ...draft, font: e.target.value })
                            }
                          >
                            {FONT_OPTIONS.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <p className="field-hint">
                          {
                            FONT_OPTIONS.find((f) => f.id === draft.font)
                              ?.description
                          }
                        </p>
                      </>
                    )}
                    <div className="field-row">
                      <Field label="Size">
                        <input
                          aria-label="Equation size"
                          type="number"
                          min="12"
                          max="180"
                          value={draft.size}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              size: Math.max(
                                12,
                                Math.min(180, Number(e.target.value)),
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field label="Color">
                        <div className="color-field">
                          <input
                            aria-label="Equation color"
                            type="color"
                            value={draft.color}
                            onChange={(e) =>
                              setDraft({ ...draft, color: e.target.value })
                            }
                          />
                          <span>{draft.color.toUpperCase()}</span>
                        </div>
                      </Field>
                    </div>
                    {draft.renderer === "local-latex" && (
                      <p className="field-hint">
                        크기를 바꾸려면 Size → Compile → Apply 순서로
                        반영하세요.
                      </p>
                    )}
                    <button
                      className="text-button"
                      disabled={draft.renderer === "local-latex"}
                      onClick={() =>
                        updateObject(object.id, (o) => {
                          if (o.type === "equation") o.style = {};
                        })
                      }
                    >
                      Use deck typography
                    </button>
                  </div>
                </>
              )}
              {object.type === "text" && (
                <div className="inspector-section">
                  <div className="section-label">CONTENT & TYPE</div>
                  <textarea
                    id="text-content"
                    aria-label="Text content"
                    className="text-input"
                    value={object.text}
                    onChange={(e) =>
                      updateObject(
                        object.id,
                        (o) => {
                          if (o.type === "text") o.text = e.target.value;
                        },
                        "text-" + object.id,
                      )
                    }
                  />
                  <div className="field-row">
                    <Field label="Size">
                      <input
                        aria-label="Text size"
                        type="number"
                        min="8"
                        max="180"
                        value={object.fontSize}
                        onChange={(e) =>
                          updateObject(
                            object.id,
                            (o) => {
                              if (o.type === "text")
                                o.fontSize = Math.max(
                                  8,
                                  Math.min(180, Number(e.target.value)),
                                );
                            },
                            "textsize",
                          )
                        }
                      />
                    </Field>
                    <Field label="Weight">
                      <select
                        value={object.fontWeight}
                        onChange={(e) =>
                          updateObject(object.id, (o) => {
                            if (o.type === "text")
                              o.fontWeight = Number(e.target.value);
                          })
                        }
                      >
                        <option value="400">Regular</option>
                        <option value="500">Medium</option>
                        <option value="600">Semibold</option>
                        <option value="700">Bold</option>
                      </select>
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Color">
                      <input
                        aria-label="Text color"
                        type="color"
                        value={object.color}
                        onChange={(e) =>
                          updateObject(object.id, (o) => {
                            if (o.type === "text") o.color = e.target.value;
                          })
                        }
                      />
                    </Field>
                    <Field label="Alignment">
                      <select
                        value={object.align}
                        onChange={(e) =>
                          updateObject(object.id, (o) => {
                            if (o.type === "text")
                              o.align = e.target.value as TextObject["align"];
                          })
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </Field>
                  </div>
                </div>
              )}
              {object.type === "shape" && (
                <div className="inspector-section">
                  <div className="section-label">APPEARANCE</div>
                  <div className="field-row">
                    {!isLineShape(object) && (
                      <Field label="Fill">
                        <input
                          aria-label="Shape fill"
                          type="color"
                          value={
                            object.fill === "none" ? "#dcf2eb" : object.fill
                          }
                          disabled={object.fill === "none"}
                          onChange={(e) =>
                            updateObject(object.id, (o) => {
                              if (o.type === "shape") o.fill = e.target.value;
                            })
                          }
                        />
                      </Field>
                    )}
                    <Field label="Stroke">
                      <input
                        aria-label="Shape stroke"
                        type="color"
                        value={
                          object.stroke === "none" ? "#259f87" : object.stroke
                        }
                        onChange={(e) =>
                          updateObject(object.id, (o) => {
                            if (o.type === "shape") o.stroke = e.target.value;
                          })
                        }
                      />
                    </Field>
                  </div>
                  {!isLineShape(object) && (
                    <label className="drawing-checkbox">
                      <input
                        type="checkbox"
                        aria-label="No shape fill"
                        checked={object.fill === "none"}
                        onChange={(e) =>
                          updateObject(object.id, (o) => {
                            if (o.type === "shape")
                              o.fill = e.target.checked ? "none" : "#dcf2eb";
                          })
                        }
                      />
                      No fill (transparent)
                    </label>
                  )}
                  <Field label="Stroke width">
                    <input
                      type="number"
                      aria-label="Shape stroke width"
                      min="0"
                      max="20"
                      value={object.strokeWidth}
                      onChange={(e) =>
                        updateObject(object.id, (o) => {
                          if (o.type === "shape")
                            o.strokeWidth = Math.max(
                              0,
                              Math.min(20, Number(e.target.value)),
                            );
                        })
                      }
                    />
                  </Field>
                  <Field label="Line style">
                    <select
                      aria-label="Shape line style"
                      value={object.strokeStyle ?? "solid"}
                      onChange={(e) =>
                        updateObject(object.id, (o) => {
                          if (o.type === "shape")
                            o.strokeStyle = e.target
                              .value as ShapeObject["strokeStyle"];
                        })
                      }
                    >
                      <option value="solid">Solid</option>
                      <option value="dashed">Dashed</option>
                      <option value="dotted">Dotted</option>
                    </select>
                  </Field>
                  {isLineShape(object) && (
                    <>
                      <Field label="Arrowheads">
                        <select
                          aria-label="Arrowheads"
                          value={`${object.startArrow ? "1" : "0"}${(object.endArrow ?? object.shape === "arrow") ? "1" : "0"}`}
                          onChange={(e) =>
                            updateObject(object.id, (o) => {
                              if (o.type === "shape") {
                                o.startArrow = e.target.value[0] === "1";
                                o.endArrow = e.target.value[1] === "1";
                              }
                            })
                          }
                        >
                          <option value="00">None</option>
                          <option value="10">Start</option>
                          <option value="01">End</option>
                          <option value="11">Both</option>
                        </select>
                      </Field>
                      <p className="field-hint">
                        Drag either endpoint to edit the line. Hold Shift for
                        45° angles.
                        {object.groupId ? " Ungroup to edit endpoints." : ""}
                      </p>
                      {(["start", "end"] as const).map((endpoint) => (
                        <div className="field-row" key={endpoint}>
                          {(["x", "y"] as const).map((axis) => (
                            <Field
                              label={`${endpoint === "start" ? "Start" : "End"} ${axis.toUpperCase()}`}
                              key={axis}
                            >
                              <input
                                aria-label={`Line ${endpoint} ${axis}`}
                                type="number"
                                disabled={
                                  !!object.groupId ||
                                  isObjectLocked(object, slide.objects)
                                }
                                value={numeric(
                                  lineWorldEndpoints(object)[endpoint][axis],
                                )}
                                onChange={(e) =>
                                  updateObject(
                                    object.id,
                                    (o) => {
                                      if (isLineShape(o)) {
                                        const p =
                                          lineWorldEndpoints(o)[endpoint];
                                        p[axis] = Math.max(
                                          -1_000_000,
                                          Math.min(
                                            1_000_000,
                                            Number(e.target.value),
                                          ),
                                        );
                                        Object.assign(
                                          o,
                                          moveLineEndpoint(o, endpoint, p),
                                        );
                                      }
                                    },
                                    `${endpoint}-${axis}`,
                                  )
                                }
                              />
                            </Field>
                          ))}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
              {object.type === "figure" && (
                <div className="inspector-section">
                  <div className="section-label">FIGURE</div>
                  <Field label="Description">
                    <textarea
                      value={object.alt}
                      onChange={(e) =>
                        updateObject(
                          object.id,
                          (o) => {
                            if (o.type === "figure") o.alt = e.target.value;
                          },
                          "alt",
                        )
                      }
                    />
                  </Field>
                  <p className="field-hint">
                    Original asset is bundled with the deck.
                  </p>
                </div>
              )}
              {object.type === "video" && (
                <div className="inspector-section">
                  <div className="section-label">VIDEO</div>
                  <Field label="Description">
                    <textarea
                      aria-label="Video description"
                      value={object.alt}
                      onChange={(e) =>
                        updateObject(
                          object.id,
                          (o) => {
                            if (o.type === "video") o.alt = e.target.value;
                          },
                          "video-alt",
                        )
                      }
                    />
                  </Field>
                  {(["autoplay", "loop", "muted", "controls"] as const).map(
                    (property) => (
                      <label className="check-field" key={property}>
                        <input
                          type="checkbox"
                          checked={object[property]}
                          onChange={(e) =>
                            updateObject(object.id, (o) => {
                              if (o.type === "video")
                                o[property] = e.target.checked;
                            })
                          }
                        />
                        <span>
                          {
                            {
                              autoplay: "Play when revealed",
                              loop: "Loop video",
                              muted: "Mute audio",
                              controls: "Show playback controls",
                            }[property]
                          }
                        </span>
                      </label>
                    ),
                  )}
                  <p className="field-hint">
                    {deck.assets.find((a) => a.id === object.assetId)?.mime ||
                      "Embedded video"}
                    {" · "}
                    {(() => {
                      const asset = deck.assets.find(
                        (a) => a.id === object.assetId,
                      );
                      if (!asset) return "Missing asset";
                      const bytes = Math.floor(
                        ((asset.dataUrl.length -
                          asset.dataUrl.indexOf(",") -
                          1) *
                          3) /
                          4,
                      );
                      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
                    })()}
                    <br />
                    Stored inside the deck. Videos play only in Present mode.
                    Codec support depends on your browser or Electron; autoplay
                    may require a click.
                  </p>
                </div>
              )}
              <div className="inspector-section">
                <div className="section-label">APPEARANCE STEPS</div>
                <Field label="Reveal step (0 = visible at start)">
                  <input
                    aria-label="Object reveal step"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={object.build?.step ?? 0}
                    onChange={(e) =>
                      updateObject(
                        object.id,
                        (o) => {
                          o.build = {
                            step: Math.max(
                              0,
                              Math.min(100, Math.round(Number(e.target.value))),
                            ),
                            effect: o.build?.effect ?? "appear",
                            durationMs: o.build?.durationMs ?? 300,
                          };
                        },
                        "build-step",
                      )
                    }
                  />
                </Field>
                <div className="field-row">
                  <Field label="Effect">
                    <select
                      aria-label="Object reveal effect"
                      value={object.build?.effect ?? "appear"}
                      onChange={(e) =>
                        updateObject(object.id, (o) => {
                          o.build = {
                            step: o.build?.step ?? 0,
                            effect: e.target.value as "appear" | "fade",
                            durationMs: o.build?.durationMs ?? 300,
                          };
                        })
                      }
                    >
                      <option value="appear">Appear</option>
                      <option value="fade">Fade in</option>
                    </select>
                  </Field>
                  <Field label="Duration (ms)">
                    <input
                      aria-label="Object reveal duration"
                      type="number"
                      min="100"
                      max="3000"
                      step="100"
                      disabled={object.build?.effect !== "fade"}
                      value={object.build?.durationMs ?? 300}
                      onChange={(e) =>
                        updateObject(
                          object.id,
                          (o) => {
                            o.build = {
                              step: o.build?.step ?? 0,
                              effect: o.build?.effect ?? "appear",
                              durationMs: Math.max(
                                100,
                                Math.min(3000, Number(e.target.value)),
                              ),
                            };
                          },
                          "build-duration",
                        )
                      }
                    />
                  </Field>
                </div>
                <p className="field-hint">
                  Present reveals each step with Next or an arrow key. Objects
                  with the same step appear together. Editor and PDF/SVG exports
                  show all steps.
                </p>
              </div>
              <div className="inspector-section">
                <div className="section-label">POSITION & SIZE</div>
                {object.groupId && (
                  <p className="field-hint">
                    Position moves the whole group. Ungroup to resize or rotate
                    a member.
                  </p>
                )}
                <div className="field-row">
                  {(["x", "y"] as const).map((k) => (
                    <Field key={k} label={k.toUpperCase()}>
                      <input
                        aria-label={`Object ${k}`}
                        type="number"
                        disabled={isObjectLocked(object, slide.objects)}
                        value={numeric(object.transform[k])}
                        onChange={(e) =>
                          updatePosition(k, Number(e.target.value))
                        }
                      />
                    </Field>
                  ))}
                </div>
                <div className="field-row">
                  {(["width", "height"] as const).map((k) => (
                    <Field key={k} label={k === "width" ? "W" : "H"}>
                      <input
                        aria-label={`Object ${k}`}
                        type="number"
                        min={isLineShape(object) ? 0.01 : 1}
                        step={isLineShape(object) ? 0.01 : 1}
                        disabled={
                          object.type === "equation" ||
                          !!object.groupId ||
                          isObjectLocked(object, slide.objects)
                        }
                        value={
                          isLineShape(object)
                            ? Number(object.transform[k].toFixed(4))
                            : numeric(
                                object.type === "equation"
                                  ? (metrics[object.id]?.[k] ??
                                      object.transform[k])
                                  : object.transform[k],
                              )
                        }
                        onChange={(e) =>
                          updateObject(
                            object.id,
                            (o) => {
                              o.transform[k] = Math.max(
                                isLineShape(o) ? 0.01 : 1,
                                Number(e.target.value),
                              );
                            },
                            k,
                          )
                        }
                      />
                    </Field>
                  ))}
                </div>
                <div className="field-row">
                  <Field label="Rotation">
                    <input
                      aria-label="Object rotation"
                      type="number"
                      disabled={
                        !!object.groupId ||
                        isObjectLocked(object, slide.objects)
                      }
                      value={object.transform.rotation}
                      onChange={(e) =>
                        updateObject(
                          object.id,
                          (o) => {
                            o.transform.rotation = Number(e.target.value);
                          },
                          "rotation",
                        )
                      }
                    />
                  </Field>
                  <Field label="Opacity">
                    <input
                      aria-label="Object opacity"
                      type="number"
                      min="0"
                      max="100"
                      value={numeric(object.opacity * 100)}
                      onChange={(e) =>
                        updateObject(
                          object.id,
                          (o) => {
                            o.opacity =
                              Math.max(
                                0,
                                Math.min(100, Number(e.target.value)),
                              ) / 100;
                          },
                          "opacity",
                        )
                      }
                    />
                  </Field>
                </div>
              </div>
              <div className="inspector-section">
                <div className="section-label">ARRANGE</div>
                <div className="arrange-buttons">
                  <button
                    onClick={groupSelection}
                    disabled={
                      editableSelection(slide.objects, selected).length < 2
                    }
                  >
                    <Group size={14} /> Group
                  </button>
                  <button
                    onClick={ungroupSelection}
                    disabled={
                      !slide.objects.some(
                        (o) =>
                          selected.includes(o.id) &&
                          o.groupId &&
                          !isObjectLocked(o, slide.objects),
                      )
                    }
                  >
                    <Ungroup size={14} /> Ungroup
                  </button>
                </div>
                <div className="arrange-buttons">
                  <button onClick={() => layer(false)}>
                    <Layers size={14} /> Send back
                  </button>
                  <button onClick={() => layer(true)}>
                    <Layers size={14} /> Bring front
                  </button>
                </div>
                <div className="object-actions">
                  <button onClick={duplicateObjects}>
                    <Copy size={14} /> Duplicate
                  </button>
                  <button
                    className="danger"
                    disabled={object.locked}
                    onClick={deleteObjects}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="inspector-empty">
                <MousePointer2 size={27} />
                <h2>Your ideas, precisely placed.</h2>
                <p>
                  Select an object to edit its content, typography, and
                  position.
                </p>
              </div>
              <div className="inspector-section">
                <div className="section-label">SLIDE</div>
                <Field label="Slide title">
                  <input
                    value={slide.title}
                    onChange={(e) =>
                      change((d) => {
                        d.slides.find((s) => s.id === slide.id)!.title =
                          e.target.value;
                      }, "slidetitle")
                    }
                  />
                </Field>
                <Field label="Background">
                  <div className="color-field">
                    <input
                      aria-label="Slide background"
                      type="color"
                      value={slide.background}
                      onChange={(e) =>
                        change((d) => {
                          d.slides.find((s) => s.id === slide.id)!.background =
                            e.target.value;
                        })
                      }
                    />
                    <span>{slide.background.toUpperCase()}</span>
                  </div>
                </Field>
              </div>
              <div className="inspector-section">
                <div className="section-label">DECK TYPOGRAPHY</div>
                <Field label="Default math font">
                  <select
                    aria-label="Default math font"
                    value={deck.theme.equation.fontSetId}
                    onChange={(e) =>
                      change((d) => {
                        d.theme.equation.fontSetId = e.target
                          .value as NonNullable<
                          EquationObject["style"]["fontSetId"]
                        >;
                      })
                    }
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="field-hint">
                  Applies to equations using deck typography.
                </p>
              </div>
              <div className="inspector-section">
                <div className="section-label">PAGE NUMBERS</div>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={pageNumbers.enabled}
                    onChange={(e) =>
                      change((d) => {
                        d.pageNumbers = {
                          ...pageNumbers,
                          enabled: e.target.checked,
                        };
                      })
                    }
                  />
                  <span>Show page numbers</span>
                </label>
                <div className="field-row">
                  <Field label="Position">
                    <select
                      aria-label="Page number position"
                      disabled={!pageNumbers.enabled}
                      value={pageNumbers.position}
                      onChange={(e) =>
                        change((d) => {
                          d.pageNumbers = {
                            ...pageNumbers,
                            position: e.target
                              .value as typeof pageNumbers.position,
                          };
                        })
                      }
                    >
                      <option value="bottom-left">Bottom left</option>
                      <option value="bottom-center">Bottom center</option>
                      <option value="bottom-right">Bottom right</option>
                    </select>
                  </Field>
                  <Field label="Format">
                    <select
                      aria-label="Page number format"
                      disabled={!pageNumbers.enabled}
                      value={pageNumbers.format}
                      onChange={(e) =>
                        change((d) => {
                          d.pageNumbers = {
                            ...pageNumbers,
                            format: e.target.value as typeof pageNumbers.format,
                          };
                        })
                      }
                    >
                      <option value="number">1</option>
                      <option value="number-total">Number / last page</option>
                    </select>
                  </Field>
                </div>
                <Field label="Start numbering at">
                  <input
                    aria-label="Page number starting value"
                    type="number"
                    min="0"
                    max="10000"
                    step="1"
                    disabled={!pageNumbers.enabled}
                    value={pageNumbers.startAt}
                    onChange={(e) =>
                      change((d) => {
                        d.pageNumbers = {
                          ...pageNumbers,
                          startAt: Math.max(
                            0,
                            Math.min(10000, Math.round(Number(e.target.value))),
                          ),
                        };
                      }, "page-start")
                    }
                  />
                </Field>
                <label className="check-field">
                  <input
                    type="checkbox"
                    disabled={!pageNumbers.enabled}
                    checked={pageNumbers.hideFirst}
                    onChange={(e) =>
                      change((d) => {
                        d.pageNumbers = {
                          ...pageNumbers,
                          hideFirst: e.target.checked,
                        };
                      })
                    }
                  />
                  <span>Hide number on the first slide</span>
                </label>
                <div className="field-row">
                  <Field label="Size">
                    <input
                      aria-label="Page number size"
                      type="number"
                      min="4"
                      max="200"
                      disabled={!pageNumbers.enabled}
                      value={pageNumbers.fontSize}
                      onChange={(e) =>
                        change((d) => {
                          d.pageNumbers = {
                            ...pageNumbers,
                            fontSize: Math.max(
                              4,
                              Math.min(200, Number(e.target.value)),
                            ),
                          };
                        }, "page-size")
                      }
                    />
                  </Field>
                  <Field label="Color">
                    <input
                      aria-label="Page number color"
                      type="color"
                      disabled={!pageNumbers.enabled}
                      value={pageNumbers.color}
                      onChange={(e) =>
                        change((d) => {
                          d.pageNumbers = {
                            ...pageNumbers,
                            color: e.target.value,
                          };
                        })
                      }
                    />
                  </Field>
                </div>
                <p className="field-hint">
                  Applies to every slide and static exports. Hiding the first
                  number keeps the remaining numbering unchanged.
                </p>
              </div>
            </>
          )}
          <div className="inspector-tip">
            <span className="tip-icon">
              <Atom size={16} />
            </span>
            <p>
              Equations stay editable.
              <br />
              <strong>Source first. Vector always.</strong>
            </p>
          </div>
        </aside>
      </div>
      <input
        hidden
        ref={openInput}
        type="file"
        accept=".scislide"
        onChange={(e) => {
          if (e.target.files?.[0]) void open(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/svg+xml,image/png,image/jpeg"
        onChange={(e) => {
          if (e.target.files?.[0]) void addFigure(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={videoInput}
        type="file"
        accept="video/mp4,video/webm,.mp4,.webm"
        onChange={(e) => {
          if (e.target.files?.[0]) void addVideo(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {(toast || busy) && (
        <div className={`toast ${busy ? "busy" : ""}`} role="status">
          {busy ? <span className="spinner" /> : <Check size={17} />}{" "}
          {busy || toast}
        </div>
      )}
      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div>
              <h2>Make room for your ideas.</h2>
              <IconButton
                title="Close shortcuts"
                onClick={() => setShowHelp(false)}
              >
                <X size={18} />
              </IconButton>
            </div>
            <p>
              수식을 더블클릭하고, 오른쪽에서 원문과 폰트를 수정한 뒤 Apply를
              누르세요.
            </p>
            <dl>
              <dt>Save deck</dt>
              <dd>Ctrl / ⌘ + S</dd>
              <dt>Undo / Redo</dt>
              <dd>Ctrl / ⌘ + Z / Shift + Z</dd>
              <dt>Duplicate object</dt>
              <dd>Ctrl / ⌘ + D</dd>
              <dt>Multiple selection</dt>
              <dd>Shift + Click</dd>
              <dt>Group / Ungroup</dt>
              <dd>Ctrl / ⌘ + G / Shift + G</dd>
              <dt>Constrain drawing / endpoints</dt>
              <dd>Shift · squares, circles and 45° lines</dd>
              <dt>Bypass alignment guides</dt>
              <dd>Hold Alt while dragging</dd>
              <dt>Cancel drawing</dt>
              <dd>Escape</dd>
              <dt>Move selection</dt>
              <dd>Arrow keys · Shift for 10 px</dd>
              <dt>Delete selection</dt>
              <dd>Delete / Backspace</dd>
              <dt>Exit slideshow</dt>
              <dd>Escape</dd>
              <dt>Next / previous reveal</dt>
              <dd>Right / Left · Space / PageDown</dd>
              <dt>First / last slide</dt>
              <dd>Home / End</dd>
            </dl>
            <p className="field-hint">
              Page numbers, embedded videos, and click-to-reveal appear/fade
              steps are available. PDF figure import, advanced animation, and
              collaborative editing are planned later.
            </p>
          </div>
        </div>
      )}
      {showMathLibrary && (
        <MathSupportDialog
          font={draft.font as EquationFontId}
          onClose={closeMathLibrary}
          onUse={(source) => setDraft({ ...draft, latex: source })}
        />
      )}
      {showSlideTemplates && (
        <SlideTemplateDialog
          deck={deck}
          onChoose={addTemplateSlide}
          onClose={closeSlideTemplates}
        />
      )}
      {showAiDraft && (
        <AIDraftDialog
          deck={deck}
          slide={slide}
          onApply={applyAiDraft}
          onClose={closeAiDraft}
        />
      )}
    </div>
  );
}
