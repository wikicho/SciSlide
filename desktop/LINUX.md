# SciSlide 0.6.0 — Linux x64

The Debian package contains SciSlide and its Electron runtime for **x64 (Intel/AMD 64-bit)** Linux. Debian calls this architecture **amd64**. Ubuntu 24.04 x64 is the packaging target; other Debian/Ubuntu releases need separate desktop validation. MathJax editing uses bundled fonts and equation resources without Node.js, TeX or a development server.

## Install, launch and remove

Download the `.deb` and its matching `.sha256` from the [v0.6.0 development prerelease](https://github.com/wikicho/SciSlide/releases/tag/v0.6.0), or download a Linux workflow artifact and extract it first. A local source build produces the same files in `release/`.

From the folder containing both files:

```sh
sha256sum -c SciSlide-0.6.0-linux-x64.deb.sha256
sudo apt install ./SciSlide-0.6.0-linux-x64.deb
scislide
```

Use the exact version in your download's filenames. The `./` tells APT to install a local file and resolve its declared system-library dependencies. No TeX distribution or AI CLI is installed with SciSlide. A matching checksum detects file changes; it does not authenticate the publisher.

The package installs the full application in `/opt/scislide`, adds `/usr/bin/scislide`, and adds **SciSlide** to the desktop application menu with its icon. Open saved `.scislide` documents through the app's **Open** action; file-manager associations and command-line document opening are not implemented. Editable examples are in `/opt/scislide/examples`; copy one to your documents folder before editing it. The package retains Electron's sandbox and does not add `--no-sandbox` to its launcher.

Quit SciSlide before installing a newer `.deb` with the same command. To remove the application:

```sh
sudo apt remove scislide
```

Removal leaves presentations saved elsewhere and Electron's per-user application data intact.

## APT repository and updates

Installing a local `.deb` does **not** register an APT repository. `apt install scislide` by package name and automatic updates through `apt upgrade` require a configured repository containing SciSlide. No SciSlide APT repository is currently provided; download and install a new `.deb` to update.

A future repository needs hosted package indexes, signed Release metadata, a scoped `Signed-By` keyring, version retention and release review. See the official [APT authentication documentation](https://manpages.debian.org/apt-secure) and [repository configuration documentation](https://manpages.debian.org/sources.list). The package-generation command does not change APT sources or trust configuration.

## Build from source

Build on Linux with Node.js 22.12 or later, pnpm and `dpkg-deb` (provided by Debian/Ubuntu's `dpkg` package):

```sh
pnpm install --frozen-lockfile
pnpm desktop:package:linux --arch=x64
```

The command builds the editor and creates:

```text
release/SciSlide-linux-x64/
release/SciSlide-0.6.0-linux-x64.deb
release/SciSlide-0.6.0-linux-x64.deb.sha256
release/LINUX-INSTALL.md
```

Only x64 is supported by this Debian distribution command. `--out` selects another output directory; `--overwrite` replaces recognized generated outputs. The standalone application folder can also be launched with `release/SciSlide-linux-x64/scislide`, with all runtime files kept together. Its Chromium sandbox still requires a supported host environment. Do not run the editor as root.

The manually started **Linux x64 development packages** workflow runs on Ubuntu 24.04, checks the editor/desktop tests, builds the package, verifies SHA-256, checks `Package: scislide` and `Architecture: amd64`, and extracts the package to verify its launcher, desktop entry, application archive and x86-64 executable. Its artifacts are retained for 30 days. These are packaging checks; the workflow does not install the package or validate the complete editor journey on a physical Ubuntu desktop. TeX integration fixtures run only when the required tools and isolation are available.

By default the Linux-only workflow uploads an artifact. Its optional publication uses a new `v<package-version>-linux-dev.<positive-number>` tag and refuses existing tags/releases. The separate **SciSlide development release** workflow builds all five macOS/Windows/Linux distributions at the requested `main` commit; explicit publication creates one `v<package-version>` development prerelease with checksums and platform guides.

## Use the editor

Choose one of five starter themes before creating a presentation. **Keynote White** has fifteen coordinated layouts and blank slides; the other themes keep the existing fourteen-layout picker. Double-click text or press **Enter** to edit on the slide; **Ctrl+Enter** applies and **Escape** cancels. Write `$\chi$` or `\(\frac{1}{2}\)` inside text for MathJax formulas with font-aware sizing and a preserved mathematical baseline. Raw source stays editable; formulas remain vectors in PDF/SVG.

**Figure** imports PNG, JPEG, sanitized SVG or a selected PDF page. PDF pages become embedded high-resolution PNGs. **CROP & INSET** supports reversible crops and independent enlarged insets; **Replace figure** preserves the frame/crop. Selected Keynote White photo/video placeholders can be filled through **Figure / Video**. Use the object/layer list, object clipboard, six-way alignment and equal-gap distribution to arrange slides.

Linux shortcuts use **Ctrl/Alt**: **Ctrl+O / Ctrl+S / Ctrl+Shift+S** open/save/save as, **Ctrl+Z / Ctrl+Shift+Z** undo/redo and **Ctrl+Alt+P / Ctrl+Alt+S** export PDF/SVG. **Ctrl+Shift+/** opens platform shortcut help. **My equations** provides a local named/tagged library with JSON transfer. **Presenter display** provides a separate notes/preview/timer window; move it to your screen manually.

Workspace recovery uses bounded IndexedDB and retains unfinished equation drafts, with a localStorage fallback. Libraries and unapplied drafts remain local workspace data; save portable files explicitly. New saves use native format **0.5.0** and read/migrate formats **0.1.0–0.4.0**. Older apps that read only 0.4.0 or earlier cannot open new files; **Save As** preserves an older original.

## Installed LaTeX and AI CLIs

MathJax, AMS notation and the bundled STIX Two, Fira Math and Latin Modern fonts work immediately. The optional **Local LaTeX** renderer requires system-installed `latex` or `xelatex`, `dvisvgm`, `kpsewhich`, **bubblewrap 0.9.0 or later** and `prlimit`. Ubuntu 24.04 provides the required bubblewrap version; Ubuntu 22.04's default version is too old for the current compile worker, while MathJax editing remains usable. On Debian/Ubuntu, an example setup is:

```sh
sudo apt install texlive-latex-extra texlive-fonts-recommended texlive-science texlive-xetex dvisvgm bubblewrap util-linux
```

SciSlide checks whether isolation actually works before enabling compilation. Home-installed TeX packages such as `~/texmf` are not currently mounted into its compile environment. Valid local vector renders saved in a presentation remain viewable and exportable without the original compiler.

**AI draft** uses compatible installed Codex CLI, Claude Code or Gemini CLI. Install and authenticate the provider CLI separately, then explicitly generate and review a draft. Detection alone does not verify authentication. See the repository README for the tested adapters, restrictions and provider behavior.

## Snap distribution

Snap packaging is planned, with no current `.snap` download or Snap Store listing. Strictly confined snaps restrict access to host files and executables, so using the user's installed TeX packages and AI CLIs needs a separate integration design. See [Snap confinement](https://snapcraft.io/docs/explanation/security/snap-confinement/). Classic confinement gives broader host access but requires a [Snap Store review](https://snapcraft.io/docs/reference/administration/reviewing-classic-confinement-snaps/); it is not assumed to be available.

A future Snap release should declare its capability subset, retain SciSlide's Electron and compiler isolation boundaries, and test native file dialogs, presentation windows, media, exports and supported host-tool connections. Snap is a separate distribution path; the `.deb` does not require Snap.

Electron/Chromium notices are in `/opt/scislide/LICENSE` and `/opt/scislide/LICENSES.chromium.html`; app dependency notices are inside `resources/app.asar` under `third-party-licenses/`. A license for the new SciSlide source has not been selected yet.
