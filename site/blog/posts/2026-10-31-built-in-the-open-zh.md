---
title: 开源共建：Rigby2D 头几周，社区带来了什么
date: 2026-10-31
time: 18:00
summary: 一位贡献者一周合并十个 PR、人人可发布的插件、第一批评测，以及会复制自己走路动画的 DragonBones 机甲。
image: /docs/images/devlog-community.jpg
tag: 新闻
lang: zh-CN
---

Rigby2D 于 10 月 13 日公开。十八天后，你今天打开的编辑器里，有相当一部分是由发现它、使用它、
并决定让它变得更好的开发者共同完成的。

![DragonBones 的机甲角色在 Rigby2D 编辑器中：洋葱皮、已复制的关键帧和粘贴预览](/docs/images/devlog-community.jpg)

*DragonBones 的 Raptor 机甲，直接从 DragonBones 文件打开。洋葱皮显示当前帧前后的走路姿势；
已复制的关键帧（绿色）等待粘贴到播放头处（紫色）。Raptor 美术 © DragonBones 团队，
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)。*

## 一周合并十个 PR

[maruccimauro](https://github.com/maruccimauro) 在 10 月 23 日提交了第一个 PR。一周后，已有十个
被合并，每一个都是动画师每天都会用到的功能：

- **可分离面板**：把时间轴、层级树或检查器拖成独立窗口，可以放到第二块屏幕上；
  **窗口布局**可以保存并一键恢复这些排布。
- **[洋葱皮](/docs/onion-skin.html)**：显示前后帧的半透明残影，可着色，并支持按骨骼单独设置。
- **[参考线](/docs/guides.html)**：像素标尺、从标尺拖出的参考线，以及旋转或移动骨骼时实时跟随的辅助线。
- **骨骼联动高亮**：在视口、层级树或时间轴中悬停一根骨骼，三处同时高亮。
- **拖拽调整绘制顺序**：拖动插槽放到想要的位置，并带预览。
- **关键帧复制粘贴**（今天合并）：可选择整列帧或同时选择多个区域，粘贴前即可预览，
  并可选择合并、覆盖或全部覆盖。
- 另有一个修复：播放时间轴时所做的修改，以前不会把项目标记为未保存。

约 6000 行代码，每一行都经过审查和测试。复制粘贴已经可以在
[浏览器编辑器](https://rigby2d.com/editor/) 中使用，桌面版将在下一个版本中提供。感谢 maruccimauro。

## 人人都能发布插件

从 0.4.2 开始，[插件市场](/addons/) 收录用 Python 编写、添加到 Scripts 菜单的插件：
[Breathing idle](/addons/) 一键为任意角色生成循环呼吸动画，Hierarchy select 可以选中骨骼的整条链。
发布插件只需一个 GitHub 仓库和一次提交，注册表会自动检查。[如何编写插件](/docs/addons.html)。

## 来自外部的关注

- Alex Hitt 发布了一期 [8 分钟的技术评测](https://www.youtube.com/watch?v=K9hDnlXZ2No)，
  讲解 AutoRig、跨引擎一致的物理，以及内置的 MCP 服务器。
- [Polydium](https://polydium.net/briefing/8df9db93-0abf-4032-bd88-acbdf95ec431) 在面向韩国游戏和
  特效工作室的每日简报中介绍了 Rigby2D。
- 按 GitHub 活跃度为开源项目排名的 [Trendshift](https://trendshift.io/topics/game-engine)，
  将它列入 2026 年热门游戏引擎项目。

## DragonBones 文件直接打开角色

DragonBones 文件常常把角色的武器、枪口火焰和子弹排在角色本身之前。Rigby2D 以前会打开排在第一位的骨架，
所以有些文件打开后只有一颗子弹。现在会直接打开角色，武器和特效都在其中。修复今天已在浏览器编辑器中上线。

## 接下来做什么，由你决定

接下来几天，我们会专心倾听。下一步做什么，取决于大家的试用、反馈和提问：
[GitHub 上的每一个 issue](https://github.com/jaisurya-dev-art/rigby2d/issues)（欢迎用中文）
和 [r/rigby2d](https://www.reddit.com/r/rigby2d/) 上的每一个帖子都会被阅读和回复。
上面这十个 PR 也是这样开始的：有人在用 Rigby2D，并希望它能做得更多。

[下载 Rigby2D](https://github.com/jaisurya-dev-art/rigby2d/releases/latest)，或
[在浏览器中打开](https://rigby2d.com/editor/)（界面支持简体中文）。[English](/blog/built-in-the-open.html)
