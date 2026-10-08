# Keyboard shortcuts

SciSlide **0.6.2** follows Keynote conventions on macOS, PowerPoint on Windows and LibreOffice Impress on Ubuntu/Linux for supported actions. **⌘** means Command and **Option** means Alt on macOS.

Open **Keyboard shortcuts** in the app for the full reference and compatibility aliases. Its platform tabs change the displayed reference, not the active bindings. Native menus and toolbar hints follow the detected host OS. In browsers, use the toolbar if a browser-reserved shortcut takes precedence.

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

Linux **Shift+F3** duplicates immediately; it does not open Impress's duplication-options dialog.

## Layout and text objects

| Action                                | macOS                | Windows                   | Ubuntu/Linux                |
| ------------------------------------- | -------------------- | ------------------------- | --------------------------- |
| Bring forward / Send backward         | ⌘+Option+Shift+F / B | Ctrl+Shift+] / [          | Ctrl++ / Ctrl+-             |
| Bring to front / Send to back         | ⌘+Shift+F / B        | Objects & Layers controls | Ctrl+Shift++ / Ctrl+Shift+- |
| Lock / Unlock                         | ⌘+L / ⌘+Option+L     | Objects & Layers controls | Objects & Layers controls   |
| Zoom in / out                         | ⌘+Shift+> / <        | Ctrl++ / Ctrl+-           | + / -                       |
| Fit slide                             | ⌘+Option+0           | Ctrl+Alt+O                | Numeric keypad *            |
| Bold selected text objects            | ⌘+B                  | Ctrl+B                    | Ctrl+B                      |
| Increase / decrease text size         | ⌘ and + / ⌘ and -    | Ctrl+Shift+> / <          | Ctrl+] / [                  |
| Text alignment: left / center / right | ⌘+{ / ⌘+\| / ⌘+}     | Ctrl+L / E / R            | Ctrl+L / E / R              |

On Linux, use numeric-keypad **+** to distinguish **Ctrl++** (one layer forward) from **Ctrl+Shift++** (front). Main-keyboard **Ctrl+= / Ctrl+Shift+=** also performs those two actions. Bare **+ / -** zoom only outside text fields.

- **Shift+click**: multi-select; macOS also supports **Command+click**.
- **Arrow keys / Shift+Arrow** on the canvas: move selected objects by **1 px / 10 px**.
- **Delete / Backspace** on the canvas: remove selected unlocked objects.
- Hold **Option/Alt** while moving/resizing: bypass smart guides.
- **Enter** on selected text: begin editing. While editing, **Enter** inserts a line, **⌘/Ctrl+Enter** applies and **Escape** cancels.

Text-formatting shortcuts act on whole selected text objects. Text-field cursor, clipboard, selection, undo and IME behavior retain their normal editing roles.

## Slide navigation and ordering

**Page Down / Page Up** navigates slides; **Home / End** selects first/last. Compact Mac keyboards send these using **Fn+↓ / ↑** and **Fn+← / →**.

When a thumbnail has focus, **Up / Down** selects slides and **Delete / Backspace** removes the focused slide. The following reorder commands also require thumbnail focus:

| Action                  | Windows              | Ubuntu/Linux                  |
| ----------------------- | -------------------- | ----------------------------- |
| Move slide up / down    | Ctrl+Up / Down       | Alt+Shift+Page Up / Page Down |
| Move slide first / last | Ctrl+Shift+Up / Down | Alt+Shift+Home / End          |

All platforms also support dragging thumbnails and the move buttons; see [[Editing-Slides]].

## Presentation and export

| Action                      | macOS                            | Windows    | Ubuntu/Linux              |
| --------------------------- | -------------------------------- | ---------- | ------------------------- |
| Present from current slide  | ⌘+Option+P                       | Shift+F5   | Shift+F5                  |
| Present from first slide    | Select first slide, then Present | F5         | F5                        |
| Open presenter display      | Presenter display toolbar        | Alt+F5     | Presenter display toolbar |
| Export all slides as PDF    | ⌘+Option+Shift+P                 | Ctrl+Alt+P | Ctrl+Alt+P                |
| Export current slide as SVG | ⌘+Option+S                       | Ctrl+Alt+S | Ctrl+Alt+S                |

During a slideshow, **Right / Down / Space / Page Down** advances a build or slide; **Left / Up / Page Up** goes back; **Home / End** selects first/last; **Escape** exits. Windows/Linux also accept **Enter** to advance and **Backspace** to go back. Windows adds **N / P**; Linux adds **-** to exit; macOS adds **Q** to exit outside text fields/media controls. Media controls keep their own keyboard behavior.

Compatibility aliases include **⌘+Shift+S**, **⌘+G / ⌘+Shift+G** and canvas **⌘+Enter** on macOS; **Ctrl+Shift+Z**, **Ctrl+Enter** and **Ctrl+Shift+/** on Windows/Linux. Linux also retains **Ctrl+D**, **Ctrl+G**, **Ctrl+Alt+=** equation insertion and **Ctrl+Shift+Up / Down / Home / End** thumbnail reordering. Linux **Ctrl+Shift+G** now groups.

See [[Export-and-Presenting]] for build steps, presenter display and static export behavior; [[Troubleshooting]] covers unavailable shortcuts.

[Wiki home](Home)
