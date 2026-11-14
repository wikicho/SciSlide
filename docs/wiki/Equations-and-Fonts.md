# Equations and fonts

SciSlide **0.6.3.1** offers bundled **MathJax** rendering and explicit compilation through **system-installed LaTeX/XeLaTeX on supported Linux and macOS systems**. Inline formulas in ordinary text always use MathJax.

## Equation objects

1. Add an **Equation** or select an existing one.
2. Choose **MathJax · Live preview** or **Local LaTeX · Installed packages**.
3. Edit the source and settings; review the preview or compilation result.
4. Click **Apply equation** to commit it to the slide.

**Linux insertion:** **Alt+Shift+E** (legacy **Ctrl+Alt+=**) inserts an equation, reveals Inspector and focuses **LATEX SOURCE**.

Selecting another equation preserves the unfinished Inspector draft locally. A draft is not part of the saved slide until applied. See [[Editing-Slides]] for recovery and [[Keyboard-Shortcuts]] for equation insertion.

## MathJax notation and fonts

MathJax runs locally with bundled syntax and font data; it does not require TeX or a CDN. Choose **STIX Two**, **Fira Math** or **Latin Modern**. If Fira Math or Latin Modern lacks a symbol, that symbol uses a STIX Two vector glyph and the editor reports the fallback.

AMS mathematics, fonts and symbols are included by default. Examples include `\mathbb`, `\mathfrak`, `\mathcal`, `\mathscr`, `\boldsymbol`, `aligned`, `cases` and matrices:

```latex
\usepackage{amsmath,amsfonts,amssymb}
\mathbb{R}\supset\mathbb{Q}\supset\mathbb{Z}
\qquad\mathfrak{g}\qquad\boldsymbol{\alpha}
```

Open **AMS fonts & symbols / Packages & examples** to browse the supported catalog with live examples. Default entries are AMS Math, AMS Fonts, AMS Symbols, `mathtools`, `boldsymbol`, `newcommand`, `color`, `braket`, `cancel`, `amscd`, `cases`, `empheq`, `extpfeil`, `gensymb`, `textmacros` and `upgreek`.

`physics` is enabled only for an equation that requests it, because it changes some standard commands:

```latex
\usepackage{physics}
\pdv{\psi}{t}=\frac{1}{i\hbar}\hat H\ket{\psi}
```

`\require{physics}` is also supported. Put package declarations at the start of the source. Comments are allowed; package options or names outside the supported catalog produce an error. Macros and physics activation are scoped to one equation.

MathJax supports a defined set of mathematical notation; it does **not** load arbitrary installed `.sty` files or TeX fonts.

## Inline mathematics

Press **⌘+Shift+M** on macOS or **Ctrl+Shift+M** on Windows/Linux in canvas or Inspector text to insert an inline formula at the caret or edit the formula containing it. The popup has a live MathJax preview; apply preserves surrounding prose and cancel restores the previous selection. Double-clicking a rendered formula also opens the popup. Typing delimiters directly does not open it; use `\$` for a literal dollar sign.

Write `$...$` or `\(...\)` inside a text box:

```text
The field $\chi$ has mass $m_\chi$.
암흑물질 $\chi$의 질량은 $m_\chi$입니다.
Constraining $U(1)_{L_\mu - L_\tau}$ Model with Dark Matter Using Relic Density and $N_\mathrm{eff}$ Bounds
```

Only the delimited parts become formulas; surrounding words remain ordinary text. Use `_` for subscripts inside formulas, without Markdown escapes (`\_`) or emphasis markers (`*`). Match each opening `{` with a closing `}`.

Inline formulas default to **Latin Modern**, the traditional Computer Modern / LaTeX math style, including existing decks without an inline font preference. Change **Document → Deck typography → Inline math font** to choose another bundled font. The inline popup, slide, and exports all use that setting. Ordinary text keeps its own font; separate equation objects use **Default math font**.

A text object's **Inline math font** can override the deck default. Choose **Use deck inline math default** to restore inheritance. Copying a mixed text/equation object or its slide preserves the source's effective inline font, so pasting into another deck keeps the same equation glyphs; the target deck's defaults remain unchanged. The inline equation editor and exports use the object's effective font.

Formulas use the text box's size/color. They share the text baseline and wrap with surrounding words; tall formulas expand line spacing. Left, center and right alignment apply to the entire mixed line. While editing on the canvas, the rendered result stays in its slide position and an upright editable source field appears below or above it. The source panel stays within the slide and scrolls when the text frame or source is too tall. The source is preserved in the file; finish with **⌘+Enter** on macOS or **Ctrl+Enter** on Windows/Linux. PDF/SVG retains vector formulas and selectable ordinary text.

Use `\$` for a literal dollar sign. Empty/unmatched delimiters and standalone `$$...$$` spans remain literal; use an Equation object for display mathematics. An invalid formula appears as red source with a diagnostic; surrounding prose and valid formulas continue rendering. Double-click the failed formula to correct it. Invalid formulas prevent PDF/SVG export with the object's name. Installed LaTeX packages apply only to separate Local LaTeX equation objects.

