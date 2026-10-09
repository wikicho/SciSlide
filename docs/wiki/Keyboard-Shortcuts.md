# Keyboard shortcuts

SciSlide **0.6.2** follows Keynote conventions on macOS, PowerPoint on Windows and LibreOffice Impress on Ubuntu/Linux for supported actions. **⌘** means Command and **Option** means Alt on macOS.

Open **Keyboard shortcuts** in the app for the full reference and compatibility aliases. Its platform tabs change the displayed reference, not the active bindings. Native menus and toolbar hints follow the detected host OS. In browsers, use the toolbar if a browser-reserved shortcut takes precedence.

For the Keynote reference mapping, compatibility exceptions, focus-routing requirements, and remaining additions, see the [Shortcut specification](Shortcut-Specification). This page lists the retained 0.6.2 bindings and labels later source additions **unreleased**. Published 0.6.2 installers have not been rebuilt with these additions.

## Files and common editing

| Action                                         | macOS                                 | Windows               | Ubuntu/Linux                          |
| ---------------------------------------------- | ------------------------------------- | --------------------- | ------------------------------------- |
| New presentation                               | ⌘+N                                   | Ctrl+N                | Ctrl+N                                |
| Open                                           | ⌘+O                                   | Ctrl+O                | Ctrl+O                                |
| Save                                           | ⌘+S                                   | Ctrl+S                | Ctrl+S                                |
| Save As                                        | ⌘+Option+Shift+S                      | Ctrl+Shift+S          | Ctrl+Shift+S                          |
| Undo / Redo                                    | ⌘+Z / ⌘+Shift+Z                       | Ctrl+Z / Ctrl+Y       | Ctrl+Z / Ctrl+Y                       |
| Copy / Cut / Paste                             | ⌘+C / X / V                           | Ctrl+C / X / V        | Ctrl+C / X / V                        |
| Select all objects                             | ⌘+A                                   | Ctrl+A                | Ctrl+A                                |
| Duplicate selection, or slide if none selected | ⌘+D                                   | Ctrl+D                | Shift+F3                              |
| Duplicate current slide                        | Use duplicate with no object selected | Ctrl+Shift+D          | Use duplicate with no object selected |
| New-slide layout chooser                       | ⌘+Shift+N                             | Ctrl+M                | Ctrl+M                                |
| Insert equation                                | ⌘+Option+E                            | Alt+=                 | Alt+Shift+E                           |
| Insert image/SVG/PDF                           | ⌘+Shift+V                             | Figure toolbar        | Figure toolbar                        |
| Group / Ungroup                                | ⌘+Option+G / ⌘+Option+Shift+G         | Ctrl+G / Ctrl+Shift+G | Ctrl+Shift+G / Ctrl+Alt+Shift+G       |
| Shortcut help                                  | ⌘+Shift+/                             | F1                    | F1                                    |
| Toggle/focus Inspector (unreleased)            | ⌘+Option+I                            | Ctrl+Alt+I            | Ctrl+Alt+I                            |
| Toggle/focus Objects & Layers (unreleased)     | ⌘+Shift+L                             | Ctrl+Shift+L          | Ctrl+Shift+L                          |

Linux **Shift+F3** duplicates immediately; it does not open Impress's duplication-options dialog.

## Layout and text objects

