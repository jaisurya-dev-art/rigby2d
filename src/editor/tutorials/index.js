// SPDX-License-Identifier: MIT OR Apache-2.0
// Help ▸ Tutorials: the lesson list, and a one-time welcome that offers the first lesson to new users.

import { track } from '../analytics.js';
import { h } from '../widgets.js';
import { runArena } from './arena.js';
import { Coach, finishedLessons, resetProgress } from './coach.js';
import { LESSONS } from './lessons.js';

const WELCOMED = 'rigby.welcomed.v2';

function modal(build) {
  const overlay = h('div', { class: 'modal-backdrop' });
  const body = h('div', { class: 'modal tutorials' });
  overlay.append(body);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);
  body.append(...build(close).filter(Boolean));
  document.body.append(overlay);
  return close;
}

/** The tutorials: a coach bound to the editor, the lesson list and the welcome. */
/** `refresh()` redraws the editor at once (used by the arena; the editor redraws itself anyway). */
export function createTutorials(app, viewport, { refresh = () => {} } = {}) {
  const coach = new Coach(app, viewport, {
    refresh,
    // At the end of a lesson, offer the next one.
    onFinish: (lesson) => {
      const next = LESSONS[LESSONS.indexOf(lesson) + 1];
      app.setStatus(`Lesson complete: ${lesson.title}`);
      if (next) open(next.id);
    },
  });

  const start = (lesson) => {
    try {
      localStorage.setItem(WELCOMED, '1');
    } catch {
      // only a convenience
    }
    track('editor-tutorial-start');
    coach.start(lesson);
  };

  /** The lesson list. `highlight`: a lesson to suggest. */
  function open(highlight = null) {
    const done = finishedLessons();
    const suggested = highlight ?? LESSONS.find((l) => !done.has(l.id))?.id ?? LESSONS[0].id;
    modal((close) => [
      h('h3', null, 'Tutorials'),
      h('p', { class: 'weak' }, 'Short, hands-on lessons. Each one points at the buttons to use and moves on when you have done a step. Start with the first one if Rigby2D is new to you.'),
      h(
        'div',
        { class: 'lesson-list' },
        LESSONS.map((l) =>
          h(
            'div',
            { class: `lesson${l.id === suggested ? ' suggested' : ''}` },
            h('div', { class: 'lesson-mark' }, done.has(l.id) ? '✓' : ''),
            h('div', { class: 'lesson-text' }, h('div', { class: 'lesson-title' }, l.title, h('span', { class: 'weak small' }, ` · ${l.minutes} min`)), h('div', { class: 'small weak' }, l.summary)),
            h(
              'button',
              {
                class: l.id === suggested ? 'primary' : '',
                onclick: () => {
                  close();
                  start(l);
                },
              },
              done.has(l.id) ? 'Again' : 'Start',
            ),
          ),
        ),
      ),
      h('p', { class: 'small weak' }, 'More lessons are coming: smooth motion and curves, meshes, IK, faces and lip-sync, film rendering, game export, retargeting and scripting.'),
      h(
        'div',
        { class: 'modal-buttons' },
        done.size
          ? h(
              'button',
              {
                title: 'Mark every lesson as not done, to take the course again',
                onclick: () => {
                  resetProgress();
                  close();
                  open();
                },
              },
              'Reset progress',
            )
          : null,
        h('span', { class: 'float-spacer' }),
        h('button', { onclick: close }, 'Close'),
      ),
    ]);
  }

  /** First start: a short welcome that offers the tour (shown once). */
  function welcome() {
    let seen = true;
    try {
      seen = !!localStorage.getItem(WELCOMED) || finishedLessons().size > 0;
    } catch {
      seen = true;
    }
    if (seen || document.querySelector('.modal-backdrop')) return;
    modal((close) => [
      h('h3', null, 'Welcome to Rigby2D'),
      h('p', null, 'New here? A 4-minute tour shows you around, and the next lessons take you from a drawing to a moving character.'),
      h(
        'div',
        { class: 'modal-buttons' },
        h(
          'button',
          {
            onclick: () => {
              try {
                localStorage.setItem(WELCOMED, '1');
              } catch {
                // only a convenience
              }
              close();
            },
          },
          'Not now',
        ),
        h(
          'button',
          {
            class: 'primary',
            onclick: () => {
              close();
              start(LESSONS[0]);
            },
          },
          'Start the tour',
        ),
      ),
      h('p', { class: 'small weak' }, 'You can find the lessons any time in Help ▸ Tutorials.'),
    ]);
  }

  /** Plays every lesson as a student and reports each step (development builds). */
  async function arena(lessons = LESSONS) {
    const confirm = app.confirmDiscard;
    app.confirmDiscard = async () => true;
    try {
      return await runArena(coach, lessons, { refresh });
    } finally {
      app.confirmDiscard = confirm;
    }
  }

  return { open, welcome, coach, arena };
}
