// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D: open-source 2D skeletal animation for games, films and interactive experiences.
// Copyright (c) 2026 jaisurya-dev-art and Rigby2D contributors

import { WORKSPACES, has } from './workspaces.js';
import { getCurrentWindow } from '@tauri-apps/api/window';

import './style.css';
import { App, Mode, saveSetting, saveShapes } from './app.js';
import { shortcutLabel, withShortcut } from './keymap.js';
import { icon } from './icons.js';
import { installKeyboard, isTyping, runAction } from './keys.js';
import { openRenderDialog } from './renderui.js';
import { openSpriteSheetDialog } from './spritesheetui.js';
import { openShareDialog } from './shareui.js';
import { installNudges } from './nudgeui.js';
import { openAutoRig, openRetarget } from './rigui.js';
import { startAudio, stopAudio } from './audio.js';
import { clipTracks } from './actors.js';
import { blockNativeContextMenu, desktopFile, isDesktop, launchFile, memoryFs, onFileDrop, openExternal } from './platform.js';
import * as edit from './edit.js';
import * as toolbar from './toolbar.js';
import * as tree from './tree.js';
import * as inspector from './inspector.js';
import { GraphEditor } from './graph.js';
import { Dopesheet, copySelectedKeys, cutSelectedKeys, deleteSelectedKeys, exitSelectModes, pasteKeys, renderControls } from './timeline.js';
import { Viewport } from './viewport.js';
import { closeMenu, h, isMenuOpen, popupMenu, submenuItem, widgetState } from './widgets.js';
import * as log from './log.js';
import { toggleLogWindow, windowOpen as logOpen } from './logwindow.js';
import { Scripts } from './scripting/scriptui.js';
import { createTutorials } from './tutorials/index.js';
import { openAiConnect } from './aiconnect.js';
import { installPanelSync } from './panelsync.js';
import { windowLayoutsMenuItem } from './layoutui.js';
import { openDemoPicker } from './demoui.js';
import { DEMOS } from './demos.js';
import { newScene } from './sceneui.js';
import { ago, clearRecentProjects, recentProjects, splitPath } from './recent.js';
import { LINKS, VERSION, openAbout, openShortcuts, openSupporters } from './helpui.js';
import { installRecovery } from './recoveryui.js';
import { applyInterfaceScale, openPreferences } from './prefsui.js';
import { AddonManager } from './addonui.js';
import { languageFor, setLanguage, t } from './i18n.js';
import { openRuntimes } from './runtimeui.js';
import { checkForUpdates, scheduleUpdateCheck, updateBadge } from './updateui.js';
import { openWelcome } from './welcomeui.js';
import { TOUR_RELEASE, openWhatsNew, shouldShowWhatsNew } from './whatsnewui.js';
import { COMMUNITY_URL, DEVLOG_URL } from './news.js';
import { openMigrationCheck } from './migrationui.js';
import markUrl from '../../branding/rigby2d-mark.svg?url';
import { startAnalytics } from './analytics.js';

// The desktop app has its own menus: no WebView right-click menu outside text fields.
blockNativeContextMenu({ dev: import.meta.env.DEV });

// Anonymous visit and feature counts, only on the public website's browser editor (analytics.js).
startAnalytics();

const app = new App();
// Errors anywhere in the editor, and status messages, go to the log (View ▸ Log).
log.installCapture(app);
// The interface language: the preference, or the system's.
const applyLanguage = () => setLanguage(app.prefs.get('interface.language') || languageFor(navigator.languages ?? [navigator.language]));
applyLanguage();
app.status = t(app.status); // set before the language was known
/** Static text in index.html, marked data-i18n (text) and data-i18n-title. */
const translateStatic = () => {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t((el.dataset.i18n ||= el.textContent));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t((el.dataset.i18nTitle ||= el.title));
};
translateStatic();
app.prefs.onChange((key) => {
  if (key === 'interface.language' || key === null) {
    applyLanguage();
    translateStatic();
    app.changed();
  }
});
const scripts = new Scripts(app);
const recovery = installRecovery(app);
const addons = new AddonManager(app, scripts);
scripts.afterStop = () => addons.loadEnabled();
const showPreferences = (page) => openPreferences(app, addons, page);
// The launch tour of this release (Help ▸ What's new, and What's new on the welcome screen).
const whatsNew = () => openWhatsNew(app, { showPreferences });
applyInterfaceScale(app);
const inTauri = '__TAURI_INTERNALS__' in window;
const $ = (sel) => document.querySelector(sel);

