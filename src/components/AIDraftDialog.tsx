import { useEffect, useMemo, useRef, useState } from "react";
import { Check, RefreshCw, Sparkles, X } from "lucide-react";
import type { Deck, Slide } from "../lib/model";
import { newId } from "../lib/model";
import { desktop } from "../lib/desktop";
import type { AiCapabilities, AiProvider, DesktopApi } from "../lib/desktop";
import {
  aiSlideContext,
  createAISlides,
  validateAIDraft,
} from "../lib/ai-draft";
import { renderEquation } from "../lib/equations";
import { SlideScene } from "./SlideScene";

type AiApi = Pick<DesktopApi, "detectAi" | "generateAi" | "cancelAi">;
export interface AIDraftApplication {
  slides: Slide[];
  deckId: string;
  anchorId: string;
  fingerprint: string;
}

export function aiAnchorFingerprint(deck: Deck, slide: Slide): string {
  return JSON.stringify({ slide, theme: deck.theme, size: deck.slideSize });
}

/** Validate mathematical syntax and fit rendered outlines inside the reserved equation area. */
export async function prepareAISlides(
  slides: Slide[],
  deck: Deck,
): Promise<Slide[]> {
  for (const slide of slides) {
    for (const object of slide.objects) {
      if (object.type !== "equation") continue;
      const font = object.style.fontSetId ?? deck.theme.equation.fontSetId;
      const size = object.style.fontSize ?? deck.theme.equation.fontSize;
      const color = object.style.color ?? deck.theme.equation.color;
      const render = await renderEquation(
        object.latex,
        font,
        size,
        color,
        true,
      );
      const factor = Math.min(
        1,
        object.transform.width / render.width,
        object.transform.height / render.height,
      );
      if (!Number.isFinite(factor) || factor <= 0 || size * factor < 12) {
        throw new Error(
          `The equation on “${slide.title}” is too large. Ask for a shorter equation.`,
        );
      }
      if (factor < 1)
        object.style.fontSize = Math.floor(size * factor * 10) / 10;
    }
  }
  return slides;
}

