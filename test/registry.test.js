// SPDX-License-Identifier: MIT OR Apache-2.0
// The add-on registry: reading addon_info without Python, the checks on entries and packages, the
// submission form, the GitHub sync (with GitHub faked) and the README rendering on the website.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPackage, entryProblems, issueFields, issueTags, latestVersion, parseRepo, readAddonInfo, searchText } from '../src/editor/registry.js';
import { zip } from '../src/editor/zip.js';
import { inspect, packageDigest } from '../registry/registry.mjs';
import { readmeHtml } from '../site/addons/pages.js';

const enc = new TextEncoder();
const INFO = `# SPDX
addon_info = {
    "name": "Mirror tools",   # shown in the gallery
    'version': (1, 2, 0),
    "author": "Ana " "Lima",
    "description": """Mirror bones
across X = 0.""",
    "rigby": (0, 4, 1),
    "flags": [True, False, None, -2.5, 1_000],
}

import rigby
`;

test('addon_info is read as a Python literal, without running anything', () => {
  assert.deepEqual(readAddonInfo(INFO), {
    name: 'Mirror tools',
    version: [1, 2, 0],
    author: 'Ana Lima',
    description: 'Mirror bones\nacross X = 0.',
    rigby: [0, 4, 1],
    flags: [true, false, null, -2.5, 1000],
  });
  assert.equal(readAddonInfo('import rigby\n'), null);
  assert.deepEqual(readAddonInfo(`addon_info = {"name": 'it\\'s \\u00e9', "n": r"a\\b"}`), { name: "it's é", n: 'a\\b' });
  assert.throws(() => readAddonInfo('addon_info = {"name": compute()}'), /not a plain literal/);
  assert.throws(() => readAddonInfo('addon_info = {"name": "x"'), /not a plain literal/);
});

test('repositories are read from URLs or owner/name', () => {
  assert.equal(parseRepo('https://github.com/ana/rigby-mirror'), 'ana/rigby-mirror');
  assert.equal(parseRepo('https://github.com/ana/rigby-mirror.git'), 'ana/rigby-mirror');
  assert.equal(parseRepo('ana/rigby.mirror/'), 'ana/rigby.mirror');
  assert.equal(parseRepo('https://gitlab.com/ana/x'), null);
  assert.equal(parseRepo('https://github.com/ana'), null);
});

test('registry entries need a valid id, a repository and known tags', () => {
  assert.deepEqual(entryProblems('mirror_tools', { repo: 'ana/x', tags: ['rigging'] }), []);
  assert.deepEqual(entryProblems('mirror_tools', { path: 'addons/mirror_tools', official: true, tags: ['rigging'] }), []);
  const bad = entryProblems('Mirror-Tools', { repo: 'nope', tags: ['magic'], official: true });
  assert.equal(bad.length, 4);
  assert.match(bad.join('\n'), /id/);
  assert.match(bad.join('\n'), /unknown tag "magic"/);
  assert.match(bad.join('\n'), /only the add-ons in addons\/ are official/);
});

test('packages are checked for addon_info, file types and size', () => {
  const files = new Map([
    ['__init__.py', enc.encode(INFO)],
    ['ops/flip.py', enc.encode('x = 1')],
    ['README.md', enc.encode('# Mirror')],
  ]);
  const ok = checkPackage('mirror_tools', files);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.manifest.version, '1.2.0');
  assert.equal(ok.manifest.rigby, '0.4.1');

  files.set('lib/fast.pyd', new Uint8Array(4));
  files.set('__init__.py', enc.encode('addon_info = {"name": "X", "version": "beta"}'));
  const bad = checkPackage('x', files).problems.join('\n');
  assert.match(bad, /fast\.pyd/);
  assert.match(bad, /numbers/);
  assert.match(bad, /no "description"/);
  assert.match(bad, /no "author"/);
  assert.deepEqual(checkPackage('x', new Map()).problems, ['no __init__.py']);
});

test('the newest version the editor can run is installed', () => {
  const addon = { versions: [{ version: '1.0.0' }, { version: '2.0.0', rigby: '0.9' }, { version: '1.5.0', rigby: '0.4.1' }] };
  assert.equal(latestVersion(addon, '0.4.2').version, '1.5.0');
  assert.equal(latestVersion(addon, '').version, '2.0.0');
  assert.equal(latestVersion({ versions: [] }), null);
});

