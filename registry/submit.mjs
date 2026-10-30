// SPDX-License-Identifier: MIT OR Apache-2.0
// Checks an add-on submitted with the "Submit an add-on" issue form, and adds it once approved.
// Run by .github/workflows/addon-registry.yml with the issue in ISSUE_BODY and ISSUE_AUTHOR:
//   node registry/submit.mjs report.md            check it, write the report (Markdown) for a comment
//   node registry/submit.mjs report.md --approve  also add registry/addons/<id>.json and update the index
// Prints id=<id> and ok=true|false for $GITHUB_OUTPUT.

import fs from 'node:fs';
import path from 'node:path';

import { addonId } from '../src/editor/addons.js';
import { issueFields, issueTags, parseRepo, TAGS } from '../src/editor/registry.js';
import { ENTRIES, inspect, readEntries, readIndex, writeIndex } from './registry.mjs';

const [out, flag] = process.argv.slice(2);
const approve = flag === '--approve';
const fields = issueFields(process.env.ISSUE_BODY);
const author = process.env.ISSUE_AUTHOR ?? '';
const repo = parseRepo(fields.Repository);
const id = (fields['Add-on id'] || '').trim() || (repo ? addonId(repo.split('/')[1].replace(/^rigby2?d?[-_]/i, '')) : '');
const entry = { id, repo, publisher: author, tags: issueTags(fields.Tags), added: new Date().toISOString().slice(0, 10) };

const lines = [];
const problems = [];
if (!repo) problems.push('The repository must be a GitHub URL, like `https://github.com/you/my-addon`.');
const taken = readEntries().find((e) => e.id === id);
if (taken && parseRepo(taken.repo) !== repo) problems.push(`The id \`${id}\` is taken. Choose another in **Add-on id**.`);
if (!entry.tags.length) problems.push(`Pick at least one tag: ${TAGS.join(', ')}.`);
const agreed = Array.isArray(fields.Checks) ? fields.Checks.length : 0;
if (agreed < 3) problems.push('Tick all three boxes under **Checks**.');

let addon = null;
if (repo && !problems.length) {
  addon = await inspect(entry, null);
  problems.push(...addon.problems);
}
const owner = repo?.split('/')[0].toLowerCase();
if (repo && owner !== author.toLowerCase()) lines.push(`> [!NOTE]\n> The repository belongs to \`${owner}\`, not to you (\`${author}\`). A maintainer checks that you may publish it.\n`);

const ok = !problems.length;
if (ok) {
  const v = addon.versions[0];
  lines.unshift(
    `### ✅ \`${id}\` passed the checks`,
    '',
    `| | |`,
    `| --- | --- |`,
    `| Name | ${addon.name} |`,
    `| Author | ${addon.author} |`,
    `| Versions | ${addon.versions.map((x) => x.version).join(', ')} |`,
    `| Needs Rigby2D | ${v.rigby || 'any'} |`,
    `| License | ${addon.license || '⚠️ none found: add a LICENSE file so people know how they may use it'} |`,
    `| Tags | ${entry.tags.join(', ')} |`,
    '',
    approve ? `Added to the registry: it appears on https://rigby2d.com/addons/ and in the editor's add-on gallery after the next website build. Publish a new GitHub release to ship an update; the registry picks it up within a few hours.` : 'A maintainer reviews the code next. Once approved (the `approved` label), it is listed on rigby2d.com/addons and in the editor.',
  );
  for (const s of addon.skipped ?? []) lines.push(`\n> [!WARNING]\n> Release \`${s.tag}\` was skipped: ${s.problems.join('; ')}`);
  if (approve) {
    fs.writeFileSync(path.join(ENTRIES, `${id}.json`), `${JSON.stringify({ repo, publisher: author, tags: entry.tags, added: entry.added }, null, 2)}\n`);
    const others = readIndex().addons.filter((a) => a.id !== id);
    writeIndex([...others, addon]);
  }
} else {
  lines.unshift(`### ❌ The submission needs changes`, '', ...problems.map((p) => `- ${p}`), '', 'Edit the issue (or push a fixed release) and the checks run again.');
}
lines.push('', '<sub>Checked by registry/submit.mjs. How add-ons are published: https://rigby2d.com/docs/addons.html#publishing</sub>');
fs.writeFileSync(out, lines.join('\n'));
console.log(`id=${id}`);
console.log(`ok=${ok}`);
