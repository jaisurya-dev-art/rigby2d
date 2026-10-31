---
title: Built in the open: what the community added in Rigby2D's first weeks
date: 2026-10-31
time: 18:00
summary: Ten pull requests from one contributor, add-ons anyone can publish, the first reviews, and a DragonBones Raptor that copies its own walk.
image: /docs/images/devlog-community.jpg
tag: News
---

Rigby2D went public on 13 October. Eighteen days later, a good share of the editor you open today
was built by people who found the project, used it, and decided to make it better.

![DragonBones' Raptor in the Rigby2D editor: onion skin, copied keys and the paste preview](/docs/images/devlog-community.jpg)

*DragonBones' Raptor, opened straight from its DragonBones files. Onion skin shows the walk around
the current frame; the copied keys (green) wait to be pasted at the playhead (purple). Raptor art
© the DragonBones team, [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).*

## Ten pull requests in a week

[maruccimauro](https://github.com/maruccimauro) opened their first pull request on 23 October. A
week later, ten have been merged, each one something animators reach for every day:

- **Detachable panels**: float the Timeline, Tree or Inspector into its own window, on a second
  monitor if you have one, and **window layouts** to save and recall those arrangements.
- **[Onion skinning](/docs/onion-skin.html)**: ghosts of the frames before and after, tinted, with
  per-bone settings.
- **[Guides](/docs/guides.html)**: pixel rulers, guides you drag out of them, and live guides that
  trace a bone while you rotate or move it.
- **Shared bone highlight**: hover a bone in the viewport, the tree or the timeline, and it lights
  up in all three.
- **Draw order by drag**: pick up a slot and drop it where it should draw, with a preview.
- **Copy and paste keys**, merged today: select whole frame columns or several areas at once, see
  the paste before you make it, and choose Merge, Overwrite or Overwrite all.
- And a fix: edits made while the timeline was playing never marked the project as unsaved.

About 6,000 lines, every one reviewed and tested before it went in. Copy and paste is already in
the [browser editor](https://rigby2d.com/editor/), and comes to the desktop app with the next
release. Thank you, maruccimauro.

## Add-ons anyone can publish

Since 0.4.2, the [add-on marketplace](/addons/) lists Python add-ons that put new tools in the
Scripts menu: [Breathing idle](/addons/) makes a looping breath for any character in one click, and
Hierarchy select picks a bone's whole chain. Publishing one takes a GitHub repository and one
submission; the registry checks it automatically. [How to write one](/docs/addons.html).

## People are talking about it

- Alex Hitt made an [8-minute technical review](https://www.youtube.com/watch?v=K9hDnlXZ2No) of how
  Rigby2D works: AutoRig, the physics that match across engines, and the built-in MCP server.
- [Polydium](https://polydium.net/briefing/8df9db93-0abf-4032-bd88-acbdf95ec431) featured it in
  its daily briefing for Korean game and VFX studios.
- [Trendshift](https://trendshift.io/topics/game-engine), which ranks open-source projects by their
  GitHub activity, lists it among 2026's top game engine projects.

## DragonBones files open on the character

DragonBones files often list a character's weapons, muzzle flashes and bullets before the character
itself. Rigby2D used to open the first one, so some files came in as a lone bullet. Now it opens
the character, with its weapons and effects inside. The fix is live in the browser editor today.

## What comes next is up to you

The next few days are about listening. What gets built next comes from what people try, report and
ask: every [issue on GitHub](https://github.com/jaisurya-dev-art/rigby2d/issues) and every thread on
[r/rigby2d](https://www.reddit.com/r/rigby2d/) gets read and answered. The ten pull requests above
started the same way: someone using Rigby2D and wanting it to do more.

[Download Rigby2D](https://github.com/jaisurya-dev-art/rigby2d/releases/latest) or
[open it in your browser](https://rigby2d.com/editor/). [中文版本](/blog/built-in-the-open-zh.html).
