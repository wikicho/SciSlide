# Editing slides

These instructions describe SciSlide **0.6.2**. Start with [[Getting-Started]] or see [[Keyboard-Shortcuts]] for platform-specific commands.

## Slides and layouts

**New slide** or **+** opens the current theme's layout picker and inserts your choice after the current slide. **Blank slide** is also available. Keynote White has fifteen layouts; the other four themes share fourteen Scientific/Keynote-inspired layouts with category filters.

Drag a thumbnail above or below another to reorder slides. The teal insertion line shows the destination; dragging near the list's edges scrolls it. Press **Escape** or release outside the list to cancel. **Move slide up/down** buttons offer another route. Reordering is undoable and updates page numbers and export order.

Use slide settings for titles, backgrounds and speaker notes. Layouts contain editable objects rather than linked masters. Photo/video areas are placeholders for your own media.

In **Keynote White**, select a single Photo placeholder frame, icon or label before choosing **Figure** to fill its frame. The imported figure keeps the frame's position and size with a reversible centered crop. Select one Video placeholder before **Video** to fill it. Other imports use ordinary free placement.

## Text and selection

Double-click text or select it and press **Enter** to edit on the canvas. **Enter** creates a new line; **⌘/Ctrl+Enter** or clicking outside applies one undoable edit; **Escape** cancels. The Inspector also offers text and formatting controls. Inline LaTeX syntax is described in [[Equations-and-Fonts]].

Click an object to select it; **Shift+click** selects several. macOS also supports **Command+click**. Drag to move, use the lower-right handle to resize, or enter geometry in the Inspector. Canvas arrow keys move selected objects by **1 px**; **Shift+Arrow** moves them by **10 px**.

**Copy / Cut / Paste** reuses objects across slides or decks in the same editor session. Copies have independent IDs and carry their figures/videos. The object clipboard is internal to SciSlide; text fields keep their ordinary clipboard behavior. Locked objects can be copied but are protected from cutting.

## Arrange, layers and groups

Use **OBJECTS & LAYERS** in the Inspector to select covered or hidden objects, rename them, change visibility/locks or change their stacking order.

The toolbar and **ARRANGE** controls align objects left/center/right/top/middle/bottom. A single object or group aligns to slide margins; several align within their combined bounds. **Distribute horizontally / vertically** equalizes edge gaps between at least three unlocked objects/groups, keeping the first and last in place.

**Group objects** keeps a selection together for moving and duplication. **Ungroup objects** preserves member positions. Groups are flat and saved with the deck. Ungroup before resizing, rotating or editing an individual member's endpoints; nested groups and whole-group scaling/rotation are not supported.

Smart guides indicate matching edges, centers and equal gaps while moving. Resize guides help independent, unrotated objects match widths/heights. Figures/videos preserve aspect ratio; hold **Shift** to preserve it for text and ordinary shapes. Equation resizing changes font size.

Toggle smart guides in the toolbar or hold **Option/Alt** to bypass them for a gesture. Separate **Snap to 20 px grid** takes precedence over smart guides. Guides are editing aids and are absent from presentation/export.

## Figures, cropping and insets

**Figure** imports a local **PNG, JPEG, SVG or PDF**, up to **20 MiB**. SVG is sanitized; active content and external resources are unsupported. For PDF, preview the document and select one page. It is embedded as a high-resolution **PNG**, so the original PDF is not required after saving. Original PDF vectors are not preserved.

Select an unlocked, independent figure and open **CROP & INSET**:

- Set **Left / Top / Width / Height** as percentages within the original image, review the preview and choose **Apply crop**. **Reset crop** restores the full image.
- Choose a region and **Create enlarged inset** to add an independent figure using the same source asset. Applying a crop first is unnecessary; the original figure is preserved.
- **Replace figure** changes the source while preserving the frame, rotation, normalized crop and description. PDF replacement opens the page chooser first.

SVG sources retain supported vector detail in PDF/SVG export. PNG/JPEG and imported PDF pages remain raster images.

## Draw shapes

Choose **Draw rectangle / ellipse / line / arrow**, then drag on the canvas. **Shift** constrains the geometry; **Escape** cancels. Select a line/arrow to drag its endpoints. The Inspector controls stroke color/width, solid/dashed/dotted lines, no-fill outlines and start/end/bidirectional arrowheads. Shapes export as vectors. Attached connectors and freehand paths are not implemented.

## Page numbers and builds

Click empty canvas space to open deck settings. Under **PAGE NUMBERS**, enable numbers and choose placement, format, starting number, size/color and whether to hide the first slide's number. Hiding it does not renumber later slides.

Select an object and use **APPEARANCE STEPS** for step **0** (visible immediately) or click steps **1–100**. Objects sharing a step appear together. Choose **Appear** or **Fade in** with a **100–3000 ms** duration. Presentation advances through populated steps before the next slide; the editor and static exports show the complete layout. See [[Export-and-Presenting]] for videos and presentation controls.

## Recovery and saving

Automatic recovery uses local IndexedDB, with a **100 MiB** record limit and a smaller localStorage fallback. It can retain up to **200** unfinished equation drafts. Web and desktop recovery stores are separate. Unapplied drafts and the personal equation library are not included in saved `.scislide` files. Save explicitly, especially for media-heavy decks, and check failure feedback. See [[Troubleshooting]].

[Wiki home](Home)
