# Editing slides

These instructions describe the **0.7.2 development source**; use a newly built package for the changes below. Start with [[Getting-Started]] or see [[Keyboard-Shortcuts]] for platform-specific commands.

## Slides and layouts

**New slide** or **+** opens the current theme's layout picker and inserts your choice after the current slide. **Blank slide** is also available. Keynote White has fifteen layouts; the other four themes share fourteen Scientific/Keynote-inspired layouts with category filters.

Drag a thumbnail above or below another to reorder slides. The teal insertion line shows the destination; dragging near the list's edges scrolls it. Press **Escape** or release outside the list to cancel. **Move slide up/down** buttons offer another route. Reordering is undoable and updates page numbers and export order.

Use slide settings for titles, backgrounds and speaker notes. Layouts contain editable objects rather than linked masters. Photo/video areas are placeholders for your own media.

In **Keynote White**, select a single Photo placeholder frame, icon or label before choosing **Figure** to fill its frame. The imported figure keeps the frame's position and size with a reversible centered crop. Select one Video placeholder before **Video** to fill it. Other imports use ordinary free placement.

## Text and selection

Double-click text or select it and press **Enter** to edit on the canvas. **Enter** creates a new line; **⌘/Ctrl+Enter** or clicking outside applies one undoable edit; **Escape** cancels. The Inspector also offers text and formatting controls. Inline LaTeX syntax is described in [[Equations-and-Fonts]].

Press **Ctrl+Shift+M** (**⌘+Shift+M** on macOS) in a text field to open the inline equation popup. Enter LaTeX such as `U(1)`, check its live preview and apply to insert `$U(1)$` at the caret. Place the caret inside an existing equation and use the shortcut to edit it, or double-click its rendered formula. Cancel returns to the previous text and selection. Typing dollar delimiters does not open the popup. Use `\$` for a literal dollar sign. A selected text box can also open the popup directly with the shortcut.

Text frames grow vertically to fit their content, using loaded-font metrics; moving/resizing preserves rotated text placement. Inspector text size and frame width/height fields apply on Enter or blur, and Escape cancels a pending value. The Inspector provides left/center/right text alignment; equal-gap distribution remains in the toolbar.

Click an object to select it; **Shift+click** selects several. macOS also supports **Command+click**. Drag to move, use the lower-right handle to resize, or enter geometry in the Inspector. Canvas arrow keys move selected objects by **1 logical document unit**; **Shift+Arrow** moves them by **10**.

With several objects selected, Format shows their count, groups and lock/visibility states. **Arrange selection** opens the existing group, distribution and layer tools. **Edit one object** opens one member's style without ungrouping it; position changes still move its group. Single-object style and geometry fields appear when one object is selected. Equal-gap distribution needs at least three unlocked objects or groups.

On an empty slide, Format offers **Add text**, **Add equation** and **Add figure**. The canvas hint changes with selection, text editing, drawing and locked objects, including the relevant keyboard action.

With the canvas focused, Tab/Shift+Tab selects eligible objects in back-to-front stacking order, treating a flat group as one unit and skipping hidden/locked content. At either end, Tab follows normal UI focus order into surrounding controls. A polite canvas status announces selected object names/counts.

Toolbar menus support Enter/Space or Up/Down to open, Up/Down and Home/End to navigate, and Escape to return to the menu trigger. Left/Right moves between menus. Choosing an action or moving focus outside closes the menu; an action that opens an editor or dialog keeps focus there.

**Export** also supports Up/Down and Home/End navigation. Moving focus outside, clicking outside or opening another menu closes it. Escape closes it and returns to Export without clearing the canvas selection.

The title area distinguishes the saved `.scislide` file, pending/completed local recovery and the number of unapplied equation drafts. Pending inline text edits immediately mark the file as unsaved; Save applies the edit before writing the file. Select **Review equation drafts** to open a retained draft; hidden or locked targets lead to Layers with guidance. Drafts remain local until **Apply equation** puts them on the slide. Saving applied content reports any drafts that remain local and absent from the portable file. During a document transition, **Save changes** is unavailable while drafts remain; cancel to apply them or choose **Keep recovery and continue** to preserve them locally.

**Copy / Cut / Paste** uses the system clipboard for editable objects, groups and slides, including embedded media and source formatting. Focus a slide thumbnail to copy that slide or paste after it. Text fields, including dialogs, keep ordinary text editing. On the canvas, pasting external text creates a text object; a screenshot or supported image creates a figure. Copying new content in another app replaces the previous SciSlide copy. Locked objects can be copied but are protected from cutting, and a failed clipboard write keeps cut originals.

Browser clipboard permissions and supported formats vary. If a toolbar action reports unavailable access, focus the canvas and use the keyboard Copy/Cut/Paste commands. A failed system clipboard read never pastes an older internal copy.

## Canvas and speaker notes

**Fit** sizes the canvas to the document's actual aspect ratio, including 4:3 and portrait documents. Other zoom percentages are relative to that fitted size. The visible grid follows the same 20-unit document spacing as snapping at every zoom.

