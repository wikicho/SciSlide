# Local release directory and packaging

Local generated outputs are ignored by Git. Packaging and organization do not publish GitHub releases or install software. A version directory identifies the application version; it does not prove that a file contains the current working tree or has passed installed-app validation. Retain accompanying build metadata and validation records when comparing same-version artifacts.

## Default layout

```text
release/
  README.md                 Generated local index after organization
  inventory.json            Generated file sizes and symlinks
  v0.7.1/
    linux/                  .deb, .sha256, LINUX-INSTALL.md
    windows/                setup/portable, .sha256, WINDOWS-INSTALL.md
    macos/                  arm64/x64 .pkg, .sha256, MACOS-INSTALL.md
  work/
    v0.7.1/
      SciSlide-linux-x64/   Complete unpacked app for inspection or execution
      SciSlide-win32-x64/
  archive/
    versions/               Previously archived releases
    builds/                 Previously archived dated development builds
    legacy-2026-11-14/      Preserved mixed historical output directories
    organization-*.json     Move/rollback journals
```

The version is read from `package.json`; the names above illustrate the current development version. Version 0.7.1 packages include the macOS audience window placement fix described in [the release notes](releases/v0.7.1.md). Keep earlier v0.7.0, v0.6.10, v0.6.9, v0.6.8, v0.6.7 and v0.6.6 packages and their validation records separately; the historical records below retain their original versions. Direct `desktop:package` builds use `work/v<version>/` for any supported platform. macOS installer builds remove their temporary app trees after creating all requested installers. Windows/Linux retain the complete app separately in `work/v<version>/`.

An explicit `--out=path` selects that exact output folder. For Windows/Linux, the complete app also remains in the explicit folder, preserving existing scripts and CI verification paths. The CI workflows pass explicit output directories so their checksum, extraction and upload steps keep the same contract.

## Build commands

```sh
pnpm desktop:package
pnpm desktop:package:linux --arch=x64
pnpm desktop:package:mac --arch=all
pnpm desktop:package:win
# Portable Windows ZIP from Linux/macOS:
pnpm desktop:package:win --portable-only
```

Each package command builds the editor first through its package script. Native Windows setup requires Windows and Inno Setup; native macOS packaging requires Apple's tools; Debian output requires Linux and `dpkg-deb`. See the [platform guides](../desktop/USAGE.md) for prerequisites and supported installation paths.

Existing output conflicts are rejected by default. Use a different `--out` directory for an independent same-version build, or explicitly request `--overwrite`. The scripts build in unique temporary directories and validate the completed result before publication. An overwrite replaces an app/installers/checksums/guides set together; a recoverable publication error restores the preceding outputs. Failed builds retain the previous app as well as its installers. Staging directories are removed after success or failure.

File and directory symlinks at output boundaries are rejected. A `.scislide-publish.lock` serializes publication to each output parent. If a filesystem error also prevents rollback, the error names preserved `.scislide-publish-backup-*` directories. Keep those directories until the original files have been recovered. Multiple renames are recoverable operations, not a filesystem-wide atomic transaction or a promise of recovery after every possible hardware failure.

## Organize existing local files

Preview the proposed moves without changing any files:

```sh
pnpm release:organize
```

Apply the displayed preservation-only plan:

```sh
pnpm release:organize --apply
```

The November 14 migration separates the existing `linux-deb/v0.6.4.1` installers and app tree into the default version/work layout. Other historical root-level platform folders, loose installation guides and mixed validation files move together into `archive/legacy-2026-11-14/` at their original relative paths. Existing `archive/`, `v0.6.3.1/` and `v0.6.4/` history remains in place. Unknown root entries are reported and left untouched.

Every moved tree is checked with SHA-256, including file contents and preserved symlink targets without following them. The move journal records the original and new paths. Same-version files are never deduplicated by filename, and the organization command never deletes artifact contents. It does not reclaim the retained historical bytes.

To preview a reversal, use the journal path returned by the completed command:

```sh
node scripts/organize-release.mjs --rollback=archive/organization-2026-11-14.json
# Apply the reversal only after checking the preview:
node scripts/organize-release.mjs --rollback=archive/organization-2026-11-14.json --apply
```

Rollback refuses conflicts or changed moved artifacts. Do not edit a moved historical tree and then expect it to be discarded by rollback. Preserve journals and previous inventory files as part of the local history. A generated inventory lists local paths and sizes; it excludes its own file, organization journals and the lock to avoid self-referential updates. The generated README is an additional inventoried file. The inventory is not a publication manifest or an installed-app validation report.

## Verification

`pnpm test:desktop` includes desktop staging, all platform packaging fixtures, multi-artifact rollback and release organization tests. `pnpm test:release` covers verified GitHub publication policy. These tests use controlled package/compiler fixtures and do not replace real installation, file association, editing, save/reopen, export, clipboard or update checks on each supported OS.

## November 14 local organization record

The local migration completed 11 moves, with every moved tree passing its before/after SHA-256 check. All 4,583 original regular files (14,368,766,384 bytes) and 140 symlinks were retained. The generated index and inventory are additional metadata. The completed journal is `release/archive/organization-2026-11-14.json`, and a subsequent preview reports zero remaining moves. The existing 0.6.4.1 Debian artifact also passed its original SHA-256 checksum. These are preserved historical files, rather than a newly built installer set.

The final Node.js 24 verification passed 207 desktop/packaging/organization tests plus 13 release-publication tests, with 14 platform-dependent skips and zero failures. Type checking and whitespace checks also passed. The actual OS installation checks remain separate.

## Follow-up Linux package validation

This historical validation covers an earlier 0.6.4.1 working-tree snapshot, before the final UX changes. It does not validate the later 0.6.6 package.

A fresh unpublished development package was built from the dirty working tree and checked through 28 real steps: production editor/CLI build, cached Electron checksum, Debian metadata/checksum/permissions/extraction, and the extracted packaged CLI's create/edit/save/reopen/unpack/repack/SVG/PDF paths. The run includes Korean text, inline fractions/subscripts, standalone equations and the actual embedded-font SVG example. The before/after build input digest matched.

The first run found headless PDF font errors and remains as a failed validation record. The corrected run is retained separately with [the report](../output/packaging-validation/linux-2026-11-14T05-15-04-897Z/report.md), installer/checksum, native document, PDF/SVG and rendered previews. This local validation does not publish a release or establish GUI, system installation, native clipboard, file association or update-installation coverage. The existing `release/` files were retained.
