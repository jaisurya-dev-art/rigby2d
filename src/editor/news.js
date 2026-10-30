// SPDX-License-Identifier: MIT OR Apache-2.0
// What's new: the newest devlog posts (rigby2d.com/news.json, made by the website build from
// site/blog/posts) for the welcome screen. The last copy is kept, so the list shows at once and
// offline; posts newer than the last time the list was seen are marked new.

import { fetchBytes } from './platform.js';

export const NEWS_URL = 'https://rigby2d.com/news.json';
export const DEVLOG_URL = 'https://rigby2d.com/blog/';
export const COMMUNITY_URL = 'https://www.reddit.com/r/rigby2d/';
const CACHE = 'rigby.news';
const SEEN = 'rigby.news.seen';

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // only a convenience
  }
};

/** The last news fetched (or null). */
export function cachedNews() {
  try {
    return JSON.parse(read(CACHE) ?? 'null');
  } catch {
    return null;
  }
}

/** Fetches the news; resolves with it (and keeps it), or with the cached copy when offline. */
export async function fetchNews() {
  try {
    const news = JSON.parse(new TextDecoder().decode(await fetchBytes(NEWS_URL)));
    if (Array.isArray(news?.items)) {
      write(CACHE, JSON.stringify(news));
      return news;
    }
  } catch {
    // offline, or the site is unreachable
  }
  return cachedNews();
}

/** Whether a post (by its date) is newer than the last time the news was seen. */
export const isNew = (item, seen = read(SEEN)) => !!seen && item.date > seen;

/** Marks everything up to `date` as seen. The first time, nothing is marked new. */
export function markSeen(date) {
  if (date) write(SEEN, date);
}
