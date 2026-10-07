# SciSlide 0.6.2 — macOS development installer

Choose the installer that matches your Mac: **arm64** for Apple Silicon (M1 or later), or **x64** for Intel. The installer copies SciSlide to `/Applications/SciSlide.app`. Node.js, a development server and TeX are not required for MathJax editing.

These are **unsigned, unnotarized development installers**. They do not carry an Apple Developer ID Application or Installer signature. macOS may prevent installation or launch under its security policy. A signed and notarized distribution is a separate future step; this build does not change system security settings.

Quit an existing SciSlide window before installing an update. Both architectures use the same application name and installation location; install only the matching one. Open SciSlide from Applications after installation.

## Use the editor

Start by choosing **Scientific**, **Minimal White**, **Minimal Black**, **Navy** or **Keynote White**, then **Create presentation**. Keynote White has fifteen coordinated white/black layouts; the other themes retain the fourteen Scientific/Keynote-inspired layouts. **New slide** or **+** opens the theme's picker, including **Blank slide**. Layouts insert after the current slide and can be undone. **Open / Save / Save As** use native file dialogs; **Export** saves the whole presentation as PDF or the current slide as SVG.

Drag a slide thumbnail above or below another thumbnail to reorder slides. A teal insertion line shows the destination, and the list scrolls when dragging near its edges. The current slide and object selection stay active; **⌘+Z / ⌘+Shift+Z** undo/redo the move. **Escape** cancels a drag.

Double-click text or press **Enter** on a selected text box to edit directly on the slide. **Enter** adds a line, **⌘+Enter** or clicking outside applies one undoable edit, and **Escape** cancels. Korean IME input and plain-text paste are supported. Write `$\chi$` or `\(\frac{1}{2}\)` inside text to render inline MathJax formulas. They match the surrounding font's lowercase height, retain their mathematical baseline and remain vectors in PDF/SVG; editing and native saves preserve the original syntax.

Choose **Figure** to import PNG, JPEG, sanitized SVG or a selected PDF page. PDF preview/selection embeds a high-resolution PNG; original PDF vector preservation is not implemented. **CROP & INSET** lets you apply/reset a reversible crop or create an independent enlarged inset. **Replace figure** preserves the frame and normalized crop. Selecting a Keynote White photo/video placeholder before **Figure / Video** fills its frame; photo crops remain adjustable. Video layouts use imported MP4/WebM, with no live-camera feed.

Choose **Draw rectangle**, **Draw ellipse**, **Draw line** or **Draw arrow**, then drag on the canvas. Shift constrains squares/circles or line direction; Escape cancels drawing. Selected lines/arrows have editable endpoint handles. The Inspector provides solid/dashed/dotted strokes, stroke width/color, no-fill outlines and arrowheads at the start, end or both ends. Shapes export as vectors in PDF/SVG.

Shift+click or Command+click selects objects for **Group objects / Ungroup objects**; **⌘+Option+G** groups and **⌘+Option+Shift+G** ungroups. Flat groups move together and duplicate independently. Ungroup before resizing, rotating or editing an individual member's endpoints. Use six-way alignment and equal-gap distribution to arrange a selection. Automatic guides appear while dragging/resizing; **Option** bypasses them. **Snap to 20 px grid** takes precedence over object guides. The **OBJECTS & LAYERS** list selects hidden or covered objects and controls visibility, locks and order. Object copy/cut/paste works across slides or decks in one session. Nested groups, whole-group scaling/rotation, attached connectors and freehand paths remain planned.