// Detaching panels into their own OS windows, syncing them and the saved window layouts all live
// in panelsync.js (it was growing here). `sync` is created once the viewport exists (below).
let sync = null;

// ---- menu bar ---------------------------------------------------------------------------------

const sc = (action) => shortcutLabel(app.keymap, action);

function zoomActual() {
  app.view.panX *= 1 / app.view.zoom;
  app.view.panY *= 1 / app.view.zoom;
  app.view.zoom = 1;
  app.changed();
}

function menus() {
  return {
    // Grouped so the menu stays short as features grow: New, Import and Export open submenus.
    File: [
      submenuItem(t('New'), [
        { label: t('Game project'), action: () => app.newDocument('game') },
        { label: t('Film project'), action: () => app.newDocument('film') },
        { label: t('Scene (several characters)'), action: () => newScene(app) },
      ]),
      { label: t('Open…'), shortcut: 'Ctrl+O', title: t('Open a .rigby work file, or import a skeleton .json / .skel'), action: () => app.openDialog() },
      submenuItem(t('Open recent'), recentItems),
      submenuItem(t('Recover'), () => recovery.menu(), { title: t('Unsaved work kept by auto-save, or discarded at the last quit') }),
      { label: t('Open demo…'), action: () => openDemoPicker(app) },
      'separator',
      { label: t('Save'), shortcut: t('Ctrl+S'), action: () => app.save(false) },
      { label: t('Save as…'), shortcut: t('Ctrl+Shift+S'), action: () => app.save(true) },
      'separator',
      submenuItem(t('Import'), [
        { label: t('PSD…'), action: () => app.importPsd() },
        { label: t('SVG…'), title: t('An Inkscape, Affinity or Illustrator drawing: each layer becomes a part, placed where it was drawn'), action: () => app.importSvg() },
        { label: t('PNG images…'), action: () => app.importImages() },
        ...(has(app, 'audio') ? [{ label: t('Audio…'), action: () => app.importAudio() }] : []),
        'separator',
        { label: t('Check a skeleton file…'), title: t('What a skeleton .json or .skel holds, and how it carries over to Rigby2D'), action: () => openMigrationCheck(app) },
      ]),
      { label: t('AutoRig artwork…'), action: () => openAutoRig(app) },
      { label: t('Retarget animations…'), title: t('Copy animations from another character onto this one'), action: () => openRetarget(app) },
      'separator',
      // Film renders video; skeleton exports (for game engines) are in both workspaces.
      ...(has(app, 'render') ? [{ label: t('Render animation…'), title: t('PNG sequence, WebM or MP4'), action: () => openRenderDialog(app) }] : []),
      { label: t('Share to Discord…'), title: t('Render a GIF or MP4 and post it to the community'), action: () => openShareDialog(app) },
      submenuItem(t('Export'), [
        { label: t('JSON + atlas…'), shortcut: t('Ctrl+E'), action: () => app.exportSkeletonJson(app.saveVersion()) },
        { label: t('Binary .skel + atlas (4.3)…'), action: () => app.exportSkeletonBinary() },
        ...(app.doc.scene ? [] : [{ label: t('Sprite sheet…'), title: t('Animations as frames: a packed sheet with JSON, a Defold atlas, or PNG frames'), action: () => openSpriteSheetDialog(app) }]),
        'separator',
        { label: t('JSON format 3.8…'), action: () => app.exportSkeletonJson('3.8') },
        { label: t('JSON format 4.2…'), action: () => app.exportSkeletonJson('4.2') },
        { label: t('JSON format 4.3…'), action: () => app.exportSkeletonJson('4.3') },
        ...(app.doc.scene ? ['separator', { label: t('Scene for runtimes…'), title: t('The stage, every character and their clips, for the JavaScript, Rust and Godot runtimes'), action: () => app.exportScene() }] : []),
      ]),
      { label: t('Get runtimes…'), title: t('Unity, Godot, Defold, Cocos Creator, Phaser, JavaScript and Rust runtimes for this version'), action: () => openRuntimes(app) },
      'separator',
      { label: t('Quit'), action: () => (inTauri ? getCurrentWindow().close() : window.close()) },
    ],
    Edit: [
      { label: t('Undo'), shortcut: sc('edit.undo'), disabled: !app.history.undo.length, action: () => app.undo() },
      { label: t('Redo'), shortcut: sc('edit.redo'), disabled: !app.history.redo.length, action: () => app.redo() },
      'separator',
      { label: t('Key changed properties'), shortcut: sc('key.changed'), action: () => edit.keyChanged(app) },
      { label: t("Key the current tool's property"), shortcut: sc('key.tool'), action: () => edit.keyTool(app) },
      { label: t('Key all transforms of the selection'), shortcut: sc('key.transforms'), action: () => edit.keyTransforms(app) },
      { label: t('Key everything shown'), shortcut: sc('key.shown'), action: () => edit.keyShown(app) },
      'separator',
      { label: t('Cut keys'), shortcut: sc('edit.cutKeys'), disabled: !app.selectedKeys.size, action: () => cutSelectedKeys(app) },
      { label: t('Copy keys'), shortcut: sc('edit.copyKeys'), disabled: !app.selectedKeys.size, action: () => copySelectedKeys(app) },
      { label: t('Paste keys'), shortcut: sc('edit.pasteKeys'), action: () => pasteKeys(app) },
      'separator',
      { label: t('Deselect'), shortcut: sc('select.none'), action: () => app.deselect() },
      { label: t('Delete selection'), shortcut: sc('edit.delete'), action: () => edit.deleteSelection(app) },
      'separator',
      { label: t('Preferences…'), shortcut: sc('app.preferences'), action: () => showPreferences() },
    ],
    View: [
      h(
        'label',
        { class: 'item' },
        h('input', {
          type: 'checkbox',
          checked: app.showBones,
          onchange: (e) => {
            app.showBones = e.target.checked;
            app.changed();
          },
        }),
        ` ${t('Show bones')}`,
      ),
      // Attachment shapes over the art, one switch per kind (remembered between sessions).
      ...[
        ['clipping', t('Show clipping masks')],
        ['boundingbox', t('Show bounding boxes')],
        ['path', t('Show paths')],
        ['point', t('Show points')],
      ].map(([kind, label]) =>
        h(
          'label',
          { class: 'item' },
          h('input', {
            type: 'checkbox',
            checked: app.showShapes[kind],
            onchange: (e) => {
              app.showShapes[kind] = e.target.checked;
              saveShapes(app.showShapes);
              app.changed();
            },
          }),
          ` ${label}`,
        ),
      ),
      has(app, 'outputFrame') &&
      h(
        'label',
        { class: 'item' },
        h('input', {
          type: 'checkbox',
          checked: app.showFrame,
          onchange: (e) => {
            app.showFrame = e.target.checked;
            app.changed();
          },
        }),
        ` ${t('Show output frame')}`,
      ),
      h(
        'label',
        { class: 'item', title: t('Off: the timeline hides in Setup mode, so the viewport gets its room') },
        h('input', {
          type: 'checkbox',
          checked: app.timelineInSetup,
          onchange: (e) => {
            app.timelineInSetup = e.target.checked;
            saveSetting('rigby.view.timelineInSetup', app.timelineInSetup ? '1' : '0');
            app.changed();
          },
        }),
        ` ${t('Timeline in Setup mode')}`,
      ),
      {
        label: `${app.hideOverlays ? '● ' : '○ '}${t('Hide overlays')}`,
        shortcut: sc('view.overlays'),
        title: t('Hides bones, shapes, selection outlines and guides at once, to watch the animation as it renders'),
        action: () => {
          app.hideOverlays = !app.hideOverlays;
          app.changed();
        },
      },
      { label: logOpen() ? t('Hide log') : t('Log'), action: () => toggleLogWindow() },
      // Save and recall where the detached panels sit (desktop only; panels pop out only there).
      ...(inTauri && sync ? [windowLayoutsMenuItem({ app, sync })] : []),
      'separator',
      { label: t('Fit the skeleton in view'), shortcut: sc('view.fit'), action: () => (app.frameRequest = true) },
      { label: t('Zoom to 100%'), shortcut: sc('view.actual'), action: () => zoomActual() },
      // The renderer and the shortcut preset are in Preferences (Interface, Keyboard).
    ],
    Scripts: scripts.menu(),
    Help: [
      // Four groups: what's new, learning, the community and problems, then Rigby2D itself.
      { label: t("What's new in {version}…", { version: TOUR_RELEASE }), action: whatsNew },
      'separator',
      { label: t('Welcome screen…'), action: () => openWelcome(app, { tutorials, whatsNew }) },
      { label: t('Tutorials…'), action: () => tutorials.open() },
      { label: t('Keyboard shortcuts…'), action: () => openShortcuts(app) },
      { label: t('Documentation'), shortcut: '↗', action: () => openExternal(LINKS.docs) },
      { label: t('Connect an AI assistant…'), action: () => openAiConnect() },
      'separator',
      submenuItem(t('Community'), [
        { label: t('Discord'), shortcut: '↗', title: t('Show your work, get help, and hear about every release first.'), action: () => openExternal(COMMUNITY_URL) },
        { label: t('Devlog'), shortcut: '↗', title: t('Releases and news on rigby2d.com'), action: () => openExternal(DEVLOG_URL) },
        { label: t('Release notes'), shortcut: '↗', action: () => openExternal(LINKS.releaseNotes) },
      ]),
      submenuItem(t('Report a problem'), [
        { label: t('Report an issue'), shortcut: '↗', action: () => openExternal(LINKS.issues) },
        { label: t('Report a crash…'), title: t('A report of the recent errors, to copy or post'), action: () => recovery.openCrashReport() },
      ]),
      'separator',
      { label: t('Support Rigby2D…'), title: t('Rigby2D is free. Supporters pay for code signing and keep it moving.'), action: () => openSupporters() },
      ...(inTauri ? [{ label: t('Check for updates…'), action: () => checkForUpdates(app) }] : []),
      { label: t('About Rigby2D'), action: () => openAbout() },
    ],
  };
}

