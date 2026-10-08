# Troubleshooting

These notes describe SciSlide **0.6.2**. Include your operating system, CPU architecture, app version, the failing action and exact error when opening a [GitHub issue](https://github.com/wikicho/SciSlide/issues). A small presentation that reproduces the problem helps; remove private content before sharing it.

## Installation or launch is blocked

macOS installers are unsigned/unnotarized, and Windows packages are unsigned development builds. Check that you downloaded the matching architecture and verify its `.sha256` file. Follow your operating system or organization's security policy. A checksum verifies file integrity, rather than publisher identity.

On Windows, extract the complete portable ZIP and keep its runtime/resources together. On Linux, use the Ubuntu 24.04 x64-targeted `.deb`, resolve declared dependencies with `sudo apt install ./<file>.deb`, and launch as an ordinary user. The Linux launcher retains Electron's sandbox. See [Installation](Installation).

## Text will not edit on the slide

Double-click a text object, or select it and press **Enter**. **Command/Ctrl+Enter** applies the edit; **Escape** cancels. Enter alone inserts a new line. Equations use the separate LaTeX source editor and **Apply equation**. Whole-object formatting and canvas shortcuts do not replace native text-field editing behavior. See [Editing slides](Editing-Slides).

## Local LaTeX is unavailable

Compilation is supported **only on Linux**. macOS and Windows may detect TeX executables, but their compile worker is not implemented. Browser editing uses MathJax or saved vector results.

Linux needs `latex` or `xelatex`, `dvisvgm`, `kpsewhich`, **bubblewrap 0.9.0 or later**, `prlimit` and working isolation. Ubuntu 22.04's default bubblewrap is too old for this worker. Ubuntu 24.04 is the target. For a Debian/Ubuntu setup:

```sh
sudo apt install texlive-latex-extra texlive-fonts-recommended texlive-science texlive-xetex dvisvgm bubblewrap util-linux
```

If kernel/system policy prevents isolation, compilation stays disabled. System TeX/font paths are mounted read-only; `~/texmf` and other home package/font folders are not mounted. Packages requiring shell escape or external programs are unsupported. Enter preamble and equation body separately, rather than a full LaTeX document. See [Equations and fonts](Equations-and-Fonts).

## An equation preview or export is stale

Equation drafts do not update the slide until **Apply equation**. For Local LaTeX, use **Compile with LaTeX**, inspect the result, then apply it. Editing source, preamble, engine, size, color or display mode requires recompilation; moving or rotating the equation does not.

A missing or mismatched local vector result causes an error. Recompile in a supported environment, apply and save the document. Opening, presenting and exporting never run imported TeX source automatically.

## PDF export fails or a figure looks different

Read the named object/slide in the error. Unsupported SVG filters, masks, `textPath`, italic/unbundled figure fonts or missing text glyphs can stop PDF export. Simplify the figure or outline its text before importing; exporting SVG is another option. External SVG references and active content are unsupported.

Modern Korean uses bundled Nanum Gothic; Hanja and some standalone/old Jamo are outside its supported coverage. Use equation objects for mathematical symbols absent from body fonts. Imported PDF pages become raster PNG figures. Videos appear as static placeholders, and static exports show the final click-build state. See [Export and presenting](Export-and-Presenting).

## AI provider is installed but unavailable

Use the **CLI**, rather than only the provider's desktop app, and authenticate it in your terminal. Choose **Refresh AI connections** and read its compatibility reason. Codex 0.160.x and Gemini 0.62.x are the reviewed versions; Claude Code must advertise all required restricted/safe-mode controls. System settings or organization policies may prevent a connection.

Detection does not prove login success. Check the same account/CLI in the terminal, shorten a request that exceeds the three-minute limit, or cancel a running job before starting another. See [AI assistance](AI-Assistance).

## Presenter window or video playback is missing

Allow presenter popups and move the separate window to your screen manually. Automatic monitor placement is not implemented; ordinary **Present** works with one display. Presenter video previews are static, with playback on the audience slideshow only.

Video codec/autoplay support depends on the runtime. Try manual playback controls or a compatible local MP4/WebM. The app does not transcode videos. See [Export and presenting](Export-and-Presenting).

## Recovery or save fails

Save `.scislide` files explicitly. Recovery is local to each browser/desktop environment and limited to **100 MiB**; browser quotas and localStorage fallback can be smaller. The personal equation library and unapplied equation drafts are not included in a deck save; transfer libraries through JSON export/import.

Each figure is limited to **20 MiB**, each video to **40 MiB**, a saved archive to **64 MiB**, and expanded resources to **100 MiB**. Reduce media if limits are exceeded. Check the desktop save-completion message; a browser download starting is not proof that a file was saved to disk.

New saves use document format **0.5.0**. Older apps that read only 0.4.0 or earlier cannot open them. SciSlide migrates older files on opening but only changes the original when saving; use **Save As** to preserve it.
