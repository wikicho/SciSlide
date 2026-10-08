# Equations and fonts

SciSlide **0.6.2** offers bundled **MathJax** rendering and explicit compilation through **system-installed LaTeX/XeLaTeX on supported Linux systems**. Inline formulas in ordinary text always use MathJax.

## Equation objects

1. Add an **Equation** or select an existing one.
2. Choose **MathJax · Live preview** or **Local LaTeX · Installed packages**.
3. Edit the source and settings; review the preview or compilation result.
4. Click **Apply equation** to commit it to the slide.

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

Write `$...$` or `\(...\)` inside a text box:

```text
The field $\chi$ has mass $m_\chi$.
암흑물질 $\chi$의 질량은 $m_\chi$입니다.
```

Formulas use the deck's equation font and the text box's size/color. They share the text baseline and wrap with surrounding words; tall formulas expand line spacing. Editing shows the original syntax, which is preserved in the source file. PDF/SVG retains vector formulas and selectable ordinary text.

Use `\$` for a literal dollar sign. Empty/unmatched delimiters and standalone `$$...$$` spans remain literal; use an Equation object for display mathematics. Invalid inline formulas show a diagnostic and prevent PDF/SVG export with the object's name. Installed LaTeX packages apply only to separate Local LaTeX equation objects.

## System-installed LaTeX on Linux

Local compilation requires system-installed `latex` or `xelatex`, `dvisvgm`, `kpsewhich`, **bubblewrap 0.9.0 or later** and `prlimit`, plus functioning isolation. See [[Installation]] for dependencies and [[Troubleshooting]] if the controls are disabled. macOS/Windows local compilation is not implemented; MathJax remains available there.

Choose **Local LaTeX · Installed packages**, select the **TeX engine**, enter **PREAMBLE** and **LATEX SOURCE** separately, then choose **Compile with LaTeX → Apply equation**. Do not paste a complete document containing `\documentclass` or `\begin{document}`.

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

The app converts DVI/XDV output to outlined SVG. pdfLaTeX and LuaLaTeX execution are not provided. System TeX/font paths are read-only inside the worker; `~/texmf` and personal package/font directories are not mounted. Packages requiring external programs or shell escape are unsupported, and not every package combination is guaranteed.

Compilation happens only on explicit request. Opening, presenting and exporting do not execute equation source. Changes to source, preamble, engine, font size, color or display mode require recompilation; position/rotation reuse the saved result.

Valid applied results are embedded as passive outlined SVG in `.scislide` files. They can be viewed, presented and exported on computers without TeX, including in the browser. Recompilation needs the relevant installed tools/packages. Missing or stale results prevent export.

## Personal equation library

**My equations** stores named/tagged entries with description, source and style locally. Search, edit or **Insert into slide** to create an independent equation. **Export library / Import library** transfers JSON between environments. Local LaTeX entries retain their preamble/engine but require explicit compilation after insertion; import never compiles source. Library entries are separate from the bundled Math package catalog and are not linked to inserted objects.

## Ordinary text fonts

Latin text uses bundled **Inter**; supported modern Korean text uses bundled **Nanum Gothic Regular/Bold**, including PDF/SVG output. These body-text fonts are separate from equation fonts. Unsupported body-text glyphs, including Hanja and old/combining Jamo, can stop PDF export; Local LaTeX outlines do not extend body-text font coverage. See [[Export-and-Presenting]].

[Wiki home](Home)