| Action                                | macOS                | Windows                   | Ubuntu/Linux                    |
| ------------------------------------- | -------------------- | ------------------------- | ------------------------------- |
| Bring forward / Send backward         | ⌘+Option+Shift+F / B | Ctrl+Shift+] / [          | Ctrl+Num + / Ctrl+-             |
| Bring to front / Send to back         | ⌘+Shift+F / B        | Objects & Layers controls | Ctrl+Shift+Num + / Ctrl+Shift+- |
| Lock / Unlock                         | ⌘+L / ⌘+Option+L     | Objects & Layers controls | Objects & Layers controls       |
| Zoom in / out                         | ⌘+Shift+> / <        | Ctrl++ / Ctrl+-           | + / -                           |
| Fit slide                             | ⌘+Option+0           | Ctrl+Alt+O                | Numeric keypad *                |
| Bold selected text objects            | ⌘+B                  | Ctrl+B                    | Ctrl+B                          |
| Increase / decrease text size         | ⌘ and + / ⌘ and -    | Ctrl+Shift+> / <          | Ctrl+] / [                      |
| Text alignment: left / center / right | ⌘+{ / ⌘+\| / ⌘+}     | Ctrl+L / E / R            | Ctrl+L / E / R                  |

On Linux, canonical **Ctrl+Num +** moves one layer forward and **Ctrl+Shift+Num +** moves to front. **Num +** means numeric-keypad Add, as identified by shortcut help and native menus. Main-keyboard **Ctrl+= / Ctrl+Shift+=** also performs those two actions. Bare **+ / -** zoom only outside text fields.

- **Shift+click**: multi-select; macOS also supports **Command+click**.
- **Arrow keys / Shift+Arrow** on the canvas: move selected objects by **1 / 10 logical document units**.
- **Delete / Backspace** on the canvas: remove selected unlocked objects.
- Hold **Option/Alt** while moving/resizing: bypass smart guides.
- **Enter** on selected text: begin editing. While editing, **Enter** inserts a line, **⌘/Ctrl+Enter** applies and **Escape** cancels.

**Unreleased:** focus the slide canvas and use **Tab / Shift+Tab** to select eligible objects in back-to-front stacking order. A flat group is one unit; hidden and locked content is skipped. At either boundary, Tab moves through normal UI focus order instead of wrapping. A polite canvas status announces selected object names/counts.

Inspector and Objects & Layers can be shown independently using their toolbar buttons or the new shortcuts above. A shown pane receives focus; hiding it returns focus to the canvas. These commands respect text fields, dialogs and playback. Double-clicking an equation reveals Inspector and focuses its source.

**Unreleased desktop menus:** enabled states follow current focus, selection, clipboard/history availability, dialogs and busy operations. Focused text retains native clipboard/history commands, including modal text controls. Disabled application commands do not dispatch.

Text-formatting shortcuts act on whole selected text objects. Text-field cursor, clipboard, selection, undo and IME behavior retain their normal editing roles.

## Slide navigation and ordering

**Page Down / Page Up** navigates slides; **Home / End** selects first/last. Compact Mac keyboards send these using **Fn+↓ / ↑** and **Fn+← / →**.

When a thumbnail has focus, **Up / Down** selects slides and **Delete / Backspace** removes the focused slide. **Unreleased:** duplication targets the focused thumbnail even with a canvas object selection, then selects and focuses the copy. Navigation and deletion ignore held-key repetition. Published 0.6.2 still duplicates the active slide if Tab has focused an inactive thumbnail, so click or navigate to select it in that release. The following reorder commands also require thumbnail focus:

| Action                  | macOS (unreleased)       | Windows              | Ubuntu/Linux                  |
| ----------------------- | ------------------------ | -------------------- | ----------------------------- |
| Move slide up / down    | ⌘+Option+Up / Down       | Ctrl+Up / Down       | Alt+Shift+Page Up / Page Down |
| Move slide first / last | ⌘+Option+Shift+Up / Down | Ctrl+Shift+Up / Down | Alt+Shift+Home / End          |

All platforms also support dragging thumbnails and the move buttons; see [[Editing-Slides]]. The new macOS reorder keys have no native menu accelerators, so text fields retain their caret commands.

## Presentation and export

| Action                      | macOS                            | Windows    | Ubuntu/Linux              |
| --------------------------- | -------------------------------- | ---------- | ------------------------- |
| Present from current slide  | ⌘+Option+P                       | Shift+F5   | Shift+F5                  |
| Present from first slide    | Select first slide, then Present | F5         | F5                        |
| Open presenter display      | Presenter display toolbar        | Alt+F5     | Presenter display toolbar |
| Export all slides as PDF    | ⌘+Option+Shift+P                 | Ctrl+Alt+P | Ctrl+Alt+P                |
| Export current slide as SVG | ⌘+Option+S                       | Ctrl+Alt+S | Ctrl+Alt+S                |

During a slideshow, **Right / Down / Space / Page Down** advances a build or slide; **Left / Up / Page Up** goes back; **Home / End** selects first/last; **Escape** exits. Windows/Linux also accept **Enter** to advance and **Backspace** to go back. Windows adds **N / P**; Linux adds **-** to exit; macOS adds **Q** to exit outside text fields/media controls. **Unreleased:** audience and presenter share the same focus rules. Editable/media controls retain all keys, including Escape; focused buttons retain Space/Enter. Plain Escape exits with presentation focus. Navigation, Home/End, and exit ignore auto-repeat. Shift+arrow preserves ordinary build navigation, while other shifted playback keys are ignored.

Compatibility aliases include **⌘+Shift+S**, **⌘+G / ⌘+Shift+G** and canvas **⌘+Enter** on macOS; **Ctrl+Shift+Z**, **Ctrl+Enter** and **Ctrl+Shift+/** on Windows/Linux. Linux also retains **Ctrl+D**, **Ctrl+G**, **Ctrl+Alt+=** equation insertion and **Ctrl+Shift+Up / Down / Home / End** thumbnail reordering. Linux **Ctrl+Shift+G** now groups.

See [[Export-and-Presenting]] for build steps, presenter display and static export behavior; [[Troubleshooting]] covers unavailable shortcuts.

[Wiki home](Home)
