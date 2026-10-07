# SciSlide

A scientific presentation editor with editable equations, vector output, and an Electron desktop host.

**The current source is v0.6.1, a working prototype.** The shared React/TypeScript editor runs in a browser or Electron. MathJax provides immediate equation previews and font-aware inline formulas inside text; the desktop app can explicitly compile equations with installed LaTeX or XeLaTeX on supported Linux systems. Fourteen existing starter layouts combine scientific structure with minimal Keynote-inspired composition; the **Keynote White** theme adds a dedicated set of fifteen coordinated layouts. Drawing, groups, smart guides, equal-spacing commands and an object/layer list help compose slides. Figures support SVG/PNG/JPEG import and PDF page selection, reversible cropping, enlarged insets and replacement without rebuilding the layout. A personal equation library, separate presenter display and recovery of unfinished equation drafts extend the authoring workflow. The included three-slide cosmology deck uses synthetic demonstration data. Compatible installed AI CLIs generate editable slide drafts. Deck-wide page numbers, embedded video, and ordered click-triggered builds remain available.

Local v0.6.1 builds add drag-and-drop slide reordering and default Linux Debian output to `release/linux-deb/`. The published GitHub downloads below remain v0.6.0; those installers do not include the new drag-and-drop behavior.

Local v0.6.1 macOS installers are kept in `release/macos-pkg/`, and Windows x64 distributions in `release/windows-x64/`. Select these directories with the packaging scripts' `--out` option; their general defaults remain `release/`.

## Download desktop builds

