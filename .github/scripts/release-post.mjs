// SPDX-License-Identifier: MIT OR Apache-2.0
// Turns a published GitHub release into a devlog post (site/blog/posts/<date>-rigby2d-<version>.md),
// so every release reaches the devlog, its RSS feed and the editor's What's new. Run by
// .github/workflows/release-post.yml when a release is published; a post that already exists for
// the version (written by hand first) is left alone.
// Usage: node .github/scripts/release-post.mjs <tag> <published date> <notes file> [release name]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/jaisurya-dev-art/rigby2d';
const POSTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site/blog/posts');

/** Markdown inline marks as plain text: **b**, *i*, `c`, [text](url). */
const plain = (s) =>
  s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** At most `max` characters, cut at a word, with an ellipsis. */
function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}…`;
}

/**
 * The devlog post for a release: { slug, file, text }. `notes` is the release body (Markdown): its
 * first paragraph becomes the summary; the sections up to "Downloads" become the post.
 */
export function releasePost({ tag, date, notes, name = '' }) {
  const version = tag.replace(/^v/, '');
  const slug = `rigby2d-${version.replace(/[^0-9a-z]+/gi, '-')}`;
  const body = String(notes ?? '').replace(/\r\n/g, '\n');
  const cut = body.search(/^## (Downloads|SHA-256|License)/m);
  const kept = (cut < 0 ? body : body.slice(0, cut)).trim();
  const paragraphs = kept.split(/\n{2,}/);
  const first = paragraphs.find((p) => p.trim() && !p.startsWith('#')) ?? '';
  const upper = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const summary = upper(clip(plain(first).replace(/^Rigby2D \S+:\s*/, ''), 220));
  // The title: the release's own name when it says more than the version, else the summary's lead.
  const lead = clip(plain(first).replace(/^Rigby2D \S+:\s*/, '').split(/[.;]/)[0], 70);
  const title = name && name.replace(/^Rigby2D\s+v?[\d.]+\s*[:-]?\s*/, '') ? name : `Rigby2D ${version}${lead ? `: ${lead}` : ''}`;
  const rest = paragraphs.filter((p) => p !== first).join('\n\n').trim();
  const text = `---
title: ${title.replace(/\n/g, ' ')}
date: ${date}
summary: ${summary}
tag: Release
---

${plain(first) ? first.trim() : `Rigby2D ${version} is out.`}

[Download ${version}](${REPO}/releases/tag/${tag}) or [open the editor in your browser](https://rigby2d.com/editor/).
${rest ? `\n${rest}\n` : ''}
The full release notes, every download and their checksums are on the
[release page](${REPO}/releases/tag/${tag}). Installed copies offer the update by themselves.
`;
  return { slug, file: `${date}-${slug}.md`, text };
}

/** Whether a post for this release's slug exists already (whatever its date). */
export function postExists(slug, dir = POSTS) {
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(`-${slug}.md`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [tag, published, notesFile, name] = process.argv.slice(2);
  if (!tag || !published || !notesFile) throw new Error('usage: release-post.mjs <tag> <published date> <notes file> [name]');
  if (/-(alpha|beta|rc)/i.test(tag)) {
    console.log(`${tag}: a pre-release, no post`);
    process.exit(0);
  }
  const post = releasePost({ tag, date: published.slice(0, 10), notes: fs.readFileSync(notesFile, 'utf8'), name });
  if (postExists(post.slug)) {
    console.log(`${post.slug}: a post exists already`);
    process.exit(0);
  }
  fs.writeFileSync(path.join(POSTS, post.file), post.text);
  console.log(`site/blog/posts/${post.file}`);
}