/**
 * File ▸ Open recent: projects opened or saved here, newest first. The browser cannot reopen a file
 * it was given once, so there only demos are listed.
 */
function recentItems() {
  const list = recentProjects().filter((e) => e.kind === 'demo' || isDesktop);
  if (!list.length) return [{ label: isDesktop ? t('No recent projects') : t('No recent demos'), disabled: true, action: () => {} }];
  const entry = (e) => {
    const { name, folder } = e.kind === 'file' ? splitPath(e.path) : { name: t('{name} demo', { name: e.name ?? e.id }), folder: t('Demo project') };
    return h(
      'button',
      {
        class: 'item recent',
        title: e.kind === 'file' ? e.path : null,
        onclick: () => {
          closeMenu();
          app.openRecent(e);
        },
      },
      h('span', { class: 'recent-text' }, h('span', { class: 'recent-name' }, name), h('span', { class: 'recent-folder' }, folder)),
      h('span', { class: 'shortcut' }, ago(e.time)),
    );
  };
  return [...list.map(entry), 'separator', { label: t('Clear recent projects'), action: () => clearRecentProjects() }];
}

let openTitle = null;

function showMenu(title, button) {
  const r = button.getBoundingClientRect();
  const menu = popupMenu(r.left, r.bottom + 2, menus()[title]);
  menu.classList.add('menubar-popup');
  openTitle = title;
  // The title stays highlighted while its menu is open.
  for (const b of document.querySelectorAll('#menubar .menu-title')) b.classList.toggle('open', b === button);
  const watch = new MutationObserver(() => {
    if (menu.isConnected) return;
    button.classList.remove('open');
    watch.disconnect();
  });
  watch.observe(document.body, { childList: true });
}