test('the submission form is read field by field', () => {
  const body = `### Repository

https://github.com/ana/rigby-mirror

### Add-on id

_No response_

### Tags

Rigging, export

### Checks

- [X] I wrote this add-on
- [x] It does only what it says
- [ ] I agree`;
  const f = issueFields(body);
  assert.equal(f.Repository, 'https://github.com/ana/rigby-mirror');
  assert.equal(f['Add-on id'], '');
  assert.deepEqual(issueTags(f.Tags), ['rigging', 'export']);
  assert.deepEqual(f.Checks, ['I wrote this add-on', 'It does only what it says']);
  assert.ok(searchText({ name: 'Mirror', description: 'flip', author: 'Ana', publisher: 'ana', tags: ['rigging'] }).includes('rigging'));
});

test('the sync lists good releases and skips broken ones', async (t) => {
  const pkg = (version) => zip([{ path: 'rigby-mirror-1/__init__.py', bytes: enc.encode(INFO.replace('(1, 2, 0)', version)) }]);
  const routes = {
    'https://api.github.com/repos/ana/rigby-mirror': { default_branch: 'main', stargazers_count: 12, license: { spdx_id: 'MIT' }, homepage: '' },
    'https://api.github.com/repos/ana/rigby-mirror/releases?per_page=30': [
      { tag_name: 'v1.2.0', published_at: '2026-11-01T00:00:00Z', assets: [{ name: 'mirror.zip', browser_download_url: 'https://dl/mirror-1.2.0.zip' }] },
      { tag_name: 'v1.3.0', published_at: '2026-11-02T00:00:00Z', assets: [] },
      { tag_name: 'v2.0.0-beta', prerelease: true, assets: [] },
    ],
    'https://api.github.com/repos/ana/rigby-mirror/readme': '# Mirror\n\nFlips bones.',
    'https://dl/mirror-1.2.0.zip': pkg('(1, 2, 0)'),
    'https://codeload.github.com/ana/rigby-mirror/zip/refs/tags/v1.3.0': zip([{ path: 'x/readme.md', bytes: enc.encode('no package') }]),
  };
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetched.push(url);
    const body = routes[url];
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body instanceof Uint8Array ? body : typeof body === 'string' ? body : JSON.stringify(body));
  });
  const entry = { id: 'mirror_tools', repo: 'ana/rigby-mirror', publisher: 'ana', tags: ['rigging'], added: '2026-11-01' };
  const a = await inspect(entry);
  assert.deepEqual(a.problems, []);
  assert.deepEqual(
    a.versions.map((v) => [v.version, v.tag]),
    [['1.2.0', 'v1.2.0']],
  );
  assert.equal(a.skipped[0].tag, 'v1.3.0');
  assert.equal(a.name, 'Mirror tools');
  assert.equal(a.stars, 12);
  assert.equal(a.license, 'MIT');
  assert.match(a.versions[0].digest, /^sha256-[0-9a-f]{64}$/);

  // A second sync downloads only what it has not seen.
  fetched.length = 0;
  const again = await inspect(entry, a);
  assert.deepEqual(again.versions, a.versions);
  assert.ok(!fetched.includes('https://dl/mirror-1.2.0.zip'));
});

test('the package digest ignores how the zip was packed', () => {
  const a = new Map([['a.py', enc.encode('1')], ['b/c.py', enc.encode('2')]]);
  const b = new Map([['b/c.py', enc.encode('2')], ['a.py', enc.encode('1')]]);
  assert.equal(packageDigest(a), packageDigest(b));
  b.set('a.py', enc.encode('3'));
  assert.notEqual(packageDigest(a), packageDigest(b));
});

test('READMEs from other repositories render without raw HTML or script links', () => {
  const html = readmeHtml('# Title\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [docs](docs/use.md) ![shot](img/a.png)\n\n## Usage', 'ana/rigby-mirror');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('href="https://github.com/ana/rigby-mirror/blob/HEAD/docs/use.md"'));
  assert.ok(html.includes('src="https://raw.githubusercontent.com/ana/rigby-mirror/HEAD/img/a.png"'));
  assert.ok(!html.includes('Title'), 'the first heading is the page title already');
  assert.ok(html.includes('<h3>Usage</h3>'));
});
