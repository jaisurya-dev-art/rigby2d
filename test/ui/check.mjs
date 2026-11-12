// SPDX-License-Identifier: MIT OR Apache-2.0
// Interface check: opens every main-window state, panel and dialog of the editor in a real browser,
// at laptop sizes (1280 x 720, 1440 x 900) and a desktop size (1920 x 1080), in English and Simplified
// Chinese, and fails on page errors, toolbars that overflow, dialogs larger than the window and text
// cut off by its box. It also lists visible English words left in the Chinese interface. A
// screenshot of every case lands in test/ui/shots/ for review.
//
// Needs the dev server (npm run web:dev) and Chromium for Playwright (npx playwright install chromium):
//   npm run ui:check            every case
//   npm run ui:check -- dialog  only cases whose name contains "dialog"

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const URL_ = process.env.RIGBY_URL ?? 'http://localhost:1420/';
const shots = fileURLToPath(new URL('./shots/', import.meta.url));
fs.mkdirSync(shots, { recursive: true });
const filter = process.argv[2] ?? '';

const SIZES = [
  ['laptop', 1280, 720],
  ['notebook', 1440, 900],
  ['desktop', 1920, 1080],
];
const LANGUAGES = ['en', 'zh-CN'];

/** Words allowed in English inside the Chinese interface: names, formats and units. */
const ENGLISH_OK = /^(Rigby2D|NILA|Rigbytron|Spine|DragonBones|Defold|Godot|Unity|Cocos|Creator|Phaser|PixiJS|Rust|JavaScript|Python|Claude|Desktop|Code|Discord|GitHub|Whisper|ElevenLabs|Rhubarb|Papagayo|PSD|SVG|PNG|GIF|MP4|WebM|JSON|JPEG|WAV|IK|AutoRig|FPS|fps|px|ms|MB|KB|GB|UI|AI|GPU|CPU|PNGs|Ctrl|Shift|Alt|Esc|Tab|Enter|Space|Delete|Home|End|OK|x|y|a|default|root|untitled|nila|rigby|skel|atlas|zip|mcpb|py|wave|idle|promo|hip|head|torso|pelvis|chest|neck|blush|bindi|hair|eye|NILA_layers|beta|Public|Film|Game|SETUP|ANIMATE|Log|Phaser|HD|Full|K|UHD|Bezier|MIT|Apache|v\d.*)$/i;

