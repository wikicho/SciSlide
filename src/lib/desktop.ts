export interface TexCapabilities {
  available: boolean;
  engines: Array<{ id: "latex" | "xelatex"; label: string; version: string }>;
  converter?: { version: string };
  packages?: string[];
  sandbox: { available: boolean; reason?: string };
  message?: string;
}

export interface TexRequest {
  jobId: string;
  source: string;
  preamble: string;
  engine: "latex" | "xelatex";
  fontSize: number;
  color: string;
  displayMode: boolean;
}

export interface TexResult {
  svg: string;
  width: number;
  height: number;
  baseline?: number;
  fingerprint: string;
  profile: {
    engine: string;
    engineVersion: string;
    converterVersion: string;
    dependencies: Array<{ name: string; sha256: string }>;
  };
  warnings: string[];
}

export type DesktopCommand =
  | "new"
  | "open"
  | "save"
  | "saveAs"
  | "undo"
  | "redo"
  | "present"
  | "presentFromStart"
  | "presenterView"
  | "exportPdf"
  | "exportSvg"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "duplicate"
  | "duplicateSlide"
  | "group"
  | "ungroup"
  | "showShortcuts"
  | "finishTextEditing"
  | "addSlide"
  | "insertEquation"
  | "insertFigure"
  | "deselectAll"
  | "lock"
  | "unlock"
  | "bringToFront"
  | "sendToBack"
  | "bringForward"
  | "sendBackward"
  | "zoomIn"
  | "zoomOut"
  | "fitSlide"
  | "bold"
  | "increaseFontSize"
  | "decreaseFontSize"
  | "alignTextLeft"
  | "alignTextCenter"
  | "alignTextRight";

export type AiProvider = "codex" | "claude" | "gemini";

export interface AiCapabilities {
  providers: Array<{
    id: AiProvider;
    label: string;
    available: boolean;
    version?: string;
    reason?: string;
  }>;
  message?: string;
}

export interface AiRequest {
  jobId: string;
  provider: AiProvider;
  prompt: string;
  slideCount: number;
  context?: string;
}

export interface AiResult {
  text: string;
  provider: AiProvider;
  version?: string;
}

export interface DesktopApi {
  platform: string;
  openDocument(): Promise<{
    bytes: Uint8Array;
    name: string;
    path: string;
  } | null>;
  saveDocument(request: {
    bytes: Uint8Array;
    suggestedName: string;
    saveAs?: boolean;
  }): Promise<{ path: string; name: string } | null>;
  saveExport(request: {
    bytes: Uint8Array;
    suggestedName: string;
    kind: "pdf" | "svg" | "json";
  }): Promise<{ path: string; name: string } | null>;
  clearDocument(): Promise<void>;
  detectTex(): Promise<TexCapabilities>;
  compileTex(request: TexRequest): Promise<TexResult>;
  cancelCompile(jobId: string): Promise<void>;
  detectAi(): Promise<AiCapabilities>;
  generateAi(request: AiRequest): Promise<AiResult>;
  cancelAi(jobId: string): Promise<void>;
  onCommand(callback: (command: DesktopCommand) => void): () => void;
}

declare global {
  interface Window {
    scislideDesktop?: DesktopApi;
  }
}

export const desktop =
  typeof window === "undefined" ? undefined : window.scislideDesktop;
export const DEFAULT_LOCAL_PREAMBLE = String.raw`\usepackage{amsmath,amsfonts,amssymb}`;
