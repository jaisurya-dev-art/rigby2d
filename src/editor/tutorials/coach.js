// SPDX-License-Identifier: MIT OR Apache-2.0
// The tutorial coach: a panel that walks through a lesson one step at a time and a ring on the
// control to use. Two kinds of steps, never mixed:
// - action steps (`done`): the coach watches the editor and moves on the moment the step is done;
//   there is no Next button, only Skip;
// - explanation steps (`next: true`): nothing to do but read; Next moves on.
// The panel's place is worked out from the target alone (never from where the panel is), so it
// cannot flip back and forth; once the user drags it, it stays put.

import { makeDraggable } from '../logwindow.js';
import { h } from '../widgets.js';
import { lintLesson } from './lint.js';
import { overlaps, resolve } from './targets.js';

// Versioned: when lessons are rebuilt, progress from their old versions no longer counts.
const PROGRESS = 'rigby.tutorials.v2';

/** Finished lesson ids. */
export function finishedLessons() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PROGRESS) ?? '[]'));
  } catch {
    return new Set();
  }
}

/** Forgets which lessons were finished (and that the welcome was shown). */
export function resetProgress() {
  try {
    localStorage.removeItem(PROGRESS);
    localStorage.removeItem('rigby.welcomed.v2');
  } catch {
    // nothing stored
  }
}

function markFinished(id) {
  const done = finishedLessons();
  done.add(id);
  try {
    localStorage.setItem(PROGRESS, JSON.stringify([...done]));
  } catch {
    // progress is a convenience; the lesson still works
  }
}

/**
 * Where the panel can sit, in order of preference: the viewport's corners, then over the timeline
 * or the side panel (for a target in the middle of a small viewport).
 */
const PLACES = ['bottom-left', 'top-left', 'top-right', 'bottom-right', 'timeline', 'side'];

export class Coach {
  /** `refresh()` redraws the editor's panels at once (the arena uses it; normally a no-op). */
  constructor(app, viewport, { onFinish = () => {}, refresh = () => {} } = {}) {
    this.app = app;
    this.viewport = viewport;
    this.onFinish = onFinish;
    this.refresh = refresh;
    this.lesson = null;
    this.index = 0;
    this.panel = null;
    this.ring = null;
    this.moved = false;
    this.mark = {};
  }

  get ctx() {
    return { app: this.app, viewport: this.viewport, mark: this.mark };
  }

  get step() {
    return this.lesson?.steps[this.index] ?? null;
  }

  get running() {
    return !!this.lesson;
  }

