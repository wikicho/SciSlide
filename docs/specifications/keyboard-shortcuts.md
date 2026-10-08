# Keyboard Shortcut Specification

| Field                      | Value                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Specification revision     | 0.1                                                                                                          |
| Application baseline       | SciSlide 0.6.2                                                                                               |
| Reviewed                   | 2026-10-08                                                                                                   |
| Primary platform reference | [Apple Keynote keyboard shortcuts for Mac](https://support.apple.com/en-gb/guide/keynote/tanfde4a3e6d/mac)   |
| Other platform profiles    | PowerPoint conventions on Windows; LibreOffice Impress conventions on Ubuntu/Linux                           |
| Scope                      | Command bindings, focus ownership, compatibility exceptions, implementation targets, and acceptance criteria |

## 1. Purpose and status

SciSlide should feel familiar to a researcher moving from Keynote while preserving native text input, scientific authoring commands, and predictable document editing. This specification defines that behavior for the shared browser/Electron editor. It supplements [section 5.3 of the project specification](../../SciSlide-Project-Specification.md#53-user-interface).

**This revision is documentation. It does not add shortcuts or change the 0.6.2 application.** “Baseline” describes audited source behavior. “Target” and “Planned” describe requirements for a later implementation; they are not release claims. The application version remains independent of native document format 0.5.0.

The Apple guide supplies the macOS reference, rather than a requirement to implement every Keynote feature. SciSlide's command inventory below is derived from its own source. A matching key combination does not establish identical feature semantics. Unsupported tables, charts, comments, master editing, rich text, and OS services must not appear as functioning SciSlide commands.

## 2. Terminology and command ownership

**Command** is Command/⌘; **Option** is Option/⌥/Alt; **Shift** is Shift/⇧; **Control** is Control/⌃. A plus between tokens means simultaneous keys. “Plus” names the `+` key; it is not an additional separator. Punctuation examples use US key positions where necessary; other layouts require the matching rules in section 6.

| Owner              | Meaning                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Editor canvas      | Object selection, document history, arrangement, and slide-level commands                                        |
| Slide navigator    | A focused thumbnail owns navigation/deletion; baseline duplication still uses the active slide (see section 3.2) |
| Text control       | Inline textarea, equation source, Inspector field, notes, or another editable control                            |
| Modal/chooser      | The active dialog owns its controls and dismissal                                                                |
| Audience/presenter | Presentation navigation, separate from document editing                                                          |
| Media/control      | Focused video/audio controls, buttons, sliders, and native controls                                              |
| Desktop host       | Electron/macOS window and application roles; not renderer document commands                                      |

“Baseline implemented” means a binding and handler exist. It does not certify every keyboard layout, OS-reserved shortcut, or physical Mac configuration.

## 3. macOS baseline command inventory

The canonical shortcut is the one shown by menus and help. Aliases are compatibility paths and must remain separately identified.

### 3.1 Files and history

| Command ID               | Canonical keys   | Required result / baseline scope                                                   |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------------- |
| `new`                    | ⌘+N              | Open the theme chooser; cancellation retains the current deck                      |
| `open`                   | ⌘+O              | Open a `.scislide` file through the platform adapter                               |
| `save`                   | ⌘+S              | Commit pending inline text, then save; desktop success follows the completed write |
| `saveAs`                 | ⌘+Option+Shift+S | Select a separate destination; legacy alias ⌘+Shift+S                              |
| `undo` / `redo`          | ⌘+Z / ⌘+Shift+Z  | Canvas document history; text controls retain their own history                    |
| `cut` / `copy` / `paste` | ⌘+X / ⌘+C / ⌘+V  | Canvas uses the internal object clipboard; text controls use normal text editing   |
| `exportPdf`              | ⌘+Option+Shift+P | Export the deck as PDF using normal preflight and save handling                    |
| `exportSvg`              | ⌘+Option+S       | Export the current slide as SVG using normal validation                            |
| `help`                   | ⌘+Shift+/        | Open SciSlide's shortcut reference, not an external user guide                     |

### 3.2 Slides, objects, and text

| Command ID                                             | Canonical keys                      | Required result / baseline scope                                                                                               |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `addSlide`                                             | ⌘+Shift+N                           | Open the new-slide layout chooser; insert the selected layout after the current slide as one undoable edit                     |
| `duplicate`                                            | ⌘+D                                 | With thumbnail focus, duplicate the active slide; otherwise selected objects, or the active slide when no objects are selected |
| `nextSlide` / `previousSlide`                          | Page Down / Page Up                 | Navigate slides outside text and unrelated focused controls                                                                    |
| `firstSlide` / `lastSlide`                             | Home / End                          | Select first/last slide in editing mode                                                                                        |
| `insertEquation`                                       | ⌘+Option+E                          | Insert an editable scientific equation object; the chord aligns with Keynote                                                   |
| `insertFigure`                                         | ⌘+Shift+V                           | Open the image/SVG/PDF figure picker                                                                                           |
| `selectAll` / `deselectAll`                            | ⌘+A / ⌘+Shift+A                     | Select visible unlocked canvas objects / clear selection; editable controls retain their own text selection                    |
| `group` / `ungroup`                                    | ⌘+Option+G / ⌘+Option+Shift+G       | Operate on flat object groups; legacy aliases ⌘+G / ⌘+Shift+G                                                                  |
| `lock` / `unlock`                                      | ⌘+L / ⌘+Option+L                    | Change selection/group lock state according to existing object rules                                                           |
| `bringToFront` / `sendToBack`                          | ⌘+Shift+F / ⌘+Shift+B               | Move the selection to the stacking extreme, preserving its relative order                                                      |
| `bringForward` / `sendBackward`                        | ⌘+Option+Shift+F / ⌘+Option+Shift+B | Move the selection one layer                                                                                                   |
| `bold`                                                 | ⌘+B                                 | Toggle bold on selected unlocked text objects                                                                                  |
| `increaseFontSize` / `decreaseFontSize`                | ⌘+Plus / ⌘+Minus                    | Change selected text-object size by 1, bounded to 8–180; the Plus binding accepts Shift where needed                           |
| `alignTextLeft` / `alignTextCenter` / `alignTextRight` | ⌘+{ / ⌘+\| / ⌘+}                    | Set whole text-object alignment; US positions use Shift+[ / Shift+Backslash / Shift+]                                          |
| `finishTextEditing`                                    | ⌘+Return                            | Apply the inline text edit and return to object editing; never begin presenting from this context                              |

These formatting commands affect entire selected text objects. Character-range styling, italic, underline, paragraph styles, and rich-text superscript/subscript are not implemented by these bindings.

Additional context handlers exist outside the typed command inventory:

- Canvas arrows move unlocked selected objects by **1 document unit**; Shift+arrow moves them by **10**. These are logical slide coordinates, not physical display pixels.
- Enter begins editing a selected text object. Inline Enter inserts a newline, and Escape discards the unfinished inline edit.
- A focused thumbnail uses Up/Down to navigate and Delete/Backspace to remove that slide. Deletion preserves at least one slide. Mac keyboard slide reordering and Return-to-add from a thumbnail are not implemented.
- Canvas Delete/Backspace removes the unlocked object selection. Option-drag bypasses smart guides in SciSlide; it does not duplicate an object or resize it from its center.

**Known focus gap:** Tab can focus an inactive thumbnail without selecting it. In 0.6.2, duplication switches to slide mode but still clones the active slide. Targeting the independently focused thumbnail is a pending KS-07/AT-05 requirement; click or navigate to select the intended slide before duplicating.

### 3.3 View and presentation

| Command / context            | Canonical keys                   | Baseline result                                                                      |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `zoomIn` / `zoomOut`         | ⌘+Shift+Period / ⌘+Shift+Comma   | Increase/decrease fit-relative zoom by 10 percentage points, within 50–150%          |
| `fitSlide`                   | ⌘+Option+0                       | Restore fit-relative zoom to 100%; this is not an actual-size command                |
| `present`                    | ⌘+Option+P                       | Begin at the current slide's initial build state; canvas alias ⌘+Return              |
| Audience/presenter next      | Right / Down / Space / Page Down | Reveal the next populated build, then advance to the next slide                      |
| Audience/presenter previous  | Left / Up / Page Up              | Reverse a build; from the initial state, open the preceding slide at its final build |
| Audience/presenter endpoints | Home / End                       | First slide at initial build / last slide at final build                             |
| Audience/presenter exit      | Escape / Q                       | End presentation; Q belongs to playback only outside editable/media controls         |
| Desktop close                | ⌘+W                              | Electron/macOS `close` role; not a canvas action                                     |
| Desktop fullscreen           | Control+⌘+F                      | Electron `togglefullscreen` role; independent of starting a slideshow                |

The desktop application menu also supplies native Hide/Quit roles. Minimize, close-all, and minimize-all must not be advertised merely because they are familiar macOS conventions: the current menu template does not define them.

Presentation keys currently do not distinguish shifted arrows from ordinary arrows. Audience Escape currently exits before its text/media focus guard; the separate presenter applies that guard first. Aligning their dismissal rules is explicit pending work, not an existing parity guarantee.

## 4. Compatibility decisions and collision register

The following comparisons were checked against the [Apple guide](https://support.apple.com/en-gb/guide/keynote/tanfde4a3e6d/mac). The resolutions are SciSlide product decisions.

| Area              | Current difference                                                  | Decision                                                                                                             |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| ⌘+Shift+S         | Keynote duplicates a presentation; SciSlide retains a Save As alias | Keep the alias for 0.6.2 compatibility; a future Duplicate Presentation feature requires an explicit alias migration |
| ⌘+Option+Shift+P  | Keynote uses this for its Pen tool; SciSlide exports PDF            | Treat as an occupied SciSlide export chord; do not silently assign it to future drawing                              |
| ⌘+G / ⌘+Shift+G   | Grouping aliases overlap future find navigation                     | Canonical grouping uses Option; resolve legacy aliases before adding Find Next/Previous                              |
| New-slide command | Keynote has context-specific slide/layout creation                  | SciSlide opens an ordinary slide chooser; it does not edit linked masters                                            |
| Playback reverse  | Keynote distinguishes previous-slide and previous-build keys        | Preserve documented 0.6.2 behavior until a separately tested playback profile is introduced                          |
| Pointer gestures  | SciSlide uses Option to bypass guides                               | Keep existing behavior; any Keynote-style gesture change needs conflict review                                       |

Other intentional differences: shortcut help is in-app, text formatting is object-level, Fit uses a fit-relative scale, and the renderer supports scientific equation insertion and PDF/SVG export. No complete Keynote compatibility claim follows from this specification.

## 5. Routing requirements

The following are normative requirements for implementation and review. Existing protections must be retained; acceptance coverage must establish any remaining gaps.

| ID    | Requirement                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KS-01 | Determine the active profile from Electron's host platform first, then browser platform metadata. Reference tabs change displayed help only. Do not derive Windows/Linux bindings by replacing Command with Ctrl.                                                                                                   |
| KS-02 | Resolve one enabled command per key event and context. A native accelerator must not cause the renderer to execute the same command again.                                                                                                                                                                          |
| KS-03 | An already handled event, IME composition, legacy composition keyCode 229, or AltGraph input must not trigger an application command or lose text through shortcut cancellation.                                                                                                                                    |
| KS-04 | Active modal dialogs own their controls and dismissal. While the theme chooser is open, only New, Open, and shortcut Help are editor-level exceptions. Background object editing, presentation, and slideshow-triggered fullscreen entry stay suppressed. Native window fullscreen remains a separate desktop role. |
| KS-05 | Text controls own caret movement, selection, clipboard, Undo/Redo, and ordinary typing. Outside modals/playback, the explicit global exceptions are New, Open, Save, Save As, PDF export, SVG export, and Help. Save/export capture pending inline text before taking their snapshot.                               |
| KS-06 | Inline Command+Return commits once and returns to object editing before any canvas Present alias can run. Escape cancels the active inline edit, dialog, or gesture according to its owner; it must not also perform an unrelated command.                                                                          |
| KS-07 | Thumbnail commands target the focused slide even if an object selection remains on the canvas. Arrows in text controls, media, buttons, or sliders must not move objects or reorder slides.                                                                                                                         |
| KS-08 | Presentation dispatch is separate from canvas editing. Focused media retains Space/Enter/arrows, and focused buttons retain activation. Modified playback keys must have explicitly documented meanings. The audience and presenter require a common, tested Escape policy.                                         |
| KS-09 | One-shot editor commands ignore auto-repeat; nudge may repeat. Playback and thumbnail repeat policies must be made explicit and tested rather than assumed to inherit the typed-command guard. A keypress produces one coherent mutation/history action.                                                            |
| KS-10 | Busy native operations and unavailable selections disable conflicting actions consistently across menu, keyboard, and toolbar. No-op commands must not create history entries. Locked content remains protected.                                                                                                    |
| KS-11 | Canonical keys, aliases, availability, and context must agree across renderer, native menus, hints, help, README, and wiki. Browser/OS-reserved keys retain a visible menu or toolbar route.                                                                                                                        |
| KS-12 | Native IPC uses fixed validated command IDs. A shortcut must not introduce arbitrary shell execution, path access, or a broader renderer bridge. Native window-role behavior requires macOS validation.                                                                                                             |

Current renderer/menu definitions are maintained in separate modules. Consolidating them into one shared declarative registry is a target, rather than an existing implementation claim. That registry should describe command ID, per-platform keys, aliases, focus scope, availability predicate, repeat policy, and accessible label. Preserve existing typed action IDs where their semantics remain unchanged.

## 6. Keyboard layout and accessibility requirements

- Match required and forbidden modifiers, including rejecting unrelated Control on macOS and unrelated Meta on Windows/Linux. Modifier ordering in displayed labels does not change the chord.
- Prefer logical Latin letter keys on Latin layouts. Use documented physical-key fallback for non-Latin input or Option-generated symbols; do not globally reinterpret AZERTY/QWERTZ letters as US letters.
- Define punctuation by logical symbol and an explicit fallback position where appropriate. Test Plus/Equal, braces, vertical bar, comma/period, and slash with the native menu enabled. Do not confuse main-row Plus with numeric-keypad Add in the Linux layer profile.
- Accept Page/Home/End events emitted by compact Mac Fn combinations. Fn is not an application-level modifier to guess from JavaScript.
- Preserve native Tab focus order until a scoped object-traversal feature exists. Any future canvas Tab mode must provide an exit to the surrounding UI and must not trap focus in dialogs.
- Help must identify primary keys, aliases, context, and feature status using readable names as well as symbols. It must open on the host profile and restore focus after dismissal.

## 7. Planned extensions

These are proposed requirements, not bindings added by this document. Proposed keys require a conflict and accessibility review before activation.

| Priority | Feature / proposed approach                                                   | Dependency and acceptance boundary                                                                                   |
| -------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| P1       | Shared registry, context routing, audience/presenter Escape and repeat parity | Preserve current aliases and text/IME/media ownership; prove menu/key parity                                         |
| P1       | Canvas object traversal with Tab/Shift+Tab                                    | Define stacking order, hidden/locked objects, group selection, and a route out of the canvas                         |
| P1       | Keyboard focus/toggles for Inspector and object list                          | Candidate macOS chords Option+⌘+I and Shift+⌘+L; existing panes need explicit visibility/focus state                 |
| P1       | Keyboard slide reordering on macOS                                            | Scope to focused thumbnails; final keys pending. Preserve existing Windows/Linux profiles                            |
| P2       | Separate next/previous slide from next/previous build                         | Evaluate Shift-arrow conventions; specify animation suppression and entry build state before changing playback       |
| P2       | Playback pause/blank-screen state (candidate F/B/W) and numeric slide chooser | Presentation-only state; Enter confirms and Escape cancels chooser input; exports/deck content unchanged             |
| P2       | Presenter notes/timer/display controls (candidate ⌘+Shift+P / R / X)          | Scope to presenter window and existing capabilities; define multi-monitor behavior before promising display swapping |
| P3       | Actual-size/selection/content zoom; keyboard crop/resize/rotation             | Distinguish document scale from fit-relative zoom; preserve numeric editing and history                              |
| P3       | Rich text, Find, style clipboard, and customizable bindings                   | Implement the underlying model/UI first; migrate conflicting aliases explicitly and version saved preferences        |

Table/chart editing, comments, linked-master editing, recording, advanced video transport, and freehand point editing remain feature-dependent future work. OS dictation and system character services remain OS-owned. This specification does not assign shortcuts for features that do not exist.

## 8. Acceptance and validation

These scenarios are acceptance criteria, not a report that this documentation update ran new application tests. Existing shortcut/editor/presenter/native-menu fixtures provide the starting coverage.

| ID    | Scenario                                                                                               | Expected result                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT-01 | Trigger a supported action by menu, keyboard, and toolbar                                              | Same availability, target, mutation, and history; one dispatch per event                                                                                   |
| AT-02 | Edit Korean IME text and use AltGraph/Option symbols on US/UK and representative non-US layouts        | No premature command, lost character, or composition cancellation; letter and punctuation matching follow section 6                                        |
| AT-03 | Use clipboard, Select All, Undo/Redo, and arrows in inline text, equation source, Inspector, and notes | Only the focused text editor changes; deck history/objects remain untouched                                                                                |
| AT-04 | Edit inline text, press Command+Return, then Save; separately cancel with Escape                       | Apply once without entering fullscreen/playback; saved text is current; cancellation restores the previous source                                          |
| AT-05 | Focus a thumbnail while canvas objects remain selected; duplicate, navigate, and delete                | Target the focused slide, retain usable focus, preserve the final-slide invariant; canvas arrows still nudge objects                                       |
| AT-06 | Use Plus, braces, bar, and zoom keys with native menus and extra modifiers                             | Exactly the documented command/alias fires; unintended modifier combinations do nothing                                                                    |
| AT-07 | Use a chooser/modal or start a conflicting native operation, then invoke object or Present keys        | No background mutation or unexpected slideshow-triggered fullscreen; native window fullscreen remains separate and allowed global exceptions stay explicit |
| AT-08 | Focus video controls and buttons during playback; compare audience and presenter Escape handling       | Media/control keys remain local; planned common dismissal policy is tested separately from the current difference                                          |
| AT-09 | Navigate sparse build steps forward/backward and use Home/End                                          | Baseline build/slide transitions and endpoint entry states match section 3.3; proposed shifted-arrow semantics have separate fixtures                      |
| AT-10 | Hold New, Duplicate, Paste, Present, and nudge keys                                                    | One-shot editor actions do not repeat; movement follows its declared repeat/history policy; pending thumbnail/playback policies receive dedicated checks   |
| AT-11 | Switch help reference tabs, close help, and use a browser-reserved shortcut                            | Active OS profile is unchanged, focus is restored, and a visible alternate action remains available                                                        |
| AT-12 | Use native Close, Quit, and Fullscreen on macOS                                                        | Desktop-role behavior is verified on a native Mac; browser tests are not presented as equivalent evidence                                                  |

Planned object traversal, slide chooser, playback pause/blank state, rich text, and customization need their own feature fixtures before they can be promoted into the baseline inventory. A future shortcut change must update this document and user-facing references in the same change.

## 9. Implementation references

- [Typed bindings and matcher](../../src/lib/shortcuts.ts)
- [Editor dispatch and focus routing](../../src/App.tsx)
- [Native menu commands and composition protection](../../desktop/menu-commands.cjs)
- [Inline text editing](../../src/components/InlineTextEditor.tsx)
- [Presenter key routing](../../src/components/PresenterApp.tsx)
- [Shortcut tests](../../tests/shortcuts.test.ts) and [editor keyboard tests](../../tests/keyboard-editor.test.ts)
- [Current user shortcut reference](../wiki/Keyboard-Shortcuts.md)
- [Apple Keynote reference](https://support.apple.com/en-gb/guide/keynote/tanfde4a3e6d/mac), reviewed 2026-10-08
