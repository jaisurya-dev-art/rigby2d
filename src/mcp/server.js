#!/usr/bin/env node
// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D MCP server: lets AI assistants inspect, validate, sample, edit and convert Rigby2D projects
// over the Model Context Protocol (stdio transport). Usage:
//   node src/mcp/server.js [--root <dir>]...
// Each --root is a folder the tools may read and write (default: the current folder).

import fs from 'node:fs';

import { createServer, serveStdio } from './protocol.js';
import { createEditTools } from './edits.js';
import { createFilmTools } from './film.js';
import { createRiggingTools } from './rigging.js';
import { createScriptTools } from './scripting.js';
import { createSceneTools } from './scene.js';
import { Workspace, createTools } from './tools.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const log = (text) => process.stderr.write(`rigby2d-mcp: ${text}\n`);

const HELP = `Rigby2D MCP server ${version}

Usage: rigby2d-mcp [--root <dir> | <dir>]...

Serves the Model Context Protocol over stdin/stdout for AI assistants.
  --root <dir>   Folder the tools may access (repeatable; default: current folder).
  <dir>          The same, without --root.
  --help         Show this help.
  --version      Show the version.

Read:  inspect_project, describe_rig, describe_animation, sample_pose, validate_project
Write: convert_project, add_bone, set_bone_setup, add_animation, set_bone_key,
       delete_bone_key, set_attachment_key, set_event_key`;

function parseArgs(argv) {
  const roots = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--version' || arg === '-v') return { version: true };
    if (arg === '--root') {
      if (!argv[i + 1]) throw new Error('--root needs a folder');
      roots.push(argv[++i]);
    } else if (arg.startsWith('--root=')) roots.push(arg.slice('--root='.length));
    // A plain folder is a root too (MCP bundles pass each folder the user picked as one argument).
    else if (!arg.startsWith('-')) roots.push(arg);
    else throw new Error(`unknown argument '${arg}' (see --help)`);
  }
  return { roots };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    log(e.message);
    process.exit(2);
  }
  if (args.help) return void process.stdout.write(`${HELP}\n`);
  if (args.version) return void process.stdout.write(`${version}\n`);

  let workspace;
  try {
    workspace = await Workspace.open(args.roots);
  } catch (e) {
    log(e.message);
    process.exit(2);
  }
  const server = createServer({
    name: 'rigby2d',
    title: 'Rigby2D',
    version,
    instructions:
      'Tools for Rigby2D 2D skeletal animation projects: .rigby work files and skeleton .json / .skel exports. ' +
      'Start with inspect_project, use describe_rig and describe_animation for structure, sample_pose to evaluate poses with the runtime ' +
      '(world coordinates, Y up, degrees), validate_project to find problems and convert_project to write other formats. ' +
      'Editing tools (add_bone, set_bone_setup, add_animation, set_bone_key, delete_bone_key, set_attachment_key, set_event_key) ' +
      'save the file they are given in its own format, or a copy when output is set; check results with sample_pose or validate_project. ' +
      '.rigby work files also hold the workspace (set_workspace), film output settings (set_output), the pose library (save_pose, apply_pose), ' +
      'face controls (add_face_control, set_face_control), and audio tracks with lip-sync (add_audio_track, lip_sync); inspect_project lists them. ' +
      'run_script runs a Python script with the rigby scripting API for anything the other tools do not cover (dry_run: true for queries). ' +
      'Scenes: add_actor puts characters (other .rigby files) on a stage, add_clip places their animations on the scene shots, set_actor and set_layer_depth stage them. autorig rigs layered artwork (a PSD or an unrigged .rigby) in one step; detect_parts previews it. retarget_animation copies animations between characters (map_bones previews the bone matching). ' +
      'Rendering video is done in the editor (File > Render animation). ' +
      `Files must be inside the workspace: ${workspace.roots.join(', ')}.`,
    tools: [...createTools(workspace), ...createEditTools(workspace), ...createFilmTools(workspace), ...createRiggingTools(workspace), ...createSceneTools(workspace), ...createScriptTools(workspace)],
    log,
  });
  log(`ready (workspace: ${workspace.roots.join(', ')})`);
  await serveStdio(server, process.stdin, process.stdout, log);
}

main();
