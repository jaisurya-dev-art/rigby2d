// SPDX-License-Identifier: MIT OR Apache-2.0
// The homepage's Founding Creators section, from site/creators.json (kept by hand): the creators who
// covered Rigby2D first, each with their video. Rendered at build time (vite.config.js replaces the
// page's <!--founding-creators--> marker), so it is plain HTML. Thumbnails are stored on the site:
// nothing loads from YouTube until someone clicks through.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';

/** One creator's card: the video (thumbnail, title, length), who made it, and a line from it. */
function card(c, base) {
  const v = c.video;
  const date = new Date(`${v.date}T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `<a class="creator-card" href="${esc(v.url)}" rel="noopener" data-goatcounter-click="site-creator-${esc(c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">
              <span class="creator-thumb">
                <img src="${base}${esc(v.thumbnail)}" alt="" width="960" height="540" loading="lazy" />
                <span class="creator-play">${PLAY}</span>
                <span class="creator-length">${esc(v.length)}</span>
              </span>
              <span class="creator-body">
                ${c.founding ? '<span class="creator-badge">Founding Creator</span>' : ''}
                <b class="creator-title">${esc(v.title)}</b>
                <span class="creator-by">${esc(c.name)} · ${esc(c.platform)} · ${esc(date)}</span>
                ${c.quote ? `<q class="creator-quote">${esc(c.quote)}</q>` : ''}
              </span>
            </a>`;
}

/** The section, or nothing when the list is empty. */
export function creatorsSection(data, base = './') {
  const list = data?.creators ?? [];
  if (!list.length) return '';
  return `<section id="creators" class="section creators-section" aria-labelledby="creators-title">
        <div class="wrap">
          <p class="eyebrow">Founding Creators</p>
          <h2 id="creators-title">The first to show Rigby2D to the world</h2>
          <p class="section-lede">Creators who found Rigby2D early and shared it with their audience. Thank you: you are why more people get to animate for free.</p>
          <div class="creator-grid">
            ${list.map((c) => card(c, base)).join('\n            ')}
          </div>
          <p class="creator-cta">Made a video, tutorial or stream about Rigby2D? <a href="https://discord.gg/PGgaTwbNH" rel="noopener" data-goatcounter-click="site-creators-discord">Tell us on Discord</a> and we will feature it here.</p>
        </div>
      </section>`;
}
