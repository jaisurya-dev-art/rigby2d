// SPDX-License-Identifier: MIT OR Apache-2.0
// File ▸ Get runtimes: every engine runtime, downloaded straight from the release that matches
// this editor (so exports and runtimes always agree), or installed into a Godot project.

import { LINKS, VERSION, dialog } from './helpui.js';
import { t } from './i18n.js';
import { engineIcon, icon } from './icons.js';
import { fetchBytes, isDesktop, openExternal, pickFolder, saveDownload, writeFilesTo } from './platform.js';
import { h } from './widgets.js';
import { unzip } from './zip.js';

/** The release this editor belongs to (the latest release for development builds). */
const release = (file) => (VERSION ? `${LINKS.repo}/releases/download/v${VERSION}/${file}` : `${LINKS.repo}/releases/latest/download/${file}`);
const V = VERSION || 'latest';

/** The Godot library for the computer the editor runs on. */
function godotPlatform() {
  const p = `${navigator.userAgentData?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent}`.toLowerCase();
  if (p.includes('mac')) return 'macos';
  if (p.includes('linux') && !p.includes('android')) return 'linux-x64';
  return 'windows-x64';
}

const PLATFORM_NAMES = { 'windows-x64': 'Windows', macos: 'macOS', 'linux-x64': 'Linux' };
const UNITY_GIT = `${LINKS.repo}.git?path=/runtimes/unity/com.rigby2d.unity${VERSION ? `#v${VERSION}` : ''}`;
const docs = (path) => `${LINKS.repo}/blob/develop/${path}`;