function buildMenuBar() {
  const bar = $('#menubar');
  const titles = Object.keys(menus()).map((title) => {
    const btn = h('button', { class: 'menu-title', 'data-tut': `menu:${title}`, 'data-title': title }, t(title));
    btn.addEventListener('click', () => {
      if (isMenuOpen() && openTitle === title) {
        closeMenu();
        openTitle = null;
      } else showMenu(title, btn);
    });
    btn.addEventListener('pointerenter', () => {
      if (isMenuOpen() && openTitle !== null && openTitle !== title) showMenu(title, btn);
    });
    return btn;
  });
  // Setup and Animate as two tabs; clicking the other one switches (Tab does too).
  const modeButton = (m) => h('button', { onclick: () => app.mode !== m && app.toggleMode() });
  const setupTab = modeButton(Mode.Setup);
  const animateTab = modeButton(Mode.Animate);
  const mode = h('span', { class: 'mode-switch', role: 'tablist' }, setupTab, animateTab);
  // Undo, redo, fit and the bones overlay, one click away (also in the Edit and View menus).
  const quick = (name, onclick) => h('button', { class: 'quick-btn', onclick }, icon(name, 16));
  const undoBtn = quick('undo-2', () => app.undo());
  const redoBtn = quick('redo-2', () => app.redo());
  const fitBtn = quick('scan', () => (app.frameRequest = true));
  const bonesBtn = quick('bone', () => {
    app.showBones = !app.showBones;
    app.changed();
  });
  const quickBar = h('span', { class: 'quick-actions' }, undoBtn, redoBtn, fitBtn, bonesBtn);
  // Notice that onion-skin predictions are on, with a menu to turn them off (hidden otherwise).
  const onionNotice = h(
    'button',
    {
      class: 'onion-notice',
      hidden: true,
      title: t('Onion-skin predictions are visible in the viewport — click for options'),
      onclick: (e) => {
        const r = e.target.getBoundingClientRect();
        popupMenu(r.left, r.bottom, [
          { label: t('Turn off all predictions'), action: () => { app.onion.enabled = false; app.changed(); } },
          app.onionOverrideCount() ? { label: t('Clear per-bone settings ({count})', { count: app.onionOverrideCount() }), action: () => { app.onion.perBone.clear(); app.changed(); } } : null,
        ].filter(Boolean));
      },
    },
    t('◉ Onion skin on'),
  );
  // Workspace switcher: which tools the editor shows for this project.
  const tabs = Object.values(WORKSPACES).map((ws) => h('button', { class: 'workspace-tab', 'data-tut': `workspace:${ws.id}`, title: t(ws.description), onclick: () => app.workspace !== ws.id && app.setWorkspace(ws.id) }, t(ws.label)));
  const switcher = h('div', { class: 'workspaces', 'data-tut': 'workspaces', role: 'tablist', title: t('Workspace') }, tabs);
  // In the browser: a way back to the website, and the open file's name (the desktop app shows it
  // in its own title bar).
  const home = inTauri
    ? null
    : h('a', { class: 'home-link', href: '../', title: t('Rigby2D website: home, documentation and downloads'), 'data-goatcounter-click': 'editor-home' }, h('img', { src: markUrl, alt: '', width: 18, height: 18 }), h('span', null, t('Rigby2D')));
  const docTitle = inTauri ? null : h('span', { class: 'doc-title' });
  bar.replaceChildren(
    ...[home, home && h('span', { class: 'vsep' }), ...titles, h('span', { class: 'vsep' }), mode, quickBar, onionNotice, h('span', { class: 'spacer' }), docTitle, docTitle && h('span', { class: 'spacer' }), updateBadge(app), switcher].filter(Boolean),
  );
  // Called every frame: touch the DOM only when something shown changed.
  let shown = '';
  let shownTitle = '';
  let shownLanguage = document.documentElement.lang;
  return () => {
    // Menu titles follow the interface language (Preferences ▸ General).
    if (document.documentElement.lang !== shownLanguage) {
      shownLanguage = document.documentElement.lang;
      for (const b of titles) b.textContent = t(b.dataset.title);
    }
    // Live states of the quick buttons (property writes only when they change).
    if (undoBtn.disabled !== !app.history.undo.length) undoBtn.disabled = !app.history.undo.length;
    if (redoBtn.disabled !== !app.history.redo.length) redoBtn.disabled = !app.history.redo.length;
    if (bonesBtn.classList.contains('on') !== app.showBones) {
      bonesBtn.classList.toggle('on', app.showBones);
      bonesBtn.setAttribute('aria-pressed', String(app.showBones));
    }
    // The notice follows the live onion state, independent of the cached menubar state below.
    onionNotice.hidden = !app.onionActive();
    if (docTitle) {
      const name = app.path ? app.path.split(/[\\/]/).pop() : `${app.doc.name && app.doc.name !== 'untitled' ? app.doc.name : t('untitled')} ${t('(not saved yet)')}`;
      const dirty = app.dirty();
      const text = `${name}${dirty ? ' ●' : ''}`;
      if (text !== shownTitle) {
        shownTitle = text;
        docTitle.textContent = text;
        docTitle.title = dirty ? t('{name}: unsaved changes (File ▸ Save, Ctrl+S)', { name }) : name;
        docTitle.classList.toggle('dirty', dirty);
      }
    }
    const state = `${app.mode}|${app.workspace}|${app.keymap}|${document.documentElement.lang}`;
    if (state === shown) return;
    shown = state;
    const tip = `${t('Switch Setup / Animate')}${sc('mode.toggle') ? ` (${sc('mode.toggle')})` : ''}`;
    undoBtn.title = withShortcut(t('Undo'), app.keymap, 'edit.undo');
    redoBtn.title = withShortcut(t('Redo'), app.keymap, 'edit.redo');
    fitBtn.title = withShortcut(t('Fit the skeleton in view'), app.keymap, 'view.fit');
    bonesBtn.title = withShortcut(t('Show or hide bones'), app.keymap, 'view.bones');
    for (const [tab, m, label] of [
      [setupTab, Mode.Setup, t('SETUP')],
      [animateTab, Mode.Animate, t('ANIMATE')],
    ]) {
      tab.textContent = label;
      tab.className = `mode ${m}${app.mode === m ? ' active' : ''}`;
      tab.title = tip;
      tab.setAttribute('aria-selected', String(app.mode === m));
      // The lessons point at the tab that switches modes: the one not active.
      if (app.mode === m) tab.removeAttribute('data-tut');
      else tab.setAttribute('data-tut', 'mode');
    }
    Object.keys(WORKSPACES).forEach((id, i) => {
      tabs[i].className = `workspace-tab${app.workspace === id ? ' active' : ''}`;
      tabs[i].setAttribute('aria-selected', String(app.workspace === id));
    });
  };
}

