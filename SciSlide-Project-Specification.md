# SciSlide — Scientific Presentation Editor

**Project specification and technical design draft · v0.3**

| Field                 | Value                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Working name          | SciSlide                                                                                         |
| Status                | Electron/web prototype v0.2.1 implemented; production release and later requirements remain open |
| Date                  | 2026-10-02                                                                                       |
| Intended audience     | Contributors, maintainers, and scientific users                                                  |
| Product direction     | Shared web/desktop visual presentation editor with MathJax and installed LaTeX equations         |
| Native file extension | `.scislide`                                                                                      |
| License               | To be selected after the implementation strategy and dependency review                           |

> A Keynote-like presentation editor designed for scientists, where LaTeX equations are native, editable objects with selectable mathematical typography.

This document consolidates the referenced conversation, **웹 기반 프레젠테이션 제작**, into an open-source project specification and records the subsequent implementation. Product goals come from that discussion. Sections identify the working prototype separately from target requirements; future features and release gates are not claims of existing functionality.

The current v0.2.1 prototype is an independent React/TypeScript application with three bundled MathJax fonts, 17 math-package catalog entries, and an Electron host. Native file operations and an explicit Local LaTeX Compile → Apply workflow are implemented. A built-in Scientific starter template provides research-title, key-findings, equation/meaning and figure-comparison layouts. Isolated local compilation currently supports Linux system TeX installations; macOS/Windows compilation and home-installed package access remain future work. [The README](README.md) documents setup and usage. This prototype is not yet a complete scientific MVP or a signed production distribution.

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

Advanced animation, masters, full presenter mode, citations, executable figure workflows, collaboration, and Office conversion belong to later milestones. Full Keynote or PowerPoint compatibility, packages requiring external program execution, and mobile authoring are outside the initial scope. The implemented Local LaTeX mode supports engine-compatible system packages inside an isolated single-page math-fragment workflow, not unrestricted document execution.

## 2. Architecture

### 2.1 Design principles

- **Object-first:** Each slide contains independent text, equation, figure, and shape objects. Charts, tables, and media can extend the model later.
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

The document engine must remain independent of the UI framework. Selection, open dialogs, zoom, and drag previews are transient editor state and must not be serialized into the deck.

### 2.3 Module responsibilities

| Module   | Responsibilities                                                                   |
| -------- | ---------------------------------------------------------------------------------- |
| Editor   | Selection, keyboard interaction, object editing, slide organization                |
| Document | Typed model, schema validation, stable IDs, commands, migrations                   |
| Layout   | Bounds, transforms, snapping, distribution, theme and master resolution            |
| Equation | Source validation, macro profiles, font profiles, SVG generation, cache management |
| Assets   | Asset import, MIME validation, deduplication, packaging, provenance                |
| Renderer | Object drawing, clipping, hit testing, viewport transforms                         |
| Player   | Slide navigation and, later, animation/build state                                 |
| Export   | Resource preflight, static composition, PDF and future formats                     |
| Platform | File access, recovery storage, offline resources, desktop integration              |

### 2.4 Technology direction

| Area            | Implemented v0.2.0 baseline                                   | Remaining decision or improvement                        |
| --------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Language        | TypeScript; small Electron/CommonJS and compiler/ESM modules  | Shared package extraction when useful                    |
| UI              | Independent React 19 editor                                   | No PPTist-derived implementation                         |
| Editor state    | React state with immutable revision history and grouped edits | Extract document command boundaries as complexity grows  |
| Rendering       | Shared SVG scene and HTML editor controls                     | Profile before adding a canvas path                      |
| Mathematics     | MathJax 4.1.3 and explicit Local LaTeX adapter                | Additional local engines and OS isolation profiles       |
| Native document | ZIP plus JSON/assets/outlined local renders, format 0.2.0     | JSON Schema publication and unpacked Git workflow        |
| PDF             | jsPDF and svg2pdf.js, shared geometry/resource preflight      | Korean body-text fonts and broader SVG/PDF fixtures      |
| Desktop         | Electron 44.5.1, isolated preload and native file operations  | Signed installers, updates and cross-platform validation |

