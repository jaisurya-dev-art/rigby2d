// SPDX-License-Identifier: MIT OR Apache-2.0
// The Demos page's Community demos section, from site/community-demos.json (kept by hand, from the
// submission form .github/ISSUE_TEMPLATE/demo-submission.yml): rigs people made in Rigby2D and
// share for others to learn from. Rendered at build time (vite.config.js replaces the page's
// <!--community-demos--> marker), so it is plain HTML. Thumbnails, and files the author lets us host,
// live in site/demos/community/; paths in the data are relative to site/demos/ (community/x.png).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The licenses a community demo may use: the label shown and the license's page. */
export const LICENSES = {
  'CC-BY-4.0': ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  'CC-BY-SA-4.0': ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  'CC-BY-NC-4.0': ['CC BY-NC 4.0', 'https://creativecommons.org/licenses/by-nc/4.0/'],
  'CC0-1.0': ['CC0 (public domain)', 'https://creativecommons.org/publicdomain/zero/1.0/'],
};

const FORM = 'https://github.com/jaisurya-dev-art/rigby2d/issues/new?template=demo-submission.yml';
const DISCORD = 'https://discord.gg/PGgaTwbNH';

/**
 * Problems with the data, as messages (none when it is fine): every demo needs an id, a title, an
 * author, a description, a known license, a thumbnail, and a file to download (hosted here or a
 * link), and ids are unique. `exists(path)` checks a site file.
 */
export function checkCommunityDemos(data, exists = () => true) {
  const problems = [];
  const seen = new Set();
  for (const [i, d] of (data?.demos ?? []).entries()) {
    const at = d?.id ? `'${d.id}'` : `#${i + 1}`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(d?.id ?? '')) problems.push(`${at}: id must be lowercase letters, digits and '-'`);
    else if (seen.has(d.id)) problems.push(`${at}: id used twice`);
    seen.add(d?.id);
    for (const f of ['title', 'author', 'description', 'thumbnail']) if (!d?.[f]) problems.push(`${at}: ${f} is missing`);
    if (!LICENSES[d?.license]) problems.push(`${at}: license must be one of ${Object.keys(LICENSES).join(', ')}`);
    if (!d?.file && !d?.download) problems.push(`${at}: needs a hosted file or a download link`);
    if (d?.download && !/^https:\/\//.test(d.download)) problems.push(`${at}: download must be an https link`);
    for (const f of ['thumbnail', 'file']) if (d?.[f] && !exists(d[f])) problems.push(`${at}: ${d[f]} is not in site/demos/`);
  }
  return problems;
}

/** Where a hosted file is published: site/demos/community/x.jpg -> demos/community/x.jpg. */
export const publishedPath = (file) => `demos/${file}`;

/** The download of a hosted demo, relative to the Demos page: its project and license, zipped. */
export const zipName = (d) => `community/rigby2d-community-${d.id}.zip`;

/** What each license lets people do, in a sentence (the license's page has the full terms). */
const TERMS = {
  'CC-BY-4.0': 'You may share and adapt it for any purpose, even commercially, as long as you give credit.',
  'CC-BY-SA-4.0': 'You may share and adapt it for any purpose, even commercially, as long as you give credit and share your changes under the same license.',
  'CC-BY-NC-4.0': 'You may share and adapt it with credit, but not for commercial purposes.',
  'CC0-1.0': 'The author has given it to the public domain: use it for anything, no credit required (though it is appreciated).',
};

/** LICENSE.md in a demo's zip: what it is, who made it, its license and how to credit it. */
export function licenseText(d) {
  const [license, url] = LICENSES[d.license];
  const by = `${d.author}${d.author_url ? ` (${d.author_url})` : ''}`;
  return [
    `# ${d.title}`,
    '',
    `By ${by}. Made in Rigby2D and shared at https://rigby2d.com/demos/#community-${d.id}.`,
    '',
    `## License: ${license}`,
    '',
    `This work is licensed under ${license}: ${url}`,
    '',
    TERMS[d.license],
    '',
    d.license === 'CC0-1.0' ? 'Suggested credit:' : 'Credit it like this:',
    '',
    `> "${d.title}" by ${by}, ${license}`,
    '',
    'The license covers this project and its artwork. Rigby2D itself is open source (MIT OR Apache-2.0); the Rigby2D name and logo are not part of this license.',
    '',
  ].join('\n');
}