export function AIDraftDialog({
  deck,
  slide,
  onApply,
  onClose,
  api = desktop,
}: {
  deck: Deck;
  slide: Slide;
  onApply: (application: AIDraftApplication) => boolean;
  onClose: () => void;
  api?: AiApi;
}) {
  const dialog = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const job = useRef<string | null>(null);
  const detection = useRef(0);
  const [capabilities, setCapabilities] = useState<AiCapabilities | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [provider, setProvider] = useState<AiProvider>("codex");
  const [prompt, setPrompt] = useState("");
  const [slideCount, setSlideCount] = useState(3);
  const [includeContext, setIncludeContext] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState("");
  const [application, setApplication] = useState<AIDraftApplication | null>(
    null,
  );
  const [draftTitle, setDraftTitle] = useState("");
  const context = useMemo(() => aiSlideContext(deck, slide), [deck, slide]);
  const fingerprint = aiAnchorFingerprint(deck, slide);
  const stale =
    !!application &&
    (application.deckId !== deck.id ||
      application.anchorId !== slide.id ||
      application.fingerprint !== fingerprint);
  const selectedProvider = capabilities?.providers.find(
    (p) => p.id === provider,
  );

  const refresh = async () => {
    if (!api?.detectAi) return;
    const request = ++detection.current;
    setDetecting(true);
    setError("");
    try {
      const result = await api.detectAi();
      if (!alive.current || request !== detection.current) return;
      setCapabilities(result);
      setProvider((current) =>
        result.providers.some((p) => p.id === current && p.available)
          ? current
          : (result.providers.find((p) => p.available)?.id ?? current),
      );
    } catch (e) {
      if (alive.current && request === detection.current)
        setError(
          e instanceof Error
            ? e.message
            : "Could not detect installed AI CLIs.",
        );
    } finally {
      if (alive.current && request === detection.current) setDetecting(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      detection.current++;
      const pending = job.current;
      job.current = null;
      if (pending) void api?.cancelAi(pending).catch(() => undefined);
    };
  }, [api]);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const fields = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary",
        ) ?? [],
      );
      const first = fields[0],
        last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [onClose]);

  const cancel = async () => {
    const pending = job.current;
    job.current = null;
    setCanceling(true);
    try {
      if (pending) await api?.cancelAi(pending);
      if (alive.current) setError("Generation canceled.");
    } catch {
      if (alive.current)
        setError(
          "Cancel could not be confirmed. The CLI job will end at its timeout.",
        );
    } finally {
      if (alive.current) {
        setGenerating(false);
        setCanceling(false);
      }
    }
  };

  const generate = async () => {
    if (!api || !selectedProvider?.available || !prompt.trim() || generating)
      return;
    const id = newId();
    job.current = id;
    const baseline = { deckId: deck.id, anchorId: slide.id, fingerprint };
    setGenerating(true);
    setApplication(null);
    setError("");
    try {
      const result = await api.generateAi({
        jobId: id,
        provider,
        prompt: prompt.trim(),
        slideCount,
        ...(includeContext ? { context } : {}),
      });
      if (!alive.current || job.current !== id) return;
      if (result.provider !== provider)
        throw new Error("The AI response did not match the selected provider.");
      const draft = validateAIDraft(result.text, slideCount);
      const slides = await prepareAISlides(
        createAISlides(draft, deck, provider),
        deck,
      );
      if (!alive.current || job.current !== id) return;
      setDraftTitle(draft.title);
      setApplication({ ...baseline, slides });
    } catch (e) {
      if (alive.current && job.current === id)
        setError(e instanceof Error ? e.message : "Draft generation failed.");
    } finally {
      if (alive.current && job.current === id) {
        job.current = null;
        setGenerating(false);
      }
    }
  };

  const previewDeck = useMemo(() => {
    if (!application) return deck;
    const index = deck.slides.findIndex((s) => s.id === application.anchorId);
    return {
      ...deck,
      slides: [
        ...deck.slides.slice(0, index + 1),
        ...application.slides,
        ...deck.slides.slice(index + 1),
      ],
    };
  }, [application, deck]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="library-eyebrow">AI ASSISTANT</span>
            <h2 id="ai-dialog-title">Turn an idea into editable slides.</h2>
            <p>Review the draft, then insert it into your presentation.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close AI assistant"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="ai-dialog-body">
          <div className="ai-compose">
            {!api?.generateAi ? (
              <div className="ai-notice">
                Open the Electron desktop app to connect installed Codex, Claude
                Code or Gemini CLIs. Install and sign in to your chosen CLI in a
                terminal first.
              </div>
            ) : (
              <>
                <div className="ai-provider-heading">
                  <strong>Installed CLI</strong>
                  <button
                    className="icon-button"
                    aria-label="Refresh AI connections"
                    disabled={detecting || generating}
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
                <label className="field">
                  <span>PROVIDER</span>
                  <select
                    aria-label="AI provider"
                    value={provider}
                    disabled={generating || detecting}
                    onChange={(e) => {
                      setProvider(e.target.value as AiProvider);
                      setApplication(null);
                    }}
                  >
                    {(["codex", "claude", "gemini"] as const).map((id) => (
                      <option key={id} value={id}>
                        {capabilities?.providers.find((p) => p.id === id)
                          ?.label ??
                          {
                            codex: "Codex",
                            claude: "Claude Code",
                            gemini: "Gemini CLI",
                          }[id]}
                      </option>
                    ))}
                  </select>
                </label>
                <p
                  className={`ai-connection ${selectedProvider?.available ? "connected" : ""}`}
                  role="status"
                >
                  {detecting
                    ? "Checking installed CLIs…"
                    : selectedProvider?.available
                      ? `Ready · ${selectedProvider.version ?? "CLI detected"}`
                      : (selectedProvider?.reason ??
                        "CLI connection unavailable.")}
                </p>
                {capabilities?.message && (
                  <p className="field-hint">{capabilities.message}</p>
                )}
              </>
            )}
            <label className="field">
              <span>WHAT SHOULD THE SLIDES EXPLAIN?</span>
              <textarea
                className="ai-prompt"
                aria-label="AI slide instructions"
                maxLength={8000}
                value={prompt}
                disabled={generating || !api?.generateAi}
                placeholder="Explain the Friedmann equation to first-year physics students. Use concise Korean bullet points and one equation."
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setApplication(null);
                }}
              />
            </label>
            <label className="field">
              <span>NUMBER OF SLIDES</span>
              <select
                aria-label="AI slide count"
                disabled={generating || !api?.generateAi}
                value={slideCount}
                onChange={(e) => {
                  setSlideCount(Number(e.target.value));
                  setApplication(null);
                }}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="ai-context-option">
              <input
                type="checkbox"
                checked={includeContext}
                disabled={generating || !api?.generateAi}
                onChange={(e) => {
                  setIncludeContext(e.target.checked);
                  setApplication(null);
                }}
              />
              Include current slide text, equations and notes
            </label>
            {includeContext && (
              <details className="ai-context">
                <summary>Preview text sent with your request</summary>
                <pre>{context}</pre>
              </details>
            )}
            <p className="ai-disclosure">
              Generate sends your instructions and selected text to the chosen
              provider through its CLI. Its existing login, network connection
              and usage limits apply.
            </p>
            {generating ? (
              <button
                className="button light ai-generate"
                disabled={canceling}
                onClick={() => void cancel()}
              >
                <X size={15} /> {canceling ? "Canceling…" : "Cancel generation"}
              </button>
            ) : (
              <button
                className="button primary ai-generate"
                disabled={
                  !api?.generateAi ||
                  !selectedProvider?.available ||
                  detecting ||
                  !prompt.trim()
                }
                onClick={() => void generate()}
              >
                <Sparkles size={16} /> Generate draft
              </button>
            )}
            {error && (
              <p className="ai-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="ai-preview" aria-live="polite">
            {generating ? (
              <div className="ai-empty">
                <span className="spinner" />
                <strong>Creating your slides…</strong>
                <p>You can cancel while the CLI is working.</p>
              </div>
            ) : application ? (
              <>
                <div className="ai-preview-heading">
                  <span className="library-eyebrow">
                    DRAFT · {application.slides.length} SLIDES
                  </span>
                  <h3>{draftTitle}</h3>
                  <p>Check scientific claims and equations before applying.</p>
                </div>
                {stale && (
                  <p className="ai-error" role="alert">
                    The source slide or presentation changed. Generate a fresh
                    draft before applying.
                  </p>
                )}
                {application.slides.map((draftSlide) => (
                  <article className="ai-preview-card" key={draftSlide.id}>
                    <div className="ai-slide-image">
                      <SlideScene
                        deck={previewDeck}
                        slide={draftSlide}
                        slideIndex={previewDeck.slides.indexOf(draftSlide)}
                      />
                    </div>
                    <strong>{draftSlide.title}</strong>
                    {draftSlide.notes && (
                      <details>
                        <summary>Speaker notes</summary>
                        <p>{draftSlide.notes}</p>
                      </details>
                    )}
                  </article>
                ))}
              </>
            ) : (
              <div className="ai-empty">
                <Sparkles size={34} />
                <strong>Your draft will appear here.</strong>
                <p>
                  Generate titles, key points, speaker notes and MathJax
                  equations. Each slide remains fully editable after insertion.
                </p>
              </div>
            )}
          </div>
        </div>
        <footer>
          <span>
            New slides are inserted after the current slide. Undo restores the
            previous deck.
          </span>
          <button
            className="button primary"
            disabled={!application || stale || generating}
            onClick={() => {
              if (application && onApply(application)) onClose();
            }}
          >
            <Check size={16} /> Insert {application?.slides.length ?? "draft"}{" "}
            {application?.slides.length === 1 ? "slide" : "slides"}
          </button>
        </footer>
      </section>
    </div>
  );
}