The conversation considered an independent React application and a PPTist-based Vue application. The prototype chose the independent React implementation and does not reuse PPTist code. PPTist remains a reference for future comparisons; any future reuse must review the selected upstream revision and license. See the [PPTist repository](https://github.com/pipipi-pikachu/PPTist) and [license](https://github.com/pipipi-pikachu/PPTist/blob/master/LICENSE).

Electron is the selected first desktop runtime. The common editor calls a narrow `window.scislideDesktop` adapter; it does not directly import Electron or Node APIs. A Tauri migration is not a committed milestone.

The renderer uses sandboxing, context isolation, disabled Node integration and a restrictive content security policy. Production content loads from the secure standard `scislide://app/` scheme; fonts and fetch-based resources remain local. Main-process IPC validates the main frame and structured payload limits. Only presentation fullscreen is permitted for the trusted main frame; other permission requests, external navigation, new windows and external network access are denied. The native Present menu performs a fixed fullscreen action with a user gesture before dispatching the presentation command. Native file destinations are selected through system dialogs and retained only by the main process; no generic shell or arbitrary-path write API is exposed.

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

Implemented `.scislide` files are ZIP containers. New saves use format **0.2.0**:

```text
presentation.scislide
  ├─ manifest.json             # Format version, document entry, resource index
  ├─ document.json             # Authoritative slides, objects, themes, and source
  ├─ assets/                   # Imported figures and redistributable resources
  └─ renders/                  # Successful outlined Local LaTeX equation SVGs
```

The manifest records `formatVersion`, the `document.json` entry, producer information, rendering profiles, and an index of bundled resources. Each resource entry includes its relative path, media type, size and SHA-256 digest. MathJax profiles record the exact engine/font-package versions and options. Local equation records retain source, engine, preamble, intrinsic metrics, an input signature and compiler/converter/dependency metadata; their SVG payloads are stored as indexed resources in `renders/`.

MathJax equations rerender from source and bundled profiles. Local LaTeX equations use the successful saved SVG when its input signature matches the resolved source/style/configuration. Viewing, slideshow playback and export never compile an imported local equation. Missing or stale local results are errors until the user explicitly recompiles. Embedded outlines preserve viewing portability; editable rerendering still requires the recorded packages/fonts in a supported local environment. Optional thumbnails remain future work.

An unpacked folder representation remains a future target for Git workflows. Stable IDs, stable serialization order, and relative asset references should keep source diffs readable. Binary ZIP files themselves are not intended to produce useful line-by-line diffs.

### 3.2 Document model

| Entity        | Required data                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Document      | Format version, ID, title, slide dimensions, theme, slide list, asset registry                                      |
| Slide         | ID, title, background, ordered object list, speaker notes                                                           |
| Common object | ID, type, name, transform, opacity, visibility/lock state, metadata                                                 |
| Text          | Plain Unicode source, typography, alignment; structured text runs may follow later                                  |
| Equation      | LaTeX source, display mode, optional style overrides, description, renderer and optional local configuration/result |
| Figure        | Asset ID and alt text; provenance can use metadata; reversible crop remains a target                                |
| Shape         | Geometry, fill, stroke                                                                                              |

Use logical slide units based on CSS pixels at 96 units per inch, independent of viewport zoom or device pixel ratio. The default slide is 1600 × 900 units. Origin is top-left; `x` and `y` locate an object's unrotated frame; rotation is in degrees about its center. Opacity ranges from 0 to 1. Object array order defines stacking from back to front.

For text, figures, and shapes, frame width and height specify layout. For equations, these dimensions are persisted layout hints derived from source and resolved typography; position and rotation remain authoritative. Equation resizing changes font size uniformly. MathJax regenerates the bounds; local equations require explicit recompilation after typography changes. Future nondestructive cropping should use normalized source coordinates and preserve the original asset.

### 3.3 Illustrative `document.json`

The following is a minimal 0.2.0 source document with a MathJax equation, not a complete ZIP package. Resource hashes and exact rendering-profile versions belong in the manifest. Local equations add `renderer: "local-latex"` and `localTex` configuration/result records, described in section 4.6.

```json
{
  "formatVersion": "0.2.0",
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

An empty equation `style` inherits the document's equation defaults. An explicit `fontSetId`, `fontSize`, or `color` overrides that property. Changing a deck default updates inherited MathJax equations; **Use deck typography** removes an equation's explicit overrides. Local TeX fonts are configured in the preamble, not through a MathJax font ID. Changes to inherited local size/color require recompilation.

### 3.4 Validation and compatibility

- The implemented TypeScript validator reads 0.1.0 and 0.2.0; 0.1.0 equations migrate to MathJax, and the next save writes 0.2.0. Unsupported versions are rejected explicitly. Opening does not rewrite the original file.
- Publish a JSON Schema alongside TypeScript types as a follow-up; schema and application versions are separate.
- Validate unique IDs, references, finite geometry, supported types, and asset integrity before loading.
- Migrate supported older formats through explicit, tested steps; preserve the original file.
- Open unsupported newer formats read-only where feasible, or reject with a clear version message.
- Preserve unknown extension data when supported; never silently discard it on save.
- Bundle figure bytes instead of relying on local absolute paths or live URLs. Provenance links are descriptive metadata.
- Define `extensions` namespaces for future objects and metadata; reserved fields retain stable meanings.

### 3.5 Saving and recovery

Native-file save creates a complete package snapshot. Electron Open, Save and Save As use native dialogs; Save reuses the selected document path, and a new deck clears that destination. Atomic file replacement completes before the UI reports success. Exports use a separate destination and do not change the original-document path. Canceled dialogs are not reported as successful saves. A browser fallback reports “download started”; initiation alone cannot prove durable saving.

The current recovery store is localStorage, separate in web and desktop environments. It retains the committed deck, not guaranteed recovery of unfinished equation drafts. Large assets can exceed its quota; explicit original-file saves remain necessary. A future IndexedDB store and draft recovery are separate requirements. Loading a damaged or unsupported package must not overwrite the current deck. Undo/redo history is editor state and is not included in the portable file.

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

**Status: working Electron v0.2.0 prototype on supported Linux system installations.** MathJax remains the default. Local LaTeX is an explicit second renderer for real installed TeX packages, macros and fonts. Installed `.sty` files are processed by the TeX engine, not MathJax's JavaScript parser. See [MathJax's TeX support](https://docs.mathjax.org/en/latest/input/tex/index.html).

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

**Format 0.2.0 and portability.** Equations add `renderer: "mathjax" | "local-latex"` and optional `localTex: { engine, preamble, render }`. The saved render contains intrinsic dimensions, an input signature, engine/converter versions, dependency-file hashes and warnings. Its SVG is stored as a SHA-256-indexed `renders/<equation-id>.svg` resource. The reader migrates old 0.1.0 equations to MathJax and rejects unsupported versions. A valid embedded local render is sufficient for viewing, presenting and exporting without TeX, including in the web editor. Editing and recompiling still require the relevant supported local environment. Missing or mismatched input signatures produce an error instead of exporting stale output.

**Reproducibility.** The compiler cache key includes input, template revision and engine/converter versions. Recorded dependency hashes are rechecked before a compiler-cache hit is used; package names alone are not considered an environment identity. Portable local render metadata retains compiler/converter versions and dependency hashes. Saved vector output preserves appearance even if an engine later changes, while editable rerendering is environment-dependent. The prototype does not bundle a TeX distribution or promise byte-identical future recompilation.

**Execution boundary.** Linux jobs run inside bubblewrap with isolated network/PID/user namespaces, read-only selected system runtime/TeX/font paths and a fresh job directory for writes. Shell escape is disabled. `prlimit` bounds address space, CPU, file size and open files; the worker adds a 20-second job deadline, bounded logs/results, cancellation and cleanup. The main process permits at most two simultaneous jobs. Output SVGs contain only validated, self-contained vector shapes; scripts, event handlers, external references, text/font dependencies and unexpected content are rejected. This boundary uses OS isolation, not source filtering alone.

**Current platform and resource limits.** The tested target is the current Linux system TeX installation. `~/texmf`, home-installed macro/package files and user font folders are not mounted. Arbitrary installation trees outside supported system runtime paths are not guaranteed. macOS and Windows can detect installed executables but intentionally do not enable local compilation until an OS isolation adapter is implemented. MathJax and saved local renders remain usable there. Explicitly selected user resource directories, macOS/Windows isolation, additional engines and signed installers are future work.

**Validation evidence.** The actual Electron host has passed secure-origin/crypto/font/MathJax/native-file checks with renderer sandboxing enabled. An AMS equation compiled through the real preload → main → isolated LaTeX → SVG path with direct vector outlines and retained engine metadata. Compiler tests cover ordinary and OpenType mathematics, installed packages, dependency-aware cache behavior, errors, cancellation, resource validation and isolation boundaries. Document tests cover 0.1.0 migration, portable render resources, sanitization, corruption and stale/missing results. These checks establish a working prototype, not complete three-OS deployment or full LaTeX compatibility.

## 5. Features and requirements

### 5.1 Functional requirements

**MVP** is a release gate. **Next** is Phase 2. **Future** is Phase 3 or later. **Spike** requires an early feasibility decision.

The table defines product requirements, including capabilities beyond the current prototype. Current implementation status is:

| Area                 | v0.2.1 status                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Editor core          | Slide operations, text/equation/figure/rectangle/ellipse objects, transforms, alignment, selection, history and notes work |
| Starter templates    | Scientific layout picker with research title, key findings, equation/meaning, figure comparison and a blank option         |
| Equations            | Three MathJax fonts and package catalog; explicit Linux Local LaTeX Compile → Apply; portable valid local SVG results      |
| Files and output     | Native Electron Open/Save/Save As and PDF/SVG save; browser download fallback; 0.1.0 migration and 0.2.0 archives          |
| Desktop              | Electron application host and current-platform packaging; signed installers and OS-wide deployment validation remain open  |
| Partial requirements | localStorage recovery; bundled Latin PDF body fonts; no figure crop, native line shape or equal-spacing control            |
| Later features       | PDF figure import, masters, animations, presenter mode, citations, Office conversion and collaboration                     |

| ID   | Feature                  | Scope                                     | Acceptance criterion                                                                                                                 |
| ---- | ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| F-01 | Slide management         | MVP                                       | Add, duplicate, delete, and reorder slides; order survives reopening                                                                 |
| F-02 | Object editing           | MVP                                       | Insert, select, move, rotate, resize, duplicate, delete, and arrange supported objects                                               |
| F-03 | Layout tools             | MVP                                       | Multi-select, numeric transforms, snapping, alignment, and equal spacing work at different zoom levels                               |
| F-04 | Text and shapes          | MVP                                       | Unicode text, font/size/color/alignment, and basic rectangle/ellipse/line objects render consistently                                |
| F-05 | Equation objects         | MVP                                       | Source remains editable after save/load; STIX Two and Fira can be selected per object and through deck defaults                      |
| F-06 | Figure objects           | MVP                                       | SVG, PNG, and JPEG import with aspect-ratio scaling, crop, alt text, and provenance                                                  |
| F-07 | PDF figure import        | Spike → MVP target                        | Select a page and crop it; tested scientific plots retain vector content. If this gate fails, defer PDF import explicitly to Phase 2 |
| F-08 | History and recovery     | MVP                                       | Editing commands undo/redo correctly; local recovery restores the last completed autosave revision                                   |
| F-09 | Native save/load         | MVP                                       | Packaged assets and source round-trip without external local files                                                                   |
| F-10 | Static PDF export        | MVP                                       | One page per slide; supported text, figures, equations, and clipping pass the export fidelity checks                                 |
| F-11 | Basic slideshow          | MVP                                       | Full-screen playback and keyboard slide navigation match the editor's supported content                                              |
| F-12 | Notes and presenter mode | Notes: MVP; presenter mode: Next          | Notes persist; later presenter view shows notes, timer, and upcoming slide                                                           |
| F-13 | Masters and templates    | Starter layouts implemented; masters Next | Scientific starter layouts insert editable objects; future shared title/footer/logo/page-number masters support slide overrides      |
| F-14 | Basic animation          | Next                                      | Appear/disappear, fade, move, and scale support ordered click-triggered builds                                                       |
| F-15 | Object transitions       | Next                                      | Stable cross-slide match keys enable transform/opacity interpolation without ambiguity                                               |
| F-16 | Scientific citations     | Future                                    | Import BibTeX, retain citation keys, and generate consistent citation text                                                           |
| F-17 | Reproducible plots       | Future                                    | Store source/parameters/environment metadata and replace the generated asset without changing layout                                 |
| F-18 | Native charts and media  | Future                                    | Extend object types and declare playback/export behavior per type                                                                    |
| F-19 | PPTX export              | Future                                    | Document an explicit supported mapping; equations can use SVG with retained source metadata where feasible                           |
| F-20 | Beamer/Typst export      | Future                                    | Export a documented subset with a report of unsupported content                                                                      |
| F-21 | Collaboration            | Future                                    | Define ownership, synchronization, asset sharing, and conflict handling before implementation                                        |
| F-22 | Desktop application      | Implemented prototype; release gate open  | Native menus/files and secure Electron rendering; supported OS packages and deployment checks                                        |
| F-23 | Installed TeX equations  | Implemented Linux prototype               | Explicit isolated compile, matching Apply, source/configuration plus outlined result portability; future OS adapters                 |

### 5.2 Figure workflow

Import original bytes into the asset store. Store source filename, optional source script or publication reference, caption, creation date, and user-supplied parameters as metadata. Cropping and resizing must remain reversible.

Scientific plots should retain readable labels and vector lines. PDF import requires a dedicated adapter and a defined supported subset; browser rendering a PDF page to a bitmap does not satisfy the vector-import target. Unsupported fonts, transparency, or PDF effects require a clear import diagnostic or an explicitly identified raster fallback.

Captions can initially be linked text objects. Python or matplotlib integration later may use provenance such as `source: simulation.py`, parameter values, environment information, and a generated SVG asset. Execution is a separate future feature, invoked explicitly by the user.

### 5.3 User interface

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

### 5.4 Animation model

Later animation records specify target object, effect, trigger, ordering, duration, delay, easing, and effect parameters. Playback state belongs to the player and does not mutate the saved deck.

Cross-slide transitions use a separate optional match key, because object IDs remain unique within the document. Initial transitions interpolate position, uniform scale, rotation, and opacity. Equation glyph morphing is a later research task.

Static PDF export uses the final visible build state by default. Exporting one page per build step is a later option. This policy must be visible to the user once animations are introduced.

### 5.5 PDF export requirements

Default text fonts must be bundled with appropriate redistribution rights. Custom text fonts require embedding where permitted or a clearly identified substitution; relying on an unrecorded system font cannot satisfy portable layout. Fonts used for Unicode text must cover the document's actual characters.

The exporter must:

1. Freeze a document revision and resolve its scene.
2. Wait for equations, text fonts, figures, and other supported resources.
3. Validate clipping, glyph availability, and supported object types.
4. Produce the requested page size with no editor controls, browser headers, or unintended margins.
5. Report missing or unsupported content before producing a file presented as complete.

Acceptance fixtures must confirm vector equation paths, supported SVG/PDF figure paths, readable text, correct colors, and crop/rotation fidelity. Raster source images remain raster. A browser-print or SVG-to-PDF approach is acceptable only after it meets these checks; visual resemblance in the editor alone is insufficient.

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

## 6. Development roadmap

The conversation suggested roughly 1 month for a prototype, 3 months for a scientific MVP, and 6 months for richer presentation features. These are provisional effort windows for each phase, not fixed delivery dates; staffing and feasibility results will determine a calendar.

| Phase                                                                 | Deliverables                                                                                                             | Exit criteria                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **0 — Prototype and decisions** (initial estimate: ~1 month)          | Delivered independent React editor, bundled fonts, vector export, native 0.2.0 format and Electron/Linux local compile   | Core choices recorded; publication/license and complete release review remain open                          |
| **1 — Scientific MVP** (initial estimate: ~3 months after Phase 0)    | Harden delivered core; Korean PDF fonts, asset storage, draft recovery, crop and representative scientific-deck fixtures | Author/save/reopen/edit/present/export release gates pass on the declared support matrix                    |
| **2 — Presentation workflow** (initial estimate: ~6 months after MVP) | Animation, masters, templates, presenter mode, PDF import and desktop distribution improvements                          | Shared content matches editor/player/export; signed packages and selected OS adapters pass fixtures         |
| **3 — Research integration** (unscheduled)                            | BibTeX; reproducible plot tooling; PPTX and Beamer/Typst export; charts/media; collaboration experiments                 | Each feature has a documented capability subset, acceptance fixtures, and an approved architecture proposal |

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
- [ ] Declare the delivered PDF-import subset, or its explicit Phase 2 deferral.
- [ ] Publish setup instructions, examples, format documentation, and the selected license.

### 6.2 Next implementation sequence

1. Select the project license and document publication/contribution boundaries.
2. Publish format 0.2.0 schema and migration documentation with portable mixed-renderer fixtures.
3. Add Korean PDF body-font coverage and review editor/player/export typography together.
4. Move assets/recovery to a bounded IndexedDB store and preserve equation drafts.
5. Add reversible figure crop and the declared PDF-import subset.
6. Validate desktop packaging, signing and OS support; implement additional local compiler isolation adapters separately.
7. Profile representative scientific decks, reduce font-loading cost, and complete the release checklist before expanding animation/Office features.

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

| Decision          | Current direction                                                        | Remaining work                                                             |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Base project      | Independent React/TypeScript implementation; no PPTist source reuse      | Select project license and contribution rules                              |
| State/model       | Typed model and immutable editor history                                 | Extract reusable command/document boundaries when useful                   |
| Native format     | Implemented ZIP/JSON/assets/local renders, 0.2.0 with 0.1.0 migration    | Publish JSON Schema and unpacked Git workflow                              |
| MathJax           | Fixed bundled font/package profiles and individual vector glyph fallback | Reduce loading cost and expand glyph fixtures                              |
| Installed TeX     | Explicit Electron compile with Linux OS isolation and saved vectors      | Home resource authorization, broader installations, macOS/Windows adapters |
| PDF pipeline      | jsPDF/svg2pdf.js with shared geometry and resource preflight             | Korean body fonts and broader supported effects                            |
| PDF figure import | Deferred                                                                 | Preserve supported vector pages and publish capability subset              |
| Desktop runtime   | Electron 44.5.1 chosen and current-platform app packaging implemented    | Signed installers, updates and tested OS matrix                            |
| Collaboration     | Deferred                                                                 | Shared-state, conflict and asset design proposal                           |

### 7.3 Validation strategy

Use focused tests for document validation, migrations, commands/history, packaging and cache invalidation. Run the current development checks from the repository root with Node.js 22.12 or later and pnpm:

```sh
pnpm install
pnpm test
pnpm test:desktop
pnpm build
pnpm desktop:package
```

The desktop integration tests need installed TeX/conversion/isolation tools to exercise compilation. The Linux x64 packaged app has been launched from a relocated app directory and checked through Compile → Apply, draft preservation, typography invalidation, native save/new/open and vector PDF/SVG export. Host checks confirm sandbox/context isolation, secure custom-origin crypto/font access and scoped IPC. The worker enforces a deadline; current cancellation tests are not a dedicated deadline-expiry test. Three-OS installation/signing/update verification remains a release requirement.

End-to-end fixtures should continue to exercise the author → save → reopen → edit → present → export journey.

Maintain visual fixtures for nested fractions, roots, integrals, aligned equations, matrices, bold symbols, scientific macros, mixed fonts, rotated/cropped plots, and Unicode text including Korean. Compare editor, slideshow, and exported output; inspect PDFs for retained vector paths in addition to rasterized visual comparisons.

Version dependency locks and representative fixture outputs. Renderer upgrades must receive visual review and explain any glyph or layout changes. A source deck can rerender differently under changed engines; exact versions and bundled output make that difference traceable.

### 7.4 Data handling and import boundaries

Imported decks, SVGs, future PDF imports and equation source are untrusted content. Validate archive paths and resource limits; sanitize SVG scripts, event handlers, and external references; use a restricted TeX extension/macro profile. A native file must never execute an embedded script simply because it is opened.

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
- [PPTist repository](https://github.com/pipipi-pikachu/PPTist) and [license](https://github.com/pipipi-pikachu/PPTist/blob/master/LICENSE) — candidate editor foundation and upstream licensing.

For implementation, record exact dependency versions and upstream commit IDs in architecture decisions; these reference links may change over time.
