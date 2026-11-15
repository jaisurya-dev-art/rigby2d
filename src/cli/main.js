// SPDX-License-Identifier: MIT OR Apache-2.0
// The `rigby` command-line tool: editor operations without the editor. Every command runs on the
// same code as the MCP server's tools (src/mcp), with paths anywhere on disk; `render` drives the
// editor's renderer on the GPU (render.js).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { createEditTools } from '../mcp/edits.js';
import { createFilmTools } from '../mcp/film.js';
import { ToolError, checkArguments } from '../mcp/protocol.js';
import { createRiggingTools } from '../mcp/rigging.js';
import { createSceneTools } from '../mcp/scene.js';
import { createScriptTools } from '../mcp/scripting.js';
import { Workspace, createTools } from '../mcp/tools.js';
import { UsageError, parseArgs, toolArguments } from './args.js';
import { exportWithAtlas, psdToWorkfile, toWorkfile } from './project.js';
import { RENDER_OPTIONS, RenderError } from '../editor/render/plan.js';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

/** The CLI works on any path the user gives: a workspace with no confinement. */
class OpenWorkspace extends Workspace {
  inside() {
    return true;
  }
}

/** Every MCP tool, by name, bound to an open workspace rooted at the current folder. */
export function toolTable(cwd = process.cwd()) {
  const ws = new OpenWorkspace([cwd]);
  const tools = [...createTools(ws), ...createEditTools(ws), ...createFilmTools(ws), ...createRiggingTools(ws), ...createSceneTools(ws), ...createScriptTools(ws)];
  return new Map(tools.map((t) => [t.name, t]));
}

/** Runs one MCP tool with schema-checked arguments. */
export async function callTool(tools, name, args) {
  const tool = tools.get(name);
  if (!tool) throw new UsageError(`no tool '${name}' (see rigby tools)`);
  const problems = checkArguments(tool.inputSchema, args);
  if (problems.length) throw new UsageError(`${name}: ${problems.join('; ')}`);
  return tool.handler(args);
}

const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---- text output ------------------------------------------------------------------------------

const scalar = (v) => (v === null ? '-' : typeof v === 'string' ? v : JSON.stringify(v));
const isPlain = (v) => v === null || typeof v !== 'object';

/** Readable indented text for any result (YAML-like): short lists of plain values on one line. */
export function formatText(value, indent = '') {
  if (isPlain(value)) return `${indent}${scalar(value)}`;
  const lines = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isPlain(item)) lines.push(`${indent}- ${scalar(item)}`);
      else if (!Array.isArray(item) && Object.values(item).every((v) => isPlain(v) || (Array.isArray(v) && v.every(isPlain)))) {
        lines.push(`${indent}- ${Object.entries(item).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(scalar).join(', ')}]` : scalar(v)}`).join(', ')}`);
      } else {
        lines.push(`${indent}-`, formatText(item, `${indent}  `));
      }
    }
    return lines.join('\n');
  }
  for (const [k, v] of Object.entries(value)) {
    if (isPlain(v)) lines.push(`${indent}${k}: ${scalar(v)}`);
    else if (Array.isArray(v) && !v.length) lines.push(`${indent}${k}: none`);
    else if (Array.isArray(v) && v.every(isPlain) && v.join(', ').length < 100) lines.push(`${indent}${k}: ${v.map(scalar).join(', ')}`);
    else if (!Array.isArray(v) && !Object.keys(v).length) lines.push(`${indent}${k}: none`);
    else lines.push(`${indent}${k}:`, formatText(v, `${indent}  `));
  }
  return lines.join('\n');
}