  start(lesson) {
    const problems = lintLesson(lesson);
    if (problems.length) throw new Error(`Lesson '${lesson.id}' is malformed: ${problems.join('; ')}`);
    this.stop();
    this.lesson = lesson;
    this.index = 0;
    this.moved = false;
    this.corner = null;
    this.ring = h('div', { class: 'coach-ring', hidden: true });
    document.body.append(this.ring);
    this.build();
    this.enter(null);
    // The ring follows its target every frame; completion is checked on a timer, so lessons go on
    // even when animation frames are paused (a background window).
    const frame = () => {
      if (!this.lesson) return;
      this.place();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    this.timer = setInterval(() => this.tick(), 120);
    this.onResize = () => this.dock(true);
    window.addEventListener('resize', this.onResize);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    window.removeEventListener('resize', this.onResize);
    this.panel?.remove();
    this.ring?.remove();
    this.panel = this.ring = this.lesson = null;
  }

  tick() {
    if (!this.lesson) return;
    this.check();
    this.place();
  }

  /** Starts the current step; `praise` is shown when the previous step was just done. */
  enter(praise) {
    this.mark = {};
    this.revealed = new Set();
    try {
      this.step.enter?.(this.ctx);
    } catch (e) {
      console.warn('tutorial step', e);
    }
    this.render(praise);
    this.dock(true);
    this.place();
    // Done already (for example: already in Setup mode)? Move on straight away.
    this.check();
  }

  go(delta, praise = null) {
    const next = this.index + delta;
    if (next < 0 || !this.lesson) return;
    if (next >= this.lesson.steps.length) return this.finish();
    this.index = next;
    this.enter(praise);
  }

  /** An action step moves on the moment it is done; nothing the user does in between is lost. */
  check() {
    const step = this.step;
    if (!step?.done) return;
    let ok = false;
    try {
      ok = !!step.done(this.ctx);
    } catch {
      ok = false;
    }
    if (ok) this.go(1, '✓ Done');
  }

  finish() {
    const lesson = this.lesson;
    markFinished(lesson.id);
    this.stop();
    this.onFinish(lesson);
  }

  /** The current step's target on screen, or null. */
  target() {
    const step = this.step;
    if (!step?.target) return null;
    try {
      const spec = typeof step.target === 'function' ? step.target(this.ctx) : step.target;
      // Scroll a target into view the first time it is found in this step (it may only appear
      // after the panels redraw, e.g. new bones in the tree), then leave scrolling to the user.
      const key = JSON.stringify(spec);
      const t = resolve(spec, this.ctx, { reveal: !this.revealed.has(key) });
      if (t) this.revealed.add(key);
      return t;
    } catch {
      return null;
    }
  }

  place() {
    if (!this.ring) return;
    const t = this.target();
    if (!t) {
      this.ring.hidden = true;
      return;
    }
    const pad = t.kind === 'area' ? 0 : 4;
    Object.assign(this.ring.style, {
      left: `${t.box.left - pad}px`,
      top: `${t.box.top - pad}px`,
      width: `${t.box.width + pad * 2}px`,
      height: `${t.box.height + pad * 2}px`,
    });
    this.ring.className = `coach-ring ${t.kind}`;
    this.ring.hidden = false;
    this.dock(false, t);
  }

  /**
   * Puts the panel in a corner of the viewport that keeps the target uncovered. The choice depends
   * only on the target, so it is stable; `force` re-docks after a step change or a resize.
   */
  dock(force, t = this.target()) {
    if (!this.panel || this.moved) return;
    const area = document.querySelector('#center')?.getBoundingClientRect();
    if (!area) return;
    const timeline = document.querySelector('#timeline')?.getBoundingClientRect() ?? area;
    const side = document.querySelector('#side')?.getBoundingClientRect() ?? area;
    const r = this.panel.getBoundingClientRect();
    const m = 12;
    const at = {
      'bottom-left': [area.left + m, area.bottom - r.height - m - 44],
      'top-left': [area.left + m, area.top + m + 28],
      'top-right': [area.right - r.width - m, area.top + m + 28],
      'bottom-right': [area.right - r.width - m, area.bottom - r.height - m - 44],
      timeline: [timeline.right - r.width - m, Math.min(timeline.top + m, window.innerHeight - r.height - m)],
      side: [side.left + m, side.bottom - r.height - m],
    };
    const boxAt = ([x, y]) => ({ left: x, top: y, right: x + r.width, bottom: y + r.height });
    // An area target (the whole viewport) cannot be avoided: keep the first corner.
    // A button inside the panel itself (Load the practice character) needs no avoiding.
    const avoid = t && t.kind !== 'area' && !(t.el && this.panel.contains(t.el)) ? t.box : null;
    const corner = (avoid && PLACES.find((c) => !overlaps(boxAt(at[c]), avoid, 12))) ?? PLACES[0];
    if (!force && corner === this.corner) return;
    this.corner = corner;
    const [x, y] = at[corner];
    Object.assign(this.panel.style, { left: `${Math.max(4, x)}px`, top: `${Math.max(4, y)}px`, right: 'auto', bottom: 'auto' });
  }

  build() {
    const close = h('button', { title: 'Close the lesson (your work stays)', onclick: () => this.stop() }, '✕');
    this.header = h('div', { class: 'float-header' }, h('b', { class: 'coach-title' }), h('span', { class: 'float-spacer' }), close);
    this.body = h('div', { class: 'coach-body' });
    this.panel = h('div', { class: 'float-window coach' }, this.header, this.body);
    makeDraggable(this.panel, this.header);
    // Once the user places the panel, it stays where they put it.
    this.header.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('button')) this.moved = true;
    });
    document.body.append(this.panel);
  }

  render(praise) {
    const { lesson, index } = this;
    const step = this.step;
    const total = lesson.steps.length;
    this.header.querySelector('.coach-title').textContent = lesson.title;
    const text = h('div', { class: 'coach-text' });
    text.innerHTML = step.text;
    const parts = [
      h('div', { class: 'coach-progress' }, h('div', { class: 'bar', style: { width: `${(index / total) * 100}%` } })),
      h('div', { class: 'coach-count small' }, h('span', { class: 'weak' }, `Step ${index + 1} of ${total}`), praise ? h('span', { class: 'coach-praise' }, praise) : null),
      text,
      step.action
        ? h(
            'button',
            {
              class: 'primary coach-action',
              'data-tut': 'coach:action',
              onclick: async (e) => {
                const button = e.currentTarget;
                button.disabled = true;
                try {
                  await step.action.run(this.ctx);
                } catch (err) {
                  // The desktop app downloads the demo and practice characters; say so when that fails.
                  this.ctx.app.setStatus(`Could not load the lesson's character: ${err?.message ?? err}. The desktop app downloads it from the Rigby2D website: check the internet connection.`);
                } finally {
                  button.disabled = false;
                  this.check();
                }
              },
            },
            step.action.label,
          )
        : null,
      step.done ? h('div', { class: 'coach-wait weak small' }, 'Do this in the editor; the lesson goes on by itself.') : null,
      h(
        'div',
        { class: 'coach-buttons' },
        h('button', { disabled: index === 0, onclick: () => this.go(-1) }, 'Back'),
        h('span', { class: 'float-spacer' }),
        step.done ? h('button', { class: 'coach-skip', 'data-tut': 'coach:skip', title: 'Go on without doing this step', onclick: () => this.go(1) }, 'Skip') : null,
        step.next ? h('button', { class: 'primary', 'data-tut': 'coach:next', onclick: () => this.go(1) }, index === total - 1 ? 'Finish' : 'Next') : null,
      ),
    ];
    this.body.replaceChildren(...parts.filter(Boolean));
  }
}
