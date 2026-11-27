// SPDX-License-Identifier: MIT OR Apache-2.0
// The form a script tool shows before it runs. A tool's Python parameters (rigby.py, @rigby.tool)
// arrive as fields { name, label, kind, default, min, max, step, choices, help }; kinds are number,
// integer, boolean, text, choice, and pickers for project items (bone, slot, animation, skin,
// event, constraint). The last values used are remembered per tool.

import { PICKERS, cleanValue, pickerNames, startValues } from './toolargs.js';
import { dragValue, h, select, textField } from '../widgets.js';
import { button, checkbox, dialog, fieldRow, fields } from '../ui.js';
import { t } from '../i18n.js';

const STORAGE = 'rigby.toolArgs';

function loadRemembered() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function remember(id, values) {
  try {
    const all = loadRemembered();
    all[id] = values;
    localStorage.setItem(STORAGE, JSON.stringify(all));
  } catch {
    // Not remembered; the form starts from the defaults next time.
  }
}

/**
 * Shows a tool's form; resolves with { parameter: value } when Run is pressed, or null when the
 * form is closed. A tool without parameters resolves at once with {}.
 */
export function askToolArgs(app, tool) {
  const list = tool.params ?? [];
  if (!list.length) return Promise.resolve({});
  const values = startValues(app, list, loadRemembered()[tool.id] ?? {});
  return new Promise((resolve) => {
    let answer = null;
    const runIt = () => {
      answer = { ...values };
      remember(tool.id, answer);
      close();
    };
    const missing = () => list.filter((f) => PICKERS.includes(f.kind) && (values[f.name] === null || values[f.name] === undefined));
    const runButton = button(t('Run'), { kind: 'primary', icon: 'play', onclick: () => !missing().length && runIt() });
    const { body, close } = dialog({
      title: tool.label,
      subtitle: tool.description || null,
      className: 'tool-form',
      onClose: () => resolve(answer),
      footer: [button(t('Cancel'), { onclick: () => close() }), runButton],
    });
    const control = (f) => {
      const set = (v) => {
        values[f.name] = v;
        runButton.disabled = missing().length > 0;
      };
      switch (f.kind) {
        case 'number':
        case 'integer': {
          const decimals = f.kind === 'integer' ? 0 : 3;
          const range = typeof f.min === 'number' && typeof f.max === 'number' ? f.max - f.min : 100;
          return dragValue(values[f.name], (v) => set(cleanValue(f, v)), { decimals, min: f.min ?? -Infinity, max: f.max ?? Infinity, speed: f.step ?? (f.kind === 'integer' ? 0.1 : Math.max(0.001, range / 300)) });
        }
        case 'boolean':
          return checkbox('', values[f.name], set);
        case 'choice':
          return select((f.choices ?? []).map((c) => [c, String(c)]), values[f.name], set);
        case 'text':
          return textField(values[f.name], set, { placeholder: f.help ?? '' });
        default: {
          const names = pickerNames(app.doc, f.kind);
          if (!names.length) return h('span', { class: 'weak' }, t('No {kind} in this project', { kind: f.kind }));
          return select(names.map((n) => [n, n]), values[f.name] ?? undefined, set, { placeholder: t('Choose…') });
        }
      }
    };
    body.append(fields(...list.flatMap((f) => fieldRow(f.label ?? f.name, control(f), f.help ? h('div', { class: 'weak' }, f.help) : null))));
    runButton.disabled = missing().length > 0;
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.defaultPrevented && !missing().length) {
        e.preventDefault();
        runIt();
      }
    });
    runButton.focus();
  });
}
