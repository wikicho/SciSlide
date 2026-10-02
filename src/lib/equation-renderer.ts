import { renderEquation } from "./equations";
import type { RenderedEquation } from "./equations";
import type { Deck, EquationObject, LocalTexEngine } from "./model";
import { sanitizeLocalEquationSvg } from "./local-equation-svg";

export interface LocalTexInputs {
  source: string;
  engine: LocalTexEngine;
  preamble: string;
  displayMode: boolean;
  fontSize: number;
  color: string;
}

/** Exact deterministic request signature; archive resources separately use SHA-256 integrity. */
export function localTexInputFingerprint(inputs: LocalTexInputs): string {
  return JSON.stringify([
    "scislide-local-tex-v1",
    inputs.source,
    inputs.engine,
    inputs.preamble,
    inputs.displayMode,
    inputs.fontSize,
    inputs.color,
  ]);
}

export function localTexInputs(
  object: EquationObject,
  deck: Deck,
): LocalTexInputs {
  return {
    source: object.latex,
    engine: object.localTex?.engine ?? "latex",
    preamble: object.localTex?.preamble ?? "",
    displayMode: object.displayMode,
    fontSize: object.style.fontSize ?? deck.theme.equation.fontSize,
    color: object.style.color ?? deck.theme.equation.color,
  };
}

export class LocalTexRenderError extends Error {
  constructor(
    public readonly code: "missing-render" | "stale-render",
    message: string,
  ) {
    super(message);
    this.name = "LocalTexRenderError";
  }
}

/** Loading, viewing and exporting never execute an imported document's TeX source. */
export async function renderObjectEquation(
  object: EquationObject,
  deck: Deck,
): Promise<RenderedEquation> {
  if (object.renderer !== "local-latex") {
    return renderEquation(
      object.latex,
      object.style.fontSetId ?? deck.theme.equation.fontSetId,
      object.style.fontSize ?? deck.theme.equation.fontSize,
      object.style.color ?? deck.theme.equation.color,
      object.displayMode,
    );
  }
  const cached = object.localTex?.render;
  if (!cached)
    throw new LocalTexRenderError(
      "missing-render",
      "Compile this Local LaTeX equation in the desktop app before viewing or exporting it.",
    );
  if (
    cached.inputFingerprint !==
    localTexInputFingerprint(localTexInputs(object, deck))
  )
    throw new LocalTexRenderError(
      "stale-render",
      "This Local LaTeX equation changed. Recompile it in the desktop app before viewing or exporting it.",
    );
  if (
    ![cached.width, cached.height].every(
      (value) => Number.isFinite(value) && value > 0 && value <= 100_000,
    )
  )
    throw new Error("This Local LaTeX render has invalid vector bounds.");
  return {
    svg: sanitizeLocalEquationSvg(cached.svg),
    width: cached.width,
    height: cached.height,
  };
}