function inspectText(r) {
  const c = r.counts;
  const lines = [
    `${r.name || path.basename(r.file)}  (${r.format}${r.version ? ` ${r.version}` : ''}, ${r.workspace} workspace)`,
    `  ${c.bones} bones, ${c.slots} slots, ${c.skins} skin(s), ${c.constraints} constraint(s), ${c.events} event(s), ${c.images} image(s)`,
  ];
  lines.push(`  animations (${r.animations.length}):`);
  for (const a of r.animations) lines.push(`    ${a.name.padEnd(24)} ${String(a.duration).padStart(7)}s  ${a.timelines} timeline(s)${a.events ? `, ${a.events} event key(s)` : ''}`);
  if (r.skins.length > 1) lines.push(`  skins: ${r.skins.join(', ')}`);
  if (r.constraints.length) lines.push(`  constraints: ${r.constraints.map((k) => `${k.name} (${k.type})`).join(', ')}`);
  if (r.events.length) lines.push(`  events: ${r.events.join(', ')}`);
  if (r.film) lines.push('  film:', formatText(r.film, '    '));
  if (r.scene) lines.push('  scene:', formatText(r.scene, '    '));
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

function validateText(r) {
  const lines = [`${r.valid ? 'valid' : 'INVALID'}: ${r.file}`];
  lines.push(`  ${Object.entries(r.checks).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  for (const e of r.errors) lines.push(`  error: ${e}`);
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

function rigText(r) {
  const lines = [`bones (${r.bones.length}):`];
  const children = new Map();
  for (const b of r.bones) children.set(b.parent, [...(children.get(b.parent) ?? []), b]);
  const walk = (parent, depth) => {
    for (const b of children.get(parent) ?? []) {
      lines.push(`${'  '.repeat(depth + 1)}${b.name}  x ${b.x}, y ${b.y}, rot ${b.rotation}${b.length ? `, len ${b.length}` : ''}${b.scaleX !== 1 || b.scaleY !== 1 ? `, scale ${b.scaleX} ${b.scaleY}` : ''}`);
      walk(b.name, depth + 1);
    }
  };
  walk(null, 0);
  lines.push(`slots (${r.slots.length}, back to front):`);
  for (const s of r.slots) lines.push(`  ${s.name}  on ${s.bone}  shows ${s.attachment ?? '-'}${s.attachments.length > 1 ? `  (${s.attachments.length} attachments)` : ''}${s.blend !== 'normal' ? `  ${s.blend}` : ''}`);
  if (r.skins.length) lines.push('skins:', ...r.skins.map((k) => `  ${k.name}: ${k.attachments.reduce((n, e) => n + e.attachments.length, 0)} attachment(s)`));
  return lines.join('\n');
}

function runText(r) {
  const lines = [...(r.output ?? [])];
  if (r.status) lines.push(r.status);
  lines.push(r.dryRun ? 'Dry run: nothing saved.' : `Saved ${r.file}`);
  return lines.join('\n');
}

function renderText(r) {
  const lines = [`Rendered with ${r.engine === 'app' ? 'the Rigby2D app' : 'Chromium'} on ${r.gpu}`];
  for (const x of r.renders) lines.push(`${x.animation}${x.skin !== 'default' ? ` (${x.skin})` : ''}: ${x.frames} frame(s), ${x.files} file(s)${x.first ? ` → ${x.first}` : ''}`);
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}

const savedText = (r) => [`Wrote ${r.files ? r.files.join(', ') : (r.output ?? r.file ?? r.model)}`, ...(r.missingImages?.length ? [`warning: ${r.missingImages.length} image(s) missing: ${r.missingImages.join(', ')}`] : []), ...(r.warnings ?? []).map((w) => `warning: ${w}`)].join('\n');

// ---- commands ---------------------------------------------------------------------------------

const FORCE = { force: { type: 'boolean', short: 'f', help: 'Replace existing output files.' } };
const PROJECT = '<project>  a .rigby work file, or a skeleton .json / .skel export';

/**
 * The commands: { summary, usage, details, positionals, options, run(args, ctx) → result,
 * text(result) → string, exit(result) → code }.
 */
export const COMMANDS = {
  inspect: {
    summary: 'Summarize a project: counts, animations, skins, constraints, film settings',
    usage: 'rigby inspect <project>',
    details: PROJECT,
    positionals: ['project'],
    run: ({ project }, { tools }) => callTool(tools, 'inspect_project', { path: project }),
    text: inspectText,
  },
  rig: {
    summary: 'Show the bone hierarchy (setup pose), the slots in draw order and the skins',
    usage: 'rigby rig <project>',
    positionals: ['project'],
    run: ({ project }, { tools }) => callTool(tools, 'describe_rig', { path: project }),
    text: rigText,
  },
  animation: {
    summary: 'Show one animation: duration and the key times of every timeline',
    usage: 'rigby animation <project> <name>',
    positionals: ['project', 'name'],
    run: ({ project, name }, { tools }) => callTool(tools, 'describe_animation', { path: project, animation: name }),
  },
  pose: {
    summary: 'Evaluate the skeleton (setup pose, or an animation at a time): world bones, attachments, bounds',
    usage: 'rigby pose <project> [--animation <name>] [--time <seconds>] [--skin <name>]',
    positionals: ['project'],
    options: {
      animation: { type: 'string', short: 'a', help: 'Animation to apply (default: the setup pose).' },
      time: { type: 'number', short: 't', help: 'Time in seconds (default 0).' },
      skin: { type: 'string', help: "Skin to show (default 'default')." },
    },
    run: ({ project, animation, time, skin }, { tools }) => callTool(tools, 'sample_pose', drop({ path: project, animation, time, skin })),
  },
  validate: {
    summary: 'Check a project for problems (exit code 1 when it is invalid)',
    usage: 'rigby validate <project>',
    details: 'Checks the structure, images missing from the work file or atlas, animations without keys, the skeleton JSON 4.3 round trip and binary .skel export.',
    positionals: ['project'],
    run: ({ project }, { tools }) => callTool(tools, 'validate_project', { path: project }),
    text: validateText,
    exit: (r) => (r.valid ? 0 : 1),
  },
  convert: {
    summary: 'Convert between .rigby, skeleton JSON (3.8 / 4.2 / 4.3) and binary .skel',
    usage: 'rigby convert <input> <output> [--version 3.8|4.2|4.3] [--force]',
    details:
      'The output extension picks the format. To .json / .skel only the skeleton data is written (keep the\n' +
      'existing atlas, or use rigby export to pack a new one). To .rigby, a skeleton export becomes a work\n' +
      'file holding its images (read from its atlas or images folder), as the editor opens it.',
    positionals: ['input', 'output'],
    outputOf: (a) => a.output,
    options: { version: { type: 'string', short: 'V', choices: ['3.8', '4.2', '4.3'], help: 'Skeleton JSON version (default 4.3; .skel is always 4.3).' }, ...FORCE },
    run: async ({ input, output, version, force }, { tools }) => {
      const ext = path.extname(output).toLowerCase();
      if (ext === '.rigby') {
        if (version) throw new UsageError('--version applies to skeleton JSON output, not .rigby');
        return toWorkfile(path.resolve(input), path.resolve(output), { force });
      }
      return callTool(tools, 'convert_project', drop({ input, output, version, overwrite: force }));
    },
    text: savedText,
  },
  export: {
    summary: 'Export for games: skeleton + packed atlas, a Defold model, or sprite sheets',
    usage: 'rigby export <project> --format json|skel|defold|spritesheet --out <file|folder> [options]',
    details:
      'json, skel   --out is the skeleton file; <name>.atlas and <name>.png are packed next to it.\n' +
      'defold       --out is a folder in a Defold project: .rigbyskel, .atlas, images/, .rigbymodel and .go.\n' +
      'spritesheet  --out is a folder: frames rendered into sheets (--sheet json|defold|frames).',
    positionals: ['project'],
    outputOf: (a) => (/\.(json|skel)$/i.test(a.out ?? '') ? a.out : undefined),
    options: {
      format: { type: 'string', short: 'F', choices: ['json', 'skel', 'defold', 'spritesheet'], help: 'What to export (default: from --out: .json or .skel).' },
      out: { type: 'string', short: 'o', help: 'Output file (json, skel) or folder (defold, spritesheet).' },
      version: { type: 'string', short: 'V', choices: ['3.8', '4.2', '4.3'], help: 'json: skeleton JSON version (default 4.3).' },
      name: { type: 'string', help: 'defold, spritesheet: base name of the files (default: the project name).' },
      folder: { type: 'string', help: "defold: the output folder's path in the Defold project, e.g. /assets/hero (default: found from game.project)." },
      animation: { type: 'list', short: 'a', help: 'defold: animation played from the start. spritesheet: animations to include (comma list; default all).' },
      skin: { type: 'string', help: 'Skin to show (default: the default skin).' },
      sheet: { type: 'string', choices: ['json', 'defold', 'frames'], help: "spritesheet: 'json' (sheet + JSON hash, default), 'defold' (frames + .atlas) or 'frames'." },
      fps: { type: 'number', help: 'spritesheet: frames per second (default 30).' },
      scale: { type: 'number', help: 'spritesheet: pixels per skeleton unit (default 1).' },
      layout: { type: 'string', choices: ['packed', 'grid'], help: 'spritesheet: sheet layout (default packed).' },
      padding: { type: 'integer', help: 'spritesheet: pixels between frames (default 2).' },
      'max-width': { type: 'integer', help: 'spritesheet: largest sheet side (default 4096).' },
      trim: { type: 'boolean', help: 'spritesheet: trim empty space around frames (default on; --no-trim).' },
      dedupe: { type: 'boolean', help: 'spritesheet: store identical frames once (default on; --no-dedupe).' },
      loop: { type: 'boolean', help: 'spritesheet: animations loop, so the last frame is left out (default on; --no-loop).' },
      pot: { type: 'boolean', help: 'spritesheet: power-of-two sheet sizes.' },
      ...FORCE,
    },
    run: async (a, { tools }) => {
      if (!a.out) throw new UsageError('give --out');
      const ext = path.extname(a.out).toLowerCase();
      const format = a.format ?? (ext === '.json' ? 'json' : ext === '.skel' ? 'skel' : null);
      if (!format) throw new UsageError('give --format json|skel|defold|spritesheet');
      if (format === 'json' || format === 'skel') {
        if (ext !== `.${format}`) throw new UsageError(`--out for ${format} is a .${format} file`);
        return exportWithAtlas(path.resolve(a.project), path.resolve(a.out), { version: a.version ?? '4.3', force: a.force });
      }
      await fsp.mkdir(path.resolve(a.out), { recursive: true });
      if (format === 'defold') {
        if (a.animation?.length > 1) throw new UsageError('defold: --animation is the one animation the model starts with');
        return callTool(tools, 'export_defold_model', drop({ input: a.project, output_folder: a.out, name: a.name, folder: a.folder, animation: a.animation?.[0], skin: a.skin, overwrite: a.force }));
      }
      return callTool(
        tools,
        'export_sprite_sheet',
        drop({ input: a.project, output_folder: a.out, name: a.name, format: a.sheet, animations: a.animation, fps: a.fps, scale: a.scale, layout: a.layout, padding: a.padding, max_width: a.maxWidth, trim: a.trim, dedupe: a.dedupe, loop: a.loop, power_of_two: a.pot, skin: a.skin, overwrite: a.force }),
      );
    },
    text: (r) => {
      if (r.model) return `Wrote ${r.model} and ${r.gameObject} (${r.images} image(s), Defold folder ${r.folder})${r.missingImages.length ? `\nwarning: missing images: ${r.missingImages.join(', ')}` : ''}`;
      if (r.input && r.folder) return `Wrote ${r.files.length} file(s) to ${r.folder}${r.frames !== undefined ? ` (${r.frames} frame(s))` : ''}`;
      return savedText(r);
    },
  },
  'import-psd': {
    summary: 'Turn a layered PSD into a .rigby work file (one slot per layer, laid out as drawn)',
    usage: 'rigby import-psd <file.psd> [--out <project.rigby>] [--force]',
    details: "Same layout rules as File > Import PSD: the canvas' bottom center is the origin; hidden layers start hidden.\nUse rigby autorig to rig the artwork in the same step.",
    positionals: ['psd'],
    outputOf: (a) => a.out,
    options: { out: { type: 'string', short: 'o', help: 'The work file to write (default: <psd name>.rigby next to it).' }, ...FORCE },
    run: ({ psd, out, force }) => {
      const input = path.resolve(psd);
      const output = path.resolve(out ?? input.replace(/\.psd$/i, '') + '.rigby');
      if (path.extname(output).toLowerCase() !== '.rigby') throw new UsageError('--out is a .rigby file');
      return psdToWorkfile(input, output, { force });
    },
    text: (r) => `Wrote ${r.output}: ${r.slots} layer(s) as slots`,
  },
  autorig: {
    summary: 'Rig layered artwork in one step (a PSD, or an unrigged .rigby): bones, meshes, weights, IK',
    usage: 'rigby autorig <file.psd|project.rigby> [--out <project.rigby>] [--meshes deforming|all|none] [--no-ik] [--role layer=role]... [--side layer=l|r]... [--dry-run]',
    details: 'From a PSD, --out is the new work file (default <psd name>.rigby). A .rigby is rigged in place unless --out is given.\n--dry-run only shows which body part each layer was taken for.',
    positionals: ['input'],
    outputOf: (a) => a.out,
    options: {
      out: { type: 'string', short: 'o', help: 'Where to save.' },
      meshes: { type: 'string', choices: ['deforming', 'all', 'none'], help: "Meshes for parts that bend across bones (default 'deforming')." },
      ik: { type: 'boolean', help: 'IK for two-bone arms and legs (default on; --no-ik).' },
      role: { type: 'list', help: "Override a layer's role: layer=role (head, torso, upperarm, ... or none). Repeatable." },
      side: { type: 'list', help: "Override a layer's side: layer=l or layer=r. Repeatable." },
      'dry-run': { type: 'boolean', short: 'n', help: 'Detect body parts only; save nothing.' },
      ...FORCE,
    },
    run: async (a, { tools }) => {
      const pairs = (list, what) =>
        list?.length
          ? Object.fromEntries(
              list.map((p) => {
                const i = p.lastIndexOf('=');
                if (i <= 0) throw new UsageError(`--${what} is layer=value, not '${p}'`);
                return [p.slice(0, i), p.slice(i + 1)];
              }),
            )
          : undefined;
      const psd = /\.psd$/i.test(a.input);
      const source = psd ? { psd_file: a.input } : { path: a.input };
      const roles = pairs(a.role, 'role');
      const sides = pairs(a.side, 'side');
      if (a.dryRun) return callTool(tools, 'detect_parts', drop({ ...source, roles, sides }));
      const output = a.out ?? (psd ? a.input.replace(/\.psd$/i, '') + '.rigby' : undefined);
      return callTool(tools, 'autorig', drop({ ...source, meshes: a.meshes, ik: a.ik, roles, sides, output, overwrite: a.force }));
    },
  },
  run: {
    summary: 'Run a Python script with the rigby scripting API against a project, then save it',
    usage: 'rigby run <project> (--script <file.py> | --code <python>) [--out <file>] [--dry-run] [--animation <name>] [--time <s>] [--select bone,...]',
    details: 'The same scripts as the editor\'s script editor (import rigby). print() output is shown. If the script raises,\nnothing is saved and the traceback is shown (exit code 1). Needs Pyodide (installed with npm install).',
    positionals: ['project', 'script?'],
    outputOf: (a) => a.out,
    options: {
      script: { type: 'string', short: 's', help: 'A .py file.' },
      code: { type: 'string', short: 'c', help: 'Python source, instead of --script.' },
      out: { type: 'string', short: 'o', help: 'Save to this file instead of changing the project (same format).' },
      'dry-run': { type: 'boolean', short: 'n', help: 'Run without saving (for queries).' },
      animation: { type: 'string', short: 'a', help: 'Animation open while the script runs (Animate mode).' },
      time: { type: 'number', short: 't', help: 'What rigby.time() returns.' },
      select: { type: 'list', help: 'Selected bones (comma list).' },
      ...FORCE,
    },
    run: (a, { tools }) => {
      const file = a.script;
      if ((file === undefined) === (a.code === undefined)) throw new UsageError('give --script <file.py> or --code <python>');
      return callTool(tools, 'run_script', drop({ path: a.project, script_file: file, script: a.code, output: a.out, dry_run: a.dryRun, animation: a.animation, time: a.time, selection: a.select, overwrite: a.force }));
    },
    text: runText,
  },
  render: {
    summary: 'Render animations to MP4, WebM, a PNG sequence or GIF on the GPU',
    usage: 'rigby render <project> --out <file.mp4|.webm|.gif|.png|folder/> [--animation <name>,... | --all] [options]',
    details:
      'Uses the editor\'s renderer and the project\'s output settings (File > Output). Two engines, both on the GPU:\n' +
      '  app       the installed Rigby2D app (0.6 or newer) renders in a hidden window, exactly as its Render\n' +
      '            dialog does (WebGL2, WebCodecs). The default when the app is found.\n' +
      '  chromium  headless Chromium (Playwright) on the dedicated GPU; MP4 by ffmpeg with NVIDIA NVENC\n' +
      "            (h264_nvenc), WebM / PNG / GIF by the editor's encoders. Used when there is no app (CI).\n" +
      'Several renders (--all, a list, or several skins) are named <out>_<animation>[_<skin>], or use\n' +
      '{animation} and {skin} in --out. A folder --out names files <project>_<animation>.',
    positionals: ['project'],
    options: {
      ...RENDER_OPTIONS,
      engine: { type: 'string', choices: ['app', 'chromium'], help: 'Renderer (default: the app when installed, else chromium).' },
      app: { type: 'string', help: 'The Rigby2D app to render with (default: RIGBY2D_APP, PATH, then the install folder).' },
      ffmpeg: { type: 'string', help: 'chromium: ffmpeg for MP4 (default: RIGBY_FFMPEG or ffmpeg on PATH).' },
      'allow-software': { type: 'boolean', help: 'Render even without a GPU or a hardware video encoder (slow).' },
    },
    run: async (a, ctx) => {
      if (!a.out) throw new UsageError('give --out');
      const { render } = await import('./render.js');
      return render(a.project, { ...a, onProgress: ctx.progress });
    },
    text: renderText,
  },
  tools: {
    summary: 'List the operations `rigby call` can run (the MCP server tools)',
    usage: 'rigby tools',
    run: (_, { tools }) => [...tools.values()].map((t) => ({ name: t.name, title: t.title, readOnly: !!t.annotations?.readOnlyHint })),
    text: (list) => list.map((t) => `${t.name.padEnd(22)} ${t.title}${t.readOnly ? '' : '  (writes)'}`).join('\n') + '\n\nrigby call <tool> --help shows its arguments.',
  },
  call: {
    summary: 'Run any MCP tool: add_bone, set_bone_key, batch_edit, retarget_animation, lip_sync, ...',
    usage: "rigby call <tool> ['{\"json\": \"arguments\"}'] [--<argument> <value>]... [--args-file <file.json>]",
    details: 'Arguments come from a JSON object, a JSON file, or --<argument> <value> pairs (values that read as JSON are\nJSON: numbers, true/false, [lists], {objects}; anything else is text). Dashes in names become underscores.',
    positionals: ['tool', 'json?'],
    passthrough: true,
    options: { 'args-file': { type: 'string', help: 'A JSON file with the arguments.' } },
    run: async ({ tool, json, argsFile, extra }, { tools }) => {
      let args = {};
      if (argsFile) {
        try {
          args = JSON.parse(await fsp.readFile(argsFile, 'utf8'));
        } catch (e) {
          throw new UsageError(`--args-file: ${e.message}`);
        }
      }
      if (json !== undefined) {
        try {
          args = { ...args, ...JSON.parse(json) };
        } catch (e) {
          throw new UsageError(`the arguments are not JSON: ${e.message}`);
        }
      }
      return callTool(tools, tool, { ...args, ...toolArguments(extra) });
    },
  },
};

// ---- help -------------------------------------------------------------------------------------

export function mainHelp() {
  const width = Math.max(...Object.keys(COMMANDS).map((n) => n.length)) + 2;
  return [
    `Rigby2D command-line tool ${VERSION}`,
    '',
    'Usage: rigby <command> [arguments] [--json]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(width)}${c.summary}`),
    '',
    'Options for every command:',
    '  --json        Print the result as JSON (errors too: {"error": ...}).',
    '  -q, --quiet   No progress messages.',
    '  -h, --help    Help for a command: rigby <command> --help',
    '',
    'Exit codes: 0 done, 1 failed (or validate found problems), 2 wrong usage.',
    'Docs: https://rigby2d.com/docs/cli.html',
  ].join('\n');
}

