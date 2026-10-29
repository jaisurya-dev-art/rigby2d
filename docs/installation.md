# Installation

Rigby2D runs in your browser with nothing to install, as a desktop app for Windows, or from source
on Windows, macOS and Linux.

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