Keyboard shortcuts use **Command** and **Option**, following [Apple's Keynote shortcuts](https://support.apple.com/ko-kr/guide/keynote/tanfde4a3e6d/mac) for supported actions. **⌘+O / ⌘+S / ⌘+Option+Shift+S** open/save/save as; **⌘+Z / ⌘+Shift+Z** undo/redo. **⌘+Option+P** presents from the canvas. **⌘+Option+Shift+P / ⌘+Option+S** export PDF/current-slide SVG. **⌘+Shift+/** opens shortcut help.

| Action                                    | Shortcut                            |
| ----------------------------------------- | ----------------------------------- |
| Open the new-slide layout chooser         | ⌘+Shift+N                           |
| Insert equation                           | ⌘+Option+E                          |
| Insert image, SVG or PDF                  | ⌘+Shift+V                           |
| Deselect all objects                      | ⌘+Shift+A                           |
| Lock / Unlock selected objects            | ⌘+L / ⌘+Option+L                    |
| Bring to front / Send to back             | ⌘+Shift+F / ⌘+Shift+B               |
| Bring forward / Send backward one layer   | ⌘+Option+Shift+F / ⌘+Option+Shift+B |
| Zoom in / out                             | ⌘+Shift+> / ⌘+Shift+<               |
| Fit slide to window                       | ⌘+Option+0                          |
| Toggle bold on selected text objects      | ⌘+B                                 |
| Increase / Decrease selected text size    | ⌘ and + / ⌘ and -                   |
| Align selected text left / center / right | ⌘+{ / ⌘+\| / ⌘+}                    |

**Page Down / Page Up** selects the next/previous slide while editing; **Home / End** selects the first/last. On compact Mac keyboards use **Fn+↓ / Fn+↑** and **Fn+← / Fn+→**, respectively. **Up / Down** selects slides and **Delete / Backspace** removes the focused slide when a thumbnail has focus in the slide navigator; on the canvas, arrows move selected objects. Zoom changes in 10% steps between 50% and 150%, and Fit restores the existing 100% view fitted to the available canvas.

Bold, size and text-alignment commands apply to whole selected text objects on the canvas. During inline text editing, **⌘+Enter** applies the edit; text-field clipboard, navigation and IME behavior remain native. Existing **⌘+Shift+S**, **⌘+G / ⌘+Shift+G** and canvas **⌘+Enter** remain accepted for Save As, Group/Ungroup and Present. During a slideshow, **Esc** exits. **Q** also exits when focus is outside text fields and media controls. In the browser, use a toolbar control when the browser reserves a combination.

**My equations** stores named/tagged formulas locally and transfers them through JSON import/export. **Presenter display** opens a separate window with current/next previews, notes, navigation and a timer; move it to your presenter screen. Recovery uses IndexedDB, bounded to 100 MiB, and retains up to 200 unfinished equation drafts, with a localStorage fallback. Libraries and unapplied drafts are local workspace data; continue saving portable files explicitly.

New saves use native format **0.5.0**, including reversible figure crops. Versions **0.1.0–0.4.0** are migrated on opening; the original is untouched until Save. Apps that support only 0.4.0 or earlier cannot read new 0.5.0 files. Use **Save As** to preserve an older original; PDF/SVG does not downgrade editable source.

MathJax equations, AMS notation and the included STIX Two, Fira Math and Latin Modern equation fonts work on macOS. **Local LaTeX compilation is currently disabled on macOS**, even when a TeX distribution is installed, until the macOS compiler sandbox is implemented. Valid vector results stored in an existing `.scislide` document can still be displayed, presented and exported without TeX.

To open bundled examples, use Finder's **Show Package Contents** on SciSlide.app and browse to `Contents/Resources/examples/`. Copy a sample presentation to your own folder before editing it. The sample data is synthetic.

The editor is a prototype. Modern Korean body text is supported through bundled Nanum Gothic; unsupported body-text glyphs still produce a PDF export error. Page numbering, embedded MP4/WebM videos and click-step appear/fade builds are available. Videos play in presentation mode; PDF/SVG exports show a static placeholder. Advanced animation, PPTX/HTML export, automatic multi-monitor placement and automatic updates remain future work. Packaging checks do not establish complete physical-Mac editing/export validation.

Each installer has a matching `.sha256` file. To verify a download, put the installer and checksum file in the same folder and run:

```sh
shasum -a 256 -c SciSlide-0.6.2-macos-arm64-unsigned.pkg.sha256
```

Use the x64 filename for an Intel installer. This checks that the file matches its accompanying checksum; it does not certify the publisher or replace Apple's code signing and notarization.

Electron/Chromium license notices are included in the application bundle. App dependency notices are inside `Contents/Resources/app.asar` under `third-party-licenses/`. A project license for the new SciSlide source has not been selected yet.

## Build installers from source

From the project root, build the editor and both macOS installers:

```sh
pnpm build
node scripts/package-macos.mjs --arch=all --out=release/macos-pkg
```

The installers, matching checksums and this guide are written to `release/macos-pkg/`. The default pure-JavaScript installer implementation also works on Linux; use `--implementation=native` on macOS to package with Apple's command-line tools. Neither method signs or notarizes the application.

## AI content drafts

Open **AI draft** to connect a compatible installed Codex CLI, Claude Code or Gemini CLI. Install and sign in to the CLI in your terminal first; the desktop chatbot application alone is insufficient. Generate titles, bullet points, notes and MathJax equations, review the preview, then insert editable slides. Including current-slide text is optional. Requests use the provider account/network/usage limits. Cancel stops a job, and Undo restores the deck after insertion. CLI versions and restrictions are checked; unsupported configurations show a reason. See the repository README for connection details and current limits.