## System-installed LaTeX on Linux and macOS

Both platforms require system-installed `latex` or `xelatex`, `dvisvgm`, `kpsewhich` and functioning isolation. Linux also needs **bubblewrap 0.9.0 or later** and `prlimit`. v0.6.3.1 macOS packages use MacTeX/BasicTeX and the built-in `sandbox-exec`; previously published v0.6.3 packages do not contain this worker. Actual file/network/exec/fork containment probes must pass before compilation is enabled. Personal home package/font paths remain blocked. Windows local compilation is not implemented; MathJax remains available. See [[Installation]] and [[Troubleshooting]].

Choose **Local LaTeX · Installed packages**, select the **TeX engine**, enter **PREAMBLE** and **LATEX SOURCE** separately, then choose **Compile with LaTeX → Apply equation**. Do not paste a complete document containing `\documentclass` or `\begin{document}`.

**Linux desktop shortcut:** press **Ctrl+Shift+Enter** from the canvas or equation Inspector controls, including **LATEX SOURCE** and **PREAMBLE**, to run **Compile with LaTeX**. One visible, unlocked equation must be selected in Local LaTeX mode, installed TeX must be ready, and the editor must be idle. The shortcut updates the draft preview; it does not apply the result or add a document undo step. **Apply equation** remains a separate action.

This shortcut is disabled in the browser and MathJax mode, which already provides live preview. Notes, inline text, media, thumbnails, dialogs and playback retain their input. IME composition and held-key repetition do not trigger compilation. This shortcut is included in v0.6.3.

LaTeX preamble example:

```latex
\usepackage{amsmath,amsfonts,amssymb,physics}
```

XeLaTeX preamble example using an installed OpenType math font:

```latex
\usepackage{amsmath}
\usepackage{unicode-math}
\setmathfont{Latin Modern Math}
```

The app converts DVI/XDV output to outlined SVG. pdfLaTeX and LuaLaTeX execution are not provided. On Linux, detection searches PATH and common TeX Live locations; **Choose TeX folder…** selects and remembers another binary directory, and **Check again** refreshes detection. System TeX/font paths and selected custom TeX Live distributions are read-only inside the worker; personal `~/texmf` packages and personal font directories are not automatically mounted. Packages requiring external programs or shell escape are unsupported, and not every package combination is guaranteed.

Compilation happens only on explicit request. Opening, presenting and exporting do not execute equation source. Changes to source, preamble, engine, font size, color or display mode require recompilation; position/rotation reuse the saved result.

Valid applied results are embedded as passive outlined SVG in `.scislide` files. They can be viewed, presented and exported on computers without TeX, including in the browser. Recompilation needs the relevant installed tools/packages. Missing or stale results prevent export.

## Personal equation library

**My equations** stores named/tagged entries with description, source and style locally. Search, edit or **Insert into slide** to create an independent equation. **Export library / Import library** transfers JSON between environments. Local LaTeX entries retain their preamble/engine but require explicit compilation after insertion; import never compiles source. Library entries are separate from the bundled Math package catalog and are not linked to inserted objects.

## Ordinary text fonts

Choose bundled **Inter** or **Nanum Gothic** in **Document → Deck typography → Default text font**. New text, templates and AI draft text follow this default. Existing text without an inheritance setting retains its explicit family; changing the deck default does not replace it. Select existing text and choose **Use deck text font for selected text**, or choose **Use deck default** in the object's **Text font** control, to follow future default changes. Selecting an explicit object font ends that inheritance. Copied objects retain their effective source family when pasted into another deck.

Body text, **Default math font** for standalone equations and **Inline math font** are independent. In the MathJax equation editor, **Reset to deck typography → Apply equation** removes font, size and color overrides so later deck changes also apply. Local LaTeX font changes use the preamble and require recompilation.

Supported modern Korean text uses bundled **Nanum Gothic Regular/Bold**, including PDF/SVG output. Unsupported body-text glyphs, including Hanja and old/combining Jamo, can stop PDF export; Local LaTeX outlines do not extend body-text font coverage. Arbitrary existing body-font names remain readable in native files, but are not added to the bundled font selector or guaranteed for PDF embedding.

Imported SVG figures have a separate font policy. Validated embedded TTF/OTF/WOFF/WOFF2 font data is retained in native files, SVG output and PPTX figure graphics. PDF supports normal embedded TrueType faces at supported requested weights and checks their glyph maps. Visible text using OTF/WOFF/WOFF2, italic/oblique text, unsupported weights or unavailable glyphs can be accepted at import and rejected later by PDF export. Outline that figure text or export SVG/PPTX. The imported font does not become a selectable body or MathJax font. See [[Export-and-Presenting]] for the remaining format-specific limits.

[Wiki home](Home)
