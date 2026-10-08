# Export and presenting

SciSlide 0.6.2 exports **all slides as PDF** or **the current slide as SVG**. Save a `.scislide` file as well if you need to continue editing: PDF and SVG exports do not preserve the native editable deck.

## Export formats

Open **Export** in the toolbar, then choose **PDF presentation** or the current-slide SVG option. Electron uses a native save dialog; the browser starts a download. A desktop save completes only after the native file write succeeds.

| Output                        | Contents and behavior                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| PDF                           | One page per slide at the deck's dimensions; vector equations and supported SVG figures; embedded raster images; selectable supported body text. |
| SVG                           | The current slide, with vector equations, supported SVG figures, embedded raster figures and bundled body-font data.                             |
| `.scislide`                   | Editable source, embedded assets and successful Local LaTeX vector results. Use **Save / Save As**, rather than Export.                          |
| PPTX, standalone HTML, Beamer | No deck exporter is implemented in 0.6.2.                                                                                                        |

The built web app in `dist/` is the editor application; it is not a standalone HTML export of your presentation.

## What static exports preserve

- The final click-build state: all ordinarily visible objects appear together. One-page-per-build export is not implemented.
- Deck-wide page numbers, figure crops, insets, shapes and object transforms.
- MathJax equations and valid saved Local LaTeX outlines as vectors, including inline formulas within text.
- Modern Korean text through bundled Nanum Gothic. Latin-only body text uses Inter. PDF embeds used font subsets; SVG includes required font data.

Video objects become **labeled static placeholders** in PDF/SVG. Exports do not contain playable videos, animations, speaker notes or presenter controls. Imported PDF pages are rendered to high-resolution PNG figures, so their original PDF vector content is not retained.

The exporter validates resources before producing the output. Missing assets, stale Local LaTeX results, unsupported text glyphs and SVG features such as filters, masks or `textPath` can stop PDF export with an object/slide-specific error. Outline imported figure text or simplify the figure when needed. See [Troubleshooting](Troubleshooting) and [Equations and fonts](Equations-and-Fonts).

## Audience slideshow

Choose **Present** to show the current slide. Windows/Linux also offer **F5** from the first slide and **Shift+F5** from the current slide. macOS uses **Command+Option+P** for the current slide. See [Keyboard shortcuts](Keyboard-Shortcuts) for the full platform-specific reference.

Advance with the navigation controls, right arrow or Space. SciSlide reveals the next populated click step before changing slides. Unused step numbers do not add clicks. Backward navigation returns through earlier build states; returning to the previous slide shows its final state. **Escape** exits.

An object's **APPEARANCE STEPS** setting supports:

- **Step 0:** visible when the slide opens.
- **Steps 1–100:** reveal on that numbered click step; objects sharing a step appear together.
- **Appear** or **Fade in:** immediate reveal or a fade lasting 100–3000 ms.

Editor and thumbnail views always show the complete layout. A timeline, exit effects, motion paths, scale effects and timing chains remain planned.

## Presenter display

Choose **Presenter display** to start the audience slideshow and open a separate presenter window. Move that window to your presenter screen manually. It shows the current build, next slide, speaker notes, navigation and an elapsed/remaining-time display. Set **Target minutes** and use **Pause / Resume / Reset timer** as needed.

Allow the presenter popup if the browser blocks it. Closing the presenter window leaves the audience slideshow running; ending the presentation closes the presenter window. Automatic monitor placement is not implemented, and fullscreen behavior depends on the environment. Video previews in the presenter window stay static; playback occurs in the audience slideshow.

## Video playback

Use **Video** to embed a local MP4 or WebM, then configure **Play when revealed**, **Loop video**, **Mute audio** and **Show playback controls** in the Inspector. Playback is confined to presentation mode; leaving the slide or ending the presentation stops it. Media controls retain their own keyboard behavior.

Autoplay and codec support depend on the browser/Electron runtime. The app does not transcode media or import streaming URLs. A video may be up to **40 MiB**; the saved archive may be up to **64 MiB**, with at most **100 MiB** of expanded resources. Save explicitly and check recovery feedback for large media decks.