export function commandHelp(name) {
  const c = COMMANDS[name];
  const lines = [`Usage: ${c.usage}`, '', c.summary + '.'];
  if (c.details) lines.push('', c.details);
  const opts = Object.entries(c.options ?? {});
  if (opts.length) {
    lines.push('', 'Options:');
    const label = ([n, d]) => `${d.short ? `-${d.short}, ` : '    '}--${n}${d.type && d.type !== 'boolean' ? ` <${d.choices ? d.choices.join('|') : d.type === 'list' ? 'a,b' : d.type === 'string' ? 'value' : 'n'}>` : ''}`;
    const width = Math.min(44, Math.max(...opts.map((o) => label(o).length)) + 2);
    for (const o of opts) lines.push(`  ${label(o).padEnd(width)}${o[1].help ?? ''}`);
  }
  lines.push('', '  --json                    Print the result as JSON.');
  return lines.join('\n');
}

/** Help for one MCP tool: its description and arguments. */
export function toolHelp(tool) {
  const s = tool.inputSchema;
  const lines = [`Usage: rigby call ${tool.name} [--<argument> <value>]...`, '', tool.description, '', 'Arguments:'];
  for (const [k, p] of Object.entries(s.properties ?? {})) {
    const type = p.enum ? p.enum.join('|') : (Array.isArray(p.type) ? p.type.join('|') : p.type) ?? 'value';
    lines.push(`  --${k} <${type}>${(s.required ?? []).includes(k) ? ' (required)' : ''}`, ...(p.description ? [`      ${p.description}`] : []));
  }
  return lines.join('\n');
}

