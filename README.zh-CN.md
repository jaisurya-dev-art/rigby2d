<p align="center">
  <img src="branding/rigby2d-lockup-dark.svg" alt="Rigby2D" width="460">
</p>

<p align="center">
  <b>English</b> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <b>简体中文</b> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<p align="center">
  <strong>面向游戏、影片和互动作品的开源 2D 骨骼动画工具。</strong><br>
  用骨骼和网格绑定你的美术，制作动画，并用自带的运行时在任何地方播放。<br>
  内置 <a href="docs/mcp.md">MCP 服务器</a>：AI 助手可以检查、验证你的项目并为其制作动画。
</p>

<p align="center">
  <a href="https://rigby2d.com/"><img alt="在浏览器中试用：完整的编辑器，无需安装" src="https://img.shields.io/badge/%E2%96%B6%20Try%20it%20in%20your%20browser-the%20full%20editor%2C%20nothing%20to%20install-b5d3e7?style=for-the-badge&labelColor=0a0a0b" height="40"></a><br>
  <sub><a href="https://rigby2d.com/editor/"><b>打开编辑器</b></a>（含 Rigbytron 和 NILA 演示、教程与 Python 脚本） · <a href="https://rigby2d.com/">网站</a> · <a href="https://rigby2d.com/docs/">文档</a>（英文）</sub>
</p>

<p align="center">
  <img alt="Status: public beta" src="https://img.shields.io/badge/status-public%20beta-blue">
  <a href="https://upstar.dev/r/jaisurya-dev-art/rigby2d"><img alt="Upstar" src="https://upstar.dev/badge/jaisurya-dev-art/rigby2d.svg"></a>
  <a href="https://youtu.be/T1MdcD_rxeQ"><img alt="Watch the Rigby2D 0.4 film on YouTube" src="https://img.shields.io/badge/watch-Rigby2D%200.4%20film-ff0000?logo=youtube&logoColor=white"></a>
  <a href="runtimes/unity/com.rigby2d.unity/README.md"><img alt="Runtime ready: Unity" src="https://img.shields.io/badge/runtime%20ready-Unity-222429?logo=unity&logoColor=white"></a>
  <a href="runtimes/godot/addons/rigby2d/README.md"><img alt="Runtime ready: Godot" src="https://img.shields.io/badge/runtime%20ready-Godot-478cbf?logo=godotengine&logoColor=white"></a>
  <a href="runtimes/phaser/README.md"><img alt="Runtime ready: Phaser" src="https://img.shields.io/badge/runtime%20ready-Phaser-7b5cd6"></a>
  <a href="docs/runtimes.md"><img alt="Runtimes: JavaScript and Rust" src="https://img.shields.io/badge/runtimes-JavaScript%20%7C%20Rust-f7df1e?labelColor=555"></a>
  <a href="docs/mcp.md"><img alt="MCP server built in" src="https://img.shields.io/badge/MCP-server%20built%20in-7c3aed"></a>
  <a href="#license"><img alt="License: MIT or Apache-2.0" src="https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey">
  <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%202-24c8db">
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
</p>

<p align="center">
  <a href="https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D_x64_portable.exe"><b>Windows</b></a> · <a href="https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D_universal.dmg"><b>macOS</b></a> · <a href="https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D_amd64.AppImage"><b>Linux</b></a>：下载最新版本
</p>

<p align="center">
  <a href="https://youtu.be/T1MdcD_rxeQ"><img src="docs/images/promo-0.4.jpg" alt="在 YouTube 上观看 Rigby2D 0.4 影片" width="800"></a><br>
  <sub>▶ <a href="https://youtu.be/T1MdcD_rxeQ">观看 <b>Rigby2D 0.4</b></a>：45 秒看完全部新功能 · 另见：<a href="https://youtu.be/3StZlHwZeSo">Meet NILA</a>，用 Rigby2D 制作动画的吉祥物</sub>
</p>

