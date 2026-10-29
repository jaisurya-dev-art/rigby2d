// SPDX-License-Identifier: MIT OR Apache-2.0
// The Rigby2D Cloud waitlist endpoint: POST { email, website } as JSON. `website` is a honeypot field
// that people never see, so a value in it means a bot. Each address is stored once.
// Export the list: npx wrangler d1 execute rigby2d-waitlist --remote --command "SELECT * FROM waitlist"
// Remove an address: ... --command "DELETE FROM waitlist WHERE email = 'name@example.com'"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return reply(405, { error: 'POST only' });
    const origin = request.headers.get('origin');
    if (origin && origin !== 'https://rigby2d.com') return reply(403, { error: 'Forbidden' });
    let data;
    try {
      data = await request.json();
    } catch {
      return reply(400, { error: 'Invalid request' });
    }
    if (data.website) return reply(200, { ok: true });
    const email = String(data.email ?? '').trim().toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) return reply(400, { error: 'Please enter a valid email address.' });
    await env.DB.prepare('INSERT OR IGNORE INTO waitlist (email) VALUES (?)').bind(email).run();
    return reply(200, { ok: true });
  },
};
