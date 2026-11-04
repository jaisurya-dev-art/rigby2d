---
title: 七个运行时，同一个答案
date: 2026-11-04
time: 18:00
summary: 用 Rigby2D 做的动画，如何在 Unity、Godot、Defold、Cocos Creator、Phaser、JavaScript 和 Rust 中播放得一模一样：一个参考运行时，每个移植版本都逐帧与它比对。
image: /docs/images/devlog-runtimes.jpg
tag: 幕后
lang: zh-CN
---

动画在哪里发布，都应该看起来一样。你在编辑器里摆好的手臂，在 Unity 里应该以同样的方式弯曲；辫子在
Godot 里应该以同样的方式摆动；网格在 Defold 里应该以同样的方式变形。在大多数工具链里，每个引擎的运行时
各自编写，细小的差异就会悄悄出现：IK 链最后停的位置略有不同，物理在几秒后开始漂移，带权重的网格偏了半个
像素。于是就有了"在编辑器里明明是对的"。下面讲讲 Rigby2D 如何让七个运行时给出同一个答案。
[English](/blog/seven-runtimes-one-answer.html)。

## 一个参考

Rigby2D 动画如何播放，只有一个定义：[`src/core`](https://github.com/jaisurya-dev-art/rigby2d/tree/develop/src/core)
里的 JavaScript 运行时。编辑器给你显示动画用的，就是这份代码。其余的运行时，要么*就是*这份代码，要么都要
与它比对。

| 引擎 | 播放你的动画的是 | 如何检查 |
| --- | --- | --- |
| Phaser | JavaScript 运行时本身 | 它就是参考 |
| Cocos Creator | JavaScript 运行时本身 | 它就是参考 |
| JavaScript（任何 Web 引擎） | JavaScript 运行时本身 | 它就是参考 |
| Rust | 它的移植版本 | 黄金文件，每次推送都检查 |
| Defold | C++ 移植版本 | 同一批黄金文件，每次推送都检查 |
| Godot | Rust 移植版本（GDExtension） | 通过 Rust 的黄金文件，外加节点的无界面测试 |
| Unity | C# 移植版本（`Rigby2D.Core`） | 黄金文件，每次发布前检查 |

## 黄金文件

黄金文件是一份录制。一个脚本用 JavaScript 运行时把骨架按固定场景播放一遍（每个动画循环播放、带分层轨道
和排队动画的淡入淡出、每套皮肤），并逐帧记录它产生的一切：

- 每根骨骼的世界变换，
- 所有绘制内容的每个顶点和颜色，
- 绘制顺序，
- 每个事件，以及它触发的准确时间。

每个移植版本随后用同样的场景播放同一个骨架，把自己的数值与录制逐一比较。不是截图对比（模糊一个像素也能
通过），而是实际的数值。

## 差一百万分之一，构建就失败

每个移植版本都必须满足的规则：位置和变换的相对误差不超过百万分之一（1e-6），颜色和时间不超过十亿分之一
（1e-9）。任何一帧超出，测试就失败。

实际上各个移植版本比这接近得多。在 16 个示例骨架上（同时导出为 JSON 和二进制 `.skel`，约 3,500 帧，
涵盖物理、路径、变换和滑块约束、网格、皮肤、裁剪和图像序列），Rust 运行时的每个数值都在 1e-10 以内一致。
带有 NILA 头发物理和视差舞台的演示场景在 1e-11 以内一致。到了这个精度，差别只是 64 位数字最后几位的舍入。

## 每个演示，每次推送

仓库里签入的黄金文件只是开始。每次推送，CI 都会从仓库中每个演示骨架（两种格式）导出黄金数据，并用 Rust
和 C++ 运行时逐一比对。如果 JavaScript 运行时改了而某个移植版本没跟上，当天构建就会变红。Unity 移植版本
用 Unity 自带的 .NET 运行同一批黄金测试；Godot 插件则以无界面方式，对照 JavaScript 运行时的结果进行测试：
整个动画过程中的骨骼变换、事件和完成的时间、轨道和队列，以及演示场景的一整个镜头。

## 为什么重要

这就是这里所说的"可用于生产"。[Godot 运行时结束预览](/blog/defold-and-sprite-sheets-zh.html)、
[Defold 运行时加入](/blog/defold-and-sprite-sheets-zh.html)，都不是靠一张"看起来没问题"的截图，而是和其他
每个运行时一样，通过了同样的录制比对。

这也意味着速度不以正确性为代价。Rust 运行时驱动一个有 143 根骨骼、21 个约束的骨架，速度约为 JavaScript
的四倍，结果仍然精确到小数点后十位。

## 自己验证

一切都在仓库里。录制你自己的骨架并比对：

```bash
node runtimes/rust/rigby-runtime/tests/golden/generate.mjs /tmp/golden/hero.golden.json path/to/hero.skel
RIGBY_GOLDEN_DIR=/tmp/golden cargo test --release -p rigby-runtime --test golden
```

细节（包括每个骨架的速度）见
[runtimes/README.md](https://github.com/jaisurya-dev-art/rigby2d/blob/develop/runtimes/README.md)，
所有运行时都在 [rigby2d.com/runtimes](/runtimes/)。

Rigby2D 0.5 将于周五发布，包含 Defold 运行时。对这些有疑问？在下方留言，或到
[r/rigby2d](https://www.reddit.com/r/rigby2d/) 提问。
