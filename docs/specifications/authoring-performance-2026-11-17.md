# Authoring and rendering improvements — 2026-11-17

This change adds seven requested authoring controls and reduces repeated work in the editor. These changes target v0.6.9, following the published v0.6.8 drop-handling release. Installed applications change when the new package is installed.

## Authoring controls

- **User layouts:** Open **File → User layouts** to save the current slide. Use the new-slide layout gallery to insert an independent copy. **Edit** inserts a copy to edit on the canvas; reopen User layouts and choose **Update** to replace the saved layout. Existing slides remain independent. Layouts keep embedded media locally and must match the document page size.
- **Partial colors:** Select characters in the text field or canvas source editor, choose **Selection** color, then **Color selection**. **Reset color** restores the selected prose to the object color. Selected terms inside inline formulas and the equation editor use portable LaTeX color commands. Selections must contain complete LaTeX commands and balanced groups.
- **Numbering:** **First numbered slide** sets which slide receives **Start at**. Earlier slides display no number. Existing documents retain their earlier numbering until this control is changed.
- **Animated PDF:** In the export menu, enable **Include animation steps in PDF** to create a page per build step. All pages belonging to one logical slide use the same slide number and logical-slide total. The option is off by default.
- **Text box sizing:** Enable **Fit box to content · keep font size**. Width and height follow the content while keeping the font size; long text wraps at the page width. Manual resizing returns to a fixed box.
- **Bullets:** **• Bullets** toggles bullets on selected lines. Enter continues a list and Enter on an empty bullet ends it. Text color ranges move with their contents.
- **Macro favorites:** The equation source tools save named `newcommand` definitions locally. Inserting a favorite copies its definitions into the equation source (or Local LaTeX preamble), so the document remains self-contained. Local LaTeX still requires explicit compilation.

## Rendering changes

Offscreen slide and layout previews defer scientific SVG rendering until they approach the visible scroll area. Unchanged thumbnail content is reused across selection changes and immutable document clones. Text measurement ignores position-only movement and avoids emitting unchanged bounds. Inline text layouts share bounded completed and in-flight results, with font-load invalidation and current event handlers. Identical pending MathJax requests share one conversion; failed requests remain retryable. Saved-state comparison uses structural comparison rather than serializing embedded media. Validation normalizes editable JSON fields while sharing immutable media strings. Recovery reuses bounded media-validation and exact JSON byte counts; raster/video base64 checks compute decoded size without allocating a second byte buffer. SVG content still passes sanitization, and media mutations and MIME mismatches still revalidate or fail.

## Validation

The isolated release source passed all 1,291 editor tests. The shared working source also passed 1,331 tests, with one opt-in live-provider test skipped. Desktop tests passed 231 tests, with three platform-dependent tests skipped. TypeScript compilation and application/CLI builds passed. Additional integration tests cover user-layout save, update, reuse, Undo, storage failures and document switching; partial colors and bullets; live fitted text bounds; numbering and PDF options; SVG/PDF/PPTX output and native archive persistence.

Native performance results are recorded separately under `output/performance-validation/2026-11-17/`. A fresh-profile Xvfb run measures startup, archive opening, six actual card switches, renderer CPU counters and DOM size using the same 24-slide fixture. Runtime copying warms the filesystem cache, so these measurements do not represent cold-OS startup or every user document. The installed user profile is never used by these tests.

## Large-media native comparison

The same valid 24-slide archive contains eight unique 1920×1080 PNG assets, two figures per slide, plus text and math. Its archive size is 49,868,097 bytes. Imported PDF pages use this same stored PNG asset path; the benchmark does not measure PDF import itself.

| Measured action                             | Official 0.6.7 | Isolated improved preview |
| ------------------------------------------- | -------------: | ------------------------: |
| Open archive to ready active slide          |       9,532 ms |                  4,525 ms |
| Edit title and commit                       |         343 ms |                     92 ms |
| Return to slide 1 during the tested journey |       6,435 ms |                     62 ms |
| Mounted thumbnail scenes                    |             24 |                       5–7 |

The original journey included a long autosave task of 6,239 ms during the final switch; the corresponding improved switch had no long task. The improved one-second idle sample still recorded a 223 ms task, and initial opening still took seconds. These are one fresh-profile comparison pair with warmed filesystem caches, not latency guarantees. The preview uses the final isolated editor and media fixes, HEAD desktop host, and a dedicated profile; unrelated in-progress poster, AI and multiwindow changes were excluded. Source/binary hashes, exact fixtures, task counters and cleanup checks are in the native reports.

The actual Linux authoring journey also saved and reopened a native file and exported a seven-page PDF. Logical page labels were `[none, 5/8, 6/8, 7/8, 7/8, 7/8, 8/8]`. Poppler visual inspection of pages 1, 4, 5, 6 and 7 confirmed legible Korean, colors, formulas, build visibility and repeated numbers. Poppler emitted Adobe-Identity-H warnings; those remain recorded even though the inspected pages rendered correctly.
