// SPDX-License-Identifier: MIT OR Apache-2.0
// Help ▸ Connect an AI assistant: three plain steps to use Rigby2D from Claude Desktop with the
// one-file extension (no Node.js, terminal or settings files), and the command for Claude Code.

import { isDesktop } from './platform.js';
import { h } from './widgets.js';
import { button, dialog, hint, uiIcon } from './ui.js';
import { t } from './i18n.js';

export const EXTENSION_URL = 'https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D-AI.mcpb';
const CLAUDE_CODE = 'claude mcp add rigby2d -- node "/path/to/rigby2d/src/mcp/server.js" "/path/to/your/projects"';

/** A button that copies `text` and says so. */
function copyButton(label, text, kind = 'secondary') {
  const b = button(label, {
    kind,
    icon: 'copy',
    onclick: async () => {
      const span = b.querySelector('span');
      try {
        await navigator.clipboard.writeText(text);
        span.textContent = t('Copied');
      } catch {
        span.textContent = t('Select the text and copy it');
      }
      setTimeout(() => (span.textContent = label), 1800);
    },
  });
  return b;
}

export function openAiConnect() {
  const { body, close } = dialog({
    title: t('Connect an AI assistant'),
    subtitle: t('Claude can explain a rig, add bones and animations, AutoRig a PSD or set up lip-sync. You ask in plain words.'),
    className: 'ai-connect',
    footer: [button(t('Close'), { onclick: () => close() })],
  });
  const link = h('input', { class: 'ai-link', readonly: true, value: EXTENSION_URL, onfocus: (e) => e.target.select() });
  // In a browser the link opens directly; the desktop app cannot open a web browser itself.
  const download = isDesktop
    ? copyButton(t('Copy the download link'), EXTENSION_URL, 'primary')
    : h('a', { class: 'ui-btn ui-btn-primary', href: EXTENSION_URL, target: '_blank', rel: 'noopener' }, uiIcon('download'), h('span', null, t('Download the extension')));
  const step = (title, ...rest) => h('li', null, h('b', null, title), ...rest);
  body.append(
    h(
      'ol',
      { class: 'ai-steps' },
      step(
        t('Get the Rigby2D extension for Claude Desktop'),
        h('div', { class: 'small weak' }, isDesktop ? t('Copy the link, paste it into your web browser and the file downloads (about 7 MB).') : t('One file, about 7 MB.')),
        h('div', { class: 'ai-row' }, download, link),
      ),
      step(t('Drag the downloaded file onto the Claude Desktop window'), h('div', { class: 'small weak' }, t('Or in Claude Desktop: Settings ▸ Extensions ▸ Advanced settings ▸ Install Extension…, then pick the file.'))),
      step(t('Choose your project folders and click Install'), h('div', { class: 'small weak' }, t('Claude can only open and change files inside the folders you choose.'))),
      step(t('Ask Claude'), h('div', { class: 'small weak' }, t('For example: “Which images are missing from hero.rigby?”, “Add a 1-second wave animation to hero.rigby that raises the right arm”, or “AutoRig character.psd into character.rigby”.'))),
    ),
    h(
      'details',
      { class: 'ai-code' },
      h('summary', null, t('Using Claude Code instead?')),
      h('p', { class: 'small' }, t('Claude Code does not install extension files. Download the Rigby2D source code (with Node.js 20 or newer installed), then run this once, with your own paths:')),
      h('pre', null, CLAUDE_CODE),
      copyButton(t('Copy the command'), CLAUDE_CODE),
    ),
    hint(t('Trouble installing? The guide covers each step.'), { docs: 'mcp' }),
  );
}
