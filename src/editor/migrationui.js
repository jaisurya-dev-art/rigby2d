// SPDX-License-Identifier: MIT OR Apache-2.0
// File ▸ Import ▸ Check a skeleton file: the migration report (migration.js) for a skeleton JSON or
// .skel file, with a button to open it.

import { isSkeletonBinary, readSkeletonBinary } from '../core/binary.js';
import { dialog } from './helpui.js';
import { t } from './i18n.js';
import { checkSkeleton } from './migration.js';
import { openExternal, pickImportFiles } from './platform.js';
import { h } from './widgets.js';

const MARK = { ok: '✓', kept: '●', partial: '◐', no: '✕' };
const LABEL = { ok: 'Plays as in the original', kept: 'Kept and exported', partial: 'Partly supported', no: 'Not supported' };

export async function openMigrationCheck(app) {
  const [file] = await pickImportFiles(t('Skeleton file (.json, .skel)'), ['json', 'skel'], false);
  if (!file) return;
  const name = String(file.name).split(/[\\/]/).pop();
  let report;
  try {
    const obj = isSkeletonBinary(file.bytes) ? readSkeletonBinary(file.bytes) : JSON.parse(new TextDecoder().decode(file.bytes));
    report = checkSkeleton(obj, name.replace(/\.[^.]+$/, ''));
  } catch (e) {
    app.setStatus(t('Could not check {file}: {error}', { file: name, error: e.message }));
    return;
  }
  const { body, close } = dialog('migration-dialog', t('Skeleton check: {file}', { file: name }), t('Format {version}', { version: report.version }));
  const verdict = !report.supported ? t('This file needs a newer export before Rigby2D can open it.') : report.items.some((i) => i.status === 'partial' || i.status === 'no') ? t('Rigby2D opens this file. A few things need a look (below).') : t('Rigby2D opens this file and plays everything in it.');
  body.append(
    h('p', { class: report.supported ? '' : 'addon-error' }, h('b', null, verdict)),
    report.summary ? h('p', { class: 'weak' }, t('{bones} bones, {slots} slots, {animations} animations', report.summary)) : null,
    ...report.notes.map((n) => h('p', null, n)),
    h(
      'table',
      { class: 'migration-table' },
      h('tbody', null, ...report.items.map((i) => h('tr', { class: `status-${i.status}` }, h('td', { title: t(LABEL[i.status]) }, MARK[i.status]), h('td', null, i.feature === 'Note' ? '' : t(i.feature)), h('td', null, i.count ? String(i.count) : ''), h('td', { class: 'weak' }, i.note || t(LABEL[i.status]))))),
    ),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { onclick: () => openExternal('https://rigby2d.com/docs/migrating-from-spine.html') }, t('Migration guide ↗')),
      report.supported ? h('button', { class: 'primary', onclick: () => (close(), app.openDialog()) }, t('Open a project…')) : null,
    ),
  );
}
