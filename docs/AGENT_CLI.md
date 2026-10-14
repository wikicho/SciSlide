# SciSlide for AI agents

The headless CLI creates and edits native `.scislide` presentations and exports SVG/PDF without a display server, editor window, or computer-use automation. Agents provide structured edits; SciSlide supplies native layouts, document validation, archive integrity checks, and the editor's static export pipeline.

**Availability:** included in v0.6.3.1 desktop packages and source builds; previously published v0.6.3 packages contain the update CLI only. Agent commands work offline. No AI account or provider is required.

## Start from a source checkout

With the project's dependencies installed:

```sh
pnpm build:cli
pnpm cli schema
pnpm cli create --title "Research talk" --layout blank --output talk.scislide
pnpm cli apply talk.scislide --ops examples/agent-edits.json --output revised.scislide
pnpm cli export revised.scislide --format pdf --output talk.pdf
```

The build creates a standalone directory containing `agent.cjs`, `fonts/`, and `THIRD_PARTY_NOTICES.txt`. Keep these files together. On a machine with **Node.js 22 or later**, the directory works without the SciSlide desktop app, npm dependencies, or an Electron runtime:

```sh
node dist-cli/agent.cjs schema
node dist-cli/agent.cjs inspect revised.scislide
node dist-cli/agent.cjs export revised.scislide --format svg --slide 1 --output slide.svg
```

You can also call the source dispatcher directly with `node desktop/update-cli.mjs --cli COMMAND ...` after building the bundle.

## Use an installed application

New Debian packages expose `scislide`; portable Linux/macOS packages include `bin/scislide`, and Windows packages include `bin\scislide.cmd`. Installed macOS apps retain `/Applications/SciSlide.app/Contents/Resources/scislide-cli/bin/scislide`; installed Windows apps retain `%LOCALAPPDATA%\Programs\SciSlide\bin\scislide.cmd`. Use the launcher directly or add its directory to your terminal's PATH.

```sh
scislide --cli schema
scislide --cli create --title "Research talk" --layout blank --output talk.scislide
scislide --cli inspect talk.scislide
scislide --cli apply talk.scislide --ops edits.json --output revised.scislide
scislide --cli validate revised.scislide
scislide --cli export revised.scislide --format pdf --output talk.pdf
```

The installed launchers use the bundled runtime in Node mode, so they need neither a graphical session nor a separate Node installation. The explicit `--cli` prefix also keeps misspelled or unsupported commands headless. Known agent commands work without the prefix too. Invoking the ordinary launcher with no command opens the editor.

## Command contract

Successful commands write **one JSON object on stdout** with `ok: true`, `protocolVersion: 1`, and the command name. Failed commands write a JSON error on stderr and exit nonzero: `2` for argument errors, `1` for failed document operations. `--help` prints human-readable help; `--version` returns JSON. Use `schema` for the supported edit JSON Schema, object fields, themes, layouts, and defaults.

| Command                                                 | Purpose                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `schema`                                                | Discover capabilities and the versioned edit schema.                                           |
| `create --output FILE`                                  | Create a native deck; supports `--title`, `--theme`, `--layout`, `--width`, and `--height`.    |
| `inspect FILE`                                          | Read editable content, IDs, geometry, and styles while omitting embedded media/cache payloads. |
| `inspect FILE --full`                                   | Return the complete native deck, including embedded assets.                                    |
| `inspect FILE --slide ID_OR_NUMBER`                     | Include the complete selected slide.                                                           |
| `validate FILE`                                         | Check archive integrity, resources, media types, native IDs, and document references.          |
| `apply FILE --ops JSON --output FILE`                   | Apply an atomic batch and save a new deck.                                                     |
| `apply FILE --ops JSON --dry-run`                       | Validate the complete edited archive and return results without saving.                        |
| `apply FILE --ops JSON --in-place`                      | Explicitly replace the input after checking it has not changed.                                |
| `unpack FILE --output deck.json`                        | Write portable native JSON, with embedded media and cached local equation SVGs.                |
| `pack deck.json --output FILE`                          | Validate native JSON and create a `.scislide` archive. `pack -` accepts stdin.                 |
| `export FILE --format svg --slide 1 --output slide.svg` | Export one slide as self-contained SVG. `--slide` also accepts a slide ID.                     |
| `export FILE --format pdf --output talk.pdf`            | Export the entire deck as vector PDF.                                                          |

