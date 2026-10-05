# SciSlide 0.6.0 — Linux x64 standalone app

Run the `scislide` executable in this folder. Keep the Electron runtime files together. Node.js, TeX and a development server are not required for MathJax editing.

```sh
./scislide
```

For system installation, the separate `SciSlide-0.6.0-linux-x64.deb` adds a desktop launcher and icon. Install it with `sudo apt install ./SciSlide-0.6.0-linux-x64.deb`, then launch `scislide`. Ubuntu 24.04 x64 is the packaging target; Debian calls the architecture `amd64`. No SciSlide APT repository or Snap package is currently provided.

## Start and edit a presentation

Choose **Scientific**, **Minimal White**, **Minimal Black**, **Navy** or **Keynote White**, then **Create presentation**. **Open presentation** loads a `.scislide` file, **Resume previous work** restores a recovered workspace and **Explore demo** opens the sample deck. Keynote White has fifteen coordinated white/black layouts; the other themes retain fourteen Scientific/Keynote-inspired layouts. **New slide** or **+** opens the theme's picker, including **Blank slide**. Added slides are editable and can be undone.

Double-click text or press **Enter** on a selected text box to edit on the slide. **Enter** adds a line, **Ctrl+Enter** or clicking outside applies one undoable edit, and **Escape** cancels. Korean IME input and plain-text paste are supported. Write `$\chi$` or `\(\frac{1}{2}\)` inside a text box for inline mathematics. MathJax formulas match the surrounding font's lowercase height and preserve their mathematical baseline; tall formulas expand their own line's spacing. Editing and native saves retain the original source. PDF/SVG preserve vector formulas and selectable ordinary text.

**Open / Save / Save As** use native dialogs. Save updates the selected source file; **Export** saves all slides as PDF or the current slide as SVG. Copy bundled examples to your documents folder before editing them. `examples/inline-math.scislide` demonstrates English/Korean inline formulas, `examples/keynote-white-theme.scislide` contains all fifteen layouts, and `examples/electron-local-latex.scislide` includes a saved Local LaTeX result. Scientific demonstration data is synthetic.

## Figures and object layout

**Figure** imports PNG, JPEG, sanitized SVG or a selected PDF page. PDF preview/selection embeds a high-resolution PNG; original PDF vector preservation remains future work. In **CROP & INSET**, apply/reset a reversible crop, create an independent enlarged inset, or replace a figure's source while preserving its frame and crop. Supported SVG content stays vector graphics in PDF/SVG. Selecting a Keynote White photo/video placeholder before **Figure / Video** fills its frame; photo crops remain adjustable.

Choose **Draw rectangle / ellipse / line / arrow**, then drag. **Shift** constrains geometry; **Escape** cancels. The Inspector controls stroke color/width/style, no-fill outlines and arrowheads. Drag a selected line/arrow's endpoints to edit it. Shapes export as vectors.

**Shift+click** selects objects. **Ctrl+G / Ctrl+Shift+G** group/ungroup; flat groups move together and duplicate independently. Ungroup before resizing or rotating a member. Use six-way alignment and equal-gap distribution for a selection. Smart guides help while moving/resizing; **Alt** bypasses them. Separate **Snap to 20 px grid** takes precedence. **OBJECTS & LAYERS** selects hidden/covered objects and controls visibility, locks and order. Object copy/cut/paste works across slides or decks in one session. Nested groups, whole-group scaling/rotation, attached connectors and freehand paths remain planned.

## Shortcuts, recovery and presentation

Linux shortcuts use **Ctrl** and **Alt**. **Ctrl+O / Ctrl+S / Ctrl+Shift+S** open/save/save as; **Ctrl+Z / Ctrl+Shift+Z** undo/redo. **Ctrl+Enter** presents from the canvas, **Ctrl+Alt+P / Ctrl+Alt+S** export PDF/current-slide SVG and **Ctrl+Shift+/** opens platform shortcut help. While editing text, Ctrl+Enter applies the edit without presenting. Text-field clipboard and IME behavior are preserved.

**My equations** stores named/tagged formulas locally and transfers them through JSON import/export. Recovery uses IndexedDB, bounded to 100 MiB, and retains up to 200 unfinished equation drafts, with a localStorage fallback. Personal libraries and unapplied drafts are workspace data, separate from portable source files; save explicitly and check failure feedback.

**Presenter display** opens a separate window with current/next previews, notes, navigation and a configurable timer; move it to your presenter screen. Audience video playback remains separate from passive presenter previews. **Video** embeds MP4/WebM; PDF/SVG use static labeled placeholders. Deck-wide page numbers and ordered click-triggered appear/fade builds are available. Live-camera feeds, automatic multi-monitor placement and advanced animation remain future work.

## Installed tools and compatibility

**Local LaTeX** requires supported system-installed `latex` or `xelatex`, `dvisvgm`, `kpsewhich`, **bubblewrap 0.9.0 or later** and `prlimit`, with working isolation. Set **PREAMBLE** and **LATEX SOURCE**, then explicitly **Compile with LaTeX → Apply equation**. Changing size/color requires recompilation. Home-installed `~/texmf` packages and personal font folders are not connected. Valid saved vector results remain viewable/exportable without TeX. Inline text formulas use MathJax rather than Local LaTeX.

**AI draft** uses a compatible installed Codex CLI, Claude Code or Gemini CLI. Install and authenticate the provider separately, choose 1–12 slides, then generate and review the preview before inserting. Current-slide context is optional; requests use the provider's account, network and usage limits. **Cancel** stops a job and **Undo** reverses insertion. Detection alone does not verify authentication; unsupported versions/configurations show a reason.

New saves use native format **0.5.0**, including reversible figure crops. Formats **0.1.0–0.4.0** migrate on opening; the original changes only when saved. Apps that read only 0.4.0 or earlier cannot open new 0.5.0 files. Use **Save As** to retain an older original; PDF/SVG does not downgrade editable source.

Modern Korean body text uses bundled Nanum Gothic; unsupported body-text glyphs still produce a PDF export error. PPTX/HTML export, signed distribution and automatic updates remain future work. Packaging checks do not establish complete installed-desktop validation.

Electron/Chromium notices are in `LICENSE` and `LICENSES.chromium.html`. App dependency notices are in `resources/app.asar` under `third-party-licenses/`. A license for the new SciSlide source has not yet been selected.
