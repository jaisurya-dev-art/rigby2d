// SPDX-License-Identifier: MIT OR Apache-2.0
// Share to r/rigby2d, without the DOM (tests run this under Node): the output settings for a short
// clip sized for Reddit, and the subreddit's new-post address with the title filled in.

import { COMMUNITY_URL } from './news.js';

export const SIZES = [360, 480, 640, 720];
export const RATES = [12, 15, 20, 25, 30];
/** The background when the project has none: GIFs are opaque and smaller on one colour. */
export const SHARE_BACKGROUND = [0.086, 0.094, 0.114, 1];

/**
 * The project's output settings scaled so the longer side is `size` pixels (never larger than the
 * project's), at `fps`, on `background` (an [r, g, b, a] colour, or null for transparent). `fit`
 * frames the animation itself; otherwise a fixed framing keeps showing the same part of the scene.
 */
export function shareSettings(settings, { size, fps, background, fit = false }) {
  const k = Math.min(1, size / Math.max(settings.width, settings.height));
  const width = Math.max(2, Math.round(settings.width * k));
  const height = Math.max(2, Math.round(settings.height * k));
  const frame = settings.frame && !fit ? { ...settings.frame, scale: settings.frame.scale * (settings.width / width) } : null;
  return { ...settings, width, height, fps, background, frame };
}

/** The r/rigby2d new-post page for an image or video post, with `title` filled in. */
export function submitUrl(title) {
  return `${COMMUNITY_URL}submit/?type=IMAGE&title=${encodeURIComponent(title.trim().slice(0, 300))}`;
}

/** The default post title. */
export const shareTitle = (projectName, animationName) => `${projectName ? `${projectName}: ` : ''}${animationName}, made in Rigby2D`;
