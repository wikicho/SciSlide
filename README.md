# SciSlide

A scientific presentation editor with editable equations, vector output, and an Electron desktop host.

**v0.2.1 is a working prototype.** The shared React/TypeScript editor runs in a browser or Electron. MathJax provides immediate equation previews; the desktop app can explicitly compile equations with installed LaTeX or XeLaTeX on supported Linux systems. The included three-slide cosmology deck uses synthetic demonstration data.

## Getting Started

Use Node.js 22.12 or later and pnpm. Install the dependencies, then launch the desktop app:

```sh
pnpm install
pnpm desktop
```

`desktop` builds the editor and opens an Electron window. During development, the following command starts Vite and Electron together:

```sh
pnpm desktop:dev
```

You can also run the web editor or create a static build:

```sh
pnpm dev
# Open http://127.0.0.1:5173/

pnpm build
pnpm preview
```

`dist/` contains the built static app. Serve the web version through a web server. Electron opens the bundled editor at `scislide://app/` without a separate web server. Equation data and MathJax fonts are bundled; editing does not connect to a CDN or remote equation service. The web version does not include a service worker or an installable PWA.

## Desktop Packaging

```sh
pnpm desktop:package
```

This creates an app for the current operating system and CPU architecture in the project's `release/` directory. On Linux x64, launch `release/SciSlide-linux-x64/scislide`. Use `--platform`, `--arch`, and `--out` to specify a target, and explicitly pass `--overwrite` to replace existing output. The app includes the editor, Electron runtime, desktop host, and dependency licenses. A TeX distribution is not bundled.

Build both **Apple Silicon and Intel macOS `.pkg` installers** with:

```sh
pnpm desktop:package:mac
# One architecture:
pnpm desktop:package:mac --arch=arm64
```

The default output paths are `release/SciSlide-0.2.1-macos-arm64-unsigned.pkg` and `release/SciSlide-0.2.1-macos-x64-unsigned.pkg`. Each installer also has a SHA-256 checksum file. The installation location is `/Applications/SciSlide.app`. See the [macOS installation guide](desktop/MACOS.md) for architecture selection and current limitations.

