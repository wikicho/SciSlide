# SciSlide — Scientific Presentation Editor

**Project specification and technical design draft · v0.9**

| Field                 | Value                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Working name          | SciSlide                                                                                       |
| Status                | Electron/web prototype v0.6.0; scientific figure tools, equation library and presenter display |
| Date                  | 2026-10-04                                                                                     |
| Intended audience     | Contributors, maintainers, and scientific users                                                |
| Product direction     | Shared web/desktop visual presentation editor with MathJax and installed LaTeX equations       |
| Native file extension | `.scislide`                                                                                    |
| License               | To be selected after the implementation strategy and dependency review                         |

> A Keynote-like presentation editor designed for scientists, where LaTeX equations are native, editable objects with selectable mathematical typography.

This document consolidates the referenced conversation, **웹 기반 프레젠테이션 제작**, into an open-source project specification and records the subsequent implementation. Product goals come from that discussion. Sections identify the working prototype separately from target requirements; future features and release gates are not claims of existing functionality.

The current v0.6.0 prototype is an independent React/TypeScript application with three bundled MathJax fonts, 17 math-package catalog entries, and an Electron host. Native file operations and an explicit Local LaTeX Compile → Apply workflow are implemented. Five starter themes include the existing fourteen layouts (eight Scientific and six Keynote-inspired) and a dedicated fifteen-layout Keynote White gallery, with blank slides available in either picker. Scientific drawing, flat persistent groups, smart guides, six-way alignment and equal edge-gap distribution support composing figures with labels and equations. An object/layer list provides access to hidden or covered objects; an internal clipboard transfers objects, groups and media across slides or decks in one session. Figures support local SVG/PNG/JPEG import and PDF page selection, reversible crops, independent enlarged insets and source replacement that retains their frames and crop. Native format 0.5.0 stores optional normalized crops as well as drawing/group records; older 0.1.0–0.4.0 files remain readable. A local named/tagged equation library and bounded IndexedDB workspace recovery with unfinished equation drafts are implemented. The separate presenter window shows notes, current/next slide previews, navigation and a configurable timer; its video previews stay passive. Deck-wide slide numbers, embedded MP4/WebM video and ordered appear/fade builds remain available. More advanced animation, linked masters, shared deck macros, PDF vector preservation and research integrations are planned below.

Isolated local compilation currently supports Linux system TeX installations; macOS/Windows compilation and home-installed package access remain future work. [The README](README.md) documents setup and usage. Unsigned, unnotarized macOS installer generation for Apple Silicon and Intel is available via `scripts/package-macos.mjs`; a native macOS build workflow is also provided. Windows x64 portable ZIP and unsigned installer generation is available via `scripts/package-windows.mjs`, with a native Windows build workflow. Linux x64 Debian package generation is available via `scripts/package-linux.mjs`, with a manual Ubuntu 24.04 packaging workflow; a hosted APT repository and Snap distribution remain planned. Windows installation is per-user, and the x64 application has no Node.js or TeX runtime requirement for MathJax editing. Installer checks and CI smoke tests do not establish complete editing, saving, export or physical multi-monitor behavior on Windows or Mac desktops. This prototype is not yet a complete scientific MVP or a signed production distribution.

## Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Document format](#3-document-format)
4. [Equation system](#4-equation-system)
5. [Features and requirements](#5-features-and-requirements)
6. [Development roadmap](#6-development-roadmap)
7. [Development notes](#7-development-notes)
8. [References](#8-references)

## 1. Overview

### 1.1 Problem and motivation

Scientists need precise mathematical typography alongside fast visual slide composition. The motivating workflow in the conversation combines LaTeX equation input, control over the resulting math font, freely positioned scientific figures, and presentation animations. Authoring layouts directly in Beamer creates friction for this workflow; exporting equations as separate images makes subsequent editing cumbersome.

SciSlide will combine a visual editor with an equation engine that retains editable source. A researcher should be able to enter a formula, compare math fonts, drag it into place, revise it in context, and export the slide without rebuilding the equation in another application.

### 1.2 Target users

- Researchers in high-energy physics, cosmology, astronomy, mathematics, and related fields.
- STEM educators preparing lectures with equations and scientific diagrams.
- Research groups that need portable slides and traceable figure sources.

### 1.3 Product goals

| Goal                   | Intended result                                                                   |
| ---------------------- | --------------------------------------------------------------------------------- |
| Visual editing         | Direct manipulation of slide objects with alignment guides and an inspector       |
| Native mathematics     | Editable LaTeX source, live preview, selectable supported math fonts              |
| Scientific figures     | Reliable vector import, nondestructive cropping, captions, and provenance         |
| Portable output        | PDF export with vector equations and consistent placement                         |
| Reproducible documents | Versioned, inspectable source and bundled assets                                  |
| Open development       | Documented interfaces, sample decks, contribution guidance, and public milestones |

“LaTeX-quality” is a typography goal. Compatibility is defined by the supported math syntax and rendering profiles, rather than an assumption that any LaTeX document or package can be compiled.

### 1.4 Primary user journey

1. Create a widescreen deck and add a slide.
2. Insert a title, a scientific figure, and an equation such as `\alpha = \frac{\rho_{\mathrm{vac}}}{\rho_{\mathrm{rad}}}`.
3. Compare STIX Two and Fira mathematical styles in a live preview.
4. Arrange the objects with drag handles, numeric coordinates, and alignment guides.
5. Double-click the equation, revise its source, and retain its position and styling.
6. Save a portable `.scislide` file, reopen it, present it, and export a PDF.

### 1.5 Initial scope

The scientific MVP includes slide management, text, equations, figures, basic shapes, alignment, undo/redo, save/load, recovery, basic slideshow playback, and PDF export. Selectable equation fonts are a release requirement because font control is the central motivation.

The current prototype includes deck-wide page numbers, embedded video, a basic click-build foundation, crop/insets, a personal equation library and a separate presenter display. Advanced animation, linked masters, automatic display placement, shared deck macros, citations, executable figure workflows, collaboration, and Office conversion belong to later milestones. Full Keynote or PowerPoint compatibility, packages requiring external program execution, and mobile authoring are outside the initial scope. The implemented Local LaTeX mode supports engine-compatible system packages inside an isolated single-page math-fragment workflow, not unrestricted document execution.

## 2. Architecture

### 2.1 Design principles

- **Object-first:** Each slide contains independent text, equation, figure, shape, and video objects. Charts and tables can extend the model later.
- **Source-first:** Document data is authoritative. Rendered output and thumbnails are derived artifacts.
- **Shared rendering:** Editing, slideshow playback, and export consume the same resolved scene.
- **Local ownership:** Core editing and native-file export require no account or hosted backend.
- **Explicit capabilities:** Importers, renderers, and exporters report supported features and limitations.
- **Portable assets:** Saved decks include the resources needed for their supported presentation content.

### 2.2 Component structure

```text
Editor UI
  ├─ Slide navigator, canvas, toolbar, inspector, equation editor
  └─ Interaction controller
       └─ Commands and undo/redo
            └─ Document engine
                 ├─ Validation, migrations, theme resolution
                 ├─ Asset store and native-file packaging
                 └─ Resolved scene
                      ├─ Equation service → SVG and layout metrics
                      ├─ Figure adapters → renderable assets
                      └─ Scene renderer
                           ├─ Editing viewport
                           ├─ Slideshow player
                           └─ PDF/export adapters

Platform adapter → browser downloads/recovery or Electron native files
  └─ Narrow preload IPC → main process → isolated local TeX worker
```

The document engine must remain independent of the UI framework. Selection, open dialogs, zoom, drag previews and smart-guide lines/measurements are transient editor state and must not be serialized into the deck.

### 2.3 Module responsibilities

| Module   | Responsibilities                                                                   |
| -------- | ---------------------------------------------------------------------------------- |
| Editor   | Selection, keyboard interaction, object editing, slide organization                |
| Document | Typed model, schema validation, stable IDs, commands, migrations                   |
| Layout   | Bounds, transforms, snapping, distribution, theme and master resolution            |
| Equation | Source validation, macro profiles, font profiles, SVG generation, cache management |
| Assets   | Asset import, MIME validation, deduplication, packaging, provenance                |
| Renderer | Object drawing, clipping, hit testing, viewport transforms                         |
| Player   | Slide navigation, click-build state, and presentation-only media playback          |
| Export   | Resource preflight, static composition, PDF and future formats                     |
| Platform | File access, recovery storage, offline resources, desktop integration              |

### 2.4 Technology direction

| Area            | Implemented v0.6.0 baseline                                     | Remaining decision or improvement                        |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| Language        | TypeScript; small Electron/CommonJS and compiler/ESM modules    | Shared package extraction when useful                    |
| UI              | Independent React 19 editor                                     | No PPTist-derived implementation                         |
| Editor state    | React state with immutable revision history and grouped edits   | Extract document command boundaries as complexity grows  |
| Rendering       | Shared SVG scene and HTML editor controls                       | Profile before adding a canvas path                      |
| Mathematics     | MathJax 4.1.3 and explicit Local LaTeX adapter                  | Additional local engines and OS isolation profiles       |
| Native document | ZIP plus JSON/assets/outlined local renders/crops, format 0.5.0 | JSON Schema publication and unpacked Git workflow        |
| PDF             | jsPDF and svg2pdf.js, shared geometry/resource preflight        | Broader SVG/PDF fixtures and additional script coverage  |
| Desktop         | Electron 44.5.1, isolated preload and native file operations    | Signed installers, updates and cross-platform validation |

The conversation considered an independent React application and a PPTist-based Vue application. The prototype chose the independent React implementation and does not reuse PPTist code. PPTist remains a reference for future comparisons; any future reuse must review the selected upstream revision and license. See the [PPTist repository](https://github.com/pipipi-pikachu/PPTist) and [license](https://github.com/pipipi-pikachu/PPTist/blob/master/LICENSE).

Electron is the selected first desktop runtime. The common editor calls a narrow `window.scislideDesktop` adapter; it does not directly import Electron or Node APIs. A Tauri migration is not a committed milestone.

The renderer uses sandboxing, context isolation, disabled Node integration and a restrictive content security policy. Production content loads from the secure standard `scislide://app/` scheme; fonts and fetch-based resources remain local. Main-process IPC validates the main frame and structured payload limits. Only presentation fullscreen is permitted for the trusted main frame; other permission requests, external navigation, new windows and external network access are denied. The native Present menu performs a fixed fullscreen action with a user gesture only when the canvas is active, then dispatches the presentation command. Focused text controls and visible dialogs suppress that fullscreen action; applying an inline edit with Command/Ctrl+Enter must not unexpectedly enter a slideshow. Native file destinations are selected through system dialogs and retained only by the main process; no generic shell or arbitrary-path write API is exposed.

### 2.5 State and rendering flow

1. A user action produces a document command.
2. The engine validates and applies the command as one undoable transaction.
3. Changed objects invalidate their derived render data.
4. Equation and asset services resolve required resources asynchronously.
5. The renderer receives a consistent scene snapshot.
6. Autosave persists the resulting document revision and required assets.

Dragging updates a temporary preview and commits one movement command on release. Editing or changing a font must not create an undo step for every rendered preview frame.

## 3. Document format

### 3.1 Native package

Implemented `.scislide` files are ZIP containers. New saves use format **0.5.0**:

```text
presentation.scislide
  ├─ manifest.json             # Format version, document entry, resource index
  ├─ document.json             # Authoritative slides, objects, themes, and source
  ├─ assets/                   # Imported figures, embedded videos, and redistributable resources
  └─ renders/                  # Successful outlined Local LaTeX equation SVGs
```

The manifest records `formatVersion`, the `document.json` entry, producer information, rendering profiles, and an index of bundled resources. Each resource entry includes its relative path, media type, size and SHA-256 digest. MathJax profiles record the exact engine/font-package versions and options. Local equation records retain source, engine, preamble, intrinsic metrics, an input signature and compiler/converter/dependency metadata; their SVG payloads are stored as indexed resources in `renders/`.

MathJax equations rerender from source and bundled profiles. Local LaTeX equations use the successful saved SVG when its input signature matches the resolved source/style/configuration. Viewing, slideshow playback and export never compile an imported local equation. Missing or stale local results are errors until the user explicitly recompiles. Embedded outlines preserve viewing portability; editable rerendering still requires the recorded packages/fonts in a supported local environment. Optional thumbnails remain future work.

An unpacked folder representation remains a future target for Git workflows. Stable IDs, stable serialization order, and relative asset references should keep source diffs readable. Binary ZIP files themselves are not intended to produce useful line-by-line diffs.

### 3.2 Document model

| Entity        | Required data                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Document      | Format version, ID, title, slide dimensions, theme, page-number settings, slide list, asset registry                      |
| Slide         | ID, title, background, ordered object list, speaker notes                                                                 |
| Common object | ID, type, name, transform, opacity, visibility/lock state, optional flat-group ID, optional click-build record, metadata  |
| Text          | Plain Unicode source, typography, alignment; structured text runs may follow later                                        |
| Equation      | LaTeX source, display mode, optional style overrides, description, renderer and optional local configuration/result       |
| Figure        | Asset ID, alt text and optional normalized crop `{x, y, width, height}`; provenance can use metadata                      |
| Video         | Embedded asset ID, accessible description, playback preferences; no external streaming URL                                |
| Shape         | Rectangle/ellipse/line/arrow geometry; fill or no fill, stroke color/width/style, line endpoints and start/end arrowheads |

Use logical slide units based on CSS pixels at 96 units per inch, independent of viewport zoom or device pixel ratio. The default slide is 1600 × 900 units. Origin is top-left; `x` and `y` locate an object's unrotated frame; rotation is in degrees about its center. Opacity ranges from 0 to 1. Object array order defines stacking from back to front.

For text, figures, and shapes, frame width and height specify layout. For equations, these dimensions are persisted layout hints derived from source and resolved typography; position and rotation remain authoritative. Equation resizing changes font size uniformly. MathJax regenerates the bounds; local equations require explicit recompilation after typography changes. Figure crops use normalized source coordinates, require a nonempty region inside `[0, 1]`, and preserve the original asset. Insets are ordinary independent figure objects sharing that asset. Crop resets and source replacement retain the figure's existing frame.

Line/arrow endpoints define their editable direction and length; their frame follows the resulting geometry. Flat groups share a group identifier within a slide without creating a nested object tree. Group translation preserves each member's size, rotation and relative position. Duplication assigns fresh object and group identifiers. Ungroup removes membership while preserving current object geometry and stacking. Nested groups and collective scaling/rotation are future work.

### 3.3 Illustrative `document.json`

The following is a minimal 0.5.0 source document with a MathJax equation, not a complete ZIP package. Resource hashes and exact rendering-profile versions belong in the manifest. Local equations add `renderer: "local-latex"` and `localTex` configuration/result records, described in section 4.6.

```json
{
  "formatVersion": "0.5.0",
  "id": "deck-001",
  "title": "Scientific presentation example",
  "slideSize": { "width": 1600, "height": 900, "unit": "px96" },
  "theme": {
    "fontFamily": "Inter",
    "equation": {
      "fontSetId": "mathjax-stix2",
      "fontSize": 48,
      "color": "#111827"
    }
  },
  "pageNumbers": {
    "enabled": true,
    "position": "bottom-right",
    "format": "number",
    "startAt": 1,
    "hideFirst": false,
    "fontSize": 22,
    "color": "#657489"
  },
  "assets": [],
  "slides": [
    {
      "id": "slide-001",
      "title": "Phase transition parameters",
      "background": "#FFFFFF",
      "notes": "Explain the energy-density ratio.",
      "objects": [
        {
          "id": "equation-001",
          "type": "equation",
          "name": "Energy-density ratio",
          "transform": {
            "x": 100,
            "y": 200,
            "width": 460,
            "height": 100,
            "rotation": 0
          },
          "opacity": 1,
          "visible": true,
          "locked": false,
          "build": { "step": 1, "effect": "fade", "durationMs": 300 },
          "renderer": "mathjax",
          "latex": "\\alpha = \\frac{\\rho_{\\mathrm{vac}}}{\\rho_{\\mathrm{rad}}}",
          "displayMode": true,
          "style": {},
          "description": "Alpha is the ratio of vacuum to radiation energy density.",
          "metadata": {}
        }
      ]
    }
  ]
}
```

This equation is visible in the editor/export and appears at step 1 during presentation. An empty equation `style` inherits the document's equation defaults. An explicit `fontSetId`, `fontSize`, or `color` overrides that property. Changing a deck default updates inherited MathJax equations; **Use deck typography** removes an equation's explicit overrides. Local TeX fonts are configured in the preamble, not through a MathJax font ID. Changes to inherited local size/color require recompilation.

### 3.4 Validation and compatibility

- The implemented TypeScript validator reads 0.1.0 through 0.5.0. Version 0.1.0 equations migrate to MathJax; 0.1.0/0.2.0 files receive disabled page numbers and no click builds. Later files retain their existing page-number/build and shape/group settings. Existing figures without crop records retain their full source and layout. The next save writes 0.5.0. Unsupported versions are rejected explicitly. Opening does not rewrite the original file.
- Earlier builds supporting only format 0.4.0 or below cannot read new 0.5.0 documents; there is no editable-format downgrade fallback. Save As preserves an older original, and PDF/SVG provides portable rendered output.
- Publish a JSON Schema alongside TypeScript types as a follow-up; schema and application versions are separate.
- Validate unique IDs, references, finite geometry, supported types, and asset integrity before loading.
- Migrate supported older formats through explicit, tested steps; preserve the original file.
- Open unsupported newer formats read-only where feasible, or reject with a clear version message.
- Preserve unknown extension data when supported; never silently discard it on save.
- Bundle figure and video bytes instead of relying on local absolute paths or live URLs. Provenance links are descriptive metadata.
- Define `extensions` namespaces for future objects and metadata; reserved fields retain stable meanings.

### 3.5 Saving and recovery

Native-file save creates a complete package snapshot. Electron Open, Save and Save As use native dialogs; Save reuses the selected document path, and a new deck clears that destination. Atomic file replacement completes before the UI reports success. Exports use a separate destination and do not change the original-document path. Canceled dialogs are not reported as successful saves. A browser fallback reports “download started”; initiation alone cannot prove durable saving.

Workspace recovery uses IndexedDB with a 100 MiB limit for the serialized recovery record. The record contains the committed deck and up to 200 equation drafts, identified by deck/slide/equation IDs and validated before restoration. Unavailable IndexedDB falls back to localStorage, where a smaller runtime quota may prevent recovery. Older localStorage snapshots can migrate into the new recovery store. Initialization completes before the restored editor begins automatic writes; failed reading must not flush the initial deck over unread recovery data. Storage writes report success only after completion and failures remain visible. Web and desktop stores are separate, and recovery does not replace an explicit portable-file save.

Changing equation or slide selection retains unapplied source/style/renderer/engine/preamble drafts. Returning to the equation restores its draft; Apply commits it and removes the associated draft record. Local compiled preview results are not draft recovery data and may need explicit recompilation. Personal libraries and unapplied drafts are workspace data, not portable deck fields. Loading a damaged or unsupported package must not overwrite the current deck. Undo/redo history remains editor state and is not included in the portable file.

## 4. Equation system

### 4.1 Rendering contract

```text
LaTeX source + resolved style + equation renderer/configuration
  → MathJax preview OR explicit isolated Local LaTeX compile
  → Self-contained SVG + width/height metrics
  → Scene placement, slideshow playback, and export
```

LaTeX source is always retained. SVG is a derived cache and export representation. MathJax supports mathematical TeX/LaTeX input rather than a full document compiler; the supported syntax and extension list must be documented. See [MathJax's TeX compatibility notes](https://docs.mathjax.org/en/latest/input/tex/differences.html).

### 4.2 Supported mathematical typography

The delivered MathJax selector exposes three tested bundled font sets:

| Display label | Renderer identifier | Prototype status                                     |
| ------------- | ------------------- | ---------------------------------------------------- |
| STIX Two      | `mathjax-stix2`     | Implemented                                          |
| Fira Math     | `mathjax-fira`      | Implemented; missing glyphs use STIX vector fallback |
| Latin Modern  | `mathjax-modern`    | Implemented; missing glyphs use STIX vector fallback |

MathJax documents these prepared font sets in its [font support reference](https://docs.mathjax.org/en/latest/output/fonts.html). Font assets and dynamically loaded ranges must be available locally for supported offline use. The UI may only list profiles available in the current build.

XITS Math was suggested in the conversation and remains a future typography candidate. Arbitrary OpenType math-font loading needs separate engine support or font-data preparation and is not an MVP promise. Installing a system font or setting a CSS font family does not define a MathJax rendering profile.

Font size and color are object properties. Mathematical bold and italic use supported semantic commands and available glyph variants. Arbitrary weight interpolation and synthetic stroke thickening are not required for the MVP.

### 4.3 Editing behavior

- Insert from a toolbar action and edit by double-click or keyboard command.
- Show a LaTeX source field, live preview, font selector, size, color, and error feedback.
- Debounce preview requests and discard stale responses when input changes.
- Keep drafts separate from the committed object; Apply creates one undoable edit and Cancel restores the previous object.
- Preserve the last valid preview while clearly marking invalid input. Export must resolve or report pending/invalid committed equations.
- Maintain placement after source or font changes; update the intrinsic bounds without silently scaling the formula to fit its old box.
- Provide Copy LaTeX and Copy SVG. SVG paths alone cannot recover the source.

Implemented MathJax syntax includes fractions, roots, integrals, sums, subscripts, superscripts, matrices, aligned equations, Greek symbols and mathematical text. The catalog exposes 17 tested package entries; physics is enabled per equation, and macros are equation-local. A shared document-level macro map remains a future feature. Loading a deck does not enable remote extensions.

### 4.4 Caching and portability

The prototype's MathJax memory cache keys source, display mode, resolved font, size and color; its locked rendering profile is recorded in the manifest. Local TeX uses an exact input signature for saved-render validity and compiler/dependency metadata for traceability. Compiler caches additionally check dependency hashes. Moving or rotating an equation does not require retypesetting it. General shared profile/cache management remains an architecture target.

Use self-contained equation SVGs with local glyph definitions or explicit paths. Global page-level definitions can produce broken references when an equation is copied or exported; local IDs must also remain unique when composing slides. See [MathJax SVG options](https://docs.mathjax.org/en/latest/options/output/svg.html).

Await asynchronous typesetting and all required font resources before committing export output. Missing profiles or glyphs must produce a visible diagnostic. The implemented MathJax adapter supplements individual unavailable Fira/Modern glyphs with STIX vector paths and reports that fallback; it retains the selected primary font. Local stale/missing renders are rejected rather than silently substituted or compiled.

### 4.5 Accessibility and export limits

Retain source and a human-readable description alongside vector output. Supply accessible math semantics to the editor and slideshow when available. MathJax SVG mathematical glyphs are paths, so searchable or selectable math in a PDF is a separate future capability. See [MathJax SVG support](https://docs.mathjax.org/en/latest/output/svg.html).

### 4.6 Implemented Local LaTeX backend

**Status: introduced in Electron v0.2.0 and retained in v0.6.0 on supported Linux system installations.** MathJax remains the default. Local LaTeX is an explicit second renderer for real installed TeX packages, macros and fonts. Installed `.sty` files are processed by the TeX engine, not MathJax's JavaScript parser. See [MathJax's TeX support](https://docs.mathjax.org/en/latest/input/tex/index.html).

| Renderer    | Execution                                                             | Appropriate use                                                                  |
| ----------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| MathJax     | Shared editor with bundled extensions and font data                   | Immediate previews and supported scientific notation without TeX installation    |
| Local LaTeX | Electron main-process adapter launches an isolated installed compiler | Engine-compatible system packages, preambles and TeX/OpenType font configuration |

**Host and capability detection.** The preload exposes only structured `detectTex`, `compileTex` and `cancelCompile` operations alongside file/menu operations. The main process validates the sender and input bounds; there is no generic command or caller-selected compile-output path. Detection checks installed `latex`/`xelatex`, `dvisvgm`, package information through `kpsewhich`, and a real isolation probe. Linux also requires `bubblewrap` and util-linux `prlimit`. Missing engines, converters or isolation are reported without disabling MathJax or saved-result viewing.

**Delivered compile pipelines.** Each job wraps the source and preamble in a bounded, single-page document. The converter emits outlined glyphs with `--no-fonts=1`, normalizes geometry to `px96`, namespaces SVG IDs and returns width/height with the SVG. The editor then validates the passive vector result before accepting it.

| Engine selector     | Implemented pipeline                    | Font/package context                                                |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| LaTeX               | `latex → DVI → dvisvgm → SVG`           | Classic TeX math fonts and engine-compatible installed packages     |
| XeLaTeX             | `xelatex -no-pdf → XDV → dvisvgm → SVG` | `unicode-math` and available system OpenType math fonts             |
| pdfLaTeX / LuaLaTeX | Future                                  | Require a separately validated PDF conversion and isolation profile |

See the [dvisvgm manual](https://dvisvgm.de/Manpage/) for the converter's formats and outlined glyph output. The current UI uses a math-fragment source plus a separate preamble; it does not expose an unrestricted full-document editor. Packages requiring shell escape, external programs or incompatible document structures are outside the delivered scope.

**Compile → Apply authoring.** Each equation explicitly selects MathJax or Local LaTeX. Local mode exposes engine, preamble, source, size and color; font selection belongs in the TeX preamble rather than a MathJax font ID. **Compile with LaTeX** produces a draft preview. **Apply equation** commits that exact successful result as one edit. Opening a deck never compiles it. Changing inputs or switching equations cancels the old job and ignores stale responses. Source, preamble, engine, display mode, size or color changes require a new compile; position/rotation edits reuse the saved outlines. Named shared profiles and automatic background compilation remain future work.

**Local-render records, introduced in format 0.2.0 and retained in 0.5.0.** Equations add `renderer: "mathjax" | "local-latex"` and optional `localTex: { engine, preamble, render }`. The saved render contains intrinsic dimensions, an input signature, engine/converter versions, dependency-file hashes and warnings. Its SVG is stored as a SHA-256-indexed `renders/<equation-id>.svg` resource. The reader migrates old 0.1.0 equations to MathJax, accepts supported older local-render records, and rejects unsupported versions. A valid embedded local render is sufficient for viewing, presenting and exporting without TeX, including in the web editor. Editing and recompiling still require the relevant supported local environment. Missing or mismatched input signatures produce an error instead of exporting stale output.

**Reproducibility.** The compiler cache key includes input, template revision and engine/converter versions. Recorded dependency hashes are rechecked before a compiler-cache hit is used; package names alone are not considered an environment identity. Portable local render metadata retains compiler/converter versions and dependency hashes. Saved vector output preserves appearance even if an engine later changes, while editable rerendering is environment-dependent. The prototype does not bundle a TeX distribution or promise byte-identical future recompilation.

**Execution boundary.** Linux jobs run inside bubblewrap with isolated network/PID/user namespaces, read-only selected system runtime/TeX/font paths and a fresh job directory for writes. Shell escape is disabled. `prlimit` bounds address space, CPU, file size and open files; the worker adds a 20-second job deadline, bounded logs/results, cancellation and cleanup. The main process permits at most two simultaneous jobs. Output SVGs contain only validated, self-contained vector shapes; scripts, event handlers, external references, text/font dependencies and unexpected content are rejected. This boundary uses OS isolation, not source filtering alone.

**Current platform and resource limits.** The tested target is the current Linux system TeX installation. `~/texmf`, home-installed macro/package files and user font folders are not mounted. Arbitrary installation trees outside supported system runtime paths are not guaranteed. macOS and Windows can detect installed executables but intentionally do not enable local compilation until an OS isolation adapter is implemented. MathJax and saved local renders remain usable there. Explicitly selected user resource directories, macOS/Windows isolation, additional engines and signed installers are future work.

**Validation evidence.** The actual Electron host has passed secure-origin/crypto/font/MathJax/native-file checks with renderer sandboxing enabled. An AMS equation compiled through the real preload → main → isolated LaTeX → SVG path with direct vector outlines and retained engine metadata. Compiler tests cover ordinary and OpenType mathematics, installed packages, dependency-aware cache behavior, errors, cancellation, resource validation and isolation boundaries. Document tests cover 0.1.0 migration, portable render resources, sanitization, corruption and stale/missing results. These checks establish a working prototype, not complete three-OS deployment or full LaTeX compatibility.

## 5. Features and requirements

### 5.1 Functional requirements

**MVP** is a release gate. **Next** is Phase 2. **Future** is Phase 3 or later. **Spike** requires an early feasibility decision.

The table defines product requirements, including capabilities beyond the current prototype. Current implementation status is (app v0.6.0; native document format 0.5.0):

| Area                 | v0.6.0 status                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor core          | Slide operations and editable objects, drawing/strokes, flat groups, transforms, internal copy/cut/paste, selectable layers, six-way alignment, equal distribution, smart guides, history and notes                              |
| Starter templates    | Five starter themes: fourteen existing Scientific/Keynote-inspired layouts and a dedicated fifteen-layout Keynote White gallery; theme-specific picker counts and blank slides; editable objects                                 |
| Page numbers         | Deck-wide numbering rendered from current slide order in the editor, player and static exports                                                                                                                                   |
| Animation foundation | Optional ordered click-triggered appear/fade builds; player state is separate from saved content                                                                                                                                 |
| Media                | Embedded MP4/WebM insertion and presentation playback; static PDF/SVG uses a labeled video placeholder                                                                                                                           |
| Figures              | SVG/PNG/JPEG import and PDF page selection as embedded high-resolution PNG, reversible crop, independent enlarged insets and source replacement preserving frame/crop; shared clipping retains vector SVG detail in PDF/SVG      |
| Equations            | Three MathJax fonts and notation examples; inline text formulas with shared baseline/wrapping; explicit Linux Local LaTeX Compile → Apply; portable valid local SVG results; searchable personal library with JSON import/export |
| Presenter            | Separate popup with current build/next-slide previews, speaker notes, navigation and target/elapsed/remaining timer; passive video previews                                                                                      |
| Recovery             | IndexedDB recovery bounded to 100 MiB, up to 200 unfinished equation drafts, localStorage fallback and legacy snapshot migration                                                                                                 |
| Files and output     | Native Electron Open/Save/Save As and PDF/SVG save; browser download fallback; 0.1.0–0.4.0 migration and 0.5.0 archives                                                                                                          |
| Desktop              | Electron host, current-platform apps, unsigned Mac installers and Windows x64 installer/portable ZIP; signing and physical desktop review remain open                                                                            |
| Partial requirements | Inter/Nanum Gothic body fonts; richer group transforms and automatic multi-monitor placement remain open                                                                                                                         |
| Later features       | PDF vector import, linked masters/themes, advanced animation, shared deck macros/linked library entries, citations and native charts                                                                                             |

| ID   | Feature                     | Scope                                                               | Acceptance criterion                                                                                                                                                             |
| ---- | --------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | Slide management            | Implemented; MVP gate                                               | Add, duplicate, delete and reorder slides; order survives reopening                                                                                                              |
| F-02 | Object editing              | Implemented; MVP gate                                               | Insert, select, move, rotate, resize, duplicate, delete and arrange supported objects                                                                                            |
| F-03 | Layout tools                | Implemented subset; MVP gate                                        | Six-way alignment and equal horizontal/vertical edge-gap distribution preserve groups and locked objects; smart guides, grid priority and Alt bypass remain available            |
| F-04 | Text and shapes             | Implemented subset; MVP gate                                        | Drag-drawn rectangles/ellipses/lines/arrows, editable endpoints, start/end heads, no-fill and stroke styles render consistently; modern Korean PDF/SVG text is supported         |
| F-05 | Equation objects            | Implemented; MVP gate                                               | Source remains editable after save/load; font choice and deck inheritance survive reopening                                                                                      |
| F-06 | Figure objects and crop     | Import/crop/replace implemented; provenance later                   | Reversible normalized crops, reset and source replacement preserve original assets and frames; aspect-ratio rendering agrees in editor/player/PDF/SVG                            |
| F-07 | PDF figure import           | Page selection implemented; vector import Next                      | Preview and select one local PDF page, embed the high-resolution PNG in the native archive, cancel without mutation, and preserve replacement frame/crop                         |
| F-08 | History and recovery        | Implemented foundation; MVP gate                                    | Editing commands undo/redo; committed decks and unfinished equation drafts recover within IndexedDB/localStorage limits; failures remain visible                                 |
| F-09 | Native save/load            | Implemented; MVP gate                                               | Assets, video bytes, editable source, build records and page-number settings round-trip without original source files                                                            |
| F-10 | Static PDF/SVG export       | Implemented subset; MVP gate                                        | Final build state and current page numbers export; video remains an explicitly labeled static placeholder                                                                        |
| F-11 | Slideshow and media         | Implemented foundation; MVP gate                                    | Click builds complete before next-slide navigation; presentation video controls work and playback stops on leaving the slide                                                     |
| F-12 | Notes and presenter display | Implemented foundation; physical display review open                | Popup synchronizes slide/build navigation, previews, notes and timer; audience content excludes private controls and presenter videos stay passive                               |
| F-13 | Themes and masters          | Starter themes/layouts implemented; linked masters Next             | Deck typography, background, title layout, research-group logo and footer update consistently; deliberate per-slide overrides survive                                            |
| F-14 | Click builds and animation  | Appear/fade foundation; advanced effects Next                       | Persist order/effect; reverse navigation is deterministic; later exit/move/scale/delay/easing do not mutate source objects                                                       |
| F-15 | Object transitions          | Future                                                              | Separate stable match keys enable unambiguous cross-slide position/scale/rotation/opacity interpolation                                                                          |
| F-16 | Scientific citations        | Next/Future                                                         | BibTeX keys, figure provenance and formatted footnotes round-trip; generate a reference slide and diagnose unresolved entries                                                    |
| F-17 | Reproducible plots          | Future                                                              | Store source/parameters/environment metadata and replace a generated asset without changing its layout                                                                           |
| F-18 | Embedded video              | Implemented foundation                                              | Import bounded local MP4/WebM, validate media type/container, embed bytes and report unsupported decoding without losing the deck                                                |
| F-19 | PPTX export                 | Future                                                              | Document supported mappings and every fallback; retain equation source metadata where feasible                                                                                   |
| F-20 | Beamer/Typst export         | Future                                                              | Export a documented subset and a report of unsupported content                                                                                                                   |
| F-21 | Collaboration               | Future                                                              | Define ownership, synchronization, asset sharing and conflict behavior before implementation                                                                                     |
| F-22 | Desktop application         | Implemented prototype; release gate open                            | Native menus/files, isolated renderer, signed packages and declared OS support pass distribution fixtures                                                                        |
| F-23 | Installed TeX equations     | Implemented Linux prototype                                         | Explicit isolated compile/apply, portable outlines and preserved source/configuration; future OS adapters remain separate                                                        |
| F-24 | Slide page numbers          | Implemented foundation                                              | Configurable deck numbering updates after insertion/reorder/deletion and matches player/PDF/SVG without duplicated text objects                                                  |
| F-25 | Grouping and smart guides   | Flat groups/guides/distribution implemented; richer transforms Next | Group/ungroup/copy preserves geometry, stacking and independent IDs; align/distribute uses group bounds and protects locks; collective scaling/rotation remains planned          |
| F-26 | Enlarged figure insets      | Implemented foundation                                              | An inset references the same source asset with an independent crop/frame; reset and edits do not alter its source figure; supported SVG detail stays vector                      |
| F-27 | Equation library/macros     | Personal library implemented; shared macros Next                    | Named/tagged entries retain source/style/profile and import/export locally; insertion is independent; shared macros/preambles remain future work                                 |
| F-28 | Editable scientific charts  | Future                                                              | CSV data, units and asymmetric error bars remain editable, validated and reproducible after reopening                                                                            |
| F-29 | Installed AI CLI drafts     | Implemented v0.4.0 prototype                                        | Detect compatible Codex/Claude/Gemini CLIs; explicit request, bounded context, schema validation, preview and insert/undo; cancellation and timeout preserve the deck            |
| F-30 | Object clipboard and layers | Implemented foundation                                              | Internal object/group/media copy/cut/paste works across slides/decks in one session; Cut protects locks; hidden/covered objects remain selectable and layer changes are undoable |

### 5.2 Figure workflow

**Implemented:** import sanitized SVG/PNG/JPEG source into the deck asset registry, or preview a local PDF and import one selected page as a high-resolution PNG. The Inspector's Left/Top/Width/Height fields express a normalized region as percentages of the original image. A nonempty region must remain inside the source. Apply crop commits the previewed region to the selected figure; Reset crop removes its crop record. Create enlarged inset instead uses any valid non-full preview region directly, preserving the source figure's existing crop while adding an independent unlocked figure referencing the same asset. Locked/grouped figures disable these controls. No linked crop-edit propagation or automatic caption/connector is created.

Shared crop geometry maps original asset coordinates into an aspect-preserving nested SVG viewport. A source-space clip prevents uncropped content appearing in letterbox margins. The editor/player keep the original embedded image; export inlines supported SVG paths beneath the same viewport/clip while retaining the source SVG's own viewBox/aspect mapping. Raster sources stay raster. Replace figure changes the selected source asset and preserves frame, rotation, opacity and normalized crop; other insets retain their own source references. Crop/inset records survive save/reopen and undo/redo.

Structured publication provenance, captions, source scripts, dates and user parameters remain future extensions of existing metadata. Captions can initially be linked text objects.

Scientific plots should retain readable labels and vector lines where the source permits. The delivered PDF adapter explicitly inserts raster page images; it does not satisfy the later vector-import target. Original PDF vectors, editable PDF text and supported-effect fidelity require a separately tested adapter. Failed decoding or rendering produces an import diagnostic instead of applying an incomplete figure.

Python or matplotlib integration later may use provenance such as `source: simulation.py`, parameter values, environment information, and a generated SVG asset. Execution is a separate future feature, invoked explicitly by the user.

### 5.3 User interface

**Theme-first startup:** open a full-screen chooser with Scientific, Minimal White, Minimal Black, Navy and Keynote White previews. Selecting a card does not modify the existing workspace; Create presentation starts a fresh deck with one editable title slide and no demo assets. An optional `theme.starterThemeId` persists the chosen palette without changing format 0.5.0; Keynote White uses `keynote-white`. Subsequent layouts, blank slides, text and equations inherit the palette, including readable foregrounds on dark backgrounds. Keynote White starts with white backgrounds, black text and bundled Inter typography and opens its dedicated fifteen-layout gallery. The original four themes keep their existing fourteen-layout picker. Open presentation imports a native file, Resume previous work explicitly restores the recovered deck, and Explore demo starts the example deck. New presentation reopens the chooser; Cancel retains the current deck. Do not autosave an unchosen starter over recovered work, and keep file-opening errors visible in the chooser.

**Direct text editing:** double-click an unlocked text box, press Enter on a selected text box, or insert a new Text object to edit on the slide. Use a native plain-text textarea inside SVG slide coordinates, retaining font, alignment, opacity, rotation and zoom. Enter adds a line; Ctrl/Command+Enter or blur applies one undoable edit; Escape discards it. Composition events must allow Korean IME input without premature completion or cancellation. Plain-text paste must not introduce HTML. Save, export, presentation and page-unload recovery flush pending text before taking a document snapshot. Locked objects and members of locked groups cannot enter inline editing. The Inspector remains a secondary text/formatting editor; equation editing continues through the LaTeX inspector.

**Inline mathematics in text:** parse paired `$...$` and `\(...\)` spans in the existing `TextObject.text` string. Keep `\$` as a literal dollar sign; empty or unmatched delimiters and standalone `$$...$$` display spans stay literal. Single-dollar spans do not cross line breaks. Editing exposes the original source, and save/load preserves it without adding fields or changing native format 0.5.0. Examples include `The field $\chi$ has mass $m_\chi$.` and Korean text surrounding the same formulas. The editable [inline math example](examples/inline-math.scislide) demonstrates English/Korean prose, fractions and AMS notation.

Use the bundled MathJax renderer and supported AMS/package profile for inline fragments, inheriting the deck's equation font and the text object's size/color. Resolve ordinary text fonts through the same Inter/Nanum Gothic rules as other text. One shared measured layout aligns math to text baselines, accounts for tall fragments in line heights, wraps whole math fragments with surrounding words and applies the text object's alignment. Match the resolved prose font's measured lowercase `x` height to the math font's x-height by uniformly scaling each fragment's viewport, dimensions and baseline; retain its vector paths and viewBox. If either metric is unavailable, retain the requested size. Line spacing depends on that line's actual ascent/descent, so a tall fraction can expand its line without enlarging every other line. Editor, slideshow and static export must use this layout. Export retains real SVG text for ordinary runs and outlined MathJax vectors for math, with unique SVG IDs and no `foreignObject` or math-font dependency. Invalid math receives an object-specific diagnostic and aborts static export instead of silently dropping a fragment. Bound rendered text objects to 100,000 source characters and 128 inline math fragments. Inline spans do not invoke installed TeX or accept Local LaTeX preambles.

Acceptance: cover multiple fragments, AMS notation, inherited math fonts, text size/color/alignment, mixed Korean/Latin text, fractions/scripts and baselines, narrow-line wrapping, escaped dollars, unmatched/display delimiters, invalid commands, source preservation through archive round trips and genuine SVG/PDF vector output. Ordinary text without math must retain the established wrapping and export path.

**Platform-specific shortcuts:** detect Electron's host platform first, with browser platform metadata as the fallback. Supported actions follow Keynote conventions on macOS, PowerPoint on Windows, and LibreOffice Impress on Ubuntu/Linux. macOS uses Command as the primary modifier and Option for Alt; Ubuntu/Linux and Windows use Ctrl and Alt. Redo is Command+Shift+Z on macOS and Ctrl+Y on Windows/Linux, with Ctrl+Shift+Z retained on both non-Mac platforms. File, clipboard, selection, duplicate, group, presentation, PDF/SVG export and help commands share bindings across renderer handling, native menus and displayed hints. The keyboard shortcut dialog shows the current OS by default and provides reference tabs for all three platforms; changing a tab must not change the active bindings.

**Detailed shortcut contract (revision 0.2, 2026-10-09):** [Keyboard Shortcut Specification](docs/specifications/keyboard-shortcuts.md) records canonical macOS commands against the [English Keynote reference](https://support.apple.com/en-gb/guide/keynote/tanfde4a3e6d/mac), compatibility aliases and intentional differences, focus/IME/media ownership, native menu boundaries, remaining extensions, and acceptance scenarios. It identifies P1 additions in current source as **unreleased**; published 0.6.2 packages remain unchanged. Windows and Ubuntu/Linux retain their existing profiles. The [wiki specification entry](https://github.com/wikicho/SciSlide/wiki/Shortcut-Specification) provides public navigation.

**Unreleased P1 implementation:** one declarative JSON command registry supplies renderer/native-menu bindings, aliases, scope, availability, repeat policy and labels. Tab/Shift+Tab traversal from the focused canvas follows back-to-front stacking order, treats each flat group as one unit, excludes hidden/locked content and exits through native focus order at the boundaries. Inspector and Objects & Layers have independent visibility and focus: macOS uses Command+Option+I / Command+Shift+L; Windows/Linux uses Ctrl+Alt+I / Ctrl+Shift+L. Showing a pane focuses it; hiding it returns to the canvas. Text fields, dialogs and playback retain their input ownership. Polite canvas status announces selected object names/counts, and equation editing reveals Inspector before focusing its source. The main editor synchronizes native menu enabled states from the same availability predicate through optional `desktop.setCommandAvailability`. Preload/host validate bounded fixed command IDs and booleans; only the trusted main editor frame can update menu state. Disabled native commands do not dispatch. Focused text clipboard/history remains native, including modal text controls; application/window role behavior still requires physical-platform checks.

Windows/Linux use Ctrl+M for the new-slide layout chooser, F5 to present from the first slide, Shift+F5 from the current slide, F1 for keyboard help, and Page Up/Down and Home/End for slide navigation. Windows additionally uses Ctrl+Shift+D to duplicate the current slide, Alt+= for an equation, Alt+F5 for the presenter display, Ctrl+G / Ctrl+Shift+G for group/ungroup, Ctrl+Shift+] / [ for one-layer ordering, Ctrl++ / - for zoom, Ctrl+Alt+O to fit the slide, and Ctrl+Shift+> / < for text size. Ubuntu/Linux uses Shift+F3 for an immediate duplicate, Ctrl+Shift+G / Ctrl+Alt+Shift+G for group/ungroup, Ctrl+Num + / Ctrl+- for one-layer ordering, Ctrl+Shift+Num + / Ctrl+Shift+- for front/back, bare + / - for zoom, numeric-keypad * to fit, and Ctrl+] / [ for text size. Here Num + means numeric-keypad Add, the canonical Linux layer-forward/front binding; main-row Ctrl+= / Ctrl+Shift+= also performs those two actions. Its Alt+Shift+E equation command also accepts Ctrl+Alt+=. Both non-Mac platforms use Ctrl+B and Ctrl+L / E / R for whole-text-object bold and alignment. SciSlide export commands remain separate from presentation commands.

Slide movement shortcuts require thumbnail focus: the unreleased macOS profile uses Command+Option+Up/Down for one position and Command+Option+Shift+Up/Down for first/last, without native accelerators that could interrupt text caret movement. Windows uses Ctrl+Up/Down and Ctrl+Shift+Up/Down for one step and first/last; Linux uses Alt+Shift+Page Up/Down and Alt+Shift+Home/End, with Ctrl+Shift+Up/Down/Home/End aliases. Arrow and delete thumbnail navigation works on all platforms. Canvas arrows retain object movement, and editable controls retain text navigation. Linux Ctrl+Shift+G now groups; Ctrl+G remains a group alias. Ctrl+Enter remains a present-current alias outside inline editing. During Windows/Linux slideshows, Enter advances and Backspace reverses a build or slide; Windows also accepts N/P, and Linux accepts - to exit. The unreleased focused-thumbnail duplicate fix targets that slide even with a stale canvas selection, focuses its copy and creates one undoable mutation. Thumbnail navigation/deletion and presentation navigation/endpoints/exit ignore auto-repeat; canvas nudge may repeat. A common audience/presenter resolver leaves all keys, including Escape, with editable/media controls and leaves Space/Enter with buttons. Plain Escape exits from playback focus. Shift+arrow preserves existing build semantics; other shifted playback keys are ignored. Separate slide/build navigation, pause/blank-screen state, a numeric slide chooser and richer presenter controls remain P2 requirements.

Acceptance: use exact modifier matching, ignore IME composition and AltGraph input, and recognize physical letter keys when a non-Latin input layout is active. Keep native text cut/copy/paste/select-all/undo/redo behavior inside editable controls; route the same commands to the internal object clipboard and document history only from the canvas. Dialogs, the theme chooser and presentation media controls must prevent unrelated object edits. Command/Ctrl+Enter finishes inline text before any Present action. Save includes pending text, Save As uses a separate destination, and export shortcuts retain ordinary export validation. Native menu command allowlists must stay consistent with the renderer's typed command API, without introducing arbitrary scripts or filesystem access. Regression fixtures cover macOS, Ubuntu/Linux and Windows bindings, Windows Redo aliases, native clipboard dispatch and fullscreen suppression while editing.

```text
+------------------------------------------------------------------+
| Toolbar: Insert · Arrange · Equation · Theme · Present · Export     |
+--------------+-----------------------------------+-----------------+
| Slide        | Canvas                            | Object          |
| thumbnails   |   Editable slide and guides       | inspector       |
|              |                                   |                 |
|              |                                   | Source/style/   |
|              |                                   | transform       |
+--------------+-----------------------------------+-----------------+
| Notes, zoom, selection details, and save status                    |
+------------------------------------------------------------------+
```

The equation inspector exposes source, live preview, font, size, and color together. Keyboard commands, labeled controls, visible focus, and numeric movement controls must make essential editing possible without relying solely on dragging.

The v0.2.0 inspector also selects MathJax or Local LaTeX. Local mode exposes engine and preamble and separates Compile from Apply. The desktop menu uses native file commands; browser mode retains downloads. Opening a document displays saved local output without running its source.

Since v0.2.1, New slide and the navigator's add buttons open a preview-based layout picker. Choosing a Scientific layout inserts a new slide after the current slide as one undoable operation, with independent object IDs and no external assets. Text, shapes, equation source and figure placeholders remain ordinary editable objects. Blank slides remain available. Escape or backdrop dismissal cancels without changing the deck. The picker supports keyboard focus and narrow screens; linked masters and custom template authoring are future work.

**Starter-layout extension in v0.5.2:** retain Research title, Key findings, Equation + meaning and Figure comparison, and add Section divider, Methods pipeline, Results spotlight and Takeaways + next steps. The eight layouts plus Blank cover transitions, a three-step method with editable arrows, a main figure with metric/interpretation, and a closing summary. Text uses the current deck body font, and example equations inherit the deck's equation font/color. Figure areas are explicitly labeled editable shapes and text, with instructions to add an actual figure and remove the placeholders. Template metrics and scientific copy are replaceable prompts. No layout bundles an imported media asset, fetches remote content or creates a linked master. The layout extension used existing object types and retained format 0.4.0 at that release; current saves write 0.5.0.

Acceptance: each catalog entry has a usable preview and inserts after the current slide with fresh slide/object IDs. Repeated insertions are independent and undoable; editing, save/reopen, presentation and PDF/SVG use ordinary scene objects. Check default and custom deck fonts, arrow geometry, slide bounds, labels, figure-placeholder instructions, and readable content in wide and narrow picker layouts.

**Keynote-inspired extension in v0.5.3:** add Minimal White, Minimal Black, Minimal White findings, Minimal Black findings, Color Statement and Figure Showcase while retaining all eight Scientific layouts and Blank. Minimal White uses a left-aligned title and whitespace; Minimal Black centers its title on black. Their findings layouts provide three clean columns. Color Statement uses deep navy, and Figure Showcase places a large isolated visual above an uppercase caption on a pale background. All layouts use the current deck body font.

The visual reference is [Apple's official Keynote theme chooser guide](https://support.apple.com/guide/keynote-icloud/create-a-presentation-gil310ef8e21/icloud) and its theme-chooser illustration: basic white/black typography, centered white/black title compositions, a deep navy color theme and an isolated showroom visual. SciSlide supplies original editable text and shape geometry. Figure Showcase's orbital illustration consists of native editable shapes; users can add their own image through Figure and remove the illustration objects. Template content is generated locally through the existing object model.

The picker offers All layouts, Scientific and Keynote-inspired filters, with a count reflecting the displayed layouts; Blank remains a separate insertion option. Switching categories must retain keyboard access and clear preview labels. [keynote-inspired-templates.scislide](examples/keynote-inspired-templates.scislide) contains the six added layouts as editable native slides, while [additional-templates.scislide](examples/additional-templates.scislide) retains the section/methods/results/closing sample. These layouts use existing text/shape objects; opening older sample decks and saving them now produces format 0.5.0.

**Keynote White theme family:** add a fifth starter theme with a coordinated white/black palette and fifteen original layouts: Title, Title & Photo, Title & Photo Alternate, Title & Bullets, Bullets, Title, Bullets & Photo, Title, Bullets & Small Video, Title, Bullets & Large Video, Section, Title Only, Agenda, Statement, Important Fact, Quote and Three Photos. The supplied Keynote layout reference informs composition and hierarchy; it does not supply bundled photographs or application assets. Latin text defaults to bundled Inter, and supported Korean retains the existing Nanum Gothic resolution. Keep the prior four themes and fourteen layouts available with their existing behavior.

New slide resolves the gallery from the persisted starter theme. A Keynote White deck shows only its fifteen coordinated layouts plus the common Blank option; other themes show the existing categorized picker. The displayed count must reflect the active gallery. All generated text, shapes and labeled media placeholders remain editable, with independent IDs, ordinary history, source persistence and export behavior. Photo/video layouts import no media and make no network requests. Users add their own figures or MP4/WebM videos; small/large video composition does not introduce live-camera support. This is a starter-theme family, with linked master propagation and custom template authoring still planned.

Selecting one Photo frame, icon or label before Figure import replaces that placeholder and its associated icon/label with a figure at the same position and size. Apply a reversible centered crop to fill the frame; the ordinary figure tools adjust or reset it. PDF page selection captures the same placeholder destination before decoding and fills it only after the chosen page is inserted. Selecting one Video placeholder before Video import replaces it with an imported MP4/WebM object in the same frame. When no single matching placeholder is selected, including an ambiguous multi-slot selection, import uses ordinary free-placement insertion. The replacement must remain one undoable edit and preserve the normal stale-destination and locked-object guards.

The editable sample [keynote-white-theme.scislide](examples/keynote-white-theme.scislide) contains all fifteen layouts in native format 0.5.0, with the persisted theme identity, ordinary text/shapes and no bundled media. Its archive is generated and round-trip checked through the application's document builder and reader.

Acceptance: verify all five startup choices, `keynote-white` validation/save/reopen, consistent white backgrounds/black typography, fifteen usable layout previews, theme-specific counts and Blank inheritance. Repeated insertion must create fresh IDs and one undo step; moving/editing/removing placeholders, presenting and PDF/SVG export must use the normal scene. Cover selected-frame/icon/label image import, centered crop/reset, PDF page insertion, video-frame replacement, ambiguous selection, cancellation, locked/stale destinations and undo/save/reopen. Check wide/narrow picker navigation and ensure existing four-theme and fourteen-layout fixtures remain valid. No Apple photo assets or live-camera capability may be inferred from the reference.

### 5.4 Animation model

**Implemented foundation:** objects may have an optional `build: { step, effect, durationMs }` record. Step 0 (or no record) is visible from slide entry; steps 1–100 reveal content on successive populated click steps. Effects are appear or fade, with a bounded 100–3000 ms duration. Objects in the same step are revealed together. The editor and thumbnails show the complete layout. During presentation, forward navigation reveals the next ordered step before changing slide; backward navigation restores the previous build state. Forward entry starts at step 0; backward entry into the previous slide restores that slide's final build state. Sparse step numbers do not require empty clicks. Static exports use the complete final visible build state.

Build state belongs to the player and never changes source visibility, transforms, opacity or history. Save/load, object duplication, slide duplication and slide reordering must retain or deliberately remap build records. Hidden objects do not become visible merely because a build is triggered. Page numbers remain visible independently of object builds. Media clicks and playback controls must not accidentally advance a build.

**Planned extension:** explicit triggers (click, with previous, after previous), exit effects, motion/scale, per-effect timing, delay, easing, a build-order panel and optional cross-slide match keys. Preserve existing appear/fade records through migrations. Reduced-motion users must receive an immediate state change instead of requiring animation to understand content.

Equation derivations initially use successive editable equation objects, optionally grouped at one step. Per-term highlighting, equation-step editing and glyph morphing require a separate semantic model; whole equations and compiled SVGs must not be treated as freely editable glyph trees without that design.

Static PDF/SVG export resolves the final state and cannot play animation or video. Exporting one page per build is a later option. A future slideshow/video exporter needs a separate capability contract. Cross-slide transitions use optional match keys rather than reusing document object IDs; initial transitions would interpolate position, uniform scale, rotation and opacity.

### 5.5 PDF export requirements

Default text fonts must be bundled with appropriate redistribution rights. Custom text fonts require embedding where permitted or a clearly identified substitution; relying on an unrecorded system font cannot satisfy portable layout. Fonts used for Unicode text must cover the document's actual characters.

The exporter must:

1. Freeze a document revision and resolve its scene.
2. Wait for equations, text fonts, figures, and other supported resources.
3. Validate clipping, glyph availability and supported object types; resolve final builds and dynamic page numbers, and use labeled static video placeholders.
4. Produce the requested page size with no editor controls, browser headers, or unintended margins.
5. Report missing or unsupported content before producing a file presented as complete.

Acceptance fixtures must confirm vector equation paths, supported SVG figure paths, readable text, correct colors, and crop/rotation fidelity. Raster source images and imported PDF page images remain raster; the delivered PDF importer does not preserve original PDF drawing commands. A browser-print or SVG-to-PDF approach is acceptable only after it meets these checks; visual resemblance in the editor alone is insufficient.

### 5.6 Quality targets

These are proposed engineering targets, to be measured against a published reference machine and representative 30-slide deck rather than treated as existing benchmarks. The equation-preview latency target concerns MathJax; explicit local TeX jobs have a separate bounded compile workflow and are not promised to meet 500 ms.

| Area                | Target                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Interactive editing | Smooth dragging near 60 fps for a visible slide with up to 100 ordinary objects                    |
| Equation preview    | Typical equation preview within 500 ms after debounce, with resources already loaded               |
| Recovery            | Autosave a completed revision within 5 seconds of an idle edit; show storage failures              |
| Portability         | Reopen packaged assets and cached equations without their original source paths                    |
| Offline use         | Core authoring, presentation, and supported resources work after the app has been installed/cached |
| Accessibility       | Essential controls support keyboard use, visible focus, and meaningful labels                      |
| Browser support     | Establish a tested browser/version matrix in Phase 0; expand it based on fixtures                  |

### 5.7 Embedded video and media policy

**Implemented foundation:** local MP4 and WebM files become embedded video assets referenced by video objects. Preserve original bytes in the native archive with MIME, dimensions, byte size and SHA-256 integrity records. A video's container is not a promise that every codec inside it can be decoded; supported playback follows the installed browser/Electron runtime. Unsupported or damaged video must show a useful error while preserving the rest of the deck. Remote streaming links, transcoding, trimming, subtitles, timeline synchronization and video export remain future work.

The editor and thumbnails show a static video placeholder. Playback controls are available only in presentation mode; no media starts when a file is opened or a thumbnail is rendered. Leaving a slide, leaving presentation, or hiding media stops playback and releases the relevant resources. User-initiated playback must remain available when runtime autoplay policies prevent automatic playback. A slide with multiple videos should keep its controls usable without accidentally advancing builds.

Enforce a 40 MiB per-video limit, 64 MiB native archive limit, and 100 MiB expanded-resource limit before expensive processing. Media counts toward native-save and recovery quotas; report a failed save/recovery instead of claiming it succeeded. The implementation's limits are documented in the README and validated by regression fixtures. Local paths and network URLs are never required after a successful native save. Do not upload or fetch videos automatically.

Acceptance: import a small valid MP4 and WebM, move/resize the video, save and reopen after deleting its source file, then present with audio/playback controls. Changing slides must stop playback. Bad signatures, oversized files, missing asset references and unsupported decoders produce actionable errors. PDF/SVG export includes a clearly labeled static placeholder, not silently missing content or a promise of playback.

### 5.8 Page numbers, themes and linked masters

**Implemented foundation:** an optional `pageNumbers` deck record contains `enabled`, `position`, `format`, `startAt`, `hideFirst`, `fontSize` and `color`. Placement is bottom-left, bottom-center or bottom-right; formatting is a number or number/last-number pair. New decks enable bottom-right numbers starting at 1; 0.1.0/0.2.0 files retain unnumbered appearance unless the user enables numbers, while 0.3.0 files preserve their settings. Numbers derive from current order and are resolved by the shared scene, so adding, duplicating, deleting and reordering slides updates the editor, presentation and static exports. Hiding the first number preserves its place in the sequence rather than subtracting it from subsequent numbering. When numbering starts above 1, the denominator is the final displayed slide number. Numbering is separate from ordinary text objects; it must not create extra editable objects on every slide. Preserve settings in format 0.4.0, undo/redo settings changes, and keep numbers legible at the selected placement.

**Planned themes/masters:** define named masters with title/body styles, background, research-group logo and footer. Apply a master to selected slides or the whole deck, with explicit override/reset behavior. Section numbering, per-slide suppression beyond the first slide, custom footer tokens and custom number templates may extend the basic numbering settings later. Page numbers must not be copied into master assets as fixed text.

Acceptance: change deck numbering, reorder slides and export; all numbers and totals match. For linked masters, changing one logo/title style updates inherited slides, retains intentional overrides and can be undone without changing unrelated equation source.

### 5.9 Grouping, smart guides and distribution

**Implemented foundation in v0.5.0:** Shift+click selects objects for Group/Ungroup. Ctrl+G groups and Ctrl+Shift+G ungroups, with Cmd equivalents on macOS. A flat persistent group selects and translates its members together without changing individual size/rotation. Ungroup preserves current geometry and stacking; duplication remaps object IDs and group IDs so the duplicate remains independent. Ungroup before editing an individual member's size, rotation or line endpoints. Group membership survives save/open and undo/redo. Nested groups and collective group scaling/rotation remain future work and require explicit transform/reference rules.

**Smart-guide extension in v0.5.1:** moving an object, selection or group compares its visible bounds with stationary visible objects and the slide center. Bounded lines show matching edges and centers. Equal-gap guides label horizontal/vertical distances when placing an object between aligned, nonoverlapping neighbors or continuing an existing row/column. Measure the gaps between edges so differently sized objects can share the same spacing; unrelated rows/columns and overlapping gaps must not produce a spacing match.

Resizing an independent, unrotated text, figure, video, rectangle or ellipse can match the width/height of another independent, unrotated object or align the resized edge. Figures/videos retain their aspect ratio, and Shift preserves the ratio for other supported objects. A constrained resize chooses a compatible dimension match and adjusts the other dimension consistently. Equation resizing changes font size and does not use dimension matching; rotated-object resize guides are deferred. Rotated objects remain eligible for movement alignment through their axis-aligned visible bounds.

Snapping tolerance is measured in screen pixels and converted to slide units so guides behave consistently across zoom levels. The toolbar control disables smart guides; Alt bypasses them during a gesture. The separate Snap to 20 px grid control takes precedence. Guides and measurement labels belong only to the active edit and must disappear on release or cancellation; they never appear in saved content, thumbnails, presentation mode or exports.

**Implemented layout commands:** the toolbar and Inspector ARRANGE section provide left/center/right/top/middle/bottom alignment and equal horizontal/vertical gaps. Alignment uses the visual bounds of editable objects or flat groups. One unit aligns within slide margins; multiple units align within their combined bounds. Horizontal/vertical distribution requires at least three editable units and enough room for nonnegative equal edge gaps. It keeps the first/last units anchored, supports different sizes, and treats a group (including hidden members) as one unit. Locked objects/groups remain unchanged. Each command is one undoable edit.

**Implemented clipboard/layers:** Copy and Paste retain native object data, media and group geometry, remapping object/group/asset IDs as needed across slides or decks in the same editor session. Identical media already present in the target can be reused; repeated pastes use increasing offsets. This is an internal object clipboard, separate from normal text-field copying. Copy permits locked objects; Cut omits locked objects/groups. The object/layer list at the top of the Inspector exposes hidden/covered objects for selection, naming, visibility, locking and stacking controls. Moving a group through layer order retains its member order.

Acceptance for the delivered subset: group a figure/caption/equation, translate it, duplicate, undo and ungroup; member positions, group independence and layer order remain correct after save/reopen. Move text/figures to matching centers/edges and equal gaps with differently sized neighbors. Resize text to a matching width/height and a figure to one matching dimension without changing its ratio. Verify zoom behavior, deterministic competing matches, hidden-reference exclusion, Alt/grid/toggle bypass, cancellation, one undoable commit and absence of guides from saved/presented/exported output. Future collective transforms must preserve equation aspect ratios and pass separate acceptance fixtures.

### 5.9.1 Scientific drawing

**Implemented foundation in v0.5.0:** select Draw rectangle, Draw ellipse, Draw line or Draw arrow and drag to create a shape; Shift constrains squares/circles or line direction, and Escape cancels creation. Selected lines/arrows expose draggable endpoints. The Inspector supports solid/dashed/dotted strokes, stroke color/width, no-fill rectangle/ellipse outlines and arrowheads at either or both endpoints. These native shapes remain editable after reopening and render through the shared editor/player/PDF/SVG scene.

Attached connectors that automatically follow object anchors, Bézier paths, freehand drawing and a path editor are future work. They require endpoint/anchor behavior for moving, resizing, duplicating and deleting attached objects; a static arrow does not imply an attached connector.

### 5.10 Equation library and shared macros

**Implemented personal library:** My equations saves named entries with editable source, description/tags, renderer profile, style and optional local engine/preamble. Entries can be searched and edited locally, and JSON import/export transfers them between web/desktop environments. Desktop JSON export uses a bounded native save dialog; the browser starts a download. MathJax previews remain live; Local LaTeX entries display a compile-after-insertion message and contain no executable cached preview. Import does not compile source. Inserting an entry creates an independent equation with fresh identifiers; editing the library entry does not change prior insertions. The selected equation's current Inspector draft can initialize an entry. The bundled Math package library remains a separate notation-example catalog.

**Planned shared settings:** linked library entries, deck-level macros and shared preambles remain future work. Linked updates must make propagation explicit.

Provide distinct deck-level MathJax macro definitions and Local LaTeX preambles. Equation-local overrides remain possible, with a documented precedence order and conflict diagnostics. MathJax only accepts its supported parser/macros/extensions; it cannot load arbitrary installed `.sty` files. Local LaTeX runs the shared preamble only through the existing explicit isolated compile workflow. Deck-level settings must never leak to another deck or equation whose resolved profile differs.

Cache keys include the resolved macro/preamble content and renderer profile. Changing a shared setting rerenders affected MathJax equations and marks affected local results stale until explicitly recompiled. A valid saved outline still records the configuration that produced it. Acceptance fixtures cover repeated equations, library insertion independence, macro name conflicts, renderer switching and save/reopen with affected-cache diagnostics.

### 5.11 Separate presenter display

**Implemented foundation:** Presenter display opens a separate window alongside the audience slideshow. It shows the current slide/build, next slide, existing speaker notes, elapsed/remaining timer and navigation. The presenter can set target minutes and pause/resume/reset its timer. A single audience controller synchronizes slide/build navigation with the presenter through a session-specific channel. The current presenter preview follows click builds; both previews use passive video placeholders so media plays only on the audience display. No speaker notes or private controls appear on the audience display or in ordinary PDF/SVG export.

The user moves the presenter window to the desired display; automatic multi-monitor placement remains future work. The browser may require popup permission. Closing the presenter window leaves the audience slideshow running, while ending the slideshow closes the presenter. Ordinary Present supports a single display. Electron admits only the bounded internal presenter popup and retains its normal renderer isolation. Physical multi-monitor placement/fullscreen behavior needs platform review. Acceptance covers navigation/build synchronization, passive media previews, timer pause/resume/reset, popup failure and disconnect handling.

### 5.12 Citations, BibTeX and figure provenance

**Planned:** maintain a deck bibliography with stable citation keys, structured title/author/year/identifier fields and imported BibTeX source. Connect figures to a paper, DOI/URL, figure/page number, license, source filename and user-supplied notes. Generate citation footnotes and a reference slide from the cited entries, retaining manually entered information when it cannot be parsed.

Import is local and does not automatically browse or upload manuscripts. Optional online metadata lookup would require a separately declared service/action. Duplicate keys, unresolved citations, invalid BibTeX and missing publication fields receive diagnostics; a reference slide must not invent missing metadata. Style changes affect generated citation text without discarding original keys or source. Acceptance covers import, key conflicts, figure provenance, generated references, reorder/delete and save/reopen.

### 5.13 Editable charts and Korean PDF text

**Planned charts:** import CSV into a typed data table and create line/scatter/bar chart objects with explicit columns, axis labels, units, scale type, legends and symmetric/asymmetric error bars. Retain data and chart configuration as source; numeric parsing, missing values and invalid log-scale data need diagnostics. Presentation/export use the same rendered chart scene. The first implementation does not execute Python or arbitrary formula code. Reproducible external plot tooling remains a separate explicit workflow.

**Implemented in v0.4.1:** bundle unmodified Nanum Gothic Regular/Bold TrueType files under SIL OFL 1.1, with copyright, full license, pinned source and checksums. Text objects containing Korean resolve to Nanum Gothic; Latin-only text retains Inter. Korean weight 500 maps to Regular and 600 to Bold, matching editor/player/export metrics. Modern decomposed Hangul is normalized to NFC for rendering without changing editable source. PDF embeds font subsets and retains selectable text and vector equations; SVG embeds needed fonts and the full Nanum license. Validate mixed Hangul/Latin, weights, wrapping, rotation, imported figure captions and font availability. Both faces cover all 11,172 modern precomposed syllables; Hanja, standalone combining/old Jamo and other missing glyphs remain unsupported and fail explicitly. Additional script coverage and user-defined body fonts remain future work.

### 5.14 Installed AI CLI content generation

**Implemented foundation in app v0.4.0:** the Electron AI draft dialog detects compatible installed Codex CLI, Claude Code and Gemini CLI executables. A GUI chatbot installation does not itself supply this interface. CLI authentication and service access remain managed by the vendor CLI; discovery checks executable/version/capabilities, not account validity. The web editor explains that desktop execution is required.

An explicit Generate action sends a user topic and requested slide count (1–12). Including the current slide is optional; context contains only visible text/equations and notes, capped at 16,000 characters, with a transmission preview. No media bytes, local file paths, private metadata, local compiler preambles or unrelated deck content are included. Provider network access, data policies, limits and account charges apply. No content is sent on opening a deck or detecting CLIs.

Generation uses a fixed headless provider adapter, stdin, a private temporary working directory and a strict content schema. Output may contain only a presentation title and slides with title, up to six bullets, one optional equation and notes. It cannot specify executable code, arbitrary object geometry, scripts, local TeX, images, files or integrations. Main-process IPC validates the caller and request; it accepts provider identifiers, not executable paths or command lines. Windows npm launchers resolve only known vendor entries with an installed Node executable and never run a command shell.

Codex uses read-only enforcement, disabled shell/image/web/MCP/hook integrations and isolated configuration. Its remaining patch utility is subject to read-only enforcement; this is not a claim that all Codex tools are absent. Compatible Claude/Gemini content modes disable tools. Gemini configuration is isolated from user customizations while retaining organization controls; known vendor authentication files are referenced by private temporary links without parsing or copying credential contents. Incompatible or conflicting configurations fail closed. SciSlide neither changes CLI login nor lowers OS/vendor security controls.

One job runs at a time with a three-minute deadline, bounded process output and prompt/context limits. Cancel, closing the dialog and app shutdown terminate the process tree and remove job files/authentication references. JSON, allowed fields and bounds are validated, and MathJax equations are pre-rendered and fitted before the draft is offered for insertion. Responses cannot execute instructions embedded in imported deck data.

Users review the proposed slides and notes before insertion after the current slide. Existing content stays intact; normal undo restores the preceding deck. A changed document/source slide invalidates application of a stale draft. Generated objects are editable native text/MathJax objects with fresh identifiers in the current 0.5.0 document format. Review scientific assertions and references, since the integration does not establish correctness or perform research.

Acceptance: cover missing/incompatible/unauthenticated CLIs; leading flags and file-reference text in prompts; shell/MCP/hook restrictions; native Windows launcher handling; malformed/oversized responses; mathematical errors and bounds; cancellation/timeout/process cleanup; late replies and changed source slides; insert/undo and save/reopen. Actual vendor-account generation and physical-platform UI coverage must be reported separately from mocked adapter tests. Later work may add model selection, conversational revisions, references/research with explicit data permissions, image generation and direct API profiles.

### 5.15 Local SVG and PDF figure import

**Implemented subset:** the toolbar **Figure** action and the Inspector's **Replace figure** picker accept local PNG, JPEG, SVG and PDF files, up to 20 MiB each. PNG/JPEG keep their raster content. SVG import sanitizes scripts, event handlers, active elements and external resource references while retaining supported self-contained vector geometry. Ordinary flat scientific-plot CSS becomes presentation attributes; validated embedded-only TTF/OTF/WOFF/WOFF2 font rules retain text appearance, including SciSlide-exported SVG figures. Font rules allow only recognized descriptors and one base64 font source with a matching binary signature; remote/mixed sources, escaped CSS, expressions, nested rules and unsupported declarations are rejected. Font resources are bounded to 8 MiB each, 16 MiB total and 16 rules, within the overall figure-file limit. Sanitized SVG assets remain vector sources in the editor, native archive and supported PDF/SVG exports.

A PDF opens a page chooser with a local preview. Select one page and explicitly insert it; opening or canceling the chooser must not alter the deck or its history. Bundled PDF decoding/rendering resources work offline without uploading the file or requiring a separately installed PDF program. The chosen page is rendered as a bounded high-resolution PNG and embedded as an ordinary figure asset in `.scislide`; the original PDF is not required after save/reopen. The delivered subset does not retain original PDF vectors or editable PDF text. Original vector preservation remains a later capability.

Imported figures use existing move/resize/rotate, crop, inset, layering and export behavior. PDF source replacement preserves the existing figure's frame, rotation, normalized crop, alt text and other object properties. Replacement requires an unlocked independent figure. Capture the destination deck/slide and replacement object before asynchronous decoding; reject changed, removed or locked targets without adding orphan assets. Successful insertion or replacement is one undoable operation.

Acceptance: cover SVG with supported vector geometry and active/external content, valid single/multipage PDFs, page navigation/preview, selected-page insertion, cancellation, malformed/oversized documents, bounded rendering, stale destinations and locked replacement targets. Save/reopen embeds the selected PNG and sanitized SVG without their original paths, and editor/player/PDF/SVG use the same figure/crop geometry. Record actual PDF page rasterization separately from the existing vector export guarantees.

## 6. Development roadmap

The conversation suggested roughly 1 month for a prototype, 3 months for a scientific MVP, and 6 months for richer presentation features. These are provisional effort windows for each phase, not fixed delivery dates; staffing and feasibility results will determine a calendar.

| Phase                                                                 | Deliverables                                                                                                                                                                                                                                                                                                                                  | Exit criteria                                                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **0 — Prototype and decisions** (initial estimate: ~1 month)          | Delivered editor/AI drafts, five starter themes with existing fourteen layouts and fifteen Keynote White layouts, bundled fonts/vector export, format 0.5.0, Linux local compile, drawing/groups/guides, clipboard/layers/layout commands, crop/insets, PDF page figures, personal library, draft recovery, presenter, video and click builds | Core choices recorded; publication/license and complete release review remain open                          |
| **1 — Scientific MVP** (initial estimate: ~3 months after Phase 0)    | Harden delivered author/save/recovery/crop/layout/presenter workflows, Korean typography, richer group transforms and representative scientific-deck fixtures                                                                                                                                                                                 | Author/save/reopen/edit/present/export release gates pass on the declared support matrix                    |
| **2 — Presentation workflow** (initial estimate: ~6 months after MVP) | Advanced animation, linked masters/themes, shared macros/linked equation entries, PDF vector import, broader presenter/display support and distribution improvements                                                                                                                                                                          | Shared content matches editor/player/export; signed packages and selected OS adapters pass fixtures         |
| **3 — Research integration** (unscheduled)                            | BibTeX/provenance/references; CSV scientific charts/error bars; reproducible plot tooling; PPTX/Beamer/Typst export; collaboration experiments                                                                                                                                                                                                | Each feature has a documented capability subset, acceptance fixtures, and an approved architecture proposal |

The Electron host and isolated Linux Local LaTeX backend are implemented in the v0.2.0 prototype. Remaining local-compiler work includes macOS/Windows isolation, explicitly authorized user package/font directories, broader installation detection and additional engine profiles. The roadmap does not commit to a Tauri migration. The initial effort estimates are historical planning figures, not promises or a measured completion timeline.

### 6.1 MVP release checklist

The working prototype supplies much of the core behavior, but these are full release gates and require representative fixture and platform review before declaring an MVP release.

- [ ] Create a deck containing scientific text, vector figures, basic shapes, and equations.
- [ ] Switch between STIX Two and Fira, including mixed fonts on one slide.
- [ ] Edit formulas after moving, rotating, saving, and reopening them.
- [ ] Change a deck default without unintentionally replacing explicit object overrides.
- [ ] Undo/redo source, typography, layout, slide, and asset operations.
- [ ] Reopen on another supported installation with no original asset directory.
- [ ] Recover an autosaved deck after an interrupted session.
- [ ] Show actionable feedback for invalid equations and missing resources.
- [ ] Export a representative deck with verified vector equations and supported vector figures.
- [ ] Review the delivered raster PDF page-import subset and its fixtures; document vector preservation as later work.
- [ ] Publish setup instructions, examples, format documentation, and the selected license.

### 6.2 Next implementation sequence

1. Select the project license and document publication/contribution boundaries.
2. Publish format 0.5.0 schema and 0.1.0–0.4.0 migration documentation with crop/inset, drawing/group, mixed-renderer, video, page-number and build fixtures.
3. Broaden body-font script coverage and review editor/player/export typography together; modern Korean support is implemented.
4. Profile bounded IndexedDB recovery/draft preservation on representative media decks; consider a separate asset/cache store where measurements justify it.
5. Add richer group transforms and evaluate PDF vector page/region import; add attached connectors/freehand drawing through separate geometry requirements.
6. Validate desktop packaging, signing and OS support; implement additional local compiler isolation adapters separately.
7. Extend click builds with an order panel and advanced effects; add linked themes/masters and shared macros/linked equation entries, and review physical multi-monitor presenter behavior.
8. Add citations/BibTeX/figure provenance and editable CSV charts with units/error bars through documented capability subsets.
9. Profile representative decks, reduce font-loading cost and complete the release checklist before Office conversion/collaboration work.

## 7. Development notes

### 7.1 Current implementation layout

The working implementation lives at the repository root. This is the delivered layout rather than a future monorepo:

```text
SciSlide/
  ├─ desktop/
  │   ├─ main.cjs             # Window, native menu/files and scoped IPC
  │   ├─ preload.cjs          # Narrow isolated renderer bridge
  │   ├─ host-utils.cjs       # Origin, resource and request validation
  │   └─ tex.mjs              # Installed compiler detection and Linux isolation
  ├─ src/
  │   ├─ App.tsx              # Editor, history and equation draft workflow
  │   ├─ components/          # Shared scene and math package dialog
  │   └─ lib/                 # Model, archive, renderers, assets and exports
  ├─ scripts/                 # Desktop development and packaging launchers
  ├─ tests/                   # Document, rendering, packaging and compiler checks
  ├─ examples/                # Scientific demo decks and vector outputs
  ├─ public/fonts/            # Bundled PDF body-text fonts
  ├─ third-party-licenses/    # Dependency and font notices
  ├─ package.json
  ├─ pnpm-lock.yaml
  └─ README.md
```

A future extraction into document/equation/renderer/platform packages should follow actual ownership and testing needs. CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, public JSON Schema and a selected project LICENSE remain publication work; the tree above does not imply those files already exist.

### 7.2 Recorded decisions and remaining work

| Decision          | Current direction                                                                                                    | Remaining work                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Base project      | Independent React/TypeScript implementation; no PPTist source reuse                                                  | Select project license and contribution rules                              |
| State/model       | Typed model and immutable editor history                                                                             | Extract reusable command/document boundaries when useful                   |
| Native format     | Implemented ZIP/JSON/media/local renders/crops, 0.5.0 with 0.1.0–0.4.0 migration                                     | Publish JSON Schema and unpacked Git workflow                              |
| MathJax           | Fixed bundled font/package profiles and individual vector glyph fallback                                             | Reduce loading cost and expand glyph fixtures                              |
| Installed TeX     | Explicit Electron compile with Linux OS isolation and saved vectors                                                  | Home resource authorization, broader installations, macOS/Windows adapters |
| PDF pipeline      | jsPDF/svg2pdf.js with shared geometry and resource preflight                                                         | Additional body-font scripts and broader supported effects                 |
| PDF figure import | Local page preview/selection with embedded high-resolution PNG                                                       | Preserve supported original vectors through a separately tested adapter    |
| Desktop runtime   | Electron 44.5.1; app packaging, Mac installers, Windows x64 distributions and Linux x64 Debian packaging implemented | Signed installers, hosted APT updates, Snap design and tested OS matrix    |
| Collaboration     | Deferred                                                                                                             | Shared-state, conflict and asset design proposal                           |

### 7.2.1 Linux distribution and package managers

**Implemented packaging path:** `pnpm desktop:package:linux --arch=x64` builds the common editor, packages the Linux x64 Electron runtime and uses `dpkg-deb --root-owner-group` to create `SciSlide-<version>-linux-x64.deb` with Debian `Package: scislide` and `Architecture: amd64`. It emits a SHA-256 checksum and Linux installation guide, retaining the standalone `SciSlide-linux-x64` app folder. The initial packaging target is Ubuntu 24.04 x64; other Debian-family releases need declared compatibility and desktop review.

Install the complete runtime, examples and notices under `/opt/scislide`, add `/usr/bin/scislide` and a desktop-menu entry/icon, and declare required system libraries without bundling TeX or AI CLIs. Package staging must retain executable modes and Chromium sandbox requirements without adding sandbox-disabling flags. There are no maintainer scripts or document-opening file associations in this first package. Installation uses `sudo apt install ./SciSlide-<version>-linux-x64.deb`; removal uses `sudo apt remove scislide` and preserves user presentations and app data.

The **Linux x64 development packages** workflow is manually dispatched on Ubuntu 24.04. It checks the editor/host, builds the package and verifies the checksum, Debian metadata, extracted payload, launcher, desktop entry and x86-64 ELF header without installing on the runner. Normal runs upload 30-day artifacts only. An explicit `main` publication option verifies a same-run artifact and creates a new development prerelease with an unused `v<version>-linux-dev.<positive-number>` tag at the exact source commit; existing tags and releases are not overwritten. Packaging tests and archive inspection do not establish installed native-window, file-dialog, media, presenter, Local LaTeX or AI behavior on a physical Ubuntu desktop.

**Planned APT repository:** a downloaded `.deb` is installable through APT but does not configure a repository. `apt install scislide` by package name and automatic `apt upgrade` delivery require hosted package indexes, signed Release metadata, a scoped `Signed-By` keyring, retention and a release process. No SciSlide APT repository is currently provided. Repository setup must be an explicit user action; package generation and installation must not silently add trust keys or third-party sources. See [APT authentication](https://manpages.debian.org/apt-secure) and [repository configuration](https://manpages.debian.org/sources.list).

**Planned Snap path:** strict confinement requires a separately designed way to use supported host-installed TeX and AI CLIs or a documented reduced capability subset. Classic confinement permits broader host access but needs Snap Store approval; it is not an assumed release permission. Keep the current Electron and explicit compiler/AI isolation boundaries, declare interfaces, and test native dialogs, presenter windows, media, exports and tool discovery before claiming Snap support. See [Snap confinement](https://snapcraft.io/docs/explanation/security/snap-confinement/) and the [classic-confinement review process](https://snapcraft.io/docs/reference/administration/reviewing-classic-confinement-snaps/). No Snap recipe, downloadable `.snap` or Store listing is delivered by the Debian packaging milestone.

Acceptance: validate bounded arguments and safe generated-output replacement; confirm x64 ELF and amd64 metadata; extract real Debian archives and inspect ownership/modes, runtime/resources, examples/notices, launcher and desktop integration; verify hashes and cleanup on failures. A later installed-desktop release check must exercise install → launch → author/save/reopen → PDF/SVG export → update → uninstall while preserving user data. Signed APT repository and Snap acceptance remain separate work.

### 7.3 Validation strategy

Use focused tests for document validation, migrations, commands/history, packaging and cache invalidation. Run the current development checks from the repository root with Node.js 22.12 or later and pnpm:

```sh
pnpm install
pnpm test
pnpm test:desktop
pnpm build
pnpm desktop:package
```

The desktop integration tests need installed TeX/conversion/isolation tools to exercise compilation. The Linux x64 packaged app has been launched from a relocated app directory and checked through Compile → Apply, draft preservation, typography invalidation, native save/new/open and vector PDF/SVG export. Host checks confirm sandbox/context isolation, secure custom-origin crypto/font access and scoped IPC. The worker enforces a deadline; current cancellation tests are not a dedicated deadline-expiry test. Windows x64 distribution checks verify PE machine type and SHA-256 hashes. The Windows workflow additionally checks installation/uninstallation in a temporary directory; physical Windows 10/11 editing, media playback, native saving and export remain release requirements. Three-OS signing/update verification remains open.

End-to-end fixtures should continue to exercise the author → save → reopen → edit → present → export journey. New fixtures cover page-number resolution after reordering, old-format default migration, grouped click builds and reverse navigation, embedded-media round trips, decoder errors, playback cleanup and static export placeholders. State exact automation/runtime coverage; a passing unit test is not a claim of physical-device media or installer validation.

For the v0.5.0 drawing/group changes, require fixtures for all drag directions, constrained drawing, line endpoint editing, solid/dashed/dotted strokes, both arrowheads, no-fill outlines, flat-group translation/independent duplication/ungroup/undo, alignment guides and Alt bypass at multiple zoom levels, 0.3.0→0.4.0 migration, save/reopen and vector PDF/SVG output. Record actual results separately; this requirement list is not a report of completed checks.

For the v0.5.1 smart-guide changes, require geometry and editor fixtures for bounded center/edge guides, equal spacing with varied object sizes, nonmatching rows/overlaps, matching resize dimensions, aspect-ratio constraints, zoom-scaled tolerance, deterministic candidate selection and bypass/cancellation. Overlay fixtures must verify readable measurement labels and exclusion from thumbnails, playback and exports. That release used format 0.4.0 because guides add only transient editing aids; the current crop extension writes 0.5.0.

For the v0.5.2 starter-layout changes, require catalog/generation fixtures for all eight layouts plus Blank, unique identifiers on repeated insertion, deck-font inheritance, editable native arrows and labeled figure placeholders. Review rendered previews, insertion/undo and saved source round-trips; reuse scene/export coverage because the layouts add no object type or native-format change.

For the v0.5.3 Keynote-inspired additions, require fixtures for all fourteen layouts plus Blank, category membership/counts, filter/insertion keyboard access, original editable illustration geometry, deck-font inheritance and native sample round-trips. Review whitespace, contrast, caption placement and narrow-screen gallery behavior. Preserve the same undo/save/export guarantees as existing layouts.

For the Keynote White theme family, require the five-choice startup, persisted `keynote-white` identity, fifteen-layout gallery isolation/counts, blank-slide inheritance, original editable photo/video placeholders and save/reopen/export fixtures. Review title hierarchy, spacing, photo proportions and wide/narrow gallery navigation against the supplied reference. Retain the existing four-theme/fourteen-layout regressions and document imported-video support separately from unsupported live-camera feeds.

For the additional v0.5.3 authoring workflows, automated fixtures cover normalized crop validation, independent insets/source preservation, 0.1.0–0.4.0 archive migration, crop preview/apply/reset and genuine clipped vector PDF output. Clipboard, locks, layer selection, six-way layout commands, personal-library validation/import/insertion, bounded recovery/drafts and presenter routing/navigation/timer behavior have separate fixtures. Browser smoke review exercised live presenter current/next previews, notes, timer and navigation synchronization. Physical two-monitor placement and complete desktop end-to-end review remain unverified; component fixtures and a browser popup review alone do not establish them.

Maintain visual fixtures for nested fractions, roots, integrals, aligned equations, matrices, bold symbols, scientific macros, mixed fonts, rotated/cropped plots, and Unicode text including Korean. Compare editor, slideshow, and exported output; inspect PDFs for retained vector paths in addition to rasterized visual comparisons.

Version dependency locks and representative fixture outputs. Renderer upgrades must receive visual review and explain any glyph or layout changes. A source deck can rerender differently under changed engines; exact versions and bundled output make that difference traceable.

### 7.4 Data handling and import boundaries

Imported decks, SVGs, PDFs, videos, future BibTeX/CSV imports and equation source are untrusted content. Media decoding is limited to the runtime's supported containers/codecs; imported media must not inject markup or require external network access. Validate archive paths and resource limits; sanitize SVG scripts, event handlers, and external references; use a restricted TeX extension/macro profile. A native file must never execute an embedded script simply because it is opened.

Core deck content stays local by default. A future remote renderer, collaboration service, or plot executor requires a separately documented data flow and an explicit user action. Keep font and asset redistribution notices with packaged dependencies.

### 7.5 Open-source maintenance

Before publishing code, select a license consistent with the chosen base and dependencies, retain required upstream attribution, and document licenses for fonts and bundled sample assets. This draft does not assign a license or imply that a future PPTist-derived project can be relicensed freely.

Contribution guidance should describe development setup, package ownership, required checks, issue reporting, and how to submit equation or export regression fixtures. Substantial format or rendering changes require an architecture decision record and a migration or compatibility plan.

### 7.6 Known risks

| Risk                                                  | Response                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Typography varies across renderers and versions       | Pin profiles, retain source and caches, review upgrade fixtures                       |
| PDF import/export loses vector content or fonts       | Establish the pipeline early and publish a tested subset                              |
| Broad presentation features delay the scientific core | Gate the MVP on equation editing, font selection, portability, and PDF export         |
| Desktop or compiler behavior varies by OS             | Preserve the common editor/API and validate each isolated OS adapter and distribution |
| Large figures or many equations slow editing          | Cache renders, deduplicate assets, and profile representative decks                   |
| Format evolution damages existing presentations       | Version schemas, preserve source files, and test migrations                           |

The first useful release should let a researcher compose a real scientific talk with editable equations and chosen mathematical typography. Later milestones can expand the presentation experience once that workflow is reliable.

## 8. References

Source conversation: [웹 기반 프레젠테이션 제작](chatgpt-conversation://6abea988-fa98-83eb-a800-105beb974f82). The discussion supplies product intent and initial proposals; the technical distinctions in this draft were checked against the following primary sources on 2026-10-01.

- [MathJax font support](https://docs.mathjax.org/en/latest/output/fonts.html) — prepared font sets and asynchronous font-resource loading.
- [MathJax SVG support](https://docs.mathjax.org/en/latest/output/svg.html) — vector output characteristics and glyph-path limitations.
- [MathJax SVG output options](https://docs.mathjax.org/en/latest/options/output/svg.html) — local versus global glyph definitions.
- [MathJax differences from actual TeX](https://docs.mathjax.org/en/latest/input/tex/differences.html) — supported mathematical input versus full LaTeX compilation.
- [MathJax TeX support](https://docs.mathjax.org/en/latest/input/tex/index.html) — JavaScript input parser and extension scope; consulted 2026-10-02.
- [dvisvgm manual](https://dvisvgm.de/Manpage/) — DVI/XDV/PDF conversion and outlined SVG glyphs; consulted 2026-10-02.
- [Electron security guide](https://www.electronjs.org/docs/latest/tutorial/security) — sandboxing, isolated preload, CSP and sender validation; consulted 2026-10-02.
- [Electron protocol API](https://www.electronjs.org/docs/latest/api/protocol) — secure custom-scheme resource loading; consulted 2026-10-02.
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/) and [CLI reference](https://developers.openai.com/codex/cli/reference/) — headless generation, read-only execution and structured output; consulted 2026-10-03.
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) — print mode, tools and configuration restrictions; consulted 2026-10-03.
- [Gemini CLI headless mode](https://geminicli.com/docs/cli/headless/) and [configuration](https://geminicli.com/docs/get-started/configuration/) — structured responses, content-only settings and authentication; consulted 2026-10-03.
- [Electron Packager](https://github.com/electron/packager) — Windows x64 application bundles; consulted 2026-10-03.
- [Inno Setup architecture identifiers](https://jrsoftware.org/ishelp/topic_setup_architecturesallowed.htm) and [installation privileges](https://jrsoftware.org/ishelp/topic_setup_privilegesrequired.htm) — x64 targeting and per-user installation; consulted 2026-10-03.
- [GitHub Windows runner image](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md) — native x64 CI and installed Inno Setup compiler; consulted 2026-10-03.
- [Apple's Keynote theme chooser guide](https://support.apple.com/guide/keynote-icloud/create-a-presentation-gil310ef8e21/icloud) and [official theme-chooser illustration](https://help.apple.com/assets/6477A85CCB8C920AE18003FC/6477A860CB8C920AE1800404/en_US/0bc25c8169fcd3fd3c17c0bbfc073172.png) — visual references for white/black typography, deep navy and isolated-visual composition; consulted 2026-10-04.
- [PPTist repository](https://github.com/pipipi-pikachu/PPTist) and [license](https://github.com/pipipi-pikachu/PPTist/blob/master/LICENSE) — candidate editor foundation and upstream licensing.

For implementation, record exact dependency versions and upstream commit IDs in architecture decisions; these reference links may change over time.