// ---- panel splitters --------------------------------------------------------------------------

// Drag a splitter to resize the panels on either side; double-click restores the default size.
// Sizes are remembered on this machine. `max()` keeps room for the panel on the other side.
function splitter(el, cssVar, axis, sign, min, max) {
  const root = document.documentElement;
  const key = `rigby.layout${cssVar}`;
  const fallback = getComputedStyle(root).getPropertyValue(cssVar).trim();
  const apply = (px) => root.style.setProperty(cssVar, `${Math.round(Math.max(min, Math.min(max(), px)))}px`);
  try {
    const saved = parseFloat(localStorage.getItem(key));
    if (Number.isFinite(saved)) apply(saved);
  } catch {
    // Storage disabled: default sizes.
  }
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const start = axis === 'x' ? e.clientX : e.clientY;
    const size = parseFloat(getComputedStyle(root).getPropertyValue(cssVar));
    const move = (ev) => apply(size + sign * ((axis === 'x' ? ev.clientX : ev.clientY) - start));
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try {
        localStorage.setItem(key, String(parseFloat(getComputedStyle(root).getPropertyValue(cssVar))));
      } catch {
        // Not remembered.
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', () => {
    root.style.setProperty(cssVar, fallback);
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing stored.
    }
  });
  el.title = t('Drag to resize · double-click to reset');
}

