# SciSlide Wiki

SciSlide is a scientific presentation editor that combines visual slide composition with editable LaTeX equations. It runs in a browser or as an Electron desktop app.

This wiki documents **v0.6.2**, a development prototype. The latest release adds keyboard shortcuts based on Keynote for macOS, PowerPoint for Windows, and LibreOffice Impress for Ubuntu/Linux.

## Start here

1. [Install SciSlide](Installation) for your operating system.
2. [Create your first presentation](Getting-Started) with a theme and editable slide layouts.
3. [Edit and arrange slides](Editing-Slides), figures, shapes, and video.
4. [Write equations and choose fonts](Equations-and-Fonts), including inline formulas such as `$\chi$`.
5. [Present or export your deck](Export-and-Presenting).

## Guides

| Guide                                                | What it covers                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| [Installation](Installation)                         | macOS, Windows x64, Linux x64, checksums, and updates             |
| [Getting started](Getting-Started)                   | Themes, the editor, first slide, and saving                       |
| [Editing slides](Editing-Slides)                     | Text, figures, drawings, layout guides, groups, and ordering      |
| [Equations and fonts](Equations-and-Fonts)           | MathJax, AMS syntax, inline math, local TeX, and equation library |
| [Keyboard shortcuts](Keyboard-Shortcuts)             | macOS, Windows, and Ubuntu/Linux profiles                         |
| [Export and presenting](Export-and-Presenting)       | PDF/SVG export, builds, video, and presenter display              |
| [AI assistance](AI-Assistance)                       | Editable slide drafts from compatible installed AI CLIs           |
| [Troubleshooting](Troubleshooting)                   | Installation, rendering, files, media, and host tools             |
| [Architecture and roadmap](Architecture-and-Roadmap) | Document format, application structure, and planned work          |
| [Development](Development)                           | Source setup, checks, packaging, and contributions                |

## Downloads and project

- [Download v0.6.2](https://github.com/wikicho/SciSlide/releases/tag/v0.6.2) — macOS Apple Silicon/Intel, Windows x64, and Linux x64.
- [Release notes](https://github.com/wikicho/SciSlide/blob/v0.6.2/docs/releases/v0.6.2.md).
- [Source repository](https://github.com/wikicho/SciSlide).
- [Report a problem](https://github.com/wikicho/SciSlide/issues).

The macOS packages are unsigned and unnotarized; Windows builds are unsigned. See [Installation](Installation) for platform-specific instructions. PDF and SVG export are implemented; PPTX and HTML export remain planned. The native `.scislide` format is **0.5.0**, independent of the app version.
