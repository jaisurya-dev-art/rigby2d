// SPDX-License-Identifier: MIT OR Apache-2.0
// The comparison pages (rigby2d.com/vs/<tool>/): Rigby2D next to Spine, DragonBones, Moho and Toon
// Boom Harmony, for people looking for an alternative. They stay honest: each says where the other
// tool is stronger. Facts about other tools were checked on their own sites (October 2026); prices
// change, so each page links to the source. Written by vite.config.js as vs/<slug>/index.html.

import { brandIcon, NAV_SCRIPT, siteFooter, siteHeader } from '../chrome.js';

const SITE = 'https://rigby2d.com';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What Rigby2D brings to every comparison. */
const RIGBY = {
  price: 'Free, forever',
  license: 'Open source (MIT OR Apache-2.0); ship games with no fee and no revenue limit',
  platforms: 'Windows, macOS, Linux, and the full editor in your browser',
  rigging: 'Bones, weighted meshes, IK, transform, path, physics and slider constraints, clipping, skins',
  setup: 'AutoRig: a layered PSD becomes an editable rig in one step',
  film: 'Film workspace: camera, audio tracks, renders to PNG sequences, WebM with alpha and MP4 at 4K',
  lipsync: 'Lip-sync from audio, transcribed on your computer',
  runtimes: 'Godot, Unity, Phaser, JavaScript and Rust, free and open source',
  automation: 'Python scripting, add-ons, and a built-in MCP server for AI assistants',
};

