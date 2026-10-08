# Installation

SciSlide **0.6.2** is a development prerelease. Its desktop packages include the Electron runtime, editor and MathJax resources. Node.js, a TeX distribution and a development server are not required to use the packaged editor.

## Download

Download the package matching your operating system and processor from the [v0.6.2 release](https://github.com/wikicho/SciSlide/releases/tag/v0.6.2).

| System                           | Package                                                                                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon, M1 or later | [arm64 installer `.pkg`](https://github.com/wikicho/SciSlide/releases/download/v0.6.2/SciSlide-0.6.2-macos-arm64-unsigned.pkg)                                                                                                                        |
| macOS Intel                      | [x64 installer `.pkg`](https://github.com/wikicho/SciSlide/releases/download/v0.6.2/SciSlide-0.6.2-macos-x64-unsigned.pkg)                                                                                                                            |
| Windows Intel/AMD x64            | [Setup `.exe`](https://github.com/wikicho/SciSlide/releases/download/v0.6.2/SciSlide-0.6.2-windows-x64-setup-unsigned.exe) or [portable `.zip`](https://github.com/wikicho/SciSlide/releases/download/v0.6.2/SciSlide-0.6.2-windows-x64-portable.zip) |
| Ubuntu/Debian Intel/AMD x64      | [Debian package `.deb`](https://github.com/wikicho/SciSlide/releases/download/v0.6.2/SciSlide-0.6.2-linux-x64.deb)                                                                                                                                    |

Matching `.sha256` files and platform installation guides are release assets. macOS packages are **unsigned and unnotarized**; Windows packages are **unsigned**. System security policies may block installation or launch. Signing and notarization remain future distribution work.

## macOS

1. Choose **arm64** for Apple Silicon or **x64** for an Intel Mac.
2. Quit any running SciSlide instance, then open the matching installer.
3. Open `/Applications/SciSlide.app` after installation.

Both installers use the same application name and destination; install only the matching architecture. If macOS blocks the development build, follow your system's security policy. The installer does not alter security settings.

To check a download, compare the two hashes:

```sh
shasum -a 256 SciSlide-0.6.2-macos-arm64-unsigned.pkg
cat SciSlide-0.6.2-macos-arm64-unsigned.pkg.sha256
```

Use the x64 filename when checking the Intel package.

## Windows

Windows **10 or later, x64** is required; Windows 11 x64 is the intended desktop target. A native Windows ARM64 or 32-bit distribution is not provided.

Run the setup executable to install for the current user under `%LOCALAPPDATA%\Programs\SciSlide`. It adds a Start menu shortcut and does not request administrator privileges. Quit SciSlide before installing an update. Uninstall through Windows' installed-app settings.

For the portable edition, extract the **complete ZIP**, then launch `SciSlide-win32-x64\scislide.exe`. Keep its runtime files, DLLs and `resources` directory together. Recovery still uses Electron's per-user application-data directory, rather than the portable folder.

In PowerShell, compare the recorded checksum with the calculated one:

```powershell
Get-FileHash .\SciSlide-0.6.2-windows-x64-setup-unsigned.exe -Algorithm SHA256
Get-Content .\SciSlide-0.6.2-windows-x64-setup-unsigned.exe.sha256
```

Use the portable ZIP's filename to check that distribution.

## Ubuntu and Debian

Ubuntu **24.04 x64** is the packaging target. Other Debian/Ubuntu releases require separate desktop validation. Debian names x64 **amd64**.

Put the `.deb` and matching checksum file in the same folder, then run:

```sh
sha256sum -c SciSlide-0.6.2-linux-x64.deb.sha256
sudo apt install ./SciSlide-0.6.2-linux-x64.deb
scislide
```

The package installs in `/opt/scislide`, provides `/usr/bin/scislide` and adds a desktop-menu entry. Do not run the editor as root. Use **Open** inside SciSlide to open presentations; file-manager associations and command-line document opening are not implemented.

Quit SciSlide before installing a newer `.deb`. Remove the application with:

```sh
sudo apt remove scislide
```

Removal leaves separately saved presentations and per-user app data intact. There is currently **no SciSlide APT repository, automatic updater, Snap package or Snap Store listing**. Update by downloading and installing a new release package.

## Optional installed tools

- **Installed LaTeX:** optional equation compilation is supported on Linux when its dependencies and isolation checks pass. It is disabled on macOS and Windows. See [Equations and fonts](Equations-and-Fonts).
- **Installed AI CLIs:** the Electron app can connect to compatible Codex CLI, Claude Code or Gemini CLI installations. Install and authenticate them separately; see [AI assistance](AI-Assistance).

A checksum detects a changed or incomplete file; it does not authenticate a publisher or replace code signing. Full editing/export validation on physical desktops remains ongoing. For building your own packages, see [Development](Development); to begin a deck, see [Getting started](Getting-Started).
