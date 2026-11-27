// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Community demos section (site/communitydemos.js) and its data file.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { checkCommunityDemos, communityDemosSection, licenseText, zipEntries } from '../site/communitydemos.js';

const demo = {
  id: 'forest-spirit',
  title: 'Forest <spirit>',
  author: 'Ada Lin',
  author_url: 'https://ada.art',
  description: 'Meshes and physics on the leaves.',
  tags: ['Meshes', 'Physics'],
  license: 'CC-BY-4.0',
  thumbnail: 'community/forest-spirit.webp',
  file: 'community/forest-spirit.rigby',
  source: 'https://discord.com/channels/1/2/3',
};

test('community demos: an invitation while there are none, cards with credit and license after', () => {
  const empty = communityDemosSection({ demos: [] });
  assert.match(empty, /id="community"/);
  assert.match(empty, /Be the first/);
  assert.match(empty, /template=demo-submission\.yml/);
  assert.match(empty, /no AI-generated images/);

  const html = communityDemosSection({ demos: [demo, { ...demo, id: 'linked', file: undefined, download: 'https://ada.itch.io/spirit', source: undefined }] }, { 'forest-spirit': 3 * 1048576 });
  assert.match(html, /<h3>Forest &lt;spirit&gt;<\/h3>/, 'text is escaped');
  assert.match(html, /By <a href="https:\/\/ada\.art" rel="noopener">Ada Lin<\/a>/);
  assert.match(html, /<a href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/" rel="noopener license">CC BY 4\.0<\/a>: credit Ada Lin/);
  // A hosted project downloads as a zip with its license; a link opens the author's page.
  assert.match(html, /href="\.\/community\/rigby2d-community-forest-spirit\.zip" download/);
  assert.match(html, /credit Ada Lin when you use it\.<br \/>Zip: <code>forest-spirit\.rigby<\/code> and its license · 3\.0 MB<\/p>/);
  assert.match(html, /href="https:\/\/ada\.itch\.io\/spirit" rel="noopener"/);
  assert.equal((html.match(/See the post/g) ?? []).length, 1);
  assert.match(html, /Submit a demo/);
});

test('community demos: the data is checked before it goes live', () => {
  assert.deepEqual(checkCommunityDemos({ demos: [demo] }), []);
  const problems = checkCommunityDemos(
    { demos: [{ ...demo, id: 'Bad Id' }, { ...demo, license: 'MIT' }, { ...demo, id: 'x', file: undefined }, { ...demo, id: 'x', download: 'http://insecure' }, { ...demo, id: 'y', title: '' }] },
    (f) => f !== 'community/forest-spirit.webp',
  );
  for (const p of [/'Bad Id': id must be lowercase/, /license must be one of/, /'x': needs a hosted file or a download link/, /'x': id used twice/, /download must be an https link/, /'y': title is missing/, /community\/forest-spirit\.webp is not in site\/demos/]) {
    assert.ok(problems.some((m) => p.test(m)), `${p} in ${problems.join(' | ')}`);
  }
});

test('community demos: the published data file is valid', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../site/community-demos.json', import.meta.url), 'utf8'));
  const site = new URL('../site/demos/', import.meta.url);
  assert.deepEqual(checkCommunityDemos(data, (f) => fs.existsSync(new URL(f, site))), []);
});

test('community demos: the zip holds the project and a LICENSE.md with the credit to give', () => {
  const text = licenseText(demo);
  assert.match(text, /^# Forest <spirit>\n\nBy Ada Lin \(https:\/\/ada\.art\)\./);
  assert.match(text, /## License: CC BY 4\.0\n\nThis work is licensed under CC BY 4\.0: https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  assert.match(text, /even commercially, as long as you give credit/);
  assert.match(text, /> "Forest <spirit>" by Ada Lin \(https:\/\/ada\.art\), CC BY 4\.0/);
  assert.match(licenseText({ ...demo, license: 'CC0-1.0' }), /Suggested credit:/);
  const entries = zipEntries(demo, (f) => new TextEncoder().encode(`bytes of ${f}`));
  assert.deepEqual(
    entries.map((e) => e.path),
    ['rigby2d-community-forest-spirit/forest-spirit.rigby', 'rigby2d-community-forest-spirit/LICENSE.md'],
  );
  assert.equal(new TextDecoder().decode(entries[0].bytes), 'bytes of community/forest-spirit.rigby');
});
