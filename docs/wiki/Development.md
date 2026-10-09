# Development

SciSlide uses a shared React/TypeScript editor with an Electron desktop host. This page describes the **0.6.2** development workflow and current source, including unreleased P1 shortcut changes. See [Architecture and roadmap](Architecture-and-Roadmap) for module boundaries and planned work.

## Prerequisites and setup

Use **Node.js 22.12 or later** and pnpm. The repository records its pnpm version in `package.json` and commits `pnpm-lock.yaml`.

```sh
git clone https://github.com/wikicho/SciSlide.git
cd SciSlide
pnpm install --frozen-lockfile
```

To check out the exact documented release before installation, use `git checkout v0.6.2`.

## Run the app

```sh
pnpm dev
```

Open `http://127.0.0.1:5173/` for the browser editor. It provides editing, source-file downloads and PDF/SVG export, but cannot execute installed LaTeX or AI CLIs.

```sh
pnpm desktop:dev
```

This starts Vite and Electron together. To build the editor and launch it through the bundled desktop origin instead:

```sh
pnpm desktop
```

Electron serves bundled resources at `scislide://app/` without a separate web server. MathJax resources and fonts are local. For a static web build:

```sh
pnpm build
pnpm preview
```

Serve `dist/` through a web server. There is currently no service worker or installable PWA.

## Validate changes

```sh
pnpm test
pnpm test:desktop
pnpm test:release
pnpm build
```

- Web tests cover the document model, migrations, archive checksums, media validation, equation rendering, text/math layout, object editing, recovery and actual export behavior.
- Desktop tests cover native API input validation, packaging, installed AI adapters and the Local LaTeX worker.
- Release tests cover release inventory and publication safeguards.
- The build includes TypeScript checks and a production Vite build.

Local TeX integration fixtures need Linux, installed TeX/converter tools and working bubblewrap isolation. Platform-specific tests may skip unsupported environments. Packaging and automated tests do not replace the complete editing, saving, presenting and export journey on physical desktops.

## Build desktop packages

| Target                             | Command                                              | Local output convention |
| ---------------------------------- | ---------------------------------------------------- | ----------------------- |
| Current platform app folder        | `pnpm desktop:package`                               | `release/`              |
| macOS arm64 and x64 installers     | `pnpm desktop:package:mac --out=release/macos-pkg`   | `release/macos-pkg/`    |
| Windows x64 setup and portable ZIP | `pnpm desktop:package:win --out=release/windows-x64` | `release/windows-x64/`  |
| Linux x64 Debian package           | `pnpm desktop:package:linux --arch=x64`              | `release/linux-deb/`    |

Use `--overwrite` explicitly when replacing recognized generated outputs. Mac/Windows scripts default to `release/` unless `--out` is provided; the Debian script defaults to `release/linux-deb/`.

The macOS script supports pure-JavaScript packaging on Linux. Native Apple packaging requires macOS and Xcode Command Line Tools; select it with `--implementation=native`. Both current methods create unsigned, unnotarized development installers.

Windows setup requires **Windows and Inno Setup 6.7 or later**. On Linux/macOS, `--portable-only` builds the Windows x64 ZIP without setup. Linux Debian packaging requires Linux and `dpkg-deb`. Neither Windows nor Debian distribution commands provide other CPU architectures.

## Release workflow

The manually dispatched **SciSlide development release** GitHub Actions workflow builds all five distributions at the requested `main` commit. It verifies source/version consistency, architecture, checksums and the Windows install/launch/uninstall smoke path. Publication is optional and defaults off; explicitly enabling it publishes a `v<package-version>` development prerelease with binaries, checksums and platform guides.

Separate platform workflows also exist. Workflow artifacts are retained for 30 days; published GitHub release assets are the user download location. Signing, notarization, automatic updates and complete physical-device validation remain future work.

## Useful source locations

| Location                                                       | Responsibility                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/App.tsx`, `src/components/`                               | Editor interaction, scenes, dialogs and presenter display.             |
| `desktop/keyboard-shortcuts.json`, `src/lib/shortcuts.ts`      | Shared command metadata and typed platform/context matching.           |
| `src/lib/playback-shortcuts.ts`, `src/lib/object-traversal.ts` | Playback ownership/repeat policy and canvas object traversal.          |
| `src/lib/model.ts`, `src/lib/persistence.ts`                   | Versioned model, migration, `.scislide` archives and asset validation. |
| `src/lib/equations.ts`, `src/lib/inline-math.ts`               | MathJax and shared text/math layout.                                   |
| `src/lib/export.ts`                                            | SVG scenes, PDF export and resource/font preflight.                    |
| `src/lib/ai-draft.ts`, `desktop/ai.mjs`                        | Draft validation/insertion and installed-provider adapters.            |
| `desktop/main.cjs`, `desktop/preload.cjs`                      | Native window/file/menu handling and narrow renderer API.              |
| `desktop/tex.mjs`                                              | Installed TeX detection and isolated Linux compiler worker.            |
| `scripts/`, `.github/workflows/`, `tests/`                     | Packaging, release automation and regression tests.                    |

Package version **0.6.2** and document format **0.5.0** are separate version numbers. Current source P1 shortcuts have not yet been packaged as a new release. Native menus receive live focus/selection/busy enabled states from the same availability rules as renderer dispatch. The optional availability bridge accepts only bounded fixed command IDs and booleans from the trusted main editor frame. Focused text retains native clipboard/history; disabled application commands do not dispatch. Physical-platform validation of native application/window roles remains required. Preserve source/archive migrations and saved-result validation when extending the model. Loading or exporting a document must not execute imported TeX source.

## Wiki maintenance

Wiki page sources live in `docs/wiki/`. Changes to these Markdown files on `main` trigger the **Publish SciSlide wiki** workflow; maintainers can also run it manually. The workflow validates internal links and Markdown fences, then commits to the existing wiki repository and verifies a fresh checkout. It preserves wiki history and pages not managed by this directory.

Edit managed pages in the source repository so the next synchronization retains your changes. Direct edits to the corresponding pages through GitHub's wiki editor will be replaced by their source versions on the next publish. Update the documented application version when features or downloads change. The wiki workflow does not rebuild or replace installer releases.

## Licensing

A project license for the new SciSlide source **has not yet been selected**. Dependency, font and Electron notices retain their respective licenses and are included under `third-party-licenses/` and in packaged runtimes. Do not infer a source license from the repository being public. License and contribution rules remain release work.