Open **Speaker notes** below the canvas. Drag its divider, or focus the divider and use Up/Down and Home/End to resize it. Notes shrink to keep canvas controls reachable in a small window, while the preferred height returns when the window grows. Collapsing or resizing notes preserves their text and does not add an Undo step.

## Arrange, layers and groups

Use **OBJECTS & LAYERS** to select covered or hidden objects, rename them, change visibility/locks or change their stacking order.

Inspector and Objects & Layers have independent visibility. Their toolbar buttons and [shortcuts](Keyboard-Shortcuts) focus the pane when shown and return to the canvas when hidden. Text fields, dialogs and playback retain input ownership. Double-clicking an equation reveals Inspector before focusing its source.

**Distribute horizontally / vertically** in the toolbar and **Equal horizontal / vertical gaps** in **ARRANGE** equalize edge gaps between at least three unlocked objects/groups, keeping the first and last in place. The Inspector's **Alignment** icons align text within its box.

Format shows a member's effective group lock and explains when another member caused it. **Lock group / Unlock group** changes the whole group; independent objects keep their own **Lock object / Unlock object** action. Layers still provides individual member locks.

**Group objects** keeps a selection together for moving and duplication. **Ungroup objects** preserves member positions. Groups are flat and saved with the deck. Ungroup before resizing, rotating or editing an individual member's endpoints; nested groups and whole-group scaling/rotation are not supported.

Smart guides indicate matching edges, centers and equal gaps while moving. Resize guides help independent, unrotated objects match widths/heights. Figures/videos preserve aspect ratio; hold **Shift** to preserve it for text and ordinary shapes. Equation resizing changes font size.

Toggle smart guides in the toolbar or hold **Option/Alt** to bypass them for a gesture. Separate **Snap to 20 px grid** takes precedence over smart guides. Guides are editing aids and are absent from presentation/export.

## Figures, cropping and insets

**Figure** imports a local **PNG, JPEG, SVG or PDF**, up to **20 MiB**. SVG is sanitized; active content and external resources are unsupported. For PDF, preview the document and select one page. It is embedded as a high-resolution **PNG**, so the original PDF is not required after saving. Original PDF vectors are not preserved.

Drop local PNG/JPEG/SVG files onto the canvas to place them at the pointer location at any zoom. Multiple images keep the supplied file order and form one Undo step. Drop a single PDF to open the page/region chooser, or a single `.scislide` file to open a document through the save-confirmation flow. Unsupported or mixed document/PDF batches leave the presentation unchanged. Web image URLs are not imported by dropping them.

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

Opening a file (including an OS file-open request or document drop), creating a new deck and closing the desktop editor offer **Save changes / Keep recovery and continue / Discard changes / Cancel** when needed. Each accepted document starts a separate Undo/Redo history and saving destination. A cancelled or failed read/save keeps the current document. Apply unfinished equation drafts before choosing Save changes to leave a document; drafts are not part of a portable deck save. Keep recovery and continue explicitly stores the latest local copy, including drafts, before switching. If that write fails, the current presentation stays open. Discard does not save the portable file; local recovery copies can remain available until explicitly removed. The browser uses its own leave-page warning.

Automatic recovery chooses the newest valid timestamp across IndexedDB and localStorage, rather than preferring one storage backend. **Resume previous work** restores the current workspace and reuses its recovery-history session. A saved or opened file reference appears as **Recovered saved copy**; known later edits appear as **Unsaved changes**. Older backups without a known save reference appear as **Recovered local copy**. The displayed filename does not restore permission to overwrite its original path; saving a resumed copy can require a native file dialog. **File → Recovered documents**, also available on the startup screen, lists separate local copies of previously opened or created presentations. Autosaves update the copy for that work session; opening the same file from disk starts a separate session.

Open copy restores text, fonts, media, relationships and unfinished equation drafts into a fresh editing session with independent Undo/Redo. It starts without a file destination, so saving the copy cannot silently overwrite its original. A failed restore leaves the current presentation intact.

History retains up to **10 copies and 100 MiB combined**. If a history save fails, a persistent warning and **Review recovered documents** action remain visible until a later save succeeds. A successful current-workspace backup does not imply that a document-history copy was saved. Older copies are not automatically evicted; remove a copy explicitly to free space, or save a portable file. Remove asks for confirmation and leaves the open presentation and saved files available. A later edit may create a new recovery copy of an open presentation. A damaged copy is reported separately and does not block other valid copies. Browser quota can be smaller than the configured limit; the current-workspace backup and document-history storage are separate.

Automatic recovery uses local IndexedDB, with a **100 MiB** record limit and a smaller localStorage fallback. It can retain up to **200** unfinished equation drafts. Web and desktop recovery stores are separate. Unapplied drafts and the personal equation library are not included in saved `.scislide` files. Save explicitly, especially for media-heavy decks, and check failure feedback. See [[Troubleshooting]].

[Wiki home](Home)
