// SPDX-License-Identifier: MIT OR Apache-2.0
// When the share, star and support prompts may show (nudgeui.js shows them), without the DOM: tests run
// this under Node. Each prompt waits between showings and stops once acted on or dismissed enough.

export const KEY = 'rigby.nudges';
const DAY = 24 * 60 * 60 * 1000;
/** Milestones worth sharing. */
export const SHAREABLE = new Set(['editor-render', 'editor-render-batch', 'editor-export-json', 'editor-export-skel', 'editor-autorig']);

export const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
};
export const save = (s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // only a convenience
  }
};

/**
 * Whether a nudge may show now: not acted on, dismissed fewer than `maxDismiss` times, and not shown
 * in the last `gap` days.
 */
export function mayShow(state, kind, now, { gap, maxDismiss }) {
  const s = state[kind] ?? {};
  if (s.done || (s.dismissed ?? 0) >= maxDismiss) return false;
  return !s.shownAt || now - s.shownAt >= gap * DAY;
}

/** Counts a finished render, export or AutoRig (the support prompt waits for the third). */
export function countWork(state) {
  state.work = (state.work ?? 0) + 1;
  return state.work;
}

/**
 * The support prompt: right after Rigby2D has just done a job for you (a render, an export, an
 * AutoRig), from the third one on, after five days of use, at most every 45 days and never again
 * after two "Not now"s.
 */
export function fundDue(state, now) {
  return (state.days ?? 0) >= 5 && (state.work ?? 0) >= 3 && mayShow(state, 'fund', now, { gap: 45, maxDismiss: 2 });
}

/** Counts the distinct days the editor was opened on (the star prompt waits for the third). */
export function countDay(state, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (state.lastDay !== today) {
    state.lastDay = today;
    state.days = (state.days ?? 0) + 1;
  }
  return state.days;
}

