# SciSlide 0.6.3.1 — Linux x64 standalone app

Run the `scislide` executable in this folder. Keep the Electron runtime files together. Node.js, TeX and a development server are not required for MathJax editing.

```sh
./scislide
```

For system installation, the separate `SciSlide-0.6.3.1-linux-x64.deb` adds a desktop launcher and icon. Install it with `sudo apt install ./SciSlide-0.6.3.1-linux-x64.deb`, then launch `scislide`. Ubuntu 24.04 x64 is the packaging target; Debian calls the architecture `amd64`. No SciSlide APT repository or Snap package is currently provided.

## Update CLI

Portable builds include `bin/scislide`; Debian packages expose it as `scislide`. Run `scislide --check-update` to check only, or `scislide --update` to download a newer matching installer from GitHub Releases. The default destination is `~/Downloads/SciSlide-updates`; `--output DIR` changes it. Development prereleases are included unless `--stable` is specified. SHA-256 is verified before success, and the CLI prints the installer path and installation command. Installation remains a separate step. The bundled runtime handles the CLI without opening an editor or requiring Node.js. Published v0.6.2 packages predate this feature.

**Upgrading from v0.6.3:** download and install v0.6.3.1 directly from the release page. The old update CLI accepts only three-part versions and ignores this four-part release tag. The v0.6.3.1 CLI supports both three-part and four-part versions; installer execution remains a separate step.

## Headless agent commands