/** The cases: a name and what to do in the page (it gets window.rigby). */
const CASES = [
  ['main-empty', async () => {}],
  ['main-nila-project', async (r) => {
    await r.app.openDemo('nila', false);
    r.app.mode = 'setup';
    r.app.deselect();
  }],
  ['main-nila-bone', async (r) => {
    r.app.mode = 'setup';
    r.app.select({ bone: r.app.doc.boneIndex('head') });
  }],
  ['main-nila-slot', async (r) => {
    const s = r.app.doc.slots.findIndex((x, i) => r.app.doc.attachment(i, x.attachment)?.type === 'region');
    r.app.select({ slot: s });
  }],
  ['main-nila-animate', async (r) => {
    r.app.mode = 'animate';
    r.app.select({ bone: r.app.doc.boneIndex('forearm_r') ?? 3 });
  }],
  ['main-nila-mesh', async (r) => {
    r.app.mode = 'setup';
    const s = r.app.doc.slots.findIndex((x, i) => r.app.doc.attachment(i, x.attachment)?.type === 'mesh');
    r.app.select({ slot: s });
    r.app.meshEdit = { slot: s, name: r.app.doc.slots[s].attachment, mode: 'vertices', radius: 40, strength: 0.5, subtract: false, selected: null };
  }],
  ['main-nila-film', async (r) => {
    r.app.meshEdit = null;
    r.app.setWorkspace?.('film');
    r.app.deselect();
  }],
  // The dock: tree and inspector sharing one space as tabs, then panels moved to other regions.
  ['main-dock-tabbed', async (r) => {
    r.app.setWorkspace?.('game');
    r.app.mode = 'animate';
    r.dock.reset();
    r.dock.set((await import('/src/editor/docklayout.js')).movePanel(r.dock.get(), 'inspector', { region: 'right', group: 0, where: 'tab' }));
  }],
  ['main-dock-moved', async (r) => {
    const { movePanel } = await import('/src/editor/docklayout.js');
    let l = r.dock.get();
    l = movePanel(l, 'tree', { region: 'left', where: 'new' });
    l = movePanel(l, 'inspector', { region: 'bottom', group: 0, where: 'after' });
    r.dock.set(l);
  }],
  // The "Rig on the left" preset: skins, constraints by type, meshes, events and the project settings
  // in the Rig panel; the tree keeps the bones and the lists. Then scrolled down to the project block.
  ['main-dock-rig-left', async (r) => {
    await r.app.openDemo('nila', false);
    r.app.mode = 'setup';
    r.app.deselect();
    r.dock.set((await import('/src/editor/docklayout.js')).rigLeftDock());
  }],
  ['main-dock-rig-project', async (r) => {
    const s = document.querySelector('#rig .tree-scroll');
    s.scrollTop = s.scrollHeight;
  }],
  ['main-dock-reset', async (r) => {
    r.dock.reset();
    r.app.mode = 'setup';
  }],
  ['dialog-preferences', async () => (await import('/src/editor/prefsui.js')).openPreferences?.(window.rigby.app)],
  ['dialog-shortcuts', async (r) => (await import('/src/editor/helpui.js')).openShortcuts(r.app)],
  ['dialog-about', async () => (await import('/src/editor/helpui.js')).openAbout()],
  ['dialog-support', async () => (await import('/src/editor/helpui.js')).openSupporters?.()],
  ['dialog-runtimes', async (r) => (await import('/src/editor/runtimeui.js')).openRuntimes(r.app)],
  ['dialog-welcome', async (r) => (await import('/src/editor/welcomeui.js')).openWelcome(r.app, {})],
  ['dialog-tutorials', async (r) => r.tutorials.open()],
  ['dialog-ai', async () => (await import('/src/editor/aiconnect.js')).openAiConnect()],
  ['dialog-demo', async (r) => (await import('/src/editor/demoui.js')).openDemoPicker(r.app)],
  ['dialog-autorig', async (r) => (await import('/src/editor/rigui.js')).openAutoRig(r.app)],
  ['dialog-sprite-sheet', async (r) => (await import('/src/editor/spritesheetui.js')).openSpriteSheetDialog(r.app)],
  ['dialog-render', async (r) => (await import('/src/editor/renderui.js')).openRenderDialog(r.app)],
  ['dialog-share', async (r) => (await import('/src/editor/shareui.js')).openShareDialog(r.app)],
  ['dialog-result', async (r) => (await import('/src/editor/resultui.js')).showResult(r.app, { ok: true, title: 'Sprite sheet exported', detail: 'A 2048×1024 sheet of 61 frames.', path: 'C:/projects/nila/nila.png' })],
  ['dialog-choice', async () => {
    (await import('/src/editor/helpui.js')).askChoice('Save changes?', 'Your changes are lost if you do not save them.', [{ id: 'save', label: 'Save', primary: true }, { id: 'no', label: "Don't save" }, { id: 'cancel', label: 'Cancel' }]);
  }],
];