The default `.pkg` implementation uses [Electron's official pure JavaScript packaging](https://packages.electronjs.org/osx-sign/v2.6.0/index.html#pure-javascript-packaging), so it also works on Linux. On macOS with Xcode Command Line Tools, use `pnpm desktop:package:mac --implementation=native` to package with Apple's `pkgbuild` and `productbuild`. **Both methods produce development installers without Developer ID signing or notarization.** macOS security policies may block installation or launch. The packaging process does not change system security settings.

The repository's **macOS development installers** Actions workflow builds the editor once on a macOS runner and creates native `.pkg` installers for both architectures. It runs when packaging configuration changes or through Actions' **Run workflow** control. The versioned artifacts contain the installer, checksum, and installation guide for each architecture and are retained for 30 days. No additional secrets or Apple account are used. Installation, editing, file saving, and export on a physical Mac, along with signed distribution, require separate validation.

Automatic updates, macOS notarization, Windows signing, and complete distribution validation across all three operating systems remain future work.

## Using the Editor

1. Select a slide from the thumbnails on the left. On narrow screens, use the slide selector above the canvas.
2. Add objects with **Text / Equation / Figure**. Figures support SVG, PNG, and JPEG.
3. Click and drag an object to move it. Resize it with the lower-right handle, or enter its position, rotation, and color in the Inspector.
4. Select an equation, then choose **MathJax · Live preview** or **Local LaTeX · Installed packages**. Equation source and previews are not applied to the slide until you click **Apply equation**.
5. Desktop **Open / Save / Save As** use native file dialogs. Save writes to the selected original path; Save As lets you choose a new path. The web version downloads the source file.
6. Use **Present** for the slideshow, and **Export** to save all slides as a PDF or the current slide as an SVG.

The desktop menu provides New Presentation, Open, Save, Save As, undo/redo, presentation mode, and PDF export. A successful save notification appears after the native file write completes. The web version distinguishes starting a download from completing a save to disk.

## Slide Templates

Click **New slide** or **+** in the slide list to choose a built-in Scientific template. Four layouts are available: **Research title**, **Key findings**, **Equation + meaning**, and **Figure comparison**, along with a **Blank** slide. The selected layout is inserted after the current slide.

Template titles, body text, equations, and shapes are ordinary editable objects. Change the text, or move and delete objects to suit your presentation. Equations inherit the presentation's current equation font and color, and you can edit the example expressions. Figure comparison uses editable rectangles and instructions as figure placeholders. Add actual images with **Figure**, then delete the placeholder objects. Templates do not download external images or additional fonts.

## MathJax Equations and AMS Packages

In MathJax mode, choose **STIX Two / Fira Math / Latin Modern** for immediate previews. Open **AMS fonts & symbols / Packages & examples** to browse the package catalog and examples rendered with the current font.

Notation from `amsmath`, `amsfonts`, and `amssymb` is included by default. You can use `\mathbb`, `\mathfrak`, `\mathcal`, `\mathscr`, `\boldsymbol`, `align`, `aligned`, `cases`, matrices, and more. You can also place supported package declarations before the equation. Source is saved unchanged, including declarations.

```latex
\usepackage{amsmath,amsfonts,amssymb}
\mathbb{R}\supset\mathbb{Q}\supset\mathbb{Z}
\qquad \mathfrak{g}\qquad \boldsymbol{\alpha}
```

The default entries are **AMS Math, AMS Fonts, AMS Symbols, mathtools, boldsymbol, newcommand, color, braket, cancel, amscd, cases, empheq, extpfeil, gensymb, textmacros, upgreek**. Because **physics** changes the meaning of some standard commands, it is enabled only for the equation that requests it.

```latex
\usepackage{physics}
\pdv{\psi}{t}=\frac{1}{i\hbar}\hat H\ket{\psi}
```

You can also use `\require{physics}`. Place declarations at the start of the source. Comments are allowed; package options and names outside the supported list produce an error. Macros and physics activation do not affect other equations.

When Fira Math or Latin Modern lacks a symbol, **only that symbol falls back to a STIX Two vector glyph**, and the editor indicates the fallback. MathJax uses bundled mathematical syntax and prepared font data. Reading installed `.sty` files or TeX fonts is handled by Local LaTeX mode. MathJax support follows the [AMS documentation](https://docs.mathjax.org/en/latest/input/tex/extensions/ams.html) and the documentation for each extension.

## Using Installed LaTeX

**Local compilation is currently supported on Linux.** It requires installed `latex` or `xelatex`, `dvisvgm`, `bubblewrap`, and `prlimit`. Package detection uses `kpsewhich`. For example, on Debian or Ubuntu:

```sh
sudo apt install texlive-latex-extra texlive-fonts-recommended texlive-science texlive-xetex dvisvgm bubblewrap util-linux
```

The app checks the executables and whether isolated execution actually works. If the kernel or system policy blocks bubblewrap isolation, local compilation controls remain disabled. MathJax editing and viewing, presenting, and exporting saved equation results remain available.

1. Choose **Local LaTeX · Installed packages** for an equation.
2. Select LaTeX or XeLaTeX under **TeX engine**.
3. Enter packages, macros, and font settings in **PREAMBLE**, and the equation body in **LATEX SOURCE**.
4. Click **Compile with LaTeX**. Review the result, then click **Apply equation** to apply it to the slide.

Example LaTeX preamble:

```latex
\usepackage{amsmath,amsfonts,amssymb,physics}
```

Example using an installed OpenType math font with XeLaTeX:

```latex
\usepackage{amsmath}
\usepackage{unicode-math}
\setmathfont{Latin Modern Math}
```

Equations are compiled inside a one-page document generated by the app. Enter the preamble and body separately instead of pasting a complete document with `\documentclass` and `\begin{document}`. LaTeX uses **DVI → SVG**, while XeLaTeX uses **XDV → SVG**, converting glyphs to vector paths. pdfLaTeX and LuaLaTeX execution are not currently provided.

Compilation requires an explicit button click. Opening files, presenting, and exporting do not execute equation source. Changing input or switching equations during compilation cancels the previous job and prevents stale results from being applied. Changes to source, preamble, engine, size, color, or display mode require recompilation. Position and rotation changes reuse the saved result.

The local worker uses only read-only system TeX and font paths and a temporary working directory. **`~/texmf` and package, macro, or font folders in the user's home directory are not currently mounted into the isolated environment.** The implementation targets system-installed packages and does not support packages that require external programs or shell escape. On macOS and Windows, executable detection is available, but local compilation remains disabled until an OS-specific isolation worker is implemented.

## Source Files and Portable Equation Results

New `.scislide` files use **`0.2.0`** as their `formatVersion`. The app migrates existing `0.1.0` files to MathJax equations and uses 0.2.0 on the next save. Opening an existing file does not modify it. Older SciSlide 0.1.x apps may not read the new format.

```text
presentation.scislide
  manifest.json              Resource sizes, SHA-256 hashes and rendering profiles
  document.json              Slides, editable source, styles and local TeX configuration
  assets/                    Original/sanitized figure assets
  renders/<equation-id>.svg   Successful outlined Local LaTeX results
```

Local LaTeX equations retain their source, preamble, engine, result SVG and dimensions, input matching information, compiler and converter versions, and hashes of the dependencies used. SVG results are stored as validated vector shapes without external references, scripts, or text font dependencies. **Valid saved results can be viewed, presented, and exported to PDF/SVG on computers without TeX and in the web editor.** Recompilation requires a supported environment with the necessary packages and fonts. Missing caches or caches that do not match the source produce an error and are rejected during export.

## Implemented Features

- Four Scientific slide templates and a blank slide; slide creation, duplication, deletion, reordering, titles, backgrounds, and speaker notes.
- Text, equations, SVG/PNG/JPEG figures, rectangles, and ellipses.
- Moving, resizing, rotation, opacity, locking, duplication, and layer ordering.
- Shift+click multi-selection, alignment, snapping to a 20 px grid, and keyboard movement.
- Undo/redo and automatic recovery through localStorage in the current editing environment.
- ZIP-based source file saving and loading, with checksum validation for assets and equation results.
- MathJax 4.1.3, three equation fonts, and 17 package entries with examples.
- Electron native file operations, menus, and isolated Local LaTeX compilation.
- PDF and SVG export. Equations and supported SVG figures remain vector graphics.

## Current Limitations

- Korean text works in the editor and source files. **PDF body text supports only the character coverage of the bundled Inter Latin fonts**; unsupported characters, including Korean, stop export with a clear error. Outlining Local LaTeX equations does not expand font support for ordinary body text. SVG body text may look different on other computers because of browser font fallback.
- Figure cropping, PDF figure import, animations, master slides, collaboration, and PPTX/Beamer conversion are not yet available.
- Local LaTeX is an initial implementation targeting system installations on Linux. Arbitrary complete documents, home package folders, every TeX distribution path, and every package combination are not guaranteed to work.
- External references and active content in SVG figures are unsupported. PDF export does not support filters, masks, textPath, or some complex SVG effects. These produce an error before export.
- Automatic recovery uses separate localStorage in the web and Electron environments. Recovery data is not shared automatically, and multiple large figures may exceed storage limits. Save a source file. Recovery of unapplied equation drafts is not guaranteed.
- Bundling the complete MathJax font data makes the build large. Split loading and an IndexedDB asset store remain future work.

## Development and Validation

```sh
pnpm test
pnpm test:desktop
pnpm build
```

Web tests cover document validation, legacy file migration, ZIP round trips, checksums, SVG sanitization, equation cache matching, and MathJax packages and fonts. Desktop tests cover input validation for the narrow file and compiler APIs, plus Linux TeX isolation, compilation, cancellation, and resource limits. Running the TeX integration tests requires the tools listed above and a functioning Linux isolation environment. `pnpm build` includes TypeScript checks and a production build.

Electron runtime validation covered sandboxing and context isolation, blocked Node access, the secure local origin, SHA-256, bundled fonts, MathJax, native file operations, and delivery of actual LaTeX vector results. Launching the Linux x64 package from another location also verified Compile → Apply, preservation of unapplied drafts, recompilation after resizing, native save → new presentation → reopen, and PDF/SVG export. These checks do not replace installer validation or complete distribution validation across all three operating systems.

```text
 desktop/main.cjs              Native window, menu, file operations and IPC validation
 desktop/preload.cjs           Narrow renderer-to-desktop API
 desktop/host-utils.cjs        Testable origin, resource and request validation
 desktop/tex.mjs               Installed TeX detection and isolated compiler worker
 scripts/desktop-dev.mjs       Vite + Electron development launcher
 scripts/package-desktop.mjs   Current-platform application packaging
 src/App.tsx                   Editor, history and equation draft/compile/apply flow
 src/components/SlideScene.tsx Shared editor, thumbnail and slideshow scene
 src/components/MathSupportDialog.tsx  MathJax package catalog and live examples
 src/lib/model.ts              Versioned document model and migration
 src/lib/slide-templates.ts    Editable scientific starter layouts
 src/lib/persistence.ts        Native archive, validation, recovery and figure import
 src/lib/desktop.ts            Typed platform and local compiler contract
 src/lib/equations.ts          MathJax renderer and font profiles
 src/lib/equation-renderer.ts  Renderer selection and saved local-result checks
 src/lib/local-equation-svg.ts Passive outlined SVG validation
 src/lib/export.ts             Vector PDF/SVG exporters and resource preflight
 tests/                        Document, equation, archive and compiler regressions
 public/fonts/                 Bundled Inter TrueType fonts for PDF
 third-party-licenses/         Dependency and font license notices
```

## Future Development and Licensing

Priorities include fonts for Korean PDF text, an IndexedDB asset store, draft recovery, figure cropping, split loading of font data, and desktop distribution validation. Local TeX isolation on macOS and Windows, along with access to explicitly selected user package folders, requires separate implementation. See the [project specification](SciSlide-Project-Specification.md) for the detailed design and follow-up requirements.

This prototype does not reuse PPTist code. **A project license for the new SciSlide source has not yet been selected.** The license and contribution rules must be finalized before a public release. Bundled dependencies, fonts, and the Electron runtime retain their respective licenses; notices are kept in `third-party-licenses/` and the packaged runtime.
