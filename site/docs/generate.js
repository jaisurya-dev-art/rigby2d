// SPDX-License-Identifier: MIT OR Apache-2.0
// Reference sections of the documentation generated from the source, so they never go stale: the
// keyboard shortcuts (src/editor/keymap.js) and the MCP tools with their parameters (src/mcp). In
// docs/*.md they sit between <!-- generated:NAME --> and <!-- /generated:NAME -->;
// `node site/docs/generate.js` rewrites them, and test/docs.test.js checks they are current.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACTIONS, PRESETS } from '../../src/editor/keymap.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const KEY_LABELS = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', pageup: 'Page Up', pagedown: 'Page Down', escape: 'Esc', delete: 'Delete', backspace: 'Backspace', space: 'Space', tab: 'Tab', home: 'Home', end: 'End' };
const keyLabel = (combo) =>
  combo
    .split('+')
    .map((k) => KEY_LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1)))
    .map((k) => `<kbd>${k}</kbd>`)
    .join('+');
const bindingsOf = (preset, action) => (PRESETS[preset].bindings[action] ?? []).map(keyLabel).join(' or ') || '–';
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** The shortcut table: every action with its keys in each preset. */
function shortcuts() {
  const ids = Object.keys(PRESETS);
  const rows = ACTIONS.map(([id, label]) => `| ${cell(label)} | ${ids.map((p) => bindingsOf(p, id)).join(' | ')} |`);
  return [`| Action | ${ids.map((p) => PRESETS[p].label).join(' | ')} |`, `| --- | ${ids.map(() => '---').join(' | ')} |`, ...rows].join('\n');
}

/** A JSON Schema property type, readably. */
function typeOf(p) {
  if (p.enum) return p.enum.map((v) => `\`${JSON.stringify(v).replace(/"/g, "'")}\``).join(', ');
  if (p.type === 'array') return `list of ${p.items ? typeOf(p.items) : 'values'}`;
  if (Array.isArray(p.type)) return p.type.join(' or ');
  if (p.oneOf || p.anyOf) return (p.oneOf ?? p.anyOf).map(typeOf).join(' or ');
  return p.type ?? 'value';
}

/** Every MCP tool: what it does and its parameters, in the order the server lists them. */
async function mcpTools() {
  const { Workspace, createTools } = await import('../../src/mcp/tools.js');
  const { createEditTools } = await import('../../src/mcp/edits.js');
  const { createFilmTools } = await import('../../src/mcp/film.js');
  const { createRiggingTools } = await import('../../src/mcp/rigging.js');
  const { createScriptTools } = await import('../../src/mcp/scripting.js');
  const { createSceneTools } = await import('../../src/mcp/scene.js');
  const ws = new Workspace([repo]);
  const tools = [...createTools(ws), ...createEditTools(ws), ...createFilmTools(ws), ...createRiggingTools(ws), ...createSceneTools(ws), ...createScriptTools(ws)];
  const out = [`The server has **${tools.length} tools**. Parameters marked **required** must be given; the others are optional.`, ''];
  for (const t of tools) {
    const writes = t.annotations?.readOnlyHint === false;
    out.push(`### \`${t.name}\``, '', `${t.description}${writes ? '' : ' *Read only.*'}`, '');
    const props = Object.entries(t.inputSchema?.properties ?? {});
    if (props.length) {
      const required = new Set(t.inputSchema.required ?? []);
      out.push('| Parameter | Type | Description |', '| --- | --- | --- |');
      for (const [name, p] of props) out.push(`| \`${name}\`${required.has(name) ? ' **required**' : ''} | ${cell(typeOf(p))} | ${cell(p.description ?? '')} |`);
      out.push('');
    }
  }
  return out.join('\n').trim();
}

/** name -> generated Markdown. */
export async function generatedSections() {
  return { shortcuts: shortcuts(), 'mcp-tools': await mcpTools() };
}

const MARKER = /(<!-- generated:([\w-]+) -->)[\s\S]*?(<!-- \/generated:\2 -->)/g;

/** `md` with its generated sections filled in from `sections`. */
export function fillGenerated(md, sections) {
  return md.replace(MARKER, (all, open, name, close) => (name in sections ? `${open}\n\n${sections[name]}\n\n${close}` : all));
}

// node site/docs/generate.js: rewrites the generated sections in docs/*.md.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sections = await generatedSections();
  const dir = path.join(repo, 'docs');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const p = path.join(dir, file);
    const before = fs.readFileSync(p, 'utf8');
    const after = fillGenerated(before, sections);
    if (after !== before) {
      fs.writeFileSync(p, after);
      console.log(`updated ${file}`);
    }
  }
}