<p align="center">
  <img src="docs/screenshot.jpg" alt="正在为 NILA 制作动画的 Rigby2D 编辑器" width="800"><br>
  <sub>编辑器正在为 NILA 制作动画：在树中选中头部骨骼，关键帧显示在摄影表中，姿势显示在检查器中。</sub>
</p>

## 文档

**[阅读文档](https://rigby2d.com/docs/)**（英文）：编辑器、运行时和 MCP 服务器每个部分的带截图指南。这些页面也在 [`docs/`](docs/) 中。

| 入门 | 绑定 | 动画 | 发布与自动化 |
| --- | --- | --- | --- |
| [安装](https://rigby2d.com/docs/installation.html) | [导入美术](https://rigby2d.com/docs/importing-art.html) | [制作动画](https://rigby2d.com/docs/animating.html) | [导出](https://rigby2d.com/docs/export.html) |
| [快速开始](https://rigby2d.com/docs/quick-start.html) | [AutoRig](https://rigby2d.com/docs/autorig.html) | [曲线编辑器](https://rigby2d.com/docs/graph-editor.html) | [运行时](https://rigby2d.com/docs/runtimes.html) |
| [界面](https://rigby2d.com/docs/interface.html) | [骨骼与插槽](https://rigby2d.com/docs/bones-and-slots.html) | [姿势与表情](https://rigby2d.com/docs/poses-and-faces.html) | [Python 脚本](https://rigby2d.com/docs/scripting.html) |
| [从 Spine 迁移](https://rigby2d.com/docs/migrating-from-spine.html) · [从 DragonBones 迁移](https://rigby2d.com/docs/migrating-from-dragonbones.html) | [网格](https://rigby2d.com/docs/meshes.html) · [约束](https://rigby2d.com/docs/constraints.html) | [影片](https://rigby2d.com/docs/film.html) · [场景](https://rigby2d.com/docs/scenes.html) · [口型同步](https://rigby2d.com/docs/lip-sync.html) | [AI 助手（MCP）](https://rigby2d.com/docs/mcp.html) · [插件](https://rigby2d.com/docs/addons.html) |

## 功能

- **AutoRig**：一步把分层 PSD 变成可编辑的绑定：骨骼、关节、可弯曲网格和 IK。
- **完整的绑定工具**：骨骼、带权重的网格、链接网格、图像序列、皮肤、事件、裁剪和路径，以及 IK、变换、路径、物理和滑块约束。
- **动画**：设置与动画模式、摄影表、带贝塞尔手柄的曲线编辑器、洋葱皮、姿势库、表情控制，以及角色之间的动画重定向。
- **影片工作区**：4K、时间码、可动画的摄像机、音轨、基于本地 Whisper 转写的视位口型同步，可渲染为 PNG 序列、带透明通道的 WebM 和 MP4。
- **场景组合**：多个角色作为演员同台，使用类似非线编的片段（裁剪、速度、循环、交叉淡入、各自的音频）、带视差的绘制图层和摄像机，并能通过所有运行时在游戏中播放。
- **保护你的工作**：不会留下写了一半的文件的安全保存、类似 Blender `.blend1` 的 `.rigby1` 备份、自动保存，以及在下次启动时找回未保存工作的崩溃恢复。
- **欢迎屏幕、自动更新和运行时下载**：启动时提供新建项目、最近工作、入门项目和课程；桌面版提供签名更新；通过 *文件 ▸ 获取运行时* 获取 Unity、Godot 和 Phaser 运行时。
- **偏好设置与插件**：语言（英语、日语、中文、韩语、西班牙语、葡萄牙语）、界面缩放、快捷键、撤销步数、备份和自动保存，以及在沙盒中运行的 Python 插件库。
- **从其他工具迁移**：可打开 Spine 导出文件（附迁移检查器）和 DragonBones 项目。
- **Python 脚本**与自定义工具，以及内置的 **MCP 服务器**，让 Claude 等 AI 助手检查、绑定你的项目并为其制作动画。
- **无损的骨骼 JSON（3.8、4.2、4.3）和二进制 `.skel`** 以及纹理图集，由 **JavaScript、Phaser、Rust、Unity 和 Godot 运行时**播放。
- 内置**教程**和演示项目（**NILA**、**Rigbytron** 以及二人同台的**场景**），也可在[演示页面](https://rigby2d.com/demos/)获取可用于游戏的导出文件（演示内容 © Rigby2D，适用其[演示许可](branding/DEMO-LICENSE.md)）。

## 开始使用

- **在浏览器中：**[打开编辑器](https://rigby2d.com/editor/)，无需安装。
- **Windows：**[下载便携版](https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D_x64_portable.exe)，或从 [Releases](https://github.com/jaisurya-dev-art/rigby2d/releases) 下载安装程序。
- **macOS：**[下载 .dmg](https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D_universal.dmg)（Apple 芯片和 Intel）。首次打开时右键 ▸ 打开（见[安装说明](https://rigby2d.com/docs/installation.html)）。
- **Linux：**[下载 AppImage](https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D_amd64.AppImage)，或从 [Releases](https://github.com/jaisurya-dev-art/rigby2d/releases) 下载 `.deb`。
- **AI 助手：**在 Claude Desktop 中安装 [Rigby2D-AI.mcpb](https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D-AI.mcpb)，或参阅 [MCP 指南](https://rigby2d.com/docs/mcp.html)。
- **从源码构建**（Node.js 20+ 和 [Tauri 前置条件](https://tauri.app/start/prerequisites/)）：

```bash
git clone https://github.com/jaisurya-dev-art/rigby2d.git
cd rigby2d
npm install
npm run dev        # 桌面版；浏览器版用 npm run web:dev，测试用 npm test
```

## 项目结构

```
src/core/       运行时：数据模型、骨骼 JSON/.skel 与图集读写、姿势计算、约束、播放
src/editor/     编辑器界面：视口、树、检查器、摄影表、曲线编辑器、导入导出、脚本
src/webgl/      运行时的参考 WebGL 渲染器
src/mcp/        面向 AI 助手的 Model Context Protocol 服务器
runtimes/       Rust、Godot、Unity 和 Phaser 运行时
addons/         官方插件
site/           网站与文档站点（GitHub Pages）
docs/           文档页面与图片
branding/       标志、图标、Rigbytron 和 NILA（专有，见 TRADEMARKS.md）
src-tauri/      原生桌面外壳
test/           node:test 测试
```

## 参与贡献

欢迎贡献！开发环境、代码风格和拉取请求流程请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）。

## 许可证

Rigby2D 的源代码可任选以下任一许可证使用：

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

© 2026 [jaisurya-dev-art](https://github.com/jaisurya-dev-art)。除非另有说明，你提交给 Rigby2D 的贡献将按上述两种许可证授权，不附加任何其他条款。编辑器为 Python 脚本附带了 Pyodide 和 CPython，适用其各自的许可证（见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。

## 商标

**Rigby2D**、**Rigbytron** 和 **NILA**，以及 [`branding/`](branding/) 中的 Rigby2D 标志、组合标、图标和 Rigbytron、NILA 吉祥物，均为 Rigby2D 项目的专有商标，不受 MIT 或 Apache 2.0 许可证覆盖。分支和修改版本必须使用自己的名称和品牌。详见 [TRADEMARKS.md](TRADEMARKS.md)。

## 免责声明

Rigby2D 是独立的开源项目，与任何其他动画软件的开发者均无关联，也未获其认可或赞助。所有商标归其各自所有者所有。对骨骼 JSON、二进制 `.skel` 和纹理图集格式的支持仅用于互操作，并以净室方式实现。详见[英文免责声明](README.md#disclaimer)。

<sub>本译文仅供参考。许可证、商标和免责声明以英文版（README.md）为准。</sub>
