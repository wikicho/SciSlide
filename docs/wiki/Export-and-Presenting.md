# Export and presenting

SciSlide exports **all slides as PowerPoint (.pptx) or PDF**, or **the current slide as SVG**. Save a `.scislide` file as well to preserve LaTeX sources, assets and all native editing settings.

## Import PowerPoint

Choose **Open presentation** or **File → Open** and select a `.pptx` file. You can also drop one PowerPoint file onto the slide canvas. SciSlide imports locally and preserves slide size, order, speaker notes, editable text and basic shapes, and embedded PNG, JPEG, and SVG images. Save the imported presentation as a `.scislide` file to keep editing it.

When elements are skipped or simplified, **PowerPoint import details** lists them by slide number. SciSlide converts supported Office Math formulas to editable inline LaTeX. It uses a supported embedded fallback image when a formula cannot be converted. Charts, tables, animations, and custom shapes may be omitted. Fonts and layout can differ, especially where the source mixes text formatting or uses complex themes.

## Export formats

Open **Export** in the toolbar, then choose **PowerPoint (.pptx)**, **PDF presentation** or the current-slide SVG option. The desktop **File** menu offers the same formats. Electron uses a native save dialog; the browser starts a download. A desktop save completes only after the native file write succeeds.

| Output                  | Contents and behavior                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| PowerPoint (`.pptx`)    | All slides with editable text and shapes, embedded equation/figure graphics, speaker notes and page numbers.                                     |
| PDF                     | One page per slide at the deck's dimensions; vector equations and supported SVG figures; embedded raster images; selectable supported body text. |
| SVG                     | The current slide, with vector equations, supported SVG figures, embedded raster figures and bundled body-font data.                             |
| `.scislide`             | Editable source, embedded assets and successful Local LaTeX vector results. Use **Save / Save As**, rather than Export.                          |
| Standalone HTML, Beamer | No deck exporter is implemented.                                                                                                                 |

The built web app in `dist/` is the editor application; it is not a standalone HTML export of your presentation.

## PowerPoint editing and compatibility

PowerPoint export preserves slide order, deck dimensions, object position/rotation and the final click-build state. Text and shapes remain editable in PowerPoint. Inline mathematics is split into editable prose and separate equation graphics. Standalone equations and scientific figures are also exported as graphics; equation graphics are not editable Office equations. Speaker notes are included.

PPTX references editable body-text fonts without embedding them. Install those fonts on the computer opening the presentation to avoid substitution and text-layout changes. Validated fonts already embedded inside an imported SVG figure remain inside that figure's SVG graphic. Native PowerPoint text uses regular or bold weights: SciSlide weights 400/500 export as regular and 600/700 as bold. Equation and figure graphics include a raster fallback for viewers without SVG support. Videos become labeled static placeholders, and click builds do not become PowerPoint animations. Keep the native `.scislide` source to preserve SciSlide-specific editing settings across saves.

## What PDF and SVG preserve

- The final click-build state: all ordinarily visible objects appear together. One-page-per-build export is not implemented.
- Deck-wide page numbers, figure crops, insets, shapes and object transforms.
- MathJax equations and valid saved Local LaTeX outlines as vectors, including inline formulas within text.
- Bundled Inter and Nanum Gothic body text, including supported modern Korean. Text can follow the deck's default family or use an explicit object family. PDF embeds used font subsets; SVG includes required font data.

Video objects become **labeled static placeholders** in PDF/SVG. Exports do not contain playable videos, animations, speaker notes or presenter controls. Imported PDF pages are rendered to high-resolution PNG figures, so their original PDF vector content is not retained.

The exporter validates resources before producing the output. Missing assets, stale Local LaTeX results, unsupported text glyphs and SVG features such as filters, masks or `textPath` can stop PDF export with an object/slide-specific error. Outline imported figure text or simplify the figure when needed. See [Troubleshooting](Troubleshooting) and [Equations and fonts](Equations-and-Fonts).

## Imported SVG fonts

Import and export use the same SVG stylesheet validation: ordinary supported plot styles are flattened, and only bounded, embedded binary font rules are retained. Font families are isolated per figure so that one imported font cannot replace another figure's or the slide's font.

| Font or text in an imported SVG                               | SVG output and PPTX figure graphic                             | PDF output                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| Validated embedded normal TTF at a supported requested weight | Retained inside the SVG graphic. Viewer support still applies. | Embedded with glyph coverage checked.                      |
| Embedded OTF, WOFF or WOFF2 used by visible text              | Retained.                                                      | Unsupported; export stops with a font diagnostic.          |
| Italic/oblique text, unavailable weights or missing glyphs    | Retained where supported by the SVG viewer.                    | Unsupported; export stops rather than substituting a font. |
| Remote font or unsupported stylesheet                         | Rejected during import.                                        | Unavailable.                                               |

After SVG import, paste, drop or replacement, the editor reports known PDF limitations early and shows an **Export compatibility** note when the figure is selected. The check follows visible text and used fonts/effects; an unused embedded font does not create a warning. It does not perform font conversion or prove complete glyph coverage, which the final PDF preflight still checks.

An SVG accepted for viewing and saving is therefore not guaranteed to support every output format. Outline unsupported figure text before importing, or choose SVG/PPTX output. The native `.scislide` source and its embedded font data remain intact if export fails. Full equivalence between every accepted SVG font format and PDF output remains unfinished.

## Audience slideshow

Choose **Present** to show the current slide. Windows/Linux also offer **F5** from the first slide and **Shift+F5** from the current slide. macOS uses **Command+Option+P** for the current slide. See [Keyboard shortcuts](Keyboard-Shortcuts) for the full platform-specific reference.

Advance with the navigation controls, right arrow or Space. SciSlide reveals the next populated click step before changing slides. Unused step numbers do not add clicks. Backward navigation returns through earlier build states; returning to the previous slide shows its final state. **Escape** exits.

An object's **APPEARANCE STEPS** setting supports:

- **Step 0:** visible when the slide opens.
- **Steps 1–100:** reveal on that numbered click step; objects sharing a step appear together.
- **Appear** or **Fade in:** immediate reveal or a fade lasting 100–3000 ms.

Editor and thumbnail views always show the complete layout. A timeline, exit effects, motion paths, scale effects and timing chains remain planned.

## Presenter display

Set your displays to **Extend**, open SciSlide on the presenter’s monitor and choose **Present**. The desktop app opens the slides fullscreen on the other display. The presenter sees the current build, next slide, speaker notes, navigation and elapsed/remaining time. Set **Target minutes** and use **Pause / Resume / Reset timer** as needed.

In a supported browser, allow window management and pop-ups. Double-click the audience slide to enter fullscreen. With a single display, **Present** plays the slideshow in the editor window. **Presenter display** can also open a separate notes window for manual placement. Videos play on the audience display. **End presentation** closes the separate window.

## Video playback

Use **Video** to embed a local MP4 or WebM, then configure **Play when revealed**, **Loop video**, **Mute audio** and **Show playback controls** in the Inspector. Playback is confined to presentation mode; leaving the slide or ending the presentation stops it. Media controls retain their own keyboard behavior.

Autoplay and codec support depend on the browser/Electron runtime. The app does not transcode media or import streaming URLs. A video may be up to **40 MiB**; the saved archive may be up to **64 MiB**, with at most **100 MiB** of expanded resources. Save explicitly and check recovery feedback for large media decks.
