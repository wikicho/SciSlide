# SciSlide

A scientific presentation editor with editable equations, vector output, and an Electron desktop host.

**v0.5.0 is a working prototype.** The shared React/TypeScript editor runs in a browser or Electron. MathJax provides immediate equation previews; the desktop app can explicitly compile equations with installed LaTeX or XeLaTeX on supported Linux systems. Draw rectangles, ellipses, lines and arrows, edit line endpoints, and move persistent groups with automatic alignment guides. The included three-slide cosmology deck uses synthetic demonstration data. Compatible installed AI CLIs generate editable slide drafts. Deck-wide page numbers, embedded video, and ordered click-triggered builds remain available.

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

The default output paths are `release/SciSlide-0.5.0-macos-arm64-unsigned.pkg` and `release/SciSlide-0.5.0-macos-x64-unsigned.pkg`. Each installer also has a SHA-256 checksum file. The installation location is `/Applications/SciSlide.app`. See the [macOS installation guide](desktop/MACOS.md) for architecture selection and current limitations.

The default `.pkg` implementation uses [Electron's official pure JavaScript packaging](https://packages.electronjs.org/osx-sign/v2.6.0/index.html#pure-javascript-packaging), so it also works on Linux. On macOS with Xcode Command Line Tools, use `pnpm desktop:package:mac --implementation=native` to package with Apple's `pkgbuild` and `productbuild`. **Both methods produce development installers without Developer ID signing or notarization.** macOS security policies may block installation or launch. The packaging process does not change system security settings.

The repository's **macOS development installers** Actions workflow builds the editor once on a macOS runner and creates native `.pkg` installers for both architectures. It runs when packaging configuration changes or through Actions' **Run workflow** control. The versioned artifacts contain the installer, checksum, and installation guide for each architecture and are retained for 30 days. No additional secrets or Apple account are used. Installation, editing, file saving, and export on a physical Mac, along with signed distribution, require separate validation.

Build **Windows x64** distributions on Windows with Inno Setup 6.7 or later:

```sh
pnpm desktop:package:win
# Portable ZIP only; also supported from Linux and macOS:
pnpm desktop:package:win --portable-only
```

This command always targets **Intel/AMD x64**, regardless of the build host. It creates `release/SciSlide-0.5.0-windows-x64-setup-unsigned.exe` and `release/SciSlide-0.5.0-windows-x64-portable.zip`, with SHA-256 checksum files. The installer uses an x64 bootstrap executable, installs for the current user under `%LOCALAPPDATA%\Programs\SciSlide`, and adds a Start menu shortcut. The portable ZIP contains the complete app folder; extract it and launch `SciSlide-win32-x64/scislide.exe`. No Node.js or TeX installation is needed to run MathJax editing.

See the [Windows installation and build guide](desktop/WINDOWS.md) for compiler selection, checksums and platform limits. The **Windows x64 development distributions** Actions workflow builds on a Windows x64 runner, verifies the executable architectures and hashes, and checks installation/uninstallation in a temporary directory. Its versioned downloadable artifacts contain both distributions and are retained for 30 days. Windows 10 or later is required; physical Windows 10/11 editing and export validation remains open. Local LaTeX compilation is currently disabled on Windows.

**Windows distributions are unsigned development builds.** Windows security policies may block installation or launch. Automatic updates, macOS notarization, Windows signing, and complete distribution validation across all three operating systems remain future work.

## Using the Editor

1. Select a slide from the thumbnails on the left. On narrow screens, use the slide selector above the canvas.
2. Add objects with **Text / Equation / Figure / Video**. Figures support SVG, PNG, and JPEG; videos support local MP4 and WebM files.
3. Click and drag an object to move it. Resize it with the lower-right handle, or enter its position, rotation, and color in the Inspector.
4. Select an equation, then choose **MathJax · Live preview** or **Local LaTeX · Installed packages**. Equation source and previews are not applied to the slide until you click **Apply equation**.
5. Desktop **Open / Save / Save As** use native file dialogs. Save writes to the selected original path; Save As lets you choose a new path. The web version downloads the source file.
6. Use **Present** for the slideshow, and **Export** to save all slides as a PDF or the current slide as an SVG.

The desktop menu provides New Presentation, Open, Save, Save As, undo/redo, presentation mode, and PDF export. A successful save notification appears after the native file write completes. The web version distinguishes starting a download from completing a save to disk.

## Drawing and Groups

Choose **Draw rectangle**, **Draw ellipse**, **Draw line** or **Draw arrow**, then drag across the canvas to draw. Hold **Shift** to constrain a rectangle/ellipse to a square/circle or constrain a line/arrow direction. **Escape** cancels drawing. Select a line or arrow and drag either endpoint to change its direction and length.

The shape Inspector controls stroke color, width and **Solid / Dashed / Dotted** style. Rectangles and ellipses support **No fill** for outlining a region of a scientific figure. Arrowheads can appear at the start, end or both ends of a line, including bidirectional arrows. These shapes remain editable objects and export as vectors in PDF and SVG.

Use **Shift+click** to select several objects, then **Group objects** to keep them together. **Ctrl+G** groups and **Ctrl+Shift+G** ungroups; on macOS use **Cmd** instead of Ctrl. Clicking a grouped member selects the group, and dragging moves its members together. Duplicate creates an independent group; **Ungroup objects** leaves each object's current position intact. Ungroup before resizing, rotating or editing the endpoints of an individual member. Group membership survives save/open and undo/redo. Groups are flat: nested groups and whole-group scaling or rotation are not available yet.

Automatic alignment guides appear while dragging near another object's edges or center. Hold **Alt** to bypass the guides. **Snap to 20 px grid** separately enables grid snapping, which takes precedence over object guides. Guide lines are editor aids and are not saved or exported. Equal distribution, connectors that track attached shapes, freehand paths and a path editor remain future work.

## AI Slide Drafts

Open **AI draft** in the Electron desktop app, choose an installed **Codex CLI / Claude Code / Gemini CLI**, enter your topic and choose 1–12 slides. Install and sign in to the CLI in your terminal first. **Refresh AI connections** checks its version and required controls; finding an executable does not prove its account is authenticated. Unsupported CLI versions show a reason. A desktop chatbot app alone is not a CLI connection.

The reviewed connections are **Codex CLI 0.160.x** and **Gemini CLI 0.62.x**. Claude Code must advertise every required safe-mode, restricted, tool-disabling and structured-output flag. Other versions may appear as unavailable until their controls are reviewed. Gemini connections are unavailable when system settings/defaults prevent SciSlide from verifying the content-only configuration.

**Generate draft** sends your instructions through that provider's existing login. Optionally include the current slide's visible text, equations and speaker notes; a preview shows the exact context. Figures, video bytes, file paths and local TeX configuration are excluded. Existing provider network requirements, data policies, account limits and any account charges still apply. SciSlide does not store API keys or read credential contents.

Review the generated slides and notes, then click **Insert draft slides** to add them after the current slide. Generated titles, bullet points and MathJax equations are ordinary editable objects. MathJax syntax and equation size are checked before insertion. Scientific claims and citations need review. Invalid output is rejected, and a changed source slide requires a fresh draft. Undo restores the previous deck. The draft's overall title labels its preview and does not rename the presentation.

The host uses fixed provider commands and passes requests through stdin in a private temporary workspace. Codex runs with read-only enforcement and restricted agent integrations; compatible Claude/Gemini modes disable content-generation tools. Gemini reuses existing authentication through private temporary links to known vendor authentication files, or its normal keychain/environment authentication; those links are removed at job completion. User customizations and organization policies can make a connection unavailable. Requests time out after three minutes, output is bounded, and Cancel or closing the dialog terminates the job. Only one generation runs at a time.

The web editor shows the desktop requirement and does not launch local programs. Image generation, file/repository access, web research, full-deck replacement, streaming chat and direct API-key setup are later features. Native `.scislide` documents use format version **0.4.0**.

## Korean Text Export

The bundled Nanum Gothic fonts are unchanged static TrueType files from a pinned revision of [Google Fonts](https://github.com/google/fonts/tree/133ccbee9a8b408eb71f31a36ccb9116f5c695ad/ofl/nanumgothic). They use [SIL Open Font License 1.1](third-party-licenses/nanum-gothic/OFL.txt), which permits software bundling and document embedding. The copyright, license, source revision and asset checksums are included in `third-party-licenses/nanum-gothic/`. Korean PDF exports embed subsets of the used fonts; mathematical equations remain vector graphics.

## Slide Templates

Click **New slide** or **+** in the slide list to choose a built-in Scientific template. Four layouts are available: **Research title**, **Key findings**, **Equation + meaning**, and **Figure comparison**, along with a **Blank** slide. The selected layout is inserted after the current slide.

Template titles, body text, equations, and shapes are ordinary editable objects. Change the text, or move and delete objects to suit your presentation. Equations inherit the presentation's current equation font and color, and you can edit the example expressions. Figure comparison uses editable rectangles and instructions as figure placeholders. Add actual images with **Figure**, then delete the placeholder objects. Templates do not download external images or additional fonts.

## Page Numbers

Click an empty area of the canvas to open the deck Inspector, then use **PAGE NUMBERS → Show page numbers**. Choose bottom-left/center/right placement, a number or number/last-number format, starting number, size and color. Optionally hide the first slide's number. The number is calculated from current slide order, so inserting, duplicating, deleting or reordering slides updates it automatically. Settings are saved in the source file and can be undone/redone.

New decks show bottom-right numbers starting at 1; older files open without numbers. Hiding the first number keeps the sequence unchanged. With three slides starting at 5, the number/last-number format reads `5 / 7`, `6 / 7`, `7 / 7`. Page numbers appear in the editor, slideshow, PDF and SVG through the same scene. They are separate from ordinary text objects and stay visible during click builds. Linked master slides, section numbering and custom footer templates are later features.

## Click Builds and Animation Preparation

Select an object and open **APPEARANCE STEPS** in the Inspector to leave it visible from slide entry (**step 0**) or reveal it at a numbered click step (**1–100**). Objects sharing a step appear together. Choose **Appear** for an immediate reveal or **Fade in** for a short transition; fade duration is bounded to **100–3000 ms**.

In presentation mode, **Next**, the right arrow or Space reveals the next populated build before moving to the next slide. Unused step numbers do not require extra clicks. Backward navigation returns to a previous build state; moving back to the previous slide shows its final state. The editor and thumbnails always show the complete layout, and saved build settings do not change an object's ordinary visibility or geometry. PDF/SVG export uses the final build state.

This is the foundation for later animation controls. A timeline, exit/move/scale effects, timing chains, per-term equation highlighting and one-page-per-build export are not included yet. Media playback controls do not advance builds.

## Embedded Videos

Click **Video**, choose a local **MP4** or **WebM** file, then move/resize the video like a figure. The **VIDEO** Inspector offers **Play when revealed**, **Loop video**, **Mute audio** and **Show playback controls**. Automatic playback remains subject to the runtime's autoplay policy; manual playback controls remain available when needed. Videos play only while presenting. The editor and thumbnails use a static placeholder; leaving the slide or presentation stops playback.

Videos are embedded in the `.scislide` archive, so a successful native save does not depend on the original file path. Each video is limited to **40 MiB**, the complete saved archive to **64 MiB**, and its expanded resources to **100 MiB**. MP4/WebM are containers: codec support depends on the browser/Electron runtime, and an unsupported video produces a playback error. No transcoding, streaming URL import, trimming, subtitles or video export is provided.

**PDF/SVG export includes a labeled static video placeholder and cannot play the video.** Large media can exceed automatic recovery storage; check save/recovery feedback and save a source file rather than relying on recovery. No video is automatically uploaded or downloaded from a remote service.

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

New `.scislide` files use **`0.4.0`** as their `formatVersion`, including line/arrow geometry, stroke styles and persistent group membership. The app reads `0.1.0`, `0.2.0` and `0.3.0` files, migrates older data, and writes 0.4.0 on the next save. Version 0.1.0/0.2.0 files receive disabled page numbering and no click builds; 0.3.0 files retain their existing settings. Opening an existing file does not modify it. **SciSlide versions that only support format 0.3.0 or earlier cannot read new 0.4.0 files.** Use Save As to keep an older original if you need it; exporting PDF/SVG provides viewable output, not a downgrade of the editable source.

```text
presentation.scislide
  manifest.json              Resource sizes, SHA-256 hashes and rendering profiles
  document.json              Slides, page numbers, builds, video settings and editable source
  assets/                    Original/sanitized figures and embedded video files
  renders/<equation-id>.svg   Successful outlined Local LaTeX results
```

Local LaTeX equations retain their source, preamble, engine, result SVG and dimensions, input matching information, compiler and converter versions, and hashes of the dependencies used. SVG results are stored as validated vector shapes without external references, scripts, or text font dependencies. **Valid saved results can be viewed, presented, and exported to PDF/SVG on computers without TeX and in the web editor.** Recompilation requires a supported environment with the necessary packages and fonts. Missing caches or caches that do not match the source produce an error and are rejected during export.

## Implemented Features

- Installed AI CLI discovery, bounded draft generation, slide preview/insertion, cancellation and undo.
- Four Scientific slide templates and a blank slide; slide creation, duplication, deletion, reordering, titles, backgrounds, and speaker notes.
- Text, equations, SVG/PNG/JPEG figures, embedded MP4/WebM videos, and drag-drawn rectangles, ellipses, lines and arrows.
- Editable line endpoints, start/end/bidirectional arrowheads, solid/dashed/dotted strokes and unfilled shape outlines.
- Deck-wide dynamic page numbers in the editor, slideshow, PDF and SVG.
- Ordered click-triggered appear/fade builds; editor/thumbnails/static exports show the complete layout.
- Moving, resizing, rotation, opacity, locking, duplication, and layer ordering.
- Shift+click multi-selection, flat persistent groups, alignment, automatic drag guides, separate 20 px grid snapping, and keyboard movement.
- Undo/redo and automatic recovery through localStorage in the current editing environment.
- ZIP-based source file saving and loading, with checksum validation for assets and equation results.
- MathJax 4.1.3, three equation fonts, and 17 package entries with examples.
- Electron native file operations, menus, and isolated Local LaTeX compilation.
- PDF and SVG export. Equations and supported SVG figures remain vector graphics.

## Current Limitations

- Modern Korean text is supported in the editor, PDF and SVG through bundled **Nanum Gothic Regular/Bold**. No system font installation or remote font request is needed. Text objects containing Korean use Nanum Gothic; Latin-only objects retain Inter. Korean weights 400/500 use Regular and 600/700 use Bold. Decomposed modern Hangul is normalized to NFC for display/export while the editable source is preserved. PDF text remains selectable, and SVG embeds the required font and its license. Unsupported glyphs, including Hanja and standalone old/combining Jamo, still stop PDF export with a clear error; use native equations for mathematical symbols unavailable in the text font. Local LaTeX equation outlines do not extend body-text font coverage.
- Figure cropping/PDF region import/insets, equal distribution, linked masters, a separate presenter display, equation libraries/shared macros, citations, editable charts, collaboration and PPTX/Beamer conversion are planned. Group nesting/scaling/rotation, attached connectors, freehand paths and a path editor are also future work. Basic appear/fade click builds are available; advanced motion, exit effects, timing chains, equation-term highlighting and a timeline are not yet available.
- Local LaTeX is an initial implementation targeting system installations on Linux. Arbitrary complete documents, home package folders, every TeX distribution path, and every package combination are not guaranteed to work.
- External references and active content in SVG figures are unsupported. PDF export does not support filters, masks, textPath, or some complex SVG effects. These produce an error before export.
- Automatic recovery uses separate localStorage in the web and Electron environments. Recovery data is not shared automatically, and large figures and embedded videos may exceed storage limits. Save a source file. Recovery of unapplied equation drafts is not guaranteed.
- Bundling the complete MathJax font data makes the build large. Split loading and an IndexedDB asset store remain future work.

## Development and Validation

```sh
pnpm test
pnpm test:desktop
pnpm build
```

Web tests cover document validation, legacy file migration, ZIP round trips, checksums, SVG sanitization, equation cache matching, and MathJax packages and fonts. New regression fixtures cover numbering/build state, video resource validation and static video export policy. Desktop tests cover input validation for the narrow file and compiler APIs, plus Linux TeX isolation, compilation, cancellation, and resource limits. Running the TeX integration tests requires the tools listed above and a functioning Linux isolation environment. `pnpm build` includes TypeScript checks and a production build.

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
 src/lib/presentation.ts      Deterministic click-build visibility and navigation
 src/lib/persistence.ts        Native archive, validation, recovery and figure import
 src/lib/desktop.ts            Typed platform and local compiler contract
 src/lib/equations.ts          MathJax renderer and font profiles
 src/lib/equation-renderer.ts  Renderer selection and saved local-result checks
 src/lib/local-equation-svg.ts Passive outlined SVG validation
 src/lib/export.ts             Vector PDF/SVG exporters and resource preflight
 tests/                        Document, equation, archive and compiler regressions
 public/fonts/                 Bundled Inter and Nanum Gothic TrueType fonts
 third-party-licenses/         Dependency and font license notices
```

## Future Development and Licensing

Priorities include bounded asset/draft recovery, figure crop/PDF region import/enlarged insets, equal distribution and richer group transforms, themes/masters, equation libraries/shared macros, a separate presenter display, citations/BibTeX and CSV charts with units/error bars. Attached connectors, freehand paths, advanced animation, split font loading and desktop distribution validation remain follow-up work. Local TeX isolation on macOS and Windows, along with access to explicitly selected user package folders, requires separate implementation. See the [project specification](SciSlide-Project-Specification.md) for the detailed design and follow-up requirements.

This prototype does not reuse PPTist code. **A project license for the new SciSlide source has not yet been selected.** The license and contribution rules must be finalized before a public release. Bundled dependencies, fonts, and the Electron runtime retain their respective licenses; notices are kept in `third-party-licenses/` and the packaged runtime.