export function openRuntimes(app) {
  const { body } = dialog('runtimes-dialog', t('Get runtimes'), t('Play your exports in games and apps. These runtimes match this editor ({version}).', { version: VERSION || 'dev' }));
  const status = (text) => app.setStatus(text);

  /** Runs `fn` with the button showing progress. */
  const busy = (button, fn) => async () => {
    button.disabled = true;
    button.classList.add('busy');
    try {
      await fn();
    } finally {
      button.disabled = false;
      button.classList.remove('busy');
    }
  };

  const download = async (file) => {
    try {
      status(t('Downloading {file}…', { file }));
      const saved = await saveDownload(release(file), file);
      status(saved ? t('Saved {file}', { file: saved }) : t('Download cancelled'));
    } catch (e) {
      status(t('Could not download {file}: {error}', { file, error: e.message }));
    }
  };

  const installGodot = async () => {
    const dir = await pickFolder(t('Choose your Godot project folder (the one with project.godot)'));
    if (!dir) return;
    const file = `rigby2d-godot-addon-${VERSION}-${godotPlatform()}.zip`;
    try {
      status(t('Downloading {file}…', { file }));
      const files = [...unzip(await fetchBytes(release(file)))].filter(([p]) => !p.endsWith('/')).map(([path, bytes]) => ({ path, bytes }));
      await writeFilesTo(dir, files);
      status(t('Installed the Godot runtime into {folder} (addons/rigby2d). Open the project in Godot.', { folder: dir }));
    } catch (e) {
      status(t('Could not install the Godot runtime: {error}', { error: e.message }));
    }
  };

  const installCocos = async () => {
    const dir = await pickFolder(t('Choose your Cocos Creator project folder (the one with assets)'));
    if (!dir) return;
    const file = `rigby2d-cocos-${VERSION}.zip`;
    try {
      status(t('Downloading {file}…', { file }));
      const files = [...unzip(await fetchBytes(release(file)))].filter(([p]) => !p.endsWith('/')).map(([path, bytes]) => ({ path, bytes }));
      const sep = dir.includes('\\') ? '\\' : '/';
      await writeFilesTo(`${dir.replace(/[\\/]$/, '')}${sep}assets`, files);
      status(t('Installed the Cocos Creator runtime into {folder} (assets/rigby2d). Open the project in Cocos Creator.', { folder: dir }));
    } catch (e) {
      status(t('Could not install the Cocos Creator runtime: {error}', { error: e.message }));
    }
  };

  const copy = async (text, button) => {
    await navigator.clipboard?.writeText(text);
    status(t('Copied {text}', { text }));
    const label = button.querySelector('span');
    const before = label.textContent;
    label.textContent = t('Copied');
    setTimeout(() => (label.textContent = before), 1500);
  };

  /** A button with an icon: `kind` is 'primary', 'secondary' or 'ghost'. */
  const action = (iconName, label, onclick, kind = 'secondary') => {
    const b = h('button', { class: `rt-btn ${kind}` }, icon(iconName, 15), h('span', null, label));
    b.addEventListener('click', busy(b, () => onclick(b)));
    return b;
  };

  const card = ({ id, name, badge, text, primary, secondary = [], guide }) =>
    h(
      'article',
      { class: `rt-card rt-${id}` },
      h('div', { class: 'rt-logo' }, engineIcon(id, 30)),
      h(
        'div',
        { class: 'rt-body' },
        h('div', { class: 'rt-title' }, h('h4', null, name), badge ? h('span', { class: 'rt-badge' }, badge) : null),
        h('p', null, text),
        h('div', { class: 'rt-actions' }, primary, ...secondary, guide ? action('external-link', t('Guide'), () => openExternal(guide), 'ghost') : null),
      ),
    );

  const godot = godotPlatform();
  body.append(
    h('div', { class: 'rt-version' }, icon('package', 15), h('span', null, t('Release {version}', { version: VERSION || 'latest' })), h('span', { class: 'rt-dot' }), h('span', null, t('Free to ship: MIT or Apache-2.0'))),
    h(
      'div',
      { class: 'rt-grid' },
      card({
        id: 'unity',
        name: 'Unity',
        badge: '2021.3+ · Unity 6',
        text: t('Add it from its git URL in the Package Manager, or install the package file.'),
        primary: action('copy', t('Copy git URL'), (b) => copy(UNITY_GIT, b), 'primary'),
        secondary: [action('download', '.tgz', () => download(`rigby2d-unity-${V}.tgz`))],
        guide: docs('runtimes/unity/com.rigby2d.unity/README.md'),
      }),
      card({
        id: 'godot',
        name: 'Godot',
        badge: `4.3+ · ${PLATFORM_NAMES[godot]}`,
        text: t('The addon goes into your project as addons/rigby2d, with RigbySkeleton2D and RigbyScene2D nodes.'),
        primary: isDesktop && VERSION ? action('folder-open', t('Install into a project…'), installGodot, 'primary') : action('download', t('Download addon'), () => download(`rigby2d-godot-addon-${V}-${godot}.zip`), 'primary'),
        secondary: [isDesktop && VERSION ? action('download', t('Addon .zip'), () => download(`rigby2d-godot-addon-${V}-${godot}.zip`)) : null, action('gamepad-2', t('Demo'), () => download(`rigby2d-godot-demo-${V}-${godot}.zip`))].filter(Boolean),
        guide: docs('runtimes/godot/addons/rigby2d/README.md'),
      }),
      card({
        id: 'cocos',
        name: 'Cocos Creator',
        badge: '3.8',
        text: t('A RigbySkeleton component for 2D scenes: drop in the exported files and pick an animation.'),
        primary: isDesktop && VERSION ? action('folder-open', t('Install into a project…'), installCocos, 'primary') : action('download', t('Download .zip'), () => download(`rigby2d-cocos-${V}.zip`), 'primary'),
        secondary: isDesktop && VERSION ? [action('download', '.zip', () => download(`rigby2d-cocos-${V}.zip`))] : [],
        guide: docs('runtimes/cocos/README.md'),
      }),
      card({
        id: 'phaser',
        name: 'Phaser',
        badge: '3.60+',
        text: t('this.load.rigby() and this.add.rigby(): one file for your game.'),
        primary: action('download', t('ES module'), () => download(`rigby2d-phaser-${V}.mjs`), 'primary'),
        secondary: [action('download', t('Script tag'), () => download(`rigby2d-phaser-${V}.js`))],
        guide: docs('runtimes/phaser/README.md'),
      }),
      card({
        id: 'javascript',
        name: 'JavaScript',
        badge: t('Web'),
        text: t('The runtime and WebGL renderer, with no dependencies, for any web engine.'),
        primary: action('external-link', t('Source'), () => openExternal(`${LINKS.repo}/tree/develop/src/core`), 'primary'),
        guide: 'https://rigby2d.com/docs/runtimes.html#javascript',
      }),
      card({
        id: 'rust',
        name: 'Rust',
        badge: t('Native'),
        text: t('The rigby-runtime crate: the same animation as the editor, 3 to 4 times faster.'),
        primary: action('external-link', t('Source'), () => openExternal(`${LINKS.repo}/tree/develop/runtimes/rust`), 'primary'),
        guide: 'https://rigby2d.com/docs/runtimes.html#rust',
      }),
    ),
  );
  if (!VERSION) body.append(h('p', { class: 'pref-note' }, t('Development build: downloads come from the latest release.')));
}