/** The zip of a hosted demo: { path, bytes } entries in a folder named after it. `read(file)` gives a file's bytes. */
export function zipEntries(d, read) {
  const folder = `rigby2d-community-${d.id}`;
  return [
    { path: `${folder}/${d.file.split('/').pop()}`, bytes: read(d.file) },
    { path: `${folder}/LICENSE.md`, bytes: new TextEncoder().encode(licenseText(d)) },
  ];
}

function card(d, sizes) {
  const [license, licenseUrl] = LICENSES[d.license];
  const by = d.author_url ? `<a href="${esc(d.author_url)}" rel="noopener">${esc(d.author)}</a>` : esc(d.author);
  const download = d.file ? `./${esc(zipName(d))}` : esc(d.download);
  const zipped = d.file ? `<br />Zip: <code>${esc(d.file.split('/').pop())}</code> and its license${sizes?.[d.id] ? ` · ${(sizes[d.id] / 1048576).toFixed(1)} MB` : ''}` : '';
  return `<article class="demo community-demo" id="community-${esc(d.id)}">
            <img class="demo-thumb" src="./${esc(d.thumbnail)}" alt="${esc(d.title)}, by ${esc(d.author)}" width="480" height="360" loading="lazy" />
            <div class="demo-body">
              <h3>${esc(d.title)}</h3>
              <p class="community-by">By ${by}</p>
              <p>${esc(d.description)}</p>
              ${d.tags?.length ? `<ul class="tags">${d.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
              <p class="demo-files community-license"><a href="${esc(licenseUrl)}" rel="noopener license">${esc(license)}</a>: credit ${esc(d.author)} when you use it.${zipped}</p>
              <div class="demo-actions">
                <a class="btn primary" href="${download}" ${d.file ? 'download' : 'rel="noopener"'} data-goatcounter-click="site-community-demo-${esc(d.id)}">Download</a>
                ${d.source ? `<a class="btn" href="${esc(d.source)}" rel="noopener">See the post</a>` : ''}
              </div>
            </div>
          </article>`;
}

/** The section: the community's demos, or an invitation to share the first one. `sizes`: zip sizes by id. */
export function communityDemosSection(data, sizes = {}) {
  const list = data?.demos ?? [];
  const share = `<div class="demo-actions">
            <a class="btn primary" href="${FORM}" rel="noopener" data-goatcounter-click="site-community-demo-submit">Submit a demo</a>
            <a class="btn" href="${DISCORD}" rel="noopener" data-goatcounter-click="site-community-demo-discord">Share it on Discord first</a>
          </div>`;
  return `<section class="section community-demos" id="community" aria-labelledby="community-title">
        <div class="wrap">
          <p class="eyebrow">Community demos</p>
          <h2 id="community-title">Made by the community</h2>
          <p class="section-lede">Rigs people made in Rigby2D and share for others to learn from, each under the license its author chose. All the art is drawn by hand.</p>
          ${
            list.length
              ? `<div class="demo-list">
          ${list.map((d) => card(d, sizes)).join('\n          ')}
          </div>
          <div class="community-share"><p><b>Made a rig you're proud of?</b> Share it here: your name goes on it, and others learn from it.</p>${share}</div>`
              : `<div class="community-share community-empty">
            <p><b>Be the first.</b> Rigged a character in Rigby2D? Share the project here so others can open it and learn how it's built. Your name goes on it, and you choose the license.</p>
            <ul class="community-rules">
              <li>Your own art, drawn by hand: no AI-generated images.</li>
              <li>A <code>.rigby</code> project, with a picture of it.</li>
              <li>A license you choose: CC BY 4.0 lets anyone use it with credit.</li>
            </ul>
            ${share}
          </div>`
          }
        </div>
      </section>`;
}