export const COMPARISONS = [
  {
    slug: 'spine',
    name: 'Spine',
    title: 'A free, open-source alternative to Spine',
    lede: 'Rigby2D opens your Spine exports without loss and plays them with free runtimes: meshes, IK, physics and every animation, with no license to buy before you ship.',
    rows: [
      ['Price', RIGBY.price, 'Essential $69, Professional $379, Enterprise from $2,499 + $379 per user (perpetual license)'],
      ['License to ship', RIGBY.license, 'An editor license is needed to use the runtimes; companies over $500,000 a year in revenue or funding need Enterprise'],
      ['Meshes and IK', 'Included', 'Professional and Enterprise only (not in Essential)'],
      ['Rigging', RIGBY.rigging, 'Bones, meshes and weights, IK, transform, path and physics constraints, clipping, skins'],
      ['Setup from art', RIGBY.setup, 'Import images or a PSD with a script; rigging by hand'],
      ['Animation and film', RIGBY.film, 'Exports images and video of animations'],
      ['Runtimes', RIGBY.runtimes, 'Official runtimes for many engines and frameworks'],
      ['Your Spine files', 'Opens Spine JSON and .skel (3.8 to 4.3) and writes them back without loss', '-'],
      ['Automation', RIGBY.automation, 'Command line export'],
    ],
    stronger: [
      'A mature ecosystem: over a decade of use in shipped games, a large community, and many official runtimes, including engines Rigby2D does not cover yet.',
      'Long-standing documentation, examples and third-party tutorials.',
    ],
    switching: 'Export from Spine as JSON or binary (.skel) with your atlas, then open it in Rigby2D with File ▸ Open. Rigby2D reads Spine 3.8 to 4.3 data and keeps everything it reads; File ▸ Import ▸ Check a skeleton file reports what carries over before you switch.',
    guide: 'migrating-from-spine.html',
    source: 'https://esotericsoftware.com/spine-purchase',
    faq: [
      ['Can I use my Spine projects in Rigby2D?', 'Yes. Export them from Spine as JSON or .skel with their atlas and open them in Rigby2D. They become Rigby2D projects you can keep editing and export again, including back to the Spine formats.'],
      ['Do I need a license to ship a game made with Rigby2D?', 'No. The editor and the runtimes are open source under MIT OR Apache-2.0: there is no fee and no revenue limit.'],
      ['Does Rigby2D play Spine physics and meshes?', 'Yes: weighted meshes, deform keys, IK, transform, path and physics constraints, clipping, skins and events all play in the Rigby2D runtimes.'],
    ],
  },
  {
    slug: 'dragonbones',
    name: 'DragonBones',
    title: 'Keep your DragonBones characters alive, in a free desktop editor',
    lede: 'Rigby2D opens DragonBones projects directly, nested weapons and effects included, checked against the DragonBones runtime itself. Keep editing on a free, open-source desktop editor and ship to modern engines.',
    rows: [
      ['Price', RIGBY.price, 'Free'],
      ['Desktop editor', 'Windows, macOS and Linux, updated with every release', 'DragonBones Pro is no longer updated; its team now makes LoongBones, a web editor'],
      ['Your DragonBones files', 'Opens _ske.json with its atlas: bones, meshes and weights, IK, skins, nested armatures and every animation', '-'],
      ['Accuracy', 'Checked against the DragonBones runtime on its demo characters: bones, images and colors match within rounding', '-'],
      ['Rigging', RIGBY.rigging, 'Bones, meshes and weights, IK, skins'],
      ['Animation and film', RIGBY.film, 'Exports images and sequences'],
      ['Runtimes', RIGBY.runtimes, 'DragonBones runtimes for several engines'],
      ['Automation', RIGBY.automation, '-'],
    ],
    stronger: ['Existing DragonBones runtimes are already built into some engines (such as Cocos Creator), so a game that uses them needs no new runtime.', 'LoongBones runs in the browser with nothing to install (Rigby2D also has a browser editor).'],
    switching: 'Open the _ske.json in Rigby2D with File ▸ Open, with its _tex.json and _tex.png next to it. The character becomes a Rigby2D project; export it to any Rigby2D runtime.',
    guide: 'migrating-from-dragonbones.html',
    source: 'https://github.com/DragonBones',
    faq: [
      ['Does Rigby2D open DragonBones projects?', 'Yes: DragonBones 4.5 and 5.x data with its texture atlas, including meshes, weights, IK, skins, nested armatures (weapons and effects in slots) and every animation timeline.'],
      ['How close is the result?', 'Rigby2D was compared with the official DragonBones runtime on DragonBones\' demo characters: across 55 animations every bone, nested bone, image and color matches within rounding.'],
      ['Is DragonBones still developed?', 'The DragonBones Pro desktop editor is no longer updated. Its team now makes LoongBones, a web editor. Rigby2D gives DragonBones projects a desktop editor that keeps moving forward.'],
    ],
  },
  {
    slug: 'moho',
    name: 'Moho',
    title: 'A free alternative to Moho for 2D character animation',
    lede: 'Rig a layered character in one step, animate it with a dopesheet and graph editor, lip-sync it from audio and render it at 4K, then ship the same character to a game engine. Free and open source.',
    rows: [
      ['Price', RIGBY.price, 'Moho Debut $59.99, Moho Pro $399.99 (one-time purchase)'],
      ['Platforms', RIGBY.platforms, 'Windows and macOS'],
      ['Setup from art', RIGBY.setup, 'Import images and PSDs; rigging by hand'],
      ['Rigging', RIGBY.rigging, 'Vector and bitmap rigging with bones, smart bones and physics'],
      ['Lip-sync', RIGBY.lipsync, 'Lip-sync tools'],
      ['Film output', RIGBY.film, 'Renders to video and image sequences'],
      ['Game engines', RIGBY.runtimes, 'Mainly built for video output'],
      ['Automation', RIGBY.automation, 'Lua scripting'],
    ],
    stronger: ['Vector drawing tools: draw and animate shapes in the same app (Rigby2D animates images you draw elsewhere).', 'Smart bones and frame-by-frame drawing for traditional animation.'],
    switching: 'Export your character\'s layers as a PSD (or PNGs) from your art tool, then use File ▸ AutoRig artwork in Rigby2D to get an editable rig in one step.',
    guide: 'quick-start.html',
    source: 'https://moho.lostmarble.com/',
    faq: [
      ['Can Rigby2D replace Moho for YouTube or film work?', 'For character animation with cut-out rigs, yes: the Film workspace has a camera, audio tracks, lip-sync from audio, and renders PNG sequences, WebM with alpha and MP4 at 4K. For vector drawing, keep your drawing tool and animate the art in Rigby2D.'],
      ['Is Rigby2D really free for commercial work?', 'Yes. It is open source under MIT OR Apache-2.0, with no fee for commercial use.'],
    ],
  },
  {
    slug: 'toon-boom',
    name: 'Toon Boom Harmony',
    title: 'A free alternative to Toon Boom Harmony for cut-out animation',
    lede: 'For rigged, cut-out characters, Rigby2D gives you bones, meshes, IK and physics, lip-sync from audio, a film camera and 4K renders, with no subscription. And the same character plays in game engines.',
    rows: [
      ['Price', RIGBY.price, 'Subscription: Essentials $30, Advanced $77, Premium $139 per month (list prices)'],
      ['Platforms', RIGBY.platforms, 'Desktop app'],
      ['Cut-out rigging', RIGBY.rigging, 'Deformers, pegs and node-based rigging'],
      ['Setup from art', RIGBY.setup, 'Import art and rig it by hand'],
      ['Lip-sync', RIGBY.lipsync, 'Lip-sync detection'],
      ['Film output', RIGBY.film, 'Full production rendering and compositing'],
      ['Game engines', RIGBY.runtimes, 'Mainly built for TV and film production'],
      ['Automation', RIGBY.automation, 'Scripting'],
    ],
    stronger: ['A complete production pipeline: drawing, paint, node compositing and effects, used by TV and film studios.', 'Frame-by-frame and paperless traditional animation.'],
    switching: 'Export your character\'s layers as a PSD, then use File ▸ AutoRig artwork in Rigby2D. Render in the Film workspace, or ship the same rig to a game.',
    guide: 'film.html',
    source: 'https://shop.toonboom.com/en/products/harmony',
    faq: [
      ['Is Rigby2D a full replacement for Harmony?', 'For cut-out character animation, it covers rigging, animation, lip-sync and rendering for free. Harmony is a complete studio pipeline with drawing and compositing that Rigby2D does not try to replace.'],
      ['Can I use Rigby2D characters in games too?', 'Yes. The same rig plays in Godot, Unity, Phaser, the browser and Rust with the free Rigby2D runtimes.'],
    ],
  },
];