const browser = await chromium.launch();
const failures = [];
const english = new Map();
let count = 0;
for (const lang of LANGUAGES) {
  for (const [sizeName, width, height] of SIZES) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((code) => {
      try {
        localStorage.setItem('rigby.welcomed.v2', '1');
        localStorage.setItem('rigby2d.whatsnew.seen', '9');
        localStorage.setItem('rigby.prefs', JSON.stringify({ 'interface.language': code, 'general.welcome': false }));
      } catch {}
    }, lang);
    await page.goto(URL_);
    await page.waitForFunction(() => window.rigby?.app);
    await page.waitForTimeout(1200);
    await page.evaluate(async (code) => {
      const i18n = await import('/src/editor/i18n.js');
      i18n.setLanguage(code);
      document.querySelectorAll('.modal-backdrop, .wn-backdrop, .wn-sheet').forEach((e) => e.remove());
      window.rigby.app.changed();
    }, lang);
    for (const [name, action] of CASES) {
      if (filter && !name.includes(filter)) continue;
      const id = `${lang}-${sizeName}-${name}`;
      errors.length = 0;
      await page.evaluate(() => document.querySelectorAll('.modal-backdrop, .popup').forEach((e) => e.remove()));
      try {
        await page.evaluate(`(${action})(window.rigby)`);
      } catch (e) {
        failures.push(`${id}: could not open (${e.message.split('\n')[0]})`);
        continue;
      }
      await page.evaluate(() => window.rigby.app.changed());
      await page.waitForTimeout(name.startsWith('main-nila-project') ? 2500 : 600);
      const found = await page.evaluate(() => {
        const out = [];
        const vw = innerWidth;
        const vh = innerHeight;
        for (const sel of ['#viewbar', '#controls']) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent && el.scrollWidth > el.clientWidth + 1) out.push(`${sel} overflows (${el.scrollWidth} > ${el.clientWidth})`);
        }
        const dialog = [...document.querySelectorAll('.modal-backdrop .modal')].pop();
        if (dialog) {
          const r = dialog.getBoundingClientRect();
          if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) out.push(`dialog outside the window (${Math.round(r.width)}x${Math.round(r.height)})`);
        }
        // Text cut off: a box that hides overflowing content it cannot scroll.
        const scope = dialog ?? document;
        for (const el of scope.querySelectorAll('button, label, .row-name, .ui-field-label, .tool-label, h2, h3, h4, strong, .dialog-sub')) {
          if (!el.offsetParent || el.closest('.scroll, .tree-scroll, .checklist, .layout-list')) continue;
          const cs = getComputedStyle(el);
          if (cs.overflow === 'visible' || cs.textOverflow === 'ellipsis') continue;
          if (el.scrollWidth > el.clientWidth + 2) out.push(`text cut off: "${el.textContent.trim().slice(0, 40)}"`);
        }
        // Visible words in Latin letters (for the Chinese check).
        const words = [];
        const walker = document.createTreeWalker(scope === document ? document.body : scope, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const n = walker.currentNode;
          const p = n.parentElement;
          if (!p || !p.offsetParent || p.closest('script, style, textarea, input, select, canvas, .mono, pre, code, .row-name, .time-readout, .dopesheet-wrap')) continue;
          for (const w of n.textContent.match(/[A-Za-z][A-Za-z']{2,}/g) ?? []) words.push(w);
        }
        return { out, words };
      });
      // Keyboard: Tab stays in the dialog with a visible focus ring, and Escape closes it.
      if (name.startsWith('dialog-')) {
        await page.screenshot({ path: `${shots}${id}.png` });
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press('Tab');
          const where = await page.evaluate(() => {
            const d = [...document.querySelectorAll('.modal-backdrop .modal')].pop();
            const a = document.activeElement;
            return { inside: !!d && d.contains(a), ring: a ? getComputedStyle(a).outlineStyle !== 'none' || getComputedStyle(a).boxShadow !== 'none' : false, what: a?.textContent?.trim().slice(0, 30) || a?.tagName };
          });
          if (!where.inside) {
            found.out.push(`Tab left the dialog (at ${where.what})`);
            break;
          }
          if (!where.ring) {
            found.out.push(`no visible focus on "${where.what}"`);
            break;
          }
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        if (await page.evaluate(() => !!document.querySelector('.modal-backdrop'))) found.out.push('Escape did not close it');
      }
      for (const f of found.out) failures.push(`${id}: ${f}`);
      for (const e of errors) failures.push(`${id}: page error: ${e}`);
      if (lang !== 'en') for (const w of found.words) if (!ENGLISH_OK.test(w)) english.set(w, (english.get(w) ?? new Set()).add(name));
      if (!name.startsWith('dialog-')) await page.screenshot({ path: `${shots}${id}.png` });
      count++;
    }
    await page.close();
  }
}
await browser.close();
console.log(`${count} cases checked, screenshots in test/ui/shots/`);
if (english.size) {
  console.log(`\nEnglish words visible in the Chinese interface (${english.size}):`);
  for (const [w, where] of [...english].sort()) console.log(`  ${w}  (${[...where].slice(0, 3).join(', ')})`);
}
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log('\nNo problems.');