splitter($('#split-right'), '--right', 'x', -1, 220, () => window.innerWidth - 360);
splitter($('#split-tree'), '--tree', 'y', 1, 80, () => $('#side').clientHeight - 120);
splitter($('#split-bottom'), '--bottom', 'y', -1, 120, () => window.innerHeight - 220);

// ---- main loop --------------------------------------------------------------------------------

const viewport = new Viewport(app, $('#viewport'), $('#viewport-gl'));
app.viewport = viewport;
// Panel detaching / sync / window layouts, now that the viewport exists (shortcuts forwarded from a
// detached window run against the authoritative editor App, which owns the undo history).
sync = installPanelSync(app, {
  inTauri,
  appEl: $('#app'),
  runForwardedAction: (action) => runAction(app, action, { viewport, zoomActual, deleteSelectedKeys, closeMenu }),
});
const dopesheet = new Dopesheet(app, $('#dopesheet'), $('#dopesheet canvas'));
const graph = new GraphEditor(app, $('#graph'), $('#graph canvas'));
installKeyboard(app, { viewport, zoomActual, deleteSelectedKeys, copySelectedKeys, cutSelectedKeys, pasteKeys, exitSelectModes, closeMenu, isMenuOpen, openPreferences: () => showPreferences() });
const renderMenuBar = buildMenuBar();

