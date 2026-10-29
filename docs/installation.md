# Installation

Rigby2D runs in your browser with nothing to install, as a desktop app for Windows, macOS and
Linux, or from source.

## In the browser

**[Open the editor](https://rigby2d.com/editor/)**. It is the full editor,
including the demos, the tutorials, Python scripting and lip-sync transcription.

- Files open and save through your browser: in Chrome and Edge you can give the editor a folder to
  save into; other browsers download the files.
- Detachable panels and saved window layouts need the desktop app.
- The browser editor follows the `develop` branch, so it has the newest features first.

## Windows desktop app

Download the latest release from the
[Releases page](https://github.com/jaisurya-dev-art/rigby2d/releases/latest):

| File | What it is |
| --- | --- |
| `Rigby2D_x64_portable.exe` | The editor as a single file. Download it and run it; nothing is installed. (`Rigby2D_<version>_x64_portable.exe` is the same file with its version in the name.) |
| `Rigby2D_<version>_x64_en-US.msi` | Windows Installer package. |
| `Rigby2D_<version>_x64-setup.exe` | Setup program (NSIS). |
| `Rigby2D-AI.mcpb` | The [MCP server](mcp.md) as a one-file extension for Claude Desktop. |
| `rigby2d-godot-addon-<version>-windows-x64.zip` | The [Godot runtime](runtimes.md#godot) for your project (preview). |
| `rigby2d-godot-demo-<version>-windows-x64.zip` | A Godot demo project using the runtime. |
| `SHA256SUMS.txt` | Checksums of every file. |

The app needs WebView2, which is part of Windows 10 and 11.

> [!WARNING]
> The downloads are not code-signed, so Windows SmartScreen may warn before running them
> (*More info ▸ Run anyway*). Each release lists the SHA-256 checksum of every file in
> `SHA256SUMS.txt`. Compare it
> before running anything:
>
> ```powershell
> Get-FileHash .\Rigby2D_x64_portable.exe -Algorithm SHA256
> ```

## Updates

The desktop app checks for a new version once a day and asks before installing it: **Install and
restart** downloads the update, checks its signature and restarts into the new version. Your project
is saved first if it has changes. *Help ▸ Check for updates* checks right away, and *Preferences ▸
General ▸ Check for updates* turns the daily check off.

Updates are signed with the Rigby2D release key, and the app installs nothing that isn't signed
with it. On Windows the update uses the installer, so the portable editor becomes an installed one.
The browser editor is always the latest version.

## macOS desktop app

Download `Rigby2D_universal.dmg` from the
[Releases page](https://github.com/jaisurya-dev-art/rigby2d/releases/latest). It runs natively on
Apple silicon and Intel Macs (macOS 10.15 or newer). Open the `.dmg` and drag Rigby2D into
*Applications*.

The app is not signed with an Apple Developer ID yet, so the first time macOS blocks it:

1. Open *Applications*, **right-click** Rigby2D and choose **Open**, then **Open** again. Or open it
   once, then go to *System Settings ▸ Privacy & Security* and click **Open Anyway**.
2. If macOS says the app "is damaged", it only means it was downloaded and is not signed. Clear the
   download flag in Terminal, then open it again:

   ```bash
   xattr -cr /Applications/Rigby2D.app
   ```

The Godot runtime for macOS is `rigby2d-godot-addon-<version>-macos.zip` (Apple silicon and Intel).

## Linux desktop app

Download from the [Releases page](https://github.com/jaisurya-dev-art/rigby2d/releases/latest):

| File | What it is |
| --- | --- |
| `Rigby2D_amd64.AppImage` | Runs on most x86-64 distributions. Make it executable, then run it: `chmod +x Rigby2D_amd64.AppImage && ./Rigby2D_amd64.AppImage` |
| `Rigby2D_<version>_amd64.deb` | For Debian and Ubuntu: `sudo apt install ./Rigby2D_<version>_amd64.deb` |
| `rigby2d-godot-addon-<version>-linux-x64.zip` | The Godot runtime for Linux. |

The app uses WebKitGTK 4.1 (Ubuntu 22.04 or newer, Debian 12, Fedora 36 and similar). The AppImage
needs FUSE: on Ubuntu 24.04, `sudo apt install libfuse2t64`.

## Build from source

You need [Node.js](https://nodejs.org) 20 or newer and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system:

- **Windows:** Microsoft C++ Build Tools ("Desktop development with C++") and WebView2.
- **macOS:** Xcode Command Line Tools.
- **Linux:** WebKitGTK and the build essentials.

```bash
git clone https://github.com/jaisurya-dev-art/rigby2d.git
cd rigby2d
npm install
npm run dev          # the desktop app, with hot reload
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm run web:dev` | Runs the editor in your browser at `http://localhost:1420` (no native file dialogs). |
| `npm run build` | Builds the desktop app and its installers into `src-tauri/target/release/bundle/`. |
| `npm test` | Runs the test suites. |
| `npm run web:build` | Builds the browser editor. |
| `npm run site:build` | Builds the website, these docs and the browser editor into `_site/`. |
| `npm run build:mcpb` | Builds the `Rigby2D-AI.mcpb` extension. |

For the Rust runtime and the Godot node, see [Runtimes](runtimes.md#rust).

## Updating

- **Browser:** reload the page.
- **Portable app:** download the new `.exe` and replace the old one.
- **Installed app:** run the new installer; it upgrades in place.

Your `.rigby` files open in newer versions. Settings such as the keyboard shortcut preset and the
script library are kept.
