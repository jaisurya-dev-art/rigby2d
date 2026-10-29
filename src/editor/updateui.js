// SPDX-License-Identifier: MIT OR Apache-2.0
// Auto-update (desktop): checks the latest release once a day (Preferences ▸ General), and
// Help ▸ Check for updates. Updates are signed: the app only installs files signed with the
// Rigby2D release key (tauri.conf.json, plugins.updater.pubkey).

import { LINKS, VERSION, askChoice } from './helpui.js';
import { t } from './i18n.js';
import * as log from './log.js';
import { isDesktop, openExternal } from './platform.js';
import { h } from './widgets.js';

const LAST_CHECK = 'rigby.updates.lastCheck';
const DAY = 24 * 60 * 60 * 1000;

/** Checks for an update; `quiet` stays silent when there is none or the check fails. */
export async function checkForUpdates(app, { quiet = false } = {}) {
  if (!isDesktop) {
    if (!quiet) app.setStatus(t('The browser editor is always up to date.'));
    return;
  }
  let update;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    update = await check();
    localStorage.setItem(LAST_CHECK, String(Date.now()));
  } catch (e) {
    log.warn(`Update check failed: ${e?.message ?? e}`, { source: 'updates' });
    if (!quiet) app.setStatus(t('Could not check for updates: {error}', { error: e?.message ?? e }));
    return;
  }
  if (!update) {
    if (!quiet) app.setStatus(t('Rigby2D {version} is the latest version.', { version: VERSION }));
    return;
  }
  const notes = String(update.body ?? '').split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
  const choice = await askChoice(
    t('Update available'),
    [h('p', null, t('Rigby2D {version} is available. You have {current}.', { version: update.version, current: VERSION })), notes ? h('p', { class: 'weak' }, notes.replace(/[*_`]/g, '')) : null].filter(Boolean),
    [
      { id: 'later', label: t('Later') },
      { id: 'notes', label: t("What's new ↗") },
      { id: 'install', label: t('Install and restart'), primary: true },
    ],
  );
  if (choice === 'notes') return openExternal(`${LINKS.repo}/releases/tag/v${update.version}`);
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

/** At startup: a quiet check, at most once a day, when the preference is on. */
export function scheduleUpdateCheck(app) {
  if (!isDesktop || !app.prefs.get('updates.check')) return;
  const last = Number(localStorage.getItem(LAST_CHECK)) || 0;
  if (Date.now() - last < DAY) return;
  setTimeout(() => checkForUpdates(app, { quiet: true }), 15_000);
}
