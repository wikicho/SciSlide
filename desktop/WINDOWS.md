# SciSlide 0.3.0 — Windows x64

This development build contains the **x64 (Intel/AMD 64-bit)** SciSlide app for Windows 10 or later. Windows 11 x64 is the intended desktop target. Node.js, a development server and TeX are not required for MathJax editing. Physical Windows 10/11 desktop validation is still a release requirement.

## Install or run the portable app

Run `SciSlide-0.3.0-windows-x64-setup-unsigned.exe` to install for your current user. The default destination is `%LOCALAPPDATA%\Programs\SciSlide`, with a Start menu shortcut. Administrator privileges are not requested. Quit SciSlide before installing an update. Remove it through Windows' installed-app settings. Uninstallation does not remove presentations you saved elsewhere or the app's user-data folder.

Alternatively, extract **all** of `SciSlide-0.3.0-windows-x64-portable.zip`, then open `SciSlide-win32-x64\scislide.exe`. Keep the runtime files, DLLs and `resources` directory together. The portable edition runs without installation, but still uses Electron's ordinary per-user app-data directory; recovery data is not stored beside the executable.

Both distributions are **unsigned development builds**. Windows security policies may block installation or launch. Code signing and publisher reputation are later release work; these builds do not change system security settings. The application binary is x64, and the installer uses an x64 bootstrap executable. A separate native ARM64 or 32-bit Windows edition is not provided.

## Use the editor

**New slide** or the slide list's **+** opens the Scientific template picker. Research title, Key findings, Equation + meaning, Figure comparison and Blank create editable slide objects. **Open / Save / Save As** use native file dialogs; **Export** saves the whole presentation as PDF or the current slide as SVG. Keyboard shortcuts use Ctrl on Windows.

MathJax, AMS notation and the bundled STIX Two, Fira Math and Latin Modern equation fonts work without a TeX installation. **Local LaTeX compilation is currently disabled on Windows**, even when MiKTeX or TeX Live is installed, until the Windows compiler isolation worker is implemented. Valid vector results already saved in a `.scislide` document can be viewed, presented and exported without TeX.

Bundled editable examples are in the app's `examples` folder. Copy one to your documents folder before editing it. The example data is synthetic. Page numbering, embedded MP4/WebM videos and click-step appear/fade builds are available. Videos play in presentation mode; PDF/SVG exports use a static placeholder. Codec support depends on the Electron runtime. Korean text works in the editor and native files; PDF body text currently supports the bundled Inter Latin character range.

## Verify a download

Each distribution has a matching `.sha256` file. In PowerShell, compare its recorded hash with the result of:

```powershell
Get-FileHash .\SciSlide-0.3.0-windows-x64-setup-unsigned.exe -Algorithm SHA256
Get-Content .\SciSlide-0.3.0-windows-x64-setup-unsigned.exe.sha256
```

Use the portable ZIP's filename to verify that distribution. A matching checksum detects file changes; it does not certify a publisher or replace code signing.

## Build from source

With Node.js 22.12 or later, pnpm and **Inno Setup 6.7 or later** installed on Windows:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:package:win
```

The target is always x64, independent of the build machine's architecture. Use `--arch=x64` explicitly if desired. Other architectures are rejected by this Windows distribution command. If Inno Setup is outside its standard installation path, pass `--iscc` with the compiler's path. To build only the portable distribution, including from Linux or macOS:

```sh
pnpm desktop:package:win --portable-only
```

Output defaults to `release/`. Use `--out` for another output folder and `--overwrite` to replace existing generated outputs. The **Windows x64 development distributions** GitHub Actions workflow builds on a Windows x64 runner, checks hashes and PE architecture, and tests installation and uninstallation in a temporary directory. Its downloadable artifacts are retained for 30 days. A build and install smoke check does not validate the complete editing, saving, media and export journey on physical Windows desktops.

Electron/Chromium notices are beside the executable in `LICENSE` and `LICENSES.chromium.html`; app dependency notices are in `resources/app.asar` under `third-party-licenses/`. A license for the new SciSlide source has not been selected yet. Automatic updates and signed distribution remain future work.