Download the **v0.6.0 development build** from [GitHub Releases](https://github.com/wikicho/SciSlide/releases/tag/v0.6.0):

| System                            | Download                                                                                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon (M1 or later) | [arm64 `.pkg`](https://github.com/wikicho/SciSlide/releases/download/v0.6.0/SciSlide-0.6.0-macos-arm64-unsigned.pkg)                                                                                                                                 |
| macOS Intel                       | [x64 `.pkg`](https://github.com/wikicho/SciSlide/releases/download/v0.6.0/SciSlide-0.6.0-macos-x64-unsigned.pkg)                                                                                                                                     |
| Windows Intel/AMD x64             | [setup `.exe`](https://github.com/wikicho/SciSlide/releases/download/v0.6.0/SciSlide-0.6.0-windows-x64-setup-unsigned.exe) · [portable `.zip`](https://github.com/wikicho/SciSlide/releases/download/v0.6.0/SciSlide-0.6.0-windows-x64-portable.zip) |
| Linux Intel/AMD x64               | [`.deb` / amd64](https://github.com/wikicho/SciSlide/releases/download/v0.6.0/SciSlide-0.6.0-linux-x64.deb)                                                                                                                                          |

Matching SHA-256 checksum files and installation instructions are included in the release. macOS installers are unsigned and unnotarized; Windows distributions are unsigned. System security policies may block installation or launch. See the [macOS](desktop/MACOS.md), [Windows](desktop/WINDOWS.md) or [Linux](desktop/LINUX.md) installation guide and the [v0.6.0 release notes](docs/releases/v0.6.0.md). Node.js and TeX are not required for MathJax editing.

The manually dispatched **SciSlide development release** workflow builds all five distributions from the same requested `main` commit, verifies architecture/checksums and uploads build artifacts. Publication is optional and defaults off; explicitly enabling it publishes one `v<package-version>` development prerelease with all distributions, checksums and platform guides. Packaging and automated checks do not replace complete physical-device validation.

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

Build a **Linux x64 `.deb` package** on Debian/Ubuntu with `dpkg-deb` installed:

```sh
pnpm desktop:package:linux --arch=x64
```

This creates `release/linux-deb/SciSlide-0.6.1-linux-x64.deb`, its SHA-256 file, `LINUX-INSTALL.md` and a complete `release/linux-deb/SciSlide-linux-x64/` app folder. Linux Debian packaging defaults to `release/linux-deb/`; `--out` selects another output directory. Debian's architecture name is **amd64**. Verify and install the local package:

```sh
cd release/linux-deb
sha256sum -c SciSlide-0.6.1-linux-x64.deb.sha256
sudo apt install ./SciSlide-0.6.1-linux-x64.deb
scislide
```

The package installs in `/opt/scislide` and adds a desktop-menu launcher and icon. Remove it with `sudo apt remove scislide`. Ubuntu 24.04 x64 is the packaging target. No SciSlide APT repository is currently provided: package-name installation and automatic APT updates require a separately hosted signed repository. **Snap distribution remains planned**, with host-installed TeX/AI access requiring confinement design and review.

See the [Linux installation and build guide](desktop/LINUX.md) for updates, optional host tools and current limits. The manually started **Linux x64 development packages** workflow checks hashes, package metadata and extracted x64 payloads, then uploads artifacts for 30 days. An explicit publication option creates a new `v<version>-linux-dev.<number>` GitHub development prerelease; normal runs do not publish. Packaging checks do not replace installed Ubuntu desktop validation.

Build both **Apple Silicon and Intel macOS `.pkg` installers** with:

```sh
pnpm desktop:package:mac
# One architecture:
pnpm desktop:package:mac --arch=arm64
```

The current source defaults to output paths `release/SciSlide-0.6.1-macos-arm64-unsigned.pkg` and `release/SciSlide-0.6.1-macos-x64-unsigned.pkg`. Each installer also has a SHA-256 checksum file. The installation location is `/Applications/SciSlide.app`. See the [macOS installation guide](desktop/MACOS.md) for architecture selection and current limitations.

The default `.pkg` implementation uses [Electron's official pure JavaScript packaging](https://packages.electronjs.org/osx-sign/v2.6.0/index.html#pure-javascript-packaging), so it also works on Linux. On macOS with Xcode Command Line Tools, use `pnpm desktop:package:mac --implementation=native` to package with Apple's `pkgbuild` and `productbuild`. **Both methods produce development installers without Developer ID signing or notarization.** macOS security policies may block installation or launch. The packaging process does not change system security settings.

The repository's **macOS development installers** Actions workflow builds the editor once on a macOS runner and creates native `.pkg` installers for both architectures. It runs when packaging configuration changes or through Actions' **Run workflow** control. The versioned artifacts contain the installer, checksum, and installation guide for each architecture and are retained for 30 days. No additional secrets or Apple account are used. Installation, editing, file saving, and export on a physical Mac, along with signed distribution, require separate validation.

Build **Windows x64** distributions on Windows with Inno Setup 6.7 or later:

```sh
pnpm desktop:package:win
# Portable ZIP only; also supported from Linux and macOS:
pnpm desktop:package:win --portable-only
```

This command always targets **Intel/AMD x64**, regardless of the build host. The current source creates `release/SciSlide-0.6.1-windows-x64-setup-unsigned.exe` and `release/SciSlide-0.6.1-windows-x64-portable.zip`, with SHA-256 checksum files. The installer uses an x64 bootstrap executable, installs for the current user under `%LOCALAPPDATA%\Programs\SciSlide`, and adds a Start menu shortcut. The portable ZIP contains the complete app folder; extract it and launch `SciSlide-win32-x64/scislide.exe`. No Node.js or TeX installation is needed to run MathJax editing.

See the [Windows installation and build guide](desktop/WINDOWS.md) for compiler selection, checksums and platform limits. The **Windows x64 development distributions** Actions workflow builds on a Windows x64 runner, verifies the executable architectures and hashes, and checks installation/uninstallation in a temporary directory. Its versioned downloadable artifacts contain both distributions and are retained for 30 days. Windows 10 or later is required; physical Windows 10/11 editing and export validation remains open. Local LaTeX compilation is currently disabled on Windows.

**Windows distributions are unsigned development builds.** Windows security policies may block installation or launch. Automatic updates, macOS notarization, Windows signing, and complete distribution validation across all three operating systems remain future work.

## Using the Editor

SciSlide starts with **Choose your theme**. Select **Scientific**, **Minimal White**, **Minimal Black**, **Navy** or **Keynote White**, then choose **Create presentation** to begin with one editable title slide. Keynote White starts with a white background, black text and bundled Inter typography, and **New slide** opens its coordinated fifteen-layout gallery. The other four themes retain the existing fourteen-layout picker. Added layouts and blank slides inherit the selected theme. Use **Open presentation** to open a `.scislide` file, **Resume previous work** to continue a recovered workspace, or **Explore demo** to try the sample deck. The chooser preserves recovered work until you explicitly choose how to continue. **New presentation** opens the chooser again; **Cancel** returns to the current deck.

Double-click a text box to edit directly on the slide, or select it and press **Enter**. New text boxes open ready for typing. **Enter** inserts a new line; **Ctrl / ⌘ + Enter** or clicking outside finishes the edit, and **Escape** cancels it. Each completed edit is one undo step. Korean IME input, plain-text paste, alignment, font size, rotation and canvas zoom are supported. The Inspector remains available for text and formatting; equations continue to use the LaTeX source editor.

1. Select a slide from the thumbnails on the left. On narrow screens, use the slide selector above the canvas.
2. Add objects with **Text / Equation / Figure / Video**. Figures support SVG, PNG, JPEG and PDF pages; videos support local MP4 and WebM files.
3. Click and drag an object to move it. Resize it with the lower-right handle, or enter its position, rotation, and color in the Inspector.
4. Select an equation, then choose **MathJax · Live preview** or **Local LaTeX · Installed packages**. Equation source and previews are not applied to the slide until you click **Apply equation**.
5. Desktop **Open / Save / Save As** use native file dialogs. Save writes to the selected original path; Save As lets you choose a new path. The web version downloads the source file.
6. Use **Present** for the slideshow, and **Export** to save all slides as a PDF or the current slide as an SVG.

The desktop menu provides New Presentation, Open, Save, Save As, object editing, presentation mode, PDF/SVG export and keyboard shortcut help. A successful save notification appears after the native file write completes. The web version distinguishes starting a download from completing a save to disk.

## Keyboard Shortcuts

SciSlide detects the host operating system and uses **Command (⌘)** on macOS or **Ctrl** on Ubuntu/Linux and Windows. **Option (⌥)** is the macOS equivalent of **Alt**. Toolbar hints and **Keyboard shortcuts** show the current platform's bindings; the help dialog also has macOS, Ubuntu/Linux and Windows tabs for reference. Choosing a reference tab does not change the active keyboard bindings.

| Action                                 | macOS         | Ubuntu / Linux   | Windows          |
| -------------------------------------- | ------------- | ---------------- | ---------------- |
| New presentation                       | ⌘+N           | Ctrl+N           | Ctrl+N           |
| Open presentation                      | ⌘+O           | Ctrl+O           | Ctrl+O           |
| Save                                   | ⌘+S           | Ctrl+S           | Ctrl+S           |
| Save as                                | ⌘+Shift+S     | Ctrl+Shift+S     | Ctrl+Shift+S     |
| Undo                                   | ⌘+Z           | Ctrl+Z           | Ctrl+Z           |
| Redo                                   | ⌘+Shift+Z     | Ctrl+Shift+Z     | Ctrl+Y           |
| Copy / Cut / Paste                     | ⌘+C / X / V   | Ctrl+C / X / V   | Ctrl+C / X / V   |
| Select all objects                     | ⌘+A           | Ctrl+A           | Ctrl+A           |
| Duplicate selection or slide           | ⌘+D           | Ctrl+D           | Ctrl+D           |
| Group / Ungroup                        | ⌘+G / Shift+G | Ctrl+G / Shift+G | Ctrl+G / Shift+G |
| Present                                | ⌘+Enter       | Ctrl+Enter       | Ctrl+Enter       |
| Export PDF                             | ⌘+Option+P    | Ctrl+Alt+P       | Ctrl+Alt+P       |
| Export current slide as SVG            | ⌘+Option+S    | Ctrl+Alt+S       | Ctrl+Alt+S       |
| Keyboard shortcuts                     | ⌘+Shift+/     | Ctrl+Shift+/     | Ctrl+Shift+/     |
| Bypass alignment guides while dragging | Hold Option   | Hold Alt         | Hold Alt         |

Windows also accepts **Ctrl+Shift+Z** for Redo. **Enter** edits selected text and inserts a new line while editing. During inline editing, **⌘/Ctrl+Enter** applies the text changes and **Esc** cancels them; the same apply gesture does not start a slideshow. Save captures the current text. Clipboard, selection and undo/redo shortcuts keep their normal text-field behavior in the inline editor and Inspector. Canvas actions do not change objects while a dialog or text field is active, and composing Korean or other IME text does not trigger editor shortcuts.

On the canvas, use **Arrow keys** to move by 1 px, **Shift+Arrow keys** to move by 10 px, **Shift+click** for multiple selection, and **Delete / Backspace** to remove selected objects. During a slideshow, **Right / Down / Space / Page Down** advances a build or slide, **Left / Up / Page Up** goes back, **Home / End** selects the first or last slide, and **Esc** exits. Media controls retain their own keyboard behavior. Native desktop menus use the same platform bindings; in a browser, use the toolbar when a browser-reserved combination takes precedence.

## Inline Equations in Text

Write `$...$` or `\(...\)` inside a text box to mix words and inline LaTeX, for example:

```text
The field $\chi$ has mass $m_\chi$.
암흑물질 $\chi$의 질량은 $m_\chi$입니다.
```

The rendered text uses MathJax for each formula, with the deck's equation font and the text box's size and color. Surrounding words keep their ordinary text font. Inline formulas match the surrounding font's measured lowercase height while preserving their mathematical baseline. Formulas wrap together with the text, tall fractions/scripts expand their own line's spacing, and all formulas remain vectors in SVG/PDF export; ordinary text stays selectable. When editing, the text box shows the original syntax, which is saved as the existing text string in native format 0.5.0.

Use `\$` for a literal dollar sign. Empty or unmatched delimiters and standalone `$$...$$` display spans remain literal text; use an **Equation** object for a standalone display equation. Inline formulas use the bundled MathJax notation/packages, including AMS notation. Installed LaTeX packages and the Local LaTeX renderer apply to separate equation objects. Invalid inline formulas show a diagnostic and stop SVG/PDF export with the text object's name.

Open [the inline math example](examples/inline-math.scislide) to try editable English and Korean text with Greek symbols, fractions and AMS notation.

## Drawing and Groups

Choose **Draw rectangle**, **Draw ellipse**, **Draw line** or **Draw arrow**, then drag across the canvas to draw. Hold **Shift** to constrain a rectangle/ellipse to a square/circle or constrain a line/arrow direction. **Escape** cancels drawing. Select a line or arrow and drag either endpoint to change its direction and length.

The shape Inspector controls stroke color, width and **Solid / Dashed / Dotted** style. Rectangles and ellipses support **No fill** for outlining a region of a scientific figure. Arrowheads can appear at the start, end or both ends of a line, including bidirectional arrows. These shapes remain editable objects and export as vectors in PDF and SVG.

Use **Shift+click** to select several objects, then **Group objects** to keep them together. **Ctrl+G** groups and **Ctrl+Shift+G** ungroups; on macOS use **Cmd** instead of Ctrl. Clicking a grouped member selects the group, and dragging moves its members together. Duplicate creates an independent group; **Ungroup objects** leaves each object's current position intact. Ungroup before resizing, rotating or editing the endpoints of an individual member. Group membership survives save/open and undo/redo. Groups are flat: nested groups and whole-group scaling or rotation are not available yet.

Smart guides appear while moving an object or selection near another object's matching edges or center, or the slide center. The lines connect the relevant bounds so the alignment is easy to see. Equal-gap guides show distance labels when placing an object between aligned neighbors or continuing an existing row or column; objects may have different widths or heights.

While resizing with the lower-right handle, guides help unrotated text, figures, videos, rectangles and ellipses match another independent, unrotated object's width or height and align the resized edge. Figures and videos keep their aspect ratio; hold **Shift** to preserve the ratio when resizing text or ordinary shapes. Matching one dimension may change the other dimension to preserve that ratio. Equation resizing changes font size, and rotated objects do not show resize guides.

Use the smart-guide toolbar control to toggle these aids, or hold **Alt** to bypass them for a gesture. **Snap to 20 px grid** separately enables grid snapping and takes precedence over smart guides. Guides exist only during editing and do not appear in saved decks, thumbnails, presentation mode or exports. Connectors that track attached shapes, freehand paths and a path editor remain future work.

## Editing Conveniences

Drag a slide thumbnail above or below another thumbnail to reorder the presentation. A teal insertion line shows where it will land, and the list scrolls when dragging near its top or bottom edge. The current slide and object selection stay active; page numbers and saved/exported slide order follow the new order. Each move supports Undo/Redo. Press **Escape** or release outside the slide list to cancel, or use the existing **Move slide up/down** buttons.

Use **Copy / Cut / Paste** or **Ctrl+C / Ctrl+X / Ctrl+V** (Cmd on macOS) to reuse selected objects across slides or decks in the same editor session. This object clipboard stays inside SciSlide; text fields retain their normal text clipboard behavior. Pasted objects and groups receive independent IDs, and their figures/videos travel with them; identical media already in the target deck can be reused. Repeated pastes are offset so the copies are easier to select. Locked objects can be copied; Cut leaves locked objects and locked groups intact.

The **OBJECTS & LAYERS** list at the top of the Inspector gives access to covered and hidden objects. Select a row, rename it, show/hide it, lock/unlock it, or move it forward/backward. Hidden objects remain selectable in this list. A group moves through the layer order as one unit.

The toolbar and the Inspector's **ARRANGE** section align selected objects/groups **left / center / right / top / middle / bottom** and provide equal horizontal/vertical gaps. With one object or group, alignment uses the slide margins; with several, it uses their combined bounds. **Distribute horizontally / vertically** equalizes edge gaps between at least three unlocked objects or groups while keeping the first and last in place. Different object sizes are supported; leave enough room for nonoverlapping gaps.

## Figure Import, Crops and Insets

Choose **Figure** in the toolbar to add a local PNG, JPEG, SVG or PDF file, up to 20 MiB. SVG files retain their sanitized vector content and supported embedded fonts, including SciSlide-exported SVG files. Ordinary scientific-plot styles are preserved; scripts, active content and external resource references are removed. Font loading accepts bounded, embedded TTF/OTF/WOFF/WOFF2 data only; remote fonts and unsupported CSS are rejected. For a PDF, preview the document, choose one page, then insert it as a high-resolution PNG figure. Cancel leaves the presentation unchanged. PDF parsing and rendering use bundled resources locally and work offline; no upload or installed PDF application is required. The selected page image is embedded in the `.scislide` file, so reopening does not require the original PDF.

Select a figure and use **CROP & INSET** in the Inspector. Enter **Left / Top / Width / Height** as percentages of the original image and review the preview. The region must stay inside the image. Choose **Apply crop** to change the selected figure; **Reset crop** restores its full image. Unlock or ungroup the figure before using these controls.

To show a detail alongside the original, choose a region in the preview and click **Create enlarged inset** directly. This adds an independent figure with that region and the same source asset, preserving the original figure's current crop. You do not need to apply the crop first. Move or edit either figure separately; resetting one crop does not change the other. SVG sources retain vector detail in SVG/PDF export, while PNG/JPEG sources remain raster images. **Replace figure** accepts the same PNG/JPEG/SVG/PDF formats and changes only the selected figure's source, preserving its frame, rotation, normalized crop and description. A PDF replacement opens the page chooser before applying a change. Replacement, crop and inset editing require an unlocked, independent figure. PDF pages remain raster images in PDF/SVG export; preserving original PDF vectors is future work.

## My Equations

Open **My equations** to save formulas with a name, tags, description, source and style. If an equation is selected, its current Inspector draft starts the library editor. Search saved entries, edit them, or choose **Insert into slide** to create an independent equation. The existing **Math package library** remains a separate catalog of bundled notation examples.

The personal library is stored locally in the current web or desktop environment. **Export library / Import library** transfer its JSON file between environments. Desktop export uses a native save dialog; browser export starts a download. MathJax entries show a live preview. Local LaTeX entries retain their engine and preamble; after insertion, explicitly **Compile with LaTeX**, then **Apply equation**. Importing a library does not compile source. Shared deck macros and linked library entries remain future work.

## Presenter Display

Choose **Presenter display** to start the audience slideshow and open a separate presenter window. Move the window to your presenter screen. It shows the current click build, next slide, speaker notes, elapsed/remaining time and navigation. Set **Target minutes**, then use **Pause timer / Resume timer / Reset timer** as needed. Notes and timer controls stay on the presenter screen. Its video previews are static placeholders; playback stays on the audience slideshow.

Allow the presenter popup if the browser blocks it. Ordinary **Present** remains available for a single display. Closing the presenter window leaves the audience slideshow running; ending the presentation closes the presenter window. Display placement and fullscreen behavior depend on the browser/desktop environment.

## Workspace Recovery and Equation Drafts

SciSlide recovers the committed deck and up to 200 unfinished equation drafts using IndexedDB, with a **100 MiB** recovery-record limit. When IndexedDB is unavailable, it falls back to localStorage, which usually has a smaller quota. The web and desktop environments maintain separate local recovery stores. Storage failures appear in the editor; explicit **Save** remains necessary for a portable source file.

Changing the selected equation or slide preserves its unapplied Inspector draft. Returning to that equation restores the draft; **Apply equation** commits it to the slide and clears its draft record. Recovery also retains draft source, font, size, color, renderer, engine and preamble across restarts. Unapplied drafts and the personal equation library are local workspace data and are not included in a saved `.scislide` file. Unapplied Local LaTeX compilation results may need recompiling after recovery.

## AI Slide Drafts

Open **AI draft** in the Electron desktop app, choose an installed **Codex CLI / Claude Code / Gemini CLI**, enter your topic and choose 1–12 slides. Install and sign in to the CLI in your terminal first. **Refresh AI connections** checks its version and required controls; finding an executable does not prove its account is authenticated. Unsupported CLI versions show a reason. A desktop chatbot app alone is not a CLI connection.

The reviewed connections are **Codex CLI 0.160.x** and **Gemini CLI 0.62.x**. Claude Code must advertise every required safe-mode, restricted, tool-disabling and structured-output flag. Other versions may appear as unavailable until their controls are reviewed. Gemini connections are unavailable when system settings/defaults prevent SciSlide from verifying the content-only configuration.

**Generate draft** sends your instructions through that provider's existing login. Optionally include the current slide's visible text, equations and speaker notes; a preview shows the exact context. Figures, video bytes, file paths and local TeX configuration are excluded. Existing provider network requirements, data policies, account limits and any account charges still apply. SciSlide does not store API keys or read credential contents.

Review the generated slides and notes, then click **Insert draft slides** to add them after the current slide. Generated titles, bullet points and MathJax equations are ordinary editable objects. MathJax syntax and equation size are checked before insertion. Scientific claims and citations need review. Invalid output is rejected, and a changed source slide requires a fresh draft. Undo restores the previous deck. The draft's overall title labels its preview and does not rename the presentation.

The host uses fixed provider commands and passes requests through stdin in a private temporary workspace. Codex runs with read-only enforcement and restricted agent integrations; compatible Claude/Gemini modes disable content-generation tools. Gemini reuses existing authentication through private temporary links to known vendor authentication files, or its normal keychain/environment authentication; those links are removed at job completion. User customizations and organization policies can make a connection unavailable. Requests time out after three minutes, output is bounded, and Cancel or closing the dialog terminates the job. Only one generation runs at a time.

The web editor shows the desktop requirement and does not launch local programs. Image generation, file/repository access, web research, full-deck replacement, streaming chat and direct API-key setup are later features. Native `.scislide` documents use format version **0.5.0**.

## Korean Text Export

The bundled Nanum Gothic fonts are unchanged static TrueType files from a pinned revision of [Google Fonts](https://github.com/google/fonts/tree/133ccbee9a8b408eb71f31a36ccb9116f5c695ad/ofl/nanumgothic). They use [SIL Open Font License 1.1](third-party-licenses/nanum-gothic/OFL.txt), which permits software bundling and document embedding. The copyright, license, source revision and asset checksums are included in `third-party-licenses/nanum-gothic/`. Korean PDF exports embed subsets of the used fonts; mathematical equations remain vector graphics.

## Slide Templates

Click **New slide** or **+** in the slide list to open the layout picker for the deck's starter theme. **Keynote White** has its own fifteen-layout gallery. The other themes offer **All layouts**, **Scientific** and **Keynote-inspired** filters for the existing fourteen layouts; the count shows the displayed layouts. Choose a layout, or **Blank slide**, to insert a new slide after the current slide. Insertion is one undoable edit.

The **Keynote White** theme uses consistent white backgrounds, black typography and generous spacing across its layouts:

| Layout                           | Starting point                                       |
| -------------------------------- | ---------------------------------------------------- |
| **Title**                        | Large title with subtitle and presenter details      |
| **Title & Photo**                | Title and one large photo placeholder                |
| **Title & Photo Alternate**      | An alternate title-and-photo composition             |
| **Title & Bullets**              | A heading followed by concise bullet points          |
| **Bullets**                      | A text-focused list without a separate title         |
| **Title, Bullets & Photo**       | A heading and bullet list beside a photo placeholder |
| **Title, Bullets & Small Video** | Text with a small video placeholder                  |
| **Title, Bullets & Large Video** | A large video placeholder with supporting text       |
| **Section**                      | A section divider                                    |
| **Title Only**                   | One prominent heading                                |
| **Agenda**                       | An ordered presentation outline                      |
| **Statement**                    | A short, oversized message                           |
| **Important Fact**               | A prominent fact or number with an explanation       |
| **Quote**                        | A quotation with attribution                         |
| **Three Photos**                 | Three photo placeholders                             |

These layouts use original editable text and shapes inspired by the supplied Keynote layout reference. Photo and video areas are placeholders; no Apple photographs or other reference-image assets are bundled. Select one **Photo** placeholder frame, icon or label, then choose **Figure** to import your image into that frame. The import retains its position and size, replaces its associated icon/label, and applies a reversible centered crop to fill the frame. Adjust or reset the crop with the existing figure tools. PDF import uses the same frame after you choose a page. Select one **Video** placeholder, then choose **Video** to fill it with a local MP4/WebM file. Without a single matching placeholder selected, imports use their ordinary free-placement behavior.

The video layouts use imported media; live-camera feeds are not supported. Keynote White's default Latin text uses bundled Inter, with the existing Nanum Gothic handling for supported Korean text. This theme is separate from the existing **Minimal White** palette and its layouts.

Open [keynote-white-theme.scislide](examples/keynote-white-theme.scislide) to explore all fifteen layouts as editable native slides. Its media areas remain placeholders ready for your own imports.

The eight **Scientific** layouts provide research-oriented structure:

| Layout                     | Starting point                                             |
| -------------------------- | ---------------------------------------------------------- |
| **Research title**         | Talk title, subtitle, author and affiliation               |
| **Key findings**           | Three findings and one clear takeaway                      |
| **Equation + meaning**     | Editable equation, notation and physical interpretation    |
| **Figure comparison**      | Two figure placeholders with captions                      |
| **Section divider**        | Section number, title and a transition into the next topic |
| **Methods pipeline**       | Three method steps connected by editable arrows            |
| **Results spotlight**      | Large figure placeholder, key metric and interpretation    |
| **Takeaways + next steps** | Closing takeaways and a next-step card                     |

Six **Keynote-inspired** layouts complement the eight Scientific layouts:

| Layout                     | Starting point                                                           |
| -------------------------- | ------------------------------------------------------------------------ |
| **Minimal White**          | Left-aligned title on white with generous whitespace                     |
| **Minimal Black**          | Centered title on black                                                  |
| **Minimal White findings** | Three clean columns on white                                             |
| **Minimal Black findings** | Three clean columns on black                                             |
| **Color Statement**        | A bold statement on deep navy                                            |
| **Figure Showcase**        | An isolated illustration above an uppercase caption on a pale background |

The visual direction references the basic white/black, color and showroom compositions shown in [Apple's official Keynote theme chooser guide](https://support.apple.com/guide/keynote-icloud/create-a-presentation-gil310ef8e21/icloud). SciSlide generates these layouts as original editable text and shape geometry using the deck's body font. Figure Showcase starts with an original orbital illustration made from editable shapes. Replace it with your own image through **Figure**, then remove the illustration objects you no longer need.

Template titles, body text, equations, arrows and shapes become ordinary editable objects with independent IDs. Change the text, or move and delete objects to suit your presentation. Text uses the deck's current body font; equations inherit its equation font and color. Figure comparison and Results spotlight use labeled shapes and instructions as placeholders. Add actual SVG/PNG/JPEG images with **Figure**, position them in those areas, then remove the placeholder objects. Example metrics and scientific text are prompts to replace with your own results. Templates contain no imported assets and do not download external images or additional fonts. Linked masters and custom template authoring remain future work.

Open [additional-templates.scislide](examples/additional-templates.scislide) for the section, methods, results and closing layouts, or [keynote-inspired-templates.scislide](examples/keynote-inspired-templates.scislide) for the six minimal and showcase layouts. Both are editable native sample decks.

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

New `.scislide` files use **`0.5.0`** as their `formatVersion`, retaining drawing/group records and adding optional normalized figure crops. The app reads `0.1.0` through `0.4.0` files, migrates older data, and writes 0.5.0 on the next save. Existing figure frames remain unchanged. Version 0.1.0/0.2.0 files receive disabled page numbering and no click builds; later files retain their existing settings. Opening an existing file does not modify it. **Earlier SciSlide builds that support only format 0.4.0 or below cannot read new 0.5.0 files.** Use Save As to keep an older original if you need it; exporting PDF/SVG provides viewable output, not a downgrade of the editable source.

```text
presentation.scislide
  manifest.json              Resource sizes, SHA-256 hashes and rendering profiles
  document.json              Slides, figure crops, page numbers, builds and editable source
  assets/                    Original/sanitized figures and embedded video files
  renders/<equation-id>.svg   Successful outlined Local LaTeX results
```

Local LaTeX equations retain their source, preamble, engine, result SVG and dimensions, input matching information, compiler and converter versions, and hashes of the dependencies used. SVG results are stored as validated vector shapes without external references, scripts, or text font dependencies. **Valid saved results can be viewed, presented, and exported to PDF/SVG on computers without TeX and in the web editor.** Recompilation requires a supported environment with the necessary packages and fonts. Missing caches or caches that do not match the source produce an error and are rejected during export.

## Implemented Features

- Installed AI CLI discovery, bounded draft generation, slide preview/insertion, cancellation and undo.
- Five starter themes: the existing fourteen layouts (eight Scientific and six Keynote-inspired), plus a dedicated fifteen-layout Keynote White gallery and blank slides; slide creation, duplication, deletion, reordering, titles, backgrounds, and speaker notes.
- Text, equations, SVG/PNG/JPEG figures, embedded MP4/WebM videos, and drag-drawn rectangles, ellipses, lines and arrows.
- Inline MathJax formulas inside text boxes, with shared baseline/wrapping and vector PDF/SVG output.
- Editable line endpoints, start/end/bidirectional arrowheads, solid/dashed/dotted strokes and unfilled shape outlines.
- Deck-wide dynamic page numbers in the editor, slideshow, PDF and SVG.
- Ordered click-triggered appear/fade builds; editor/thumbnails/static exports show the complete layout.
- Moving, resizing, rotation, opacity, locking, duplication, object copy/cut/paste, and a selectable object/layer list including hidden objects.
- Shift+click multi-selection, flat persistent groups, six-way alignment, equal horizontal/vertical distribution, smart movement/resize/equal-gap guides, separate 20 px grid snapping, and keyboard movement.
- Local SVG/PNG/JPEG import and PDF page preview/selection; selected PDF pages become embedded high-resolution PNG figures.
- Reversible figure cropping, enlarged independent insets and replacement preserving layout/crop.
- A local searchable equation library with named/tagged entries and JSON import/export.
- A separate presenter display with notes, click-build previews, navigation and a configurable timer.
- Undo/redo and bounded IndexedDB workspace recovery, with equation drafts and a localStorage fallback.
- ZIP-based source file saving and loading, with checksum validation for assets and equation results.
- MathJax 4.1.3, three equation fonts, and 17 package entries with examples.
- Electron native file operations, menus, and isolated Local LaTeX compilation.
- PDF and SVG export. Equations and supported SVG figures remain vector graphics.

## Current Limitations

- Modern Korean text is supported in the editor, PDF and SVG through bundled **Nanum Gothic Regular/Bold**. No system font installation or remote font request is needed. Text objects containing Korean use Nanum Gothic; Latin-only objects retain Inter. Korean weights 400/500 use Regular and 600/700 use Bold. Decomposed modern Hangul is normalized to NFC for display/export while the editable source is preserved. PDF text remains selectable, and SVG embeds the required font and its license. Unsupported glyphs, including Hanja and standalone old/combining Jamo, still stop PDF export with a clear error; use native equations for mathematical symbols unavailable in the text font. Local LaTeX equation outlines do not extend body-text font coverage.
- Original PDF vector preservation, linked masters/themes, shared deck macros, linked equation-library entries, citations, editable charts, collaboration and PPTX/Beamer conversion are planned. Group nesting/scaling/rotation, attached connectors, freehand paths and a path editor are also future work. Basic appear/fade click builds are available; advanced motion, exit effects, timing chains, equation-term highlighting and a timeline are not yet available.
- Local LaTeX is an initial implementation targeting system installations on Linux. Arbitrary complete documents, home package folders, every TeX distribution path, and every package combination are not guaranteed to work.
- External references and active content in SVG figures are unsupported. PDF export does not support filters, masks, textPath, or some complex SVG effects. These produce an error before export.
- Automatic recovery and the personal library remain local to each web/Electron environment. Recovery records are limited to 100 MiB, browser quotas can be smaller, and localStorage fallback is more limited. Large media decks may exceed recovery storage; use source-file saves and check failure feedback.
- The object clipboard is limited to the current SciSlide editor session. Presenter display requires popup and communication support; automatic multi-monitor placement is not provided.
- Bundling the complete MathJax font data makes the build large. Split loading and a separate asset/cache store remain future work.

## Development and Validation

```sh
pnpm test
pnpm test:desktop
pnpm build
```

Web tests cover document validation, legacy file migration, ZIP round trips, checksums, SVG sanitization, equation cache matching, and MathJax packages and fonts. Inline-math fixtures cover delimiter handling, original-source round trips, real MathJax glyphs, baseline/wrapping/alignment, unique SVG references, named errors and actual vector PDF output with Korean prose. Regression fixtures also cover object clipboard/locking, layers, alignment/distribution, personal equation libraries, bounded draft recovery, crop/inset round trips, shared crop geometry and actual vector PDF clipping. PDF figure fixtures cover page selection, cancellation, bounded rendering, embedded-page persistence and replacement preserving frame/crop; editor fixtures keep SVG sanitization on the actual import path. Numbering/build state, video resource validation and static video export remain covered. Presenter components cover synchronized previews and timer/navigation behavior. Browser smoke review exercised presenter current/next previews, notes, timer and navigation synchronization; physical two-monitor placement remains unverified. Desktop tests cover input validation for the narrow file and compiler APIs, plus Linux TeX isolation, compilation, cancellation, and resource limits. Running the TeX integration tests requires the tools listed above and a functioning Linux isolation environment. `pnpm build` includes TypeScript checks and a production build.

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
 src/components/EquationLibraryDialog.tsx  Personal equation library
 src/components/FigureTools.tsx Crop preview, apply/reset and inset controls
 src/components/PdfFigureDialog.tsx  Local PDF page preview and selection
 src/components/ObjectLayers.tsx  Hidden/covered object selection and layer controls
 src/components/PresenterApp.tsx  Separate presenter display
 src/lib/model.ts              Versioned document model and migration
 src/lib/slide-templates.ts    Editable scientific starter layouts
 src/lib/presentation.ts      Deterministic click-build visibility and navigation
 src/lib/persistence.ts        Native archive, validation, legacy recovery and media import
 src/lib/workspace-recovery.ts Bounded IndexedDB recovery with equation drafts
 src/lib/object-clipboard.ts   Independent object/group/media copying
 src/lib/selection-layout.ts   Alignment and equal edge-gap distribution
 src/lib/figure-editing.ts     Shared crop geometry and inset creation
 src/lib/pdf-figure.ts         Bounded local PDF page rendering
 src/lib/equation-library.ts   Personal library validation and storage
 src/lib/desktop.ts            Typed platform and local compiler contract
 src/lib/equations.ts          MathJax renderer and font profiles
 src/lib/inline-math.ts        Inline delimiter parsing and shared text/math layout
 src/lib/equation-renderer.ts  Renderer selection and saved local-result checks
 src/lib/local-equation-svg.ts Passive outlined SVG validation
 src/lib/export.ts             Vector PDF/SVG exporters and resource preflight
 tests/                        Document, equation, archive and compiler regressions
 public/fonts/                 Bundled Inter and Nanum Gothic TrueType fonts
 third-party-licenses/         Dependency and font license notices
```

## Future Development and Licensing

Priorities include PDF vector import, richer group transforms, linked themes/masters, shared deck macros, linked equation-library entries, citations/BibTeX and CSV charts with units/error bars. Attached connectors, freehand paths, advanced animation, split font loading, a separate asset/cache store and desktop distribution validation remain follow-up work. Local TeX isolation on macOS and Windows, along with access to explicitly selected user package folders, requires separate implementation. See the [project specification](SciSlide-Project-Specification.md) for the detailed design and follow-up requirements.

This prototype does not reuse PPTist code. **A project license for the new SciSlide source has not yet been selected.** The license and contribution rules must be finalized before a public release. Bundled dependencies, fonts, and the Electron runtime retain their respective licenses; notices are kept in `third-party-licenses/` and the packaged runtime.
