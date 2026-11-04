// SPDX-License-Identifier: MIT OR Apache-2.0
// Devlog read counts (rigby2d.com/api/reads).
//   GET  ?slugs=a,b   -> { a: 12, b: 3 }   running totals
//   POST { slug }     -> { reads: 13 }      sent by a post page after it has been visible for 5 s
// A read counts once per reader, per post, per day: the reader is a SHA-256 of (secret salt, day, IP,
// browser, post), kept only for that day, so no IP or anything that identifies a reader is stored, and
// readers can't be linked across days or posts. Only real posts count (the slugs in the devlog's RSS
// feed), and requests from other sites or from known bots are ignored.
// Totals: npx wrangler d1 execute rigby2d-reads --remote --command "SELECT slug, SUM(count) FROM reads GROUP BY slug"

const SITE = 'https://rigby2d.com';
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|discord|telegram|whatsapp|headless|lighthouse|python|curl|wget|httpclient/i;

const reply = (status, body, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

// The devlog's posts, read from its RSS feed and kept for 10 minutes.
let posts = null;
let postsAt = 0;
async function knownSlugs() {
  if (posts && Date.now() - postsAt < 600_000) return posts;
  const xml = await (await fetch(`${SITE}/blog/feed.xml`, { cf: { cacheTtl: 300 } })).text();
  posts = new Set([...xml.matchAll(/<link>https:\/\/rigby2d\.com\/blog\/([a-z0-9-]+)\.html<\/link>/g)].map((m) => m[1]));
  postsAt = Date.now();
  return posts;
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function totals(env, slugs) {
  const out = Object.fromEntries(slugs.map((s) => [s, 0]));
  if (!slugs.length) return out;
  const { results } = await env.DB.prepare(`SELECT slug, SUM(count) AS n FROM reads WHERE slug IN (${slugs.map(() => '?').join(',')}) GROUP BY slug`).bind(...slugs).all();
  for (const r of results) out[r.slug] = r.n;
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const slugs = [...new Set((url.searchParams.get('slugs') ?? '').split(',').filter((s) => SLUG.test(s)))].slice(0, 60);
      return reply(200, await totals(env, slugs), 'public, max-age=60');
    }
    if (request.method !== 'POST') return reply(405, { error: 'GET or POST' });
    if (request.headers.get('origin') !== SITE) return reply(403, { error: 'Forbidden' });
    let slug;
    try {
      slug = String((await request.json()).slug ?? '');
    } catch {
      return reply(400, { error: 'Invalid request' });
    }
    if (!SLUG.test(slug) || !(await knownSlugs()).has(slug)) return reply(404, { error: 'Unknown post' });
    const ua = request.headers.get('user-agent') ?? '';
    if (!ua || BOT.test(ua)) return reply(200, await totals(env, [slug]).then((t) => ({ reads: t[slug] })));

    const day = new Date().toISOString().slice(0, 10);
    const ip = request.headers.get('cf-connecting-ip') ?? '';
    const hash = await sha256(`${env.SALT}|${day}|${ip}|${ua}|${slug}`);
    const fresh = await env.DB.prepare('INSERT OR IGNORE INTO seen (hash, day) VALUES (?, ?)').bind(hash, day).run();
    if (fresh.meta.changes) {
      await env.DB.prepare('INSERT INTO reads (slug, day, count) VALUES (?, ?, 1) ON CONFLICT (slug, day) DO UPDATE SET count = count + 1').bind(slug, day).run();
    }
    // Forget earlier days' hashes now and then (about one request in 50).
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM seen WHERE day < ?').bind(day).run();
    const t = await totals(env, [slug]);
    return reply(200, { reads: t[slug] });
  },
};