// ---- main -------------------------------------------------------------------------------------

/**
 * Runs the CLI. `io`: { stdout(text), stderr(text), cwd }. Returns the exit code. Never exits the
 * process itself, so tests can call it.
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? ((t) => process.stdout.write(t));
  const err = io.stderr ?? ((t) => process.stderr.write(t));
  const json = argv.includes('--json');
  const quiet = argv.includes('--quiet') || argv.includes('-q');
  const rest = argv.filter((a) => a !== '--json' && a !== '--quiet' && a !== '-q');
  const fail = (code, message) => {
    if (json) out(`${JSON.stringify({ error: message })}\n`);
    else err(`rigby: ${message}\n`);
    return code;
  };
  const [name, ...args] = rest;
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    if (name === 'help' && args[0]) return main([args[0], '--help'], io);
    out(`${mainHelp()}\n`);
    return 0;
  }
  if (name === '--version' || name === '-v' || name === 'version') {
    out(json ? `${JSON.stringify({ version: VERSION })}\n` : `${VERSION}\n`);
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!command) return fail(2, `unknown command '${name}' (see rigby --help)`);
  const tools = toolTable(io.cwd);
  if (args.includes('--help') || args.includes('-h')) {
    if (name === 'call' && args[0] && !args[0].startsWith('-')) {
      const tool = tools.get(args[0]);
      if (!tool) return fail(2, `no tool '${args[0]}' (see rigby tools)`);
      out(`${toolHelp(tool)}\n`);
    } else out(`${commandHelp(name)}\n`);
    return 0;
  }
  let result;
  try {
    const parsed = parseArgs(args, command);
    // Output folders are made as needed.
    const target = command.outputOf?.({ ...parsed.positionals, ...parsed.options });
    if (target) await fsp.mkdir(path.dirname(path.resolve(io.cwd ?? process.cwd(), target)), { recursive: true });
    const ctx = { tools, progress: json || quiet ? () => {} : (text) => err(`${text}\n`) };
    result = await command.run({ ...parsed.positionals, ...parsed.options, extra: parsed.extra }, ctx);
  } catch (e) {
    if (e instanceof UsageError) return fail(2, `${e.message}\n  usage: ${name === 'call' ? COMMANDS.call.usage : command.usage}`);
    // Tool messages speak of tool arguments; here they are options.
    if (e instanceof RenderError) return fail(1, e.message);
    if (e instanceof ToolError) return fail(1, e.message.replace(/Pass overwrite: true/g, 'Pass --force'));
    // File system errors are the user's to fix; anything else is a bug worth a stack trace.
    if (e?.code && typeof e.code === 'string' && !process.env.RIGBY_DEBUG) return fail(1, e.message);
    return fail(1, e?.stack ?? String(e));
  }
  if (json) out(`${JSON.stringify(result, null, 2)}\n`);
  else out(`${(command.text ?? formatText)(result)}\n`);
  return command.exit?.(result) ?? 0;
}
