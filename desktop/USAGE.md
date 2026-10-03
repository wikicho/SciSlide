# SciSlide 0.5.0 — Linux x64

Run the `scislide` executable in this folder. Keep the runtime files together. Node.js and a development server are not required.

```sh
./scislide
```

Use **Open** to load a `.scislide` presentation. The bundled `examples/electron-local-latex.scislide` includes a saved Local LaTeX result. **Save** updates the selected document; **Export** saves a PDF or the current slide as SVG.

Choose **New slide** or the **+** button in the slide list to open the Scientific template picker. Research-title, key-findings, equation/meaning, figure-comparison and **Blank** layouts are available. A new slide is inserted after the current slide, with editable text, equations and shapes. Figure placeholders are guide shapes: insert your image with **Figure**, then remove the guide objects.

Use the inspector to enable deck-wide page numbers. **Video** embeds MP4 or WebM files for playback in presentation mode; static exports show a labeled placeholder. Object builds support ordered click-triggered appear/fade steps. Advanced motion effects remain planned.

## Drawing and groups

Choose **Draw rectangle**, **Draw ellipse**, **Draw line** or **Draw arrow**, then drag on the canvas. Shift constrains squares/circles or line direction; Escape cancels drawing. Drag a selected line/arrow's endpoints to edit it. The Inspector provides solid/dashed/dotted strokes, stroke width/color, no-fill outlines and arrowheads at the start, end or both ends. Shapes export as vectors in PDF/SVG.

Shift+click selects objects for **Group objects / Ungroup objects**; Ctrl+G groups and Ctrl+Shift+G ungroups. Groups move together and duplicated groups stay independent. Ungroup before resizing, rotating or editing an individual member's endpoints. Group membership survives save/open and undo/redo. Automatic alignment guides appear while dragging; Alt bypasses them. **Snap to 20 px grid** enables grid snapping with precedence over object guides. Nested groups, collective group scaling/rotation, equal distribution, attached connectors and freehand paths remain planned.

New saves use native format **0.4.0**. Versions 0.1.0/0.2.0/0.3.0 are migrated on opening; the original is untouched until Save. Apps that support only 0.3.0 or earlier cannot read new 0.4.0 files. Save As can preserve an older original; PDF/SVG is a rendered export, not an editable-format downgrade.

## AI content drafts

Open **AI draft**, choose a compatible installed Codex CLI, Claude Code or Gemini CLI, enter a topic and select 1–12 slides. Install and sign in to the chosen CLI in your terminal first. A desktop chatbot application alone does not provide a CLI connection. Refresh checks executable versions and required controls; generation verifies that the account can actually respond.

Including the current slide's visible text, equations and speaker notes is optional. Generate uses the provider's existing login, network connection and usage limits. Review the preview, then use **Insert draft slides** to add editable slides after the current slide. **Undo** reverses the insertion. **Cancel** stops the active request; requests also have a time limit. Unsupported CLI versions or settings show a reason. See the repository README for compatibility details.

## Equations and current limits

**MathJax** works without a TeX installation. **Local LaTeX** uses the Linux system's `latex` or `xelatex`, `dvisvgm`, `bubblewrap` and `prlimit`. Enter package/font settings in **PREAMBLE** and the equation in **LATEX SOURCE**, then select **Compile with LaTeX → Apply equation**. Changing size or color requires recompilation.

Isolated compilation uses supported system TeX/font paths. Home-installed `~/texmf` packages and personal font folders are not connected yet. Presentations with saved equation results can be viewed, presented and exported without TeX.

This is a prototype. Modern Korean body text uses bundled Nanum Gothic in the editor, PDF and SVG. Font files and the SIL OFL 1.1 notice are included; no separate font installation is needed. Unsupported scripts and glyphs still produce an export error. Figure cropping, advanced animation, PPTX conversion, signed installers and automatic updates remain planned.

Electron/Chromium notices are in `LICENSE` and `LICENSES.chromium.html`. Application dependency notices are in `resources/app.asar` under `third-party-licenses/`. The license for the new SciSlide project source has not yet been selected.
