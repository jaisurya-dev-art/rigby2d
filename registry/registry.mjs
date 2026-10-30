// SPDX-License-Identifier: MIT OR Apache-2.0
// The add-on registry's GitHub side (Node): reads an add-on's repository, checks its versions, and
// keeps registry/index.json. Used by sync.mjs, submit.mjs and the website build.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAddonPackage } from '../src/editor/addons.js';
import { checkPackage, compareVersions, entryProblems, parseRepo } from '../src/editor/registry.js';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const ENTRIES = path.join(HERE, 'addons');
export const INDEX = path.join(HERE, 'index.json');
const README_LIMIT = 40000;

/** The registry entries: [{ id, ...registry/addons/<id>.json }], by id. */
export function readEntries() {
  return fs
    .readdirSync(ENTRIES)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ id: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(ENTRIES, f), 'utf8')) }));
}

/** registry/index.json, or an empty index. */
export function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  } catch {
    return { updated: null, addons: [] };
  }
}

/** A hash of a package's files (paths and contents), the same however the zip was packed. */
export function packageDigest(files) {
  const h = crypto.createHash('sha256');
  for (const p of [...files.keys()].sort()) {
    h.update(`${p}\0${files.get(p).length}\0`);
    h.update(files.get(p));
  }
  return `sha256-${h.digest('hex')}`;
}

async function github(api, { raw = false } = {}) {
  const headers = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'User-Agent': 'rigby2d-registry' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${api}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${api}: ${res.status} ${res.statusText}`);
  return raw ? res.text() : res.json();
}

/** Downloads a zip and returns its package files (the registry id names it, not the zip's folder). */
export async function downloadPackage(url, id) {
  const res = await fetch(url, { headers: { 'User-Agent': 'rigby2d-registry' } });
  if (!res.ok) throw new Error(`download ${url}: ${res.status} ${res.statusText}`);
  return readAddonPackage(`${id}.zip`, new Uint8Array(await res.arrayBuffer())).files;
}

/** The package of an official add-on (addons/<id> in this repository). */
export function localPackage(dir) {
  const root = path.join(REPO_ROOT, dir);
  const files = new Map();
  for (const f of fs.readdirSync(root, { recursive: true })) {
    const full = path.join(root, f);
    if (fs.statSync(full).isFile() && !String(f).includes('__pycache__')) files.set(String(f).split(path.sep).join('/'), new Uint8Array(fs.readFileSync(full)));
  }
  return files;
}

async function checkVersion(id, source, extra) {
  try {
    const files = await downloadPackage(source, id);
    const { manifest, problems } = checkPackage(id, files);
    const { name = '', description = '', author = '', url = '', rigby = '' } = manifest ?? {};
    return { manifest, problems, version: { version: manifest?.version ?? '', ...extra, rigby, source, digest: packageDigest(files), name, description, author, url } };
  } catch (e) {
    return { manifest: null, problems: [e.message], version: null };
  }
}

/**
 * Reads an add-on's repository and returns its index entry: the details from GitHub, and every
 * version that passes the checks. Versions already in `previous` are kept without downloading them
 * again. Releases are versions; a repository without releases offers its default branch.
 */
export async function inspect(entry, previous = null, log = () => {}) {
  const problems = entryProblems(entry.id, entry);
  const base = { id: entry.id, tags: entry.tags ?? [], publisher: entry.publisher ?? '', added: entry.added ?? '', official: !!entry.official };
  if (entry.path) {
    const files = localPackage(entry.path);
    const check = checkPackage(entry.id, files);
    const readme = files.get('README.md');
    return {
      ...base,
      ...describe(check.manifest),
      repo: 'jaisurya-dev-art/rigby2d',
      path: entry.path,
      readme: readme ? new TextDecoder().decode(readme) : '',
      problems: [...problems, ...check.problems],
      versions: check.manifest ? [{ version: check.manifest.version, rigby: check.manifest.rigby, published: entry.added, digest: packageDigest(files) }] : [],
    };
  }
  const repo = parseRepo(entry.repo);
  if (problems.length) return { ...base, repo, problems, versions: previous?.versions ?? [] };
  const info = await github(`/repos/${repo}`);
  if (!info) return { ...base, repo, problems: [`the repository ${repo} was not found (is it public?)`], versions: previous?.versions ?? [] };
  const known = new Map((previous?.versions ?? []).map((v) => [v.tag ?? `#${v.commit}`, v]));
  const versions = [];
  const skipped = [];
  const releases = ((await github(`/repos/${repo}/releases?per_page=30`)) ?? []).filter((r) => !r.draft && !r.prerelease);
  if (releases.length) {
    for (const r of releases) {
      if (known.has(r.tag_name)) {
        versions.push(known.get(r.tag_name));
        continue;
      }
      const asset = r.assets.find((a) => a.name.toLowerCase().endsWith('.zip'));
      const source = asset?.browser_download_url ?? `https://codeload.github.com/${repo}/zip/refs/tags/${encodeURIComponent(r.tag_name)}`;
      log(`  ${entry.id}: checking release ${r.tag_name}`);
      const check = await checkVersion(entry.id, source, { tag: r.tag_name, published: r.published_at });
      if (check.problems.length) skipped.push({ tag: r.tag_name, problems: check.problems });
      else versions.push(check.version);
    }
  } else {
    const commit = (await github(`/repos/${repo}/commits/${encodeURIComponent(info.default_branch)}`))?.sha;
    if (commit && known.has(`#${commit}`)) versions.push(known.get(`#${commit}`));
    else if (commit) {
      log(`  ${entry.id}: checking ${info.default_branch} at ${commit.slice(0, 7)}`);
      const check = await checkVersion(entry.id, `https://codeload.github.com/${repo}/zip/${commit}`, { commit, published: new Date().toISOString() });
      if (check.problems.length) skipped.push({ tag: info.default_branch, problems: check.problems });
      else versions.push(check.version);
    }
  }
  versions.sort((a, b) => compareVersions(b.version, a.version));
  const readme = await github(`/repos/${repo}/readme`, { raw: true }).catch(() => null);
  return {
    ...base,
    // The details shown come from the newest good version's addon_info.
    ...describe(versions[0]),
    repo,
    homepage: info.homepage || '',
    license: info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : '',
    stars: info.stargazers_count ?? 0,
    archived: !!info.archived,
    readme: readme ? readme.slice(0, README_LIMIT) : '',
    problems: versions.length ? [] : skipped.length ? skipped[0].problems : ['no version found: publish a release, or put the add-on on the default branch'],
    skipped,
    versions,
  };
}

const describe = (m) => (m ? { name: m.name, description: m.description, author: m.author, url: m.url ?? '' } : {});

/** Writes the index when something other than its date changed; returns whether it did. */
export function writeIndex(addons) {
  const old = readIndex();
  const strip = (i) => JSON.stringify(i.addons);
  const next = { updated: new Date().toISOString(), addons: [...addons].sort((a, b) => a.id.localeCompare(b.id)) };
  if (strip(old) === strip(next)) return false;
  fs.writeFileSync(INDEX, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}