Slide numbers and insertion positions start at **1**. In edit JSON, numeric selectors are slide numbers and strings are stable IDs; `{ "id": "slide-id" }` and `{ "index": 1 }` are also supported. CLI `--slide` treats digit-only values as slide numbers. Object selectors always use IDs. The coordinate system uses 96-DPI pixels; the default slide is 1600 × 900.

## Edit batches

The recommended input is a versioned envelope:

```json
{
  "version": 1,
  "operations": [
    { "op": "slide.update", "slide": 1, "patch": { "title": "Symmetry" } },
    {
      "op": "object.add",
      "slide": 1,
      "object": {
        "id": "symmetry-text",
        "type": "text",
        "text": "Something about $U(1)$",
        "fontSize": 44,
        "transform": { "x": 96, "y": 96, "width": 1200, "height": 140 }
      }
    },
    {
      "op": "object.add",
      "slide": 1,
      "object": {
        "id": "energy-equation",
        "type": "equation",
        "latex": "E=mc^2",
        "transform": { "x": 96, "y": 300, "width": 600, "height": 160 }
      }
    }
  ]
}
```

The CLI also accepts an operations array. Batches support deck updates; slide creation/update/removal/reordering; text, equation, shape, figure, and video object creation/update/removal/reordering; and asset creation/update/removal. Unknown fields and invalid values are rejected. The whole batch must satisfy the native model, including final references and unique IDs, before a file is written. IDs omitted when creating objects/slides/assets are generated and returned in `results`.

`object.update` merges partial transforms and equation styles, so changing `x` preserves width and height. Metadata and unrelated cached resources survive edits. Changes to a local equation's compilation inputs invalidate its stale render cache. See `schema` for optional-field removal using `null` and complete operation details.

Use `--ops -` to read a batch from stdin. A failed batch leaves the input intact. New output files are required by default; `--overwrite` explicitly replaces an output. `--in-place` is required to edit the original presentation. After inspecting a file, pass its returned hash as `--expect-sha256 HASH` to reject edits based on stale state; in-place writes also recheck the input before saving.

## Local figures

An agent does not need to encode image bytes. This CLI shorthand imports a local SVG, PNG, or JPEG using the editor's media importer:

```json
{
  "version": 1,
  "operations": [
    { "op": "asset.add", "file": "plot.svg", "id": "plot-asset" },
    {
      "op": "object.add",
      "slide": 1,
      "object": {
        "type": "figure",
        "assetId": "plot-asset",
        "alt": "Measured spectrum",
        "transform": { "x": 96, "y": 260, "width": 1000, "height": 500 }
      }
    }
  ]
}
```

Relative figure paths resolve from the operations file's directory; stdin batches use the working directory. Fully embedded native assets are also accepted. Files are embedded into the presentation; there are no remote image URLs or linked local resources. Video assets can be preserved or supplied as valid embedded native assets; the file shorthand imports image figures.

## Export and review

SVG and PDF use the editor's static exporter, including MathJax and inline equations, figures/crops, vector shapes, and page numbers. All appearance steps are visible; video objects use the existing static placeholder. PDFs retain vector paths and supported selectable text. SVG exports include local fonts. Inter and Nanum Gothic provide reproducible headless text metrics, with standard serif/sans-serif/monospace families also supported. An unavailable custom font or unsupported glyph returns an error; bundled-font kerning and standard fallback metrics may differ slightly from a physical desktop browser.

The CLI preserves saved Local LaTeX caches, but does not invoke TeX compilers or installed AI providers. Equations authored by agents normally use the supported MathJax syntax. A Local LaTeX object needs a valid existing render cache for export; editing compilation inputs clears that cache.

A useful agent loop is: read `schema`, inspect IDs/content, apply a dry run, save a revised deck, export SVG/PDF, review the result, and repeat. The resulting `.scislide` file remains directly editable in the normal SciSlide editor.
