# Additional editor UX review — 2026-11-15

This pass follows the [first real-desktop review](ux-review-0.6.6-2026-11-15.md). Its comparison baseline is the unpublished preview at commit `7da5d93`, which already contains that review's fixes. The public v0.6.6 tag, installers, and checksums remain unchanged.

## Changes

| Editing situation                              | Previous behavior                                                                                                                                             | Improvement                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editing text directly on the slide             | “Saved to file” could remain visible while the source field contained an unfinished change.                                                                   | The header immediately shows “Unsaved changes.” Escape restores the previous saved status; Save commits the edit before writing the file.                                                                                                     |
| Returning to an unapplied equation             | The local draft count described the state but offered no direct action. Saving the applied presentation gave no draft-specific feedback.                      | The badge opens a relevant draft and focuses its source. Save explicitly says how many drafts remain local and absent from the file. Apply includes the draft in subsequent saves.                                                            |
| A draft belongs to a hidden or locked equation | A direct route could otherwise require silently changing visibility or locks.                                                                                 | Review opens Layers and explains what to show or unlock. It preserves the equation, group locks, local draft, and Undo history. Editable drafts are preferred when available.                                                                 |
| Expanding speaker notes in a small window      | The 320px resize maximum could put 150px of the input below a 620×550 window, or 118px below an 800×600 window.                                               | The panel and accessible resize range follow the remaining window space. The preferred height returns when space becomes available. A zero-height input is hidden and disabled; focus returns to the toggle only if it was inside that input. |
| Fitting a 4:3 or portrait presentation         | Fit calculated width using 16:9, so the rendered slide extended below the available canvas. The fixed minimum paper width could also overflow a short canvas. | Paper shape and fit follow the document dimensions, including borders. “Fit” explains the initial zoom; other percentages are relative to the fitted slide.                                                                                   |
| Snapping on a custom slide size                | The grid used percentages derived from 1600×900, while snapping used 20 document units.                                                                       | Both grid axes now use 20 document units at the current render scale, including zoom changes.                                                                                                                                                 |

Review keeps the equation draft unapplied and preserves visibility and locks. It finishes any active canvas text edit through the existing commit path before navigating; navigation itself adds no Undo entry. The cross-slide route prefers the selected editable equation, then an editable equation on the current slide. If no editable draft exists, it selects a blocked draft in Layers. Saving applied content preserves unapplied drafts in local recovery; the existing document-transition guard remains in force.

## Regression checks

- **84 files / 1,112 tests passed**, including six new App integration tests and seven speaker-notes tests.
- The new checks cover cross-slide draft review, source focus, hidden/group-locked targets, Save feedback and recovery preservation, Apply, busy/modal guards, pending text and Escape, responsive resize ranges, preferred-height restoration, and focus when notes become unavailable.
- Existing drawing and grid-snapping integration tests also passed after the grid correction.
- TypeScript, production Vite and CLI builds, formatting, and whitespace checks passed.

## Real desktop results

The final preview completed every targeted scenario in an actual Electron window. The source input SHA-256 was `99ed99835f16fbd94cdab8dedf264b15488a1a60c8316fe66936edb96f0362d1`; packaged `app.asar` was `a104dc6de26f1455a1ced67a238bf604e959e84145ef01d3f1e4bc6c96d08449`. Packaging verified unchanged inputs and matched 321 embedded files.

| Check                     | Observed result                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pending canvas text       | New preview shows “Unsaved changes” immediately; Escape restores “Saved to file.” The archive stays unchanged until Save, which includes the pending source. The baseline kept showing “Saved to file” during typing.                                     |
| Local equation draft      | The new badge opens the source editor. Direct Save reports that the draft remains local, preserves the previous applied equation in the file, and retains the draft for review. Apply followed by Save includes the draft source in the archive.          |
| Notes at 620×550          | End now caps the body at 113px, with all 99px of its textarea visible. Previously 150px of the expanded textarea was off-screen.                                                                                                                          |
| Notes at 800×600          | End now caps the body at 165px, with all 151px of its textarea visible. Previously 118px was off-screen.                                                                                                                                                  |
| Custom-size Fit           | Both 960×720 and 720×960 slides are fully visible at native window sizes 620×550, 800×600, and 1440×900. The baseline clipped each custom-size slide vertically.                                                                                          |
| Visible grid              | Both axes match 20 document units at Fit and 120% for both custom sizes; measured rounding error is below 0.001px. The baseline grid does not match.                                                                                                      |
| Pointer behavior          | A 60px drag moves the painted object 59.9987px on 4:3 and 60.0001px on portrait. Baseline 4:3 dragging already aligned; no pointer-scale defect is claimed.                                                                                               |
| Native round trip and PDF | Canvas editing of Korean, English, and inline math → Ctrl+S → Ctrl+O preserves editable source and resets Undo. GUI export creates a one-page PDF; text extraction and visual inspection of its rendered page passed. Renderer page/console errors: zero. |

The first combined driver finished the preview but failed a baseline portrait Undo wait after attempting a target that was clipped and had unstable geometry. That failed record is retained. A separate baseline geometry retry waited for layout stability, completed the measurements, and marked the still-clipped portrait drag unavailable without attempting it. The successful preview checks and native file flow are separate from that driver setup failure.

Evidence:

- [Final-preview desktop measurements and screenshots](../../output/ux-validation/2026-11-15/pass-2/gui-final/preview-2/report.json)
- [Completed baseline geometry retry](../../output/ux-validation/2026-11-15/pass-2/baseline-geometry-retry/report.json)
- [Native editing, save, reopen, and PDF report](../../output/ux-validation/2026-11-15/pass-2/native-final/report.json)
- [Rendered PDF page](../../output/ux-validation/2026-11-15/pass-2/native-final/final-preview/pdf-page-1.png)
- [Small-window notes](../../output/ux-validation/2026-11-15/pass-2/gui-final/preview-2/05-notes-620x550-End.png) and [portrait Fit](../../output/ux-validation/2026-11-15/pass-2/gui-final/preview-2/06-portrait-1440x900.png)
- [Unpublished preview provenance](../../output/ux-validation/2026-11-15/pass-2/preview-app-final/provenance.json)
- [Original combined driver record, including its baseline setup failure](../../output/ux-validation/2026-11-15/pass-2/gui-final/report.json)

## Test boundaries

Desktop verification uses the user-authorized Xvfb and Playwright setup with real Electron windows, separate profiles, and copied fixtures. Only native file-dialog return paths are controlled; the editor, rendering, IPC, archive validation, and file IO run their actual implementations. This does not validate manual OS file-picker operation, OS IME composition, system clipboard interoperability, or Windows/macOS desktop behavior.

The task copies temporarily reference an existing root-owned sandbox helper only after matching its SHA-256. Chromium sandboxing stays enabled, and each helper is restored after its app closes. The preview stays separate from official release assets and existing user profiles.