v0.6.3.1 includes `schema`, `create`, `inspect`, `validate`, `apply`, `unpack`, `pack` and `export`. Run `scislide --cli schema` to discover native objects and edit operations. These commands return JSON and create/edit `.scislide` documents or export SVG/PDF without an editor window or a separate Node installation. Use the launcher path above when `scislide` is not on PATH. See the [agent CLI guide](https://github.com/wikicho/SciSlide/blob/v0.6.3.1/docs/AGENT_CLI.md) for examples and export limits.

## Start and edit a presentation

Choose **Scientific**, **Minimal White**, **Minimal Black**, **Navy** or **Keynote White**, then **Create presentation**. **Open presentation** loads a `.scislide` file, **Resume previous work** restores a recovered workspace and **Explore demo** opens the sample deck. Keynote White has fifteen coordinated white/black layouts; the other themes retain fourteen Scientific/Keynote-inspired layouts. **New slide** or **+** opens the theme's picker, including **Blank slide**. Added slides are editable and can be undone.

Double-click text or press **Enter** on a selected text box to edit on the slide. **Enter** adds a line, **Ctrl+Enter** or clicking outside applies one undoable edit, and **Escape** cancels. Korean IME input and plain-text paste are supported. Write `$\chi$` or `\(\frac{1}{2}\)` inside a text box for inline mathematics. MathJax formulas match the surrounding font's lowercase height and preserve their mathematical baseline; tall formulas expand their own line's spacing. Editing and native saves retain the original source. PDF/SVG preserve vector formulas and selectable ordinary text.

Press **Ctrl+Shift+M** in canvas or Inspector text to insert/edit an inline equation with a live LaTeX preview, or double-click a rendered formula. Apply preserves the surrounding prose; Escape returns to the previous text selection. Text frames grow to fit their content using loaded-font metrics; moving/resizing preserves rotated placement. Inspector text size and frame width/height fields commit on Enter or blur and cancel a pending value with Escape.

With the canvas focused, **Tab / Shift+Tab** selects eligible objects/groups in stacking order and follows normal UI focus order at the boundaries. **Ctrl+Alt+I / Ctrl+Shift+L** toggle and focus Inspector / Objects & Layers independently. Duplicate targets the focused thumbnail even with a retained canvas selection. Text fields, dialogs and playback retain their input; native menu availability follows focus, selection and busy state.

**Open / Save / Save As** use native dialogs. Save updates the selected source file; **Export** saves all slides as PDF or the current slide as SVG. Copy bundled examples to your documents folder before editing them. `examples/inline-math.scislide` demonstrates English/Korean inline formulas, `examples/keynote-white-theme.scislide` contains all fifteen layouts, and `examples/electron-local-latex.scislide` includes a saved Local LaTeX result. Scientific demonstration data is synthetic.

## Figures and object layout

**Figure** imports PNG, JPEG, sanitized SVG or a selected PDF page. PDF preview/selection embeds a high-resolution PNG; original PDF vector preservation remains future work. In **CROP & INSET**, apply/reset a reversible crop, create an independent enlarged inset, or replace a figure's source while preserving its frame and crop. Supported SVG content stays vector graphics in PDF/SVG. Selecting a Keynote White photo/video placeholder before **Figure / Video** fills its frame; photo crops remain adjustable.

Choose **Draw rectangle / ellipse / line / arrow**, then drag. **Shift** constrains geometry; **Escape** cancels. The Inspector controls stroke color/width/style, no-fill outlines and arrowheads. Drag a selected line/arrow's endpoints to edit it. Shapes export as vectors.

**Shift+click** selects objects. **Ctrl+Shift+G / Ctrl+Alt+Shift+G** group/ungroup; flat groups move together and duplicate independently. Ungroup before resizing or rotating a member. Use equal-gap distribution and Inspector text alignment for a selection. Smart guides help while moving/resizing; **Alt** bypasses them. Separate **Snap to 20 px grid** takes precedence. **OBJECTS & LAYERS** selects hidden/covered objects and controls visibility, locks and order. Object copy/cut/paste works across slides or decks in one session. Nested groups, whole-group scaling/rotation, attached connectors and freehand paths remain planned.

## Shortcuts, recovery and presentation

Linux shortcuts follow LibreOffice Impress for supported actions. **Ctrl+O / Ctrl+S / Ctrl+Shift+S** open/save/save as, **Ctrl+Z / Ctrl+Y** undo/redo, **Ctrl+M** opens the new-slide layout chooser, and **Shift+F3** immediately duplicates the selection or current slide. **F5 / Shift+F5** start at the first / current slide. **Page Up / Page Down** navigate slides; **Home / End** select the first / last. With a thumbnail focused, **Alt+Shift+Page Up / Page Down** moves it one position and **Alt+Shift+Home / End** moves it first / last. **Ctrl+Shift+Up / Down / Home / End** also move thumbnails.

For selected objects, **Ctrl++ / Ctrl+-** move one layer forward / backward, and **Ctrl+Shift++ / Ctrl+Shift+-** move to front / back. Use numeric-keypad **+** to distinguish layer-forward from front; main-keyboard **Ctrl+= / Ctrl+Shift+=** also performs those two actions. Bare **+ / -** zoom the canvas and numeric-keypad **\*** fits the slide to the window. **Ctrl+B** toggles bold, **Ctrl+] / Ctrl+[** changes font size, and **Ctrl+L / E / R** aligns whole selected text objects left / center / right.

**Alt+Shift+E** inserts an equation and **Ctrl+Alt+P / Ctrl+Alt+S** export PDF/current-slide SVG. **F1** opens platform shortcut help. Existing **Ctrl+D**, **Ctrl+G**, **Ctrl+Shift+Z**, **Ctrl+Shift+/** and **Ctrl+Enter** remain duplicate, group, Redo, help and present-current aliases. Equation insertion also accepts **Ctrl+Alt+=**. **Ctrl+Shift+G** now groups, matching Impress. During a slideshow, **Enter** advances a build or slide, **Backspace** goes back, and **Esc / -** exits. While editing text, Ctrl+Enter applies the edit without presenting; text-field clipboard, cursor, undo and IME behavior are preserved. See [LINUX.md](LINUX.md) for the complete reference and official sources.

**My equations** stores named/tagged formulas locally and transfers them through JSON import/export. Recovery uses IndexedDB, bounded to 100 MiB, and retains up to 200 unfinished equation drafts, with a localStorage fallback. Personal libraries and unapplied drafts are workspace data, separate from portable source files; save explicitly and check failure feedback.

**Presenter display** opens a separate window with current/next previews, notes, navigation and a configurable timer; move it to your presenter screen. Audience video playback remains separate from passive presenter previews. **Video** embeds MP4/WebM; PDF/SVG use static labeled placeholders. Deck-wide page numbers and ordered click-triggered appear/fade builds are available. Live-camera feeds, automatic multi-monitor placement and advanced animation remain future work.

## Installed tools and compatibility

**Local LaTeX** requires supported system-installed `latex` or `xelatex`, `dvisvgm`, `kpsewhich`, **bubblewrap 0.9.0 or later** and `prlimit`, with working isolation. Set **PREAMBLE** and **LATEX SOURCE**, then explicitly **Compile with LaTeX → Apply equation**. Changing size/color requires recompilation. Home-installed `~/texmf` packages and personal font folders are not connected. Valid saved vector results remain viewable/exportable without TeX. Inline text formulas use MathJax rather than Local LaTeX.

**AI draft** uses a compatible installed Codex CLI, Claude Code or Gemini CLI. Install and authenticate the provider separately, choose 1–12 slides, then generate and review the preview before inserting. Current-slide context is optional; requests use the provider's account, network and usage limits. **Cancel** stops a job and **Undo** reverses insertion. Detection alone does not verify authentication; unsupported versions/configurations show a reason.

New saves use native format **0.5.0**, including reversible figure crops. Formats **0.1.0–0.4.0** migrate on opening; the original changes only when saved. Apps that read only 0.4.0 or earlier cannot open new 0.5.0 files. Use **Save As** to retain an older original; PDF/SVG does not downgrade editable source.

Modern Korean body text uses bundled Nanum Gothic; unsupported body-text glyphs still produce a PDF export error. PPTX/HTML export, signed distribution and automatic updates remain future work. Packaging checks do not establish complete installed-desktop validation.

Electron/Chromium notices are in `LICENSE` and `LICENSES.chromium.html`. App dependency notices are in `resources/app.asar` under `third-party-licenses/`. A license for the new SciSlide source has not yet been selected.
