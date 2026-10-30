// SPDX-License-Identifier: MIT OR Apache-2.0
// Auto-update (desktop): checks the latest release when the editor starts and every few hours
// after (Preferences ▸ General), and with Help ▸ Check for updates. A found update shows as an
// "Update available" button in the menu bar until it is installed. Updates are signed: the app only
// installs files signed with the Rigby2D release key (tauri.conf.json, plugins.updater.pubkey).

import { LINKS, VERSION, askChoice } from './helpui.js';
import { t } from './i18n.js';
import * as log from './log.js';
import { icon } from './icons.js';
import { isDesktop, openExternal } from './platform.js';
import { h } from './widgets.js';

const RECHECK = 6 * 60 * 60 * 1000;

/** The update found by the last check (Tauri's Update), or null. */
let available = null;
let badge = null;

/** The menu bar's "Update available" button: hidden until a check finds an update. */
export function updateBadge(app) {
  if (!badge) {
    badge = h('button', { class: 'update-badge', hidden: true, onclick: () => available && offerUpdate(app, available) }, icon('download', 14), h('span', null, ''));
  }
  return badge;
}

/** Shows `update` in the menu bar (null hides the button). */
export function showUpdate(app, update) {
  available = update;
  const b = updateBadge(app);
  b.hidden = !update;
  if (!update) return;
  b.lastChild.textContent = t('Update available');
  b.title = t('Rigby2D {version} is available. You have {current}.', { version: update.version, current: VERSION });
}

/**
 * Checks for an update. Found, it shows in the menu bar, and the dialog offers it unless `quiet`;
 * `quiet` also stays silent when there is none or the check fails.
 */
export async function checkForUpdates(app, { quiet = false } = {}) {
  if (!isDesktop) {
    if (!quiet) app.setStatus(t('The browser editor is always up to date.'));
    return;
  }
  let update;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    update = await check();
  } catch (e) {
    log.warn(`Update check failed: ${e?.message ?? e}`, { source: 'updates' });
    if (!quiet) app.setStatus(t('Could not check for updates: {error}', { error: e?.message ?? e }));
    return;
  }
  showUpdate(app, update);
  if (!update) {
    if (!quiet) app.setStatus(t('Rigby2D {version} is the latest version.', { version: VERSION }));
    return;
  }
  if (quiet) {
    log.info(`Rigby2D ${update.version} is available`, { source: 'updates' });
    return;
  }
  await offerUpdate(app, update);
}

/**
 * How this copy of the editor was installed ('nsis', 'msi', 'appimage', 'app', 'deb', 'rpm'), or
 * '' for the portable Windows program and development builds.
 */
async function bundleType() {
  try {
    return (await (await import('@tauri-apps/api/app')).getBundleType()) ?? '';
  } catch {
    return '';
  }
}

/** Installs the update can replace in place; the others download the new version instead. */
const SELF_UPDATING = ['nsis', 'msi', 'appimage', 'app'];

/** Where a copy that cannot update itself gets the new version. */
const downloadUrl = (version, bundle) =>
  bundle === '' && navigator.userAgent.includes('Windows') ? `${LINKS.repo}/releases/download/v${version}/Rigby2D_${version}_x64_portable.exe` : `${LINKS.repo}/releases/tag/v${version}`;

/** The update dialog: what's new, later, or install and restart (or download, for copies that cannot update themselves). */
async function offerUpdate(app, update) {
  const bundle = await bundleType();
  const inPlace = SELF_UPDATING.includes(bundle);
  const notes = String(update.body ?? '').split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
  const choice = await askChoice(
    t('Update available'),
    [h('p', null, t('Rigby2D {version} is available. You have {current}.', { version: update.version, current: VERSION })), notes ? h('p', { class: 'weak' }, notes.replace(/[*_`]/g, '')) : null].filter(Boolean),
    [
      { id: 'later', label: t('Later') },
      { id: 'notes', label: t("What's new ↗") },
      inPlace ? { id: 'install', label: t('Install and restart'), primary: true } : { id: 'download', label: t('Download ↗'), primary: true },
    ],
  );
  if (choice === 'notes') return openExternal(`${LINKS.repo}/releases/tag/v${update.version}`);
  if (choice === 'download') return openExternal(downloadUrl(update.version, bundle));
  if (choice !== 'install') return;
  if (app.dirty()) {
    const save = await askChoice(t('Unsaved changes'), t('Save your project before updating?'), [
      { id: 'cancel', label: t('Cancel') },
      { id: 'save', label: t('Save'), primary: true },
    ]);
    if (save !== 'save') return;
    await app.save(false);
    if (app.dirty()) return;
  }
  try {
    let total = 0;
    let done = 0;
    await update.downloadAndInstall((e) => {
      if (e.event === 'Started') total = e.data.contentLength ?? 0;
      if (e.event === 'Progress') {
        done += e.data.chunkLength;
        app.setStatus(t('Downloading Rigby2D {version}… {percent}', { version: update.version, percent: total ? `${Math.round((100 * done) / total)}%` : '' }));
      }
      if (e.event === 'Finished') app.setStatus(t('Installing Rigby2D {version}…', { version: update.version }));
    });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    log.exception(e, { source: 'updates', context: 'Update failed' });
    app.setStatus(t('The update failed: {error}', { error: e?.message ?? e }));
  }
}

/** Quiet checks when the preference is on: soon after the editor starts, then every few hours. */
export function scheduleUpdateCheck(app) {
  if (!isDesktop) return;
  const run = () => app.prefs.get('updates.check') && checkForUpdates(app, { quiet: true });
  setTimeout(run, 8_000);
  setInterval(run, RECHECK);
}