/** The page for one comparison. */
export function comparePage(c) {
  const rows = c.rows.map(([k, ours, theirs]) => `<tr><th scope="row">${esc(k)}</th><td class="ours">${esc(ours)}</td><td>${esc(theirs)}</td></tr>`).join('');
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: c.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
  const others = COMPARISONS.filter((o) => o.slug !== c.slug)
    .map((o) => `<a href="/vs/${o.slug}/">Rigby2D vs ${esc(o.name)}</a>`)
    .join(' · ');
  const main = `
      <section class="page-head vs-head">
        <div class="wrap">
          <p class="eyebrow">Rigby2D vs ${esc(c.name)}</p>
          <h1>${esc(c.title)}</h1>
          <p class="section-lede">${esc(c.lede)}</p>
          <div class="cta">
            <a class="btn primary" href="/editor/" data-goatcounter-click="vs-${c.slug}-editor">Open the editor in your browser</a>
            <a class="btn" href="/#download" data-goatcounter-click="vs-${c.slug}-download">Download for Windows, macOS, Linux</a>
          </div>
        </div>
      </section>
      <section class="section vs-body">
        <div class="wrap">
          <div class="vs-table"><table>
            <thead><tr><th></th><th class="ours">Rigby2D</th><th>${esc(c.name)}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          <p class="fine">${esc(c.name)} details from <a href="${esc(c.source)}" rel="noopener nofollow">its own site</a>, October 2026. Prices and features change; check there before you decide.</p>

          <div class="vs-columns">
            <div>
              <h2>Where ${esc(c.name)} is stronger</h2>
              <ul class="vs-list">${c.stronger.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
            </div>
            <div>
              <h2>Switching</h2>
              <p>${esc(c.switching)}</p>
              <p><a class="btn small" href="/docs/${c.guide}">Read the guide</a></p>
            </div>
          </div>

          <h2>Questions</h2>
          <div class="vs-faq">${c.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>

          <div class="community-callout"><p><b>Questions about switching?</b> Ask on r/rigby2d: people who made the move answer there.</p><a class="btn reddit" href="https://www.reddit.com/r/rigby2d/" rel="noopener">${brandIcon('reddit', 18)}Join r/rigby2d</a></div>
          <p class="fine vs-others">Also: ${others}</p>
        </div>
      </section>`;
  const title = `Rigby2D vs ${c.name}: ${c.title}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(c.lede)}" />
    <link rel="canonical" href="${SITE}/vs/${c.slug}/" />
    <meta name="theme-color" content="#0a0a0b" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(c.lede)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${SITE}/vs/${c.slug}/" />
    <meta property="og:image" content="${SITE}/og.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" type="image/svg+xml" href="/blog/icon.svg" />
    <link rel="stylesheet" href="/blog/site.css" />
    <script type="application/ld+json">${JSON.stringify(faqLd).replace(/</g, '\\u003c')}</script>
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    ${siteHeader()}
    <main id="main">${main}</main>
    ${siteFooter()}
    ${NAV_SCRIPT}
  </body>
</html>
`;
}
