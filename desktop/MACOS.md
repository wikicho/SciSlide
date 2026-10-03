# SciSlide 0.5.3 — macOS development installer

Choose the installer that matches your Mac: **arm64** for Apple Silicon (M1 or later), or **x64** for Intel. The installer copies SciSlide to `/Applications/SciSlide.app`. Node.js, a development server and TeX are not required for MathJax editing.

These are **unsigned, unnotarized development installers**. They do not carry an Apple Developer ID Application or Installer signature. macOS may prevent installation or launch under its security policy. A signed and notarized distribution is a separate future step; this build does not change system security settings.

Quit an existing SciSlide window before installing an update. Both architectures use the same application name and installation location; install only the matching one. Open SciSlide from Applications after installation.

**New slide** or the slide list's **+** opens the template picker. **All layouts**, **Scientific** and **Keynote-inspired** filter fourteen editable layouts; **Blank slide** creates an empty slide. The eight Scientific layouts cover research titles, findings, equations, comparisons, sections, methods, results and conclusions. Six Keynote-inspired layouts add minimal white/black titles and findings, a navy statement and a figure showcase. Layouts insert after the current slide and can be undone. **Open / Save / Save As** use native file dialogs; **Export** saves the whole presentation as PDF or the current slide as SVG.

Choose **Draw rectangle**, **Draw ellipse**, **Draw line** or **Draw arrow**, then drag on the canvas. Shift constrains squares/circles or line direction; Escape cancels drawing. Selected lines/arrows have editable endpoint handles. The Inspector provides solid/dashed/dotted strokes, stroke width/color, no-fill outlines and arrowheads at the start, end or both ends. Shapes export as vectors in PDF/SVG.

Shift+click selects objects for **Group objects / Ungroup objects**; Cmd+G groups and Cmd+Shift+G ungroups. Flat groups move together and duplicate independently, with membership preserved by save/open and undo/redo. Ungroup before resizing, rotating or editing an individual member's endpoints. Automatic alignment guides appear while dragging; Option/Alt bypasses them. **Snap to 20 px grid** enables grid snapping with precedence over object guides. Nested groups, collective group scaling/rotation, equal distribution, attached connectors and freehand paths remain planned.

New saves use native format **0.4.0**. Versions 0.1.0/0.2.0/0.3.0 are migrated on opening; the original is untouched until Save. Apps that support only 0.3.0 or earlier cannot read new 0.4.0 files. Use Save As to preserve an older original when needed; PDF/SVG does not downgrade editable source.

MathJax equations, AMS notation and the included STIX Two, Fira Math and Latin Modern equation fonts work on macOS. **Local LaTeX compilation is currently disabled on macOS**, even when a TeX distribution is installed, until the macOS compiler sandbox is implemented. Valid vector results stored in an existing `.scislide` document can still be displayed, presented and exported without TeX.

To open bundled examples, use Finder's **Show Package Contents** on SciSlide.app and browse to `Contents/Resources/examples/`. Copy a sample presentation to your own folder before editing it. The sample data is synthetic.

The editor is a prototype. Modern Korean body text is supported in the editor and PDF/SVG through bundled Nanum Gothic, without a separate font installation. Page numbering, embedded MP4/WebM videos and click-step appear/fade builds are available. Videos play in presentation mode; PDF/SVG exports show a static placeholder. Image crop, advanced animation timelines, PPTX conversion and automatic updates are future work.

Each installer has a matching `.sha256` file. To verify a download, put the installer and checksum file in the same folder and run:

```sh
shasum -a 256 -c SciSlide-0.5.3-macos-arm64-unsigned.pkg.sha256
```

Use the x64 filename for an Intel installer. This checks that the file matches its accompanying checksum; it does not certify the publisher or replace Apple's code signing and notarization.

Electron/Chromium license notices are included in the application bundle. App dependency notices are inside `Contents/Resources/app.asar` under `third-party-licenses/`. A project license for the new SciSlide source has not been selected yet.

## AI content drafts

Open **AI draft** to connect a compatible installed Codex CLI, Claude Code or Gemini CLI. Install and sign in to the CLI in your terminal first; the desktop chatbot application alone is insufficient. Generate titles, bullet points, notes and MathJax equations, review the preview, then insert editable slides. Including current-slide text is optional. Requests use the provider account/network/usage limits. Cancel stops a job, and Undo restores the deck after insertion. CLI versions and restrictions are checked; unsupported configurations show a reason. See the repository README for connection details and current limits.
