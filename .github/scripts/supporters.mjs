// SPDX-License-Identifier: MIT OR Apache-2.0
// Updates site/supporters.json from GitHub Sponsors: the public sponsors and the active goal. The
// website's /fund page and the editor's Supporters list read that file (rigby2d.com/supporters.json).
// Supporters from elsewhere (Ko-fi, one-off) are kept by hand in its "others" list and left as they
// are. Run daily by .github/workflows/supporters.yml. Reading the Sponsors goal needs a personal token
// (the SPONSORS_TOKEN secret, read:user); with only the workflow's token the goal is kept from the file.
//   node .github/scripts/supporters.mjs [--dry-run]

import fs from 'node:fs';

const FILE = new URL('../../site/supporters.json', import.meta.url);
const LOGIN = 'jaisurya-dev-art';

const GOAL = `query($login: String!) { user(login: $login) {
  sponsorsListing { activeGoal { kind targetValue percentComplete title } }
} }`;
const SPONSORS = `query($login: String!) { user(login: $login) {
  sponsors(first: 100) { totalCount nodes {
    ... on User { login name avatarUrl url }
    ... on Organization { login name avatarUrl url }
  } }
} }`;

async function graphql(query) {
  const token = process.env.SPONSORS_TOKEN || process.env.GITHUB_TOKEN;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data.user;
}

/** Runs a query, or returns null when this token may not read it (FORBIDDEN). */
async function tryGraphql(query) {
  try {
    return await graphql(query);
  } catch (e) {
    if (String(e.message).includes('FORBIDDEN')) {
      console.warn(`Skipped (not allowed with this token): ${e.message.slice(0, 160)}`);
      return null;
    }
    throw e;
  }
}

const current = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
const goal = (await tryGraphql(GOAL))?.sponsorsListing?.activeGoal;
const sponsors = await tryGraphql(SPONSORS);
const next = {
  // Where to give, and the goal the /fund page shows (monthly dollars, kept when GitHub has none).
  goal: goal?.kind === 'MONTHLY_SPONSORSHIP_AMOUNT'
    ? { title: goal.title || current.goal?.title || 'Signed by Rigby2D', monthly: goal.targetValue, percent: goal.percentComplete }
    : (current.goal ?? { title: 'Signed by Rigby2D', monthly: 25, percent: 0 }),
  github: !sponsors ? (current.github ?? []) : sponsors.sponsors.nodes.map((s) => ({ login: s.login, name: s.name || s.login, url: s.url, avatar: `${s.avatarUrl}${s.avatarUrl.includes('?') ? '&' : '?'}s=96` })),
  // Logins of the first 20 monthly supporters, marked Founding Supporters for good (kept by hand).
  founding: current.founding ?? [],
  others: current.others ?? [],
};
const text = `${JSON.stringify(next, null, 2)}\n`;
if (process.argv.includes('--dry-run')) process.stdout.write(text);
else fs.writeFileSync(FILE, text);
