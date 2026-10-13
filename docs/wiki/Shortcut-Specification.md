# Shortcut specification

The [Keyboard Shortcut Specification](https://github.com/wikicho/SciSlide/blob/main/docs/specifications/keyboard-shortcuts.md) defines SciSlide's command bindings, focus ownership, compatibility decisions, planned extensions, and acceptance criteria.

Revision **0.4**, dated **2026-10-13**, uses [Apple's Keynote shortcut reference](https://support.apple.com/en-gb/guide/keynote/tanfde4a3e6d/mac) for macOS conventions. It records the **SciSlide 0.6.3** bindings, including P1 improvements, inline equation editing and the Linux compile workflow. Windows retains its PowerPoint profile and Ubuntu/Linux retains its Impress profile.

## What the specification contains

- Canonical macOS bindings, compatibility aliases, and context-specific behavior.
- Explicit differences for Save As, export, grouping aliases, fit-relative zoom, slide creation, pointer gestures, and slideshow builds.
- Requirements for inline text, equation source, IME input, dialogs, thumbnails, media controls, native menus, and accessibility.
- Released P1 implementation: shared command metadata, canvas object traversal, independent pane focus/visibility, macOS thumbnail reordering, focused-slide duplication, and common audience/presenter key ownership/repeat rules.
- Remaining P2/P3 requirements for separate build/slide navigation, playback controls, richer text editing, and customization.
- Acceptance scenarios that separate existing behavior from future implementation work.

P1 features are included in v0.6.3; planned P2/P3 bindings are not active. Native menus synchronize their enabled states with current focus, selection and busy operations, and disabled application commands do not dispatch. Native text clipboard/history remains with focused controls, including modal text fields. The bounded availability bridge accepts fixed command IDs and booleans only from the trusted main editor frame; physical OS-role validation remains required. Use [Keyboard shortcuts](Keyboard-Shortcuts) for the user reference and [Development](Development) to run current source.

[Home](Home) · [Architecture and roadmap](Architecture-and-Roadmap) · [Development](Development)