// In the browser, leaving the page (the home link, closing the tab) asks first when there are unsaved
// changes; a page closed with unsaved work keeps its auto-save for File ▸ Recover. The desktop
// app asks Save / Don't save / Cancel when its window closes (File ▸ Quit too).
if (!inTauri) {
  window.addEventListener('beforeunload', (e) => {
    if (!app.dirty()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('pagehide', () => {
    if (!app.dirty()) recovery.endSession();
  });
} else {
  let closing = false;
  getCurrentWindow().onCloseRequested(async (e) => {
    e.preventDefault();
    if (closing) return;
    closing = true;
    try {
      if (!(await recovery.confirmQuit())) return;
      sync.closePanels();
      await getCurrentWindow().destroy();
    } finally {
      closing = false;
    }
  });
}
const tutorials = createTutorials(app, viewport, { refresh: () => renderNow() });

let pointersDown = 0;
let audioPlaying = false;
/** Element under the last press: its panel must not be rebuilt before the release, or the click is lost. */
let pressTarget = null;
window.addEventListener('pointerdown', (e) => {
  pointersDown++;
  pressTarget = e.target;
}, true);
window.addEventListener('pointerup', () => (pointersDown = Math.max(0, pointersDown - 1)), true);
window.addEventListener('pointercancel', () => (pointersDown = Math.max(0, pointersDown - 1)), true);
window.addEventListener('blur', () => (pointersDown = 0));

/** Panels are rebuilt when the app changes, except while the user is editing a field or pressing in them. */
/**
 * Panels are rebuilt when the app changes. While playing, the time moves every frame: panels that
 * show it (`every`: at most every that many ms) follow it; the others wait for a real change.
 */
const panels = [
  { el: $('#tree'), render: tree.render, built: -1 },
  { el: $('#properties .content'), render: inspector.render, built: -1, every: 200 },
  { el: $('#viewbar'), render: toolbar.render, built: -1 },
  { el: $('#controls'), render: renderControls, built: -1, every: 66 },
];

function editingIn(el) {
  const active = document.activeElement;
  // Keep a panel while a press inside it is held (playback otherwise rebuilds it every frame).
  if (pointersDown > 0 && pressTarget && el.contains(pressTarget)) return true;
  return widgetState.dragging || (active && el.contains(active) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName));
}

let lastFrame = performance.now();
let lastTitle = '';

let lastTime = 0;
let lastAnim = null;

/** Redraws everything at once (the tutorial arena uses it; the frame loop normally does this). */
function renderNow() {
  for (const p of panels) {
    p.built = app.version;
    p.builtTime = app.timeVersion;
    p.render(app, p.el);
  }
  viewport.draw();
  renderMenuBar();
}

/** Sets an element's text only when it differs (the frame loop runs 60 times a second). */
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function frame(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  app.advancePlayback(dt);
  app.sanitize();
  // Audio tracks (Film) start with playback, and restart when the time jumps or loops.
  const jumped = app.playing && (!audioPlaying || app.anim !== lastAnim || app.time < lastTime || app.time - lastTime > 0.25);
  if (jumped && has(app, 'audio') && app.playDirection > 0) startAudio(app.doc, app.currentAnimation()?.name, app.time, clipTracks(app.doc, app.currentAnimation()?.name));
  if (!app.playing && audioPlaying) stopAudio();
  audioPlaying = app.playing && app.playDirection > 0;
  if (app.time !== lastTime || app.anim !== lastAnim) {
    if (!app.playing) app.discardPending(app.anim !== lastAnim ? 'animation changed' : 'time changed');
    lastTime = app.time;
    lastAnim = app.anim;
  }

  viewport.draw();
  // Setup mode hides the timeline (keys are made in Animate), unless kept on or a lesson runs.
  const hideTimeline = app.mode === Mode.Setup && !app.timelineInSetup && !tutorials.coach?.running;
  if ($('#app').classList.contains('setup-hides-timeline') !== hideTimeline) {
    $('#app').classList.toggle('setup-hides-timeline', hideTimeline);
    window.dispatchEvent(new Event('resize'));
  }
  const showGraph = app.timelineView === 'graph' && !!app.currentAnimation();
  $('#graph').hidden = !showGraph;
  if (showGraph) {
    $('#dopesheet').hidden = true;
    $('.dopesheet-wrap .empty').hidden = true;
    graph.draw();
  } else {
    dopesheet.draw();
  }
  for (const p of panels) {
    const changed = p.built !== app.version;
    const timeMoved = p.every && p.builtTime !== app.timeVersion && now - (p.builtAt ?? 0) >= p.every;
    if ((changed || timeMoved) && !editingIn(p.el)) {
      p.built = app.version;
      p.builtTime = app.timeVersion;
      p.builtAt = now;
      p.render(app, p.el);
    }
  }
  renderMenuBar();
  setText($('#status-text'), app.status);
  const errors = log.unreadErrors;
  const badge = $('#status-log');
  setText(badge, errors ? `⚠ ${t('{count} error(s)', { count: errors })}` : t('Log'));
  badge.classList.toggle('has-errors', errors > 0);
  setText($('#status-info'), `${t('{bones} bones · {slots} slots', { bones: app.doc.bones.length, slots: app.doc.slots.length })} · ${Math.round(app.view.zoom * 100)}%`);

  app.commitHistory(pointersDown > 0 || isTyping(document.activeElement));
  const title = app.title();
  if (title !== lastTitle) {
    lastTitle = title;
    document.title = title;
    if (inTauri) getCurrentWindow().setTitle(title).catch(() => {});
  }
  sync.syncPanels();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// The editor starts with an empty project (demos are under File > Open demo); new users are
// offered the tour once. A link such as editor/?demo=nila (the website's Demos page) opens that
// demo instead.
// Work from an editor that crashed is offered back first; otherwise the last project reopens when
// that preference is on, or the welcome screen shows (Preferences ▸ General). Then, on the desktop,
// quiet update checks (a found update shows in the menu bar).
const linkedDemo = new URLSearchParams(location.search).get('demo');
if (linkedDemo && DEMOS.some((d) => d.id === linkedDemo)) app.openDemo(linkedDemo, false);
else {
  recovery.offerRecovery().then(async (offered) => {
    if (offered) return;
    const launched = await launchFile();
    if (launched) return openDesktopPaths([launched]);
    const last = recentProjects()[0];
    if (inTauri && app.prefs.get('files.reopenLast') && last?.kind === 'file') await app.openRecent(last);
    else {
      // A new release opens with its tour (once), then the welcome screen as usual.
      const welcome = () => app.prefs.get('general.welcome') && openWelcome(app, { tutorials, whatsNew });
      if (shouldShowWhatsNew() || new URLSearchParams(location.search).has('whatsnew')) openWhatsNew(app, { showPreferences, onClose: welcome });
      else welcome();
    }
  });
}

// The window starts hidden while the splash screen plays; the splash opens it when done. Show it
// anyway if the splash never does.
if (inTauri) setTimeout(() => getCurrentWindow().maximize().catch(() => {}).finally(() => getCurrentWindow().show().catch(() => {})), 10000);

/**
 * Desktop: opens the project among files dropped on the window or passed at launch (a work file
 * first, then a .skel, a skeleton .json, a backup); its images are read from next to it.
 */
async function openDesktopPaths(paths) {
  const rank = (p) => [/\.rigby$/i, /\.skel$/i, /\.json$/i, /\.rigby\d$/i].findIndex((re) => re.test(p));
  const path = paths.filter((p) => rank(p) >= 0).sort((a, b) => rank(a) - rank(b))[0];
  if (!path) return app.setStatus(t('Nothing to open: drop a Rigby2D work file (.rigby) or a skeleton (.json or .skel).'));
  if (!(await app.confirmDiscard())) return;
  const file = desktopFile(path);
  await app.openFrom(file.path, file.fs);
}

// Desktop: drop a project on the window to open it (as File ▸ Open).
document.body.dataset.dropHint = isDesktop ? t('Drop to open') : t('Drop to open: a project with its images and atlas');
onFileDrop({ hover: (on) => document.body.classList.toggle('drop-open', on), drop: openDesktopPaths });

// Browser: drop a project with its images and atlas on the window to open it (as File ▸ Open).
if (!isDesktop) {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const hint = (on) => document.body.classList.toggle('drop-open', on);
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    hint(true);
  });
  window.addEventListener('dragleave', (e) => {
    if (hasFiles(e) && --depth <= 0) (depth = 0), hint(false);
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    hint(false);
    const files = [...e.dataTransfer.files];
    if (!files.length || !(await app.confirmDiscard())) return;
    await app.openFiles(files);
  });
}

// Development builds expose the editor for debugging from the console.
if (import.meta.env.DEV) window.rigby = { app, memoryFs, dopesheet, graph, viewport, scripts, log, tutorials, recovery, addons };

// Scripts in the library load in the background, adding their tools to the Scripts menu.
// Enabled add-ons too (Edit ▸ Preferences ▸ Add-ons).
if (scripts.library.length) setTimeout(() => scripts.loadAll({ quiet: true }), 1500);
setTimeout(() => addons.loadEnabled(), 1500);
scheduleUpdateCheck(app);
installNudges({ share: () => openShareDialog(app), star: () => openExternal(LINKS.repo), fund: () => openExternal(LINKS.fund) });

// The editor's version at the right of the status bar; it opens About.
$('#status-version').textContent = VERSION ? `v${VERSION}` : 'dev';
$('#status-version').addEventListener('click', () => openAbout());
$('#status-log').addEventListener('click', () => toggleLogWindow());
$('#status-community').addEventListener('click', () => openExternal(COMMUNITY_URL));

// Each panel pops out into its own window from the ⧉ button at its top-right (desktop only).
for (const btn of document.querySelectorAll('.panel-detach-btn')) {
  btn.hidden = !inTauri;
  btn.addEventListener('click', () => sync.detachPanel(btn.dataset.panel));
}
