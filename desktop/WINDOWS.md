# SciSlide 0.6.2 — Windows x64

This development build contains the **x64 (Intel/AMD 64-bit)** SciSlide app for Windows 10 or later. Windows 11 x64 is the intended desktop target. Node.js, a development server and TeX are not required for MathJax editing. Physical Windows 10/11 desktop validation is still a release requirement.

## Install or run the portable app

Local 0.6.2 Windows packages are stored in `release/windows-x64/`. A Linux or macOS build produces the portable ZIP only; the setup executable requires a native Windows build with Inno Setup. The commands below describe each distribution when it is available.

Run `SciSlide-0.6.2-windows-x64-setup-unsigned.exe` to install for your current user. The default destination is `%LOCALAPPDATA%\Programs\SciSlide`, with a Start menu shortcut. Administrator privileges are not requested. Quit SciSlide before installing an update. Remove it through Windows' installed-app settings. Uninstallation does not remove presentations you saved elsewhere or the app's user-data folder.

Alternatively, extract **all** of `SciSlide-0.6.2-windows-x64-portable.zip`, then open `SciSlide-win32-x64\scislide.exe`. Keep the runtime files, DLLs and `resources` directory together. The portable edition runs without installation, but still uses Electron's ordinary per-user app-data directory; recovery data is not stored beside the executable.

Both distributions are **unsigned development builds**. Windows security policies may block installation or launch. Code signing and publisher reputation are later release work; these builds do not change system security settings. The application binary is x64, and the installer uses an x64 bootstrap executable. A separate native ARM64 or 32-bit Windows edition is not provided.

## Use the editor

Start by choosing **Scientific**, **Minimal White**, **Minimal Black**, **Navy** or **Keynote White**, then **Create presentation**. Keynote White has fifteen coordinated white/black layouts; the other themes retain the fourteen Scientific/Keynote-inspired layouts. **New slide** or **+** opens the theme's picker, including **Blank slide**. Layouts insert after the current slide and can be undone. **Open / Save / Save As** use native file dialogs; **Export** saves the whole presentation as PDF or the current slide as SVG.

Drag a slide thumbnail above or below another thumbnail to reorder the presentation. A teal line marks the insertion position, and dragging near the list edge scrolls longer presentations. The current slide and selected objects stay selected. Undo/Redo restores the order, and Escape cancels a drag. Page numbering and saved slide order follow the new position.

Double-click text or press **Enter** on a selected text box to edit directly on the slide. **Enter** adds a line, **Ctrl+Enter** or clicking outside applies one undoable edit, and **Escape** cancels. Korean IME input and plain-text paste are supported. Write `$\chi$` or `\(\frac{1}{2}\)` inside text to render inline MathJax formulas. They match the surrounding font's lowercase height, retain their mathematical baseline and remain vectors in PDF/SVG; editing and native saves preserve the original syntax.

Choose **Figure** to import PNG, JPEG, sanitized SVG or a selected PDF page. PDF preview/selection embeds a high-resolution PNG; original PDF vector preservation is not implemented. **CROP & INSET** lets you apply/reset a reversible crop or create an independent enlarged inset. **Replace figure** preserves the frame and normalized crop. Selecting a Keynote White photo/video placeholder before **Figure / Video** fills its frame; photo crops remain adjustable. Video layouts use imported MP4/WebM, with no live-camera feed.

Choose **Draw rectangle**, **Draw ellipse**, **Draw line** or **Draw arrow**, then drag on the canvas. Shift constrains squares/circles or line direction; Escape cancels drawing. Selected lines/arrows have editable endpoint handles. The Inspector provides solid/dashed/dotted strokes, stroke width/color, no-fill outlines and arrowheads at the start, end or both ends. Shapes export as vectors in PDF/SVG.

Shift+click selects objects for **Group objects / Ungroup objects**; **Ctrl+G** groups and **Ctrl+Shift+G** ungroups. Flat groups move together and duplicate independently. Ungroup before resizing, rotating or editing an individual member's endpoints. Use six-way alignment and equal-gap distribution to arrange a selection. Automatic guides appear while dragging/resizing; **Alt** bypasses them. **Snap to 20 px grid** takes precedence over object guides. The **OBJECTS & LAYERS** list selects hidden or covered objects and controls visibility, locks and order. Object copy/cut/paste works across slides or decks in one session. Nested groups, whole-group scaling/rotation, attached connectors and freehand paths remain planned.

Keyboard shortcuts follow [PowerPoint for Windows](https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations) for supported actions. **Ctrl+O / Ctrl+S / Ctrl+Shift+S** open/save/save as; **Ctrl+Z / Ctrl+Y** undo/redo, with **Ctrl+Shift+Z** also accepted for Redo.

