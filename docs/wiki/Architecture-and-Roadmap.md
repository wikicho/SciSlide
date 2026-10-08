# Architecture and roadmap

SciSlide **v0.6.2** uses one React/TypeScript editor for the browser and Electron desktop application. The application is a development prototype; the sections below distinguish its current behavior from planned work.

## Application structure

```text
React editor
  ├─ Slide navigator, canvas, toolbar, inspector, and dialogs
  ├─ Typed document model and immutable undo/redo history
  ├─ Shared SVG scene → editor, slideshow, PDF/SVG exports
  ├─ Equation services → MathJax SVG or saved Local LaTeX SVG
  └─ Platform adapter
       ├─ Browser downloads, file input, IndexedDB recovery
       └─ Electron preload → native files, menus, presenter, host tools
```

| Area           | Current implementation                                                |
| -------------- | --------------------------------------------------------------------- |
| User interface | React 19 and TypeScript; SVG scene with HTML editing controls         |
| Mathematics    | Bundled MathJax 4 profiles with Modern, STIX Two, and Fira Math fonts |
| Installed TeX  | Explicit compile/apply workflow through a Linux isolation adapter     |
| Persistence    | Versioned ZIP/JSON `.scislide` archives with embedded resources       |
| Export         | jsPDF and svg2pdf.js for PDF; current-slide SVG                       |
| Desktop        | Electron with a narrow isolated preload bridge                        |
| Packaging      | macOS arm64/x64 PKG, Windows x64 setup/portable ZIP, Linux x64 DEB    |

The renderer does not import Node.js or Electron APIs directly. The desktop host validates structured requests and keeps file destinations selected through native dialogs. Opening a presentation does not run its equation source or host commands. Local LaTeX compilation and AI generation require explicit user actions.

See [Development](Development) for source directories and commands.

## Native document format

The application version **0.6.2** and file-format version **0.5.0** are separate. A `.scislide` file is a ZIP container:

```text
presentation.scislide
  ├─ manifest.json
  ├─ document.json
  ├─ assets/
  └─ renders/
```

- `manifest.json` identifies the document and rendering profiles, and indexes embedded resources with their size, media type, and SHA-256 digest.
- `document.json` contains slides, ordered objects, source text, equation configuration, slide notes, themes, and presentation settings.
- `assets/` contains imported figures and embedded video.
- `renders/` contains successful outlined SVG results for Local LaTeX equations.

Objects retain editable source, position, size, rotation, and supported styling. Array order determines stacking. Figure crops are normalized source coordinates; insets are independent figures sharing the original asset. Groups are flat memberships rather than nested transform trees.

MathJax equations render from their source and bundled profiles. Saved Local LaTeX renders can be viewed on another computer without installing the original TeX packages, while recompilation requires a supported environment. A stale or missing local render needs an explicit recompile; importing a deck never compiles it automatically.

Formats **0.1.0–0.4.0** migrate on opening. Saving writes format 0.5.0. Use **Save As** to keep an older original. Earlier applications that only understand older formats cannot necessarily read new saves.

Workspace recovery, unfinished equation drafts, and the personal equation library are local editor data; they are separate from a saved presentation. See [Getting started](Getting-Started) and [Equations and fonts](Equations-and-Fonts).

## Current capabilities

- Theme chooser, editable layout galleries, and drag-and-drop slide ordering.
- Direct text editing with inline math, drawing, flat groups, layers, smart guides, alignment, and equal spacing.
- SVG/PNG/JPEG figures, rasterized PDF page import, reversible crop, insets, and figure replacement.
- MathJax font/package profiles, a personal equation library, and isolated installed-package compilation on supported Linux systems.
- Embedded MP4/WebM video, click-triggered appear/fade builds, notes, and a separate presenter display.
- Native save/open, PDF/SVG export, workspace recovery, and installed AI CLI drafts.
- Platform-specific shortcuts using Keynote, PowerPoint, and Impress conventions where the corresponding action exists.

## Planned work

These features are **not implemented in v0.6.2**:

| Direction            | Remaining work                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Distribution         | Signing/notarization, automatic updates, hosted APT repository, Snap distribution, and broader physical-device validation |
| Document tooling     | Published JSON Schema, richer migration documentation, unpacked Git workflow                                              |
| Scientific authoring | Shared deck macros, linked equation-library entries, citations/BibTeX, editable charts with units/error bars              |
| Layout               | Linked masters, nested groups, collective group scaling/rotation, attached connectors, freehand drawing                   |
| Figures              | Preservation of original PDF vectors and expanded provenance tools                                                        |
| Presentation         | Advanced animation, a dedicated build-order panel, automatic monitor placement                                            |
| Host tools           | Additional Local LaTeX isolation adapters for macOS/Windows and authorized home-installed TeX resources                   |
| Interchange          | PPTX/HTML export and collaboration                                                                                        |
| Project governance   | A selected project license and dedicated contribution/security documents                                                  |

No delivery dates are promised by this list. The [project specification](https://github.com/wikicho/SciSlide/blob/v0.6.2/SciSlide-Project-Specification.md) records the broader requirements; its baseline narrative predates 0.6.2. Use this wiki, the [0.6.2 release notes](https://github.com/wikicho/SciSlide/blob/v0.6.2/docs/releases/v0.6.2.md), and source code to determine the current feature set.

[Home](Home) · [Development](Development) · [Troubleshooting](Troubleshooting)
