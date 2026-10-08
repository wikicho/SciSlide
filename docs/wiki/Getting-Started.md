# Getting started

SciSlide is a scientific presentation editor for editable mathematical notation, figures and vector PDF/SVG output. Version **0.6.2** is a working prototype, available as an Electron desktop app and a browser editor.

## 1. Install or launch

Download the package for your operating system from the [v0.6.2 release](https://github.com/wikicho/SciSlide/releases/tag/v0.6.2). See [[Installation]] for architecture selection, checksums and platform instructions. Node.js and TeX are **not required** to use a packaged app with MathJax.

To run the source checkout instead, see [[Development]]. The browser editor shares the editing interface, but installed-tool integration requires Electron.

## 2. Choose a starting point

The opening **Choose your theme** dialog offers:

| Choice                                           | Result                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Scientific, Minimal White, Minimal Black or Navy | A title slide, with fourteen available Scientific/Keynote-inspired starter layouts |
| Keynote White                                    | A title slide, with a separate gallery of fifteen coordinated layouts              |
| Open presentation                                | Open an existing `.scislide` file                                                  |
| Resume previous work                             | Restore the locally recovered workspace                                            |
| Explore demo                                     | Open the sample cosmology deck, which uses synthetic demonstration data            |

Choose a theme and **Create presentation**. **New presentation** reopens the chooser; **Cancel** returns to the current deck.

## 3. Make your first slide

1. Double-click a text box, or select it and press **Enter**, to type directly on the slide. **Enter** adds a line; **⌘/Ctrl+Enter** or clicking outside applies the edit. **Escape** cancels it.
2. Choose **New slide** or **+** in the slide list, then select a layout or **Blank slide**. The new slide is inserted after the current slide.
3. Use **Text**, **Equation**, **Figure** or **Video** to add content. Drag objects to position them and use the Inspector for precise settings.
4. For an equation, edit its LaTeX source, review the preview and choose **Apply equation**. An unapplied equation draft is separate from the slide's saved content.

For layout, figures, drawing and slide ordering, see [[Editing-Slides]]. For inline mathematics such as `The field $\chi$ has mass $m_\chi$.`, see [[Equations-and-Fonts]].

## 4. Save and share

Use **Save / Save As** to create a portable `.scislide` source file. Electron uses native file dialogs; the browser starts a download. Automatic recovery is local workspace storage and does not replace saving a file.

Current saves use **document format 0.5.0**, independently of the app version. Older formats 0.1.0–0.4.0 migrate when opened; the original file changes only when saved. Older SciSlide apps that only support format 0.4.0 or below cannot open new 0.5.0 files.

Use **Present** to run the slideshow or **Export** for all slides as PDF/current slide as SVG. See [[Export-and-Presenting]], [[Keyboard-Shortcuts]], [[AI-Assistance]] and [[Troubleshooting]] for the next steps.

[Wiki home](Home)
