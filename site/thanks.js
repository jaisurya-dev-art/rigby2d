// SPDX-License-Identifier: MIT OR Apache-2.0
// A thank-you card when someone downloads Rigby2D: the download goes ahead as usual, and a small card
// says Rigby2D is free and shows the monthly goal (from /supporters.json) with a way to support it.
// It shows at most once a week per browser, so it never nags.

const SPONSOR = 'https://github.com/sponsors/jaisurya-dev-art';
const WEEK = 7 * 24 * 3600 * 1000;
const KEY = 'rigby2d.thanks.shown';

function recentlyShown() {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < WEEK;
  } catch {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Private window: it may show again, which is fine.
  }
}

async function goal() {
  try {
    const data = await (await fetch('/supporters.json', { cache: 'no-cache' })).json();
    return data.goal ?? null;
  } catch {
    return null;
  }
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

async function show() {
  remember();
  const g = await goal();
  const percent = Math.max(0, Math.min(100, Math.round(g?.percent ?? 0)));
  const fill = el('span');
  fill.style.width = `${Math.max(percent, 1.5)}%`;
  const close = el('button', { class: 'btn', type: 'button' }, 'Maybe later');
  const dialog = el(
    'dialog',
    { class: 'thanks', 'aria-labelledby': 'thanks-title' },
    el('h2', { id: 'thanks-title' }, 'Thanks for downloading Rigby2D'),
    el('p', {}, 'Your download has started. Rigby2D is free and stays free. A few dollars a month pays for code signing in its name, so Windows and macOS stop warning the next person who downloads it.'),
    el(
      'div',
      { class: 'goal' },
      el('div', { class: 'goal-top' }, el('span', { class: 'goal-title' }, g?.title ?? 'Signed by Rigby2D'), el('span', { class: 'goal-amount' }, `$${g?.monthly ?? 25} a month`)),
      el('div', { class: 'goal-bar' }, fill),
    ),
    el(
      'div',
      { class: 'thanks-actions' },
      el('a', { class: 'btn primary', href: SPONSOR, rel: 'noopener', target: '_blank', 'data-goatcounter-click': 'site-download-thanks-sponsor' }, 'Support Rigby2D'),
      el('a', { class: 'btn', href: '/fund/', 'data-goatcounter-click': 'site-download-thanks-fund' }, 'Where the money goes'),
      close,
    ),
  );
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  document.body.append(dialog);
  dialog.showModal();
}

/** Shows the card after a click on any Rigby2D release download link on the page. */
export function installDownloadThanks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="github.com/jaisurya-dev-art/rigby2d/releases"]');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || recentlyShown()) return;
    // Let the download start first.
    setTimeout(show, 400);
  });
}