| Action                                                | Shortcut                        |
| ----------------------------------------------------- | ------------------------------- |
| Choose a layout for a new slide                       | Ctrl+M                          |
| Copy the current slide                                | Ctrl+Shift+D                    |
| Copy selected objects, or the slide with no selection | Ctrl+D                          |
| Insert equation                                       | Alt+=                           |
| Start at first / current slide                        | F5 / Shift+F5                   |
| Open presenter display                                | Alt+F5                          |
| Advance / retreat one object layer                    | Ctrl+Shift+] / Ctrl+Shift+[     |
| Enlarge / shrink the canvas view                      | Ctrl++ / Ctrl+-                 |
| Fit the slide in the window                           | Ctrl+Alt+O                      |
| Toggle bold on selected text objects                  | Ctrl+B                          |
| Increase / decrease selected text size                | Ctrl+Shift+> / Ctrl+Shift+<     |
| Align selected text left / center / right             | Ctrl+L / Ctrl+E / Ctrl+R        |
| Move focused thumbnail up / down                      | Ctrl+Up / Ctrl+Down             |
| Move focused thumbnail first / last                   | Ctrl+Shift+Up / Ctrl+Shift+Down |
| Shortcut help                                         | F1                              |

**Page Up / Page Down** navigates the deck; **Home / End** selects its first / last slide. Slide-move commands require a focused thumbnail, preserving canvas object movement and text navigation. **Up / Down** selects thumbnails and **Delete / Backspace** deletes the focused slide. **Ctrl+Enter** still presents from the current slide outside text editing; inside the inline editor it applies the edit. **Ctrl+Shift+/** remains a help alias. Text formatting changes whole selected text objects; clipboard, cursor, IME and undo behavior in text fields remain native.

SciSlide's **Ctrl+Alt+P / Ctrl+Alt+S** export PDF/current-slide SVG. During a slideshow, **Enter / N** advance a build or slide, **Backspace / P** go back, and **Esc** exits; arrow, Space and Page Up/Down navigation remain available. Media controls keep their own keyboard behavior.

**My equations** stores named/tagged formulas locally and transfers them through JSON import/export. **Presenter display** opens a separate window with current/next previews, notes, navigation and a timer; move it to your presenter screen. Recovery uses IndexedDB, bounded to 100 MiB, and retains up to 200 unfinished equation drafts, with a localStorage fallback. Libraries and unapplied drafts are local workspace data; continue saving portable files explicitly.

New saves use native format **0.5.0**, including reversible figure crops. Versions **0.1.0–0.4.0** are migrated on opening; the original is untouched until Save. Apps that support only 0.4.0 or earlier cannot read new 0.5.0 files. Use **Save As** to preserve an older original; PDF/SVG does not downgrade editable source.

MathJax, AMS notation and the bundled STIX Two, Fira Math and Latin Modern equation fonts work without a TeX installation. **Local LaTeX compilation is currently disabled on Windows**, even when MiKTeX or TeX Live is installed, until the Windows compiler isolation worker is implemented. Valid vector results already saved in a `.scislide` document can be viewed, presented and exported without TeX.

Bundled editable examples are in the app's `examples` folder. Copy one to your documents folder before editing it. The example data is synthetic. Page numbering, embedded MP4/WebM videos and click-step appear/fade builds are available. Videos play in presentation mode; PDF/SVG exports use a static placeholder. Codec support depends on the Electron runtime. Modern Korean body text is supported in the editor and PDF/SVG through bundled Nanum Gothic, without a separate font installation.

## Verify a download

Each distribution has a matching `.sha256` file. In PowerShell, compare its recorded hash with the result of:

```powershell
Get-FileHash .\SciSlide-0.6.2-windows-x64-setup-unsigned.exe -Algorithm SHA256
Get-Content .\SciSlide-0.6.2-windows-x64-setup-unsigned.exe.sha256
```

Use the portable ZIP's filename to verify that distribution. A matching checksum detects file changes; it does not certify a publisher or replace code signing.

## Build from source

With Node.js 22.12 or later, pnpm and **Inno Setup 6.7 or later** installed on Windows:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:package:win --out=release/windows-x64
```

The target is always x64, independent of the build machine's architecture. Use `--arch=x64` explicitly if desired. Other architectures are rejected by this Windows distribution command. If Inno Setup is outside its standard installation path, pass `--iscc` with the compiler's path. To build only the portable distribution, including from Linux or macOS:

```sh
pnpm desktop:package:win --portable-only --out=release/windows-x64
```

The commands above keep local Windows packages in `release/windows-x64/`; the script itself defaults to `release/`. Use `--out` for another output folder and `--overwrite` to replace existing generated outputs. The **Windows x64 development distributions** GitHub Actions workflow builds on a Windows x64 runner, checks hashes and PE architecture, and tests installation and uninstallation in a temporary directory. Its downloadable artifacts are retained for 30 days. A build and install smoke check does not validate the complete editing, saving, media and export journey on physical Windows desktops.

Electron/Chromium notices are beside the executable in `LICENSE` and `LICENSES.chromium.html`; app dependency notices are in `resources/app.asar` under `third-party-licenses/`. A license for the new SciSlide source has not been selected yet. Automatic updates and signed distribution remain future work.

## AI content drafts

Open **AI draft** to connect a compatible installed Codex CLI, Claude Code or Gemini CLI. Install and sign in to the CLI in your terminal first; the desktop chatbot application alone is insufficient. Generate titles, bullet points, notes and MathJax equations, review the preview, then insert editable slides. Including current-slide text is optional. Requests use the provider account/network/usage limits. Cancel stops a job, and Undo restores the deck after insertion. CLI versions and restrictions are checked; unsupported configurations show a reason. See the repository README for connection details and current limits.
