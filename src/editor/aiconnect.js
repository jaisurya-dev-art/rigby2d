// SPDX-License-Identifier: MIT OR Apache-2.0
// Help ▸ Connect an AI assistant: three plain steps to use Rigby2D from Claude Desktop with the
// one-file extension (no Node.js, terminal or settings files), and the command for Claude Code.

import { isDesktop } from './platform.js';
import { h } from './widgets.js';

export const EXTENSION_URL = 'https://github.com/jaisurya-dev-art/rigby2d/releases/latest/download/Rigby2D-AI.mcpb';
const GUIDE_URL = 'https://rigby2d.com/docs/mcp.html';
const CLAUDE_CODE = 'claude mcp add rigby2d -- node "/path/to/rigby2d/src/mcp/server.js" "/path/to/your/projects"';

/** A button that copies `text` and says so. */
function copyButton(label, text, primary = false) {
  return h(
    'button',
    {
      class: primary ? 'primary' : '',
      onclick: async (e) => {
        const b = e.currentTarget;
        try {
          await navigator.clipboard.writeText(text);
          b.textContent = 'Copied ✓';
        } catch {
          b.textContent = 'Select the text and copy it';
        }
        setTimeout(() => (b.textContent = label), 1800);
      },
    },
    label,
  );
}

export function openAiConnect() {
  const overlay = h('div', { class: 'modal-backdrop' });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  const link = h('input', { class: 'ai-link', readonly: true, value: EXTENSION_URL, onfocus: (e) => e.target.select() });
  // In a browser the link opens directly; the desktop app cannot open a web browser itself.
  const download = isDesktop ? copyButton('Copy the download link', EXTENSION_URL, true) : h('a', { class: 'button primary', href: EXTENSION_URL, target: '_blank', rel: 'noopener' }, 'Download the extension');
  overlay.append(
    h(
      'div',
      { class: 'modal ai-connect' },
      h('h3', null, 'Connect an AI assistant'),
      h('p', { class: 'weak' }, 'Let Claude work on your Rigby2D projects: explain a rig, add bones and animations, rig a PSD with AutoRig, set up lip-sync and more. You ask in plain words; Claude changes the files.'),
      h(
        'ol',
        { class: 'ai-steps' },
        h(
          'li',
          null,
          h('b', null, 'Get the Rigby2D extension for Claude Desktop'),
          h('div', { class: 'small weak' }, isDesktop ? 'Copy the link, paste it into your web browser and the file downloads (about 7 MB).' : 'One file, about 7 MB.'),
          h('div', { class: 'ai-row' }, download, link),
        ),
        h(
          'li',
          null,
          h('b', null, 'Drag the downloaded file onto the Claude Desktop window'),
          h(
            'div',
            { class: 'small weak' },
            'Or, in Claude Desktop: Settings ▸ Extensions ▸ Advanced settings ▸ Install Extension…, then pick the file. (Double-clicking the file may work too, but on some Windows installs it asks which app to use; if it does, close that box and drag the file instead.) No other software is needed: Claude Desktop includes everything the extension needs.',
          ),
        ),
        h('li', null, h('b', null, 'Choose your project folders and click Install'), h('div', { class: 'small weak' }, 'Claude can only open and change files inside the folders you choose.')),
        h(
          'li',
          null,
          h('b', null, 'Ask Claude'),
          h('div', { class: 'small weak' }, 'For example: “Which images are missing from hero.rigby?”, “Add a 1-second wave animation to hero.rigby that raises the right arm”, or “AutoRig character.psd into character.rigby”.'),
        ),
      ),
      h(
        'details',
        { class: 'ai-code' },
        h('summary', null, 'Using Claude Code instead?'),
        h('p', { class: 'small' }, 'Claude Code does not install extension files. Download the Rigby2D source code (with Node.js 20 or newer installed), then run this once, with your own paths:'),
        h('pre', null, CLAUDE_CODE),
        copyButton('Copy the command', CLAUDE_CODE),
        h('p', { class: 'small weak' }, `More: ${GUIDE_URL}`),
      ),
      h('div', { class: 'modal-buttons' }, h('button', { onclick: close }, 'Close')),
    ),
  );
  document.body.append(overlay);
}
