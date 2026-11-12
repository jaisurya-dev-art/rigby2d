// SPDX-License-Identifier: MIT OR Apache-2.0
// Help ▸ Tutorials: the lesson list, and a one-time welcome that offers the first lesson to new users.

import { track } from '../analytics.js';
import { h } from '../widgets.js';
import { button, dialog, hint, uiIcon } from '../ui.js';
import { runArena } from './arena.js';
import { Coach, finishedLessons, resetProgress } from './coach.js';
import { LESSONS } from './lessons.js';
import { t } from '../i18n.js';

const WELCOMED = 'rigby.welcomed.v2';

/** The tutorials: a coach bound to the editor, the lesson list and the welcome. */
/** `refresh()` redraws the editor at once (used by the arena; the editor redraws itself anyway). */
export function createTutorials(app, viewport, { refresh = () => {} } = {}) {
  const coach = new Coach(app, viewport, {
    refresh,
    // At the end of a lesson, offer the next one.
    onFinish: (lesson) => {
      const next = LESSONS[LESSONS.indexOf(lesson) + 1];
      app.setStatus(t('Lesson complete: {title}', { title: t(lesson.title) }));
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
    const { body, close } = dialog({
      title: t('Tutorials'),
      subtitle: t('Short, hands-on lessons that point at each button and move on when you have done a step.'),
      className: 'tutorials',
      footer: [
        done.size
          ? button(t('Reset progress'), {
              kind: 'ghost',
              title: t('Mark every lesson as not done, to take the course again'),
              onclick: () => {
                resetProgress();
                close();
                open();
              },
            })
          : null,
        h('span', { class: 'float-spacer' }),
        button(t('Close'), { onclick: () => close() }),
      ],
    });
    body.append(
      h(
        'div',
        { class: 'lesson-list' },
        LESSONS.map((l) =>
          h(
            'div',
            { class: `lesson${l.id === suggested ? ' suggested' : ''}` },
            h('div', { class: 'lesson-mark' }, done.has(l.id) ? uiIcon('check', 'sm') : ''),
            h('div', { class: 'lesson-text' }, h('div', { class: 'lesson-title' }, t(l.title), h('span', { class: 'weak small' }, ' · ' + t('{minutes} min', { minutes: l.minutes }))), h('div', { class: 'small weak' }, t(l.summary))),
            button(done.has(l.id) ? t('Again') : t('Start'), {
              kind: l.id === suggested ? 'primary' : 'secondary',
              size: 'sm',
              onclick: () => {
                close();
                start(l);
              },
            }),
          ),
        ),
      ),
      hint(t('More lessons are coming: smooth motion and curves, meshes, IK, faces and lip-sync, film rendering, game export, retargeting and scripting.')),
    );
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
    const remember = () => {
      try {
        localStorage.setItem(WELCOMED, '1');
      } catch {
        // only a convenience
      }
    };
    const { body, close } = dialog({
      title: t('Welcome to Rigby2D'),
      className: 'choice-dialog',
      onClose: remember,
      footer: [
        button(t('Not now'), { onclick: () => close() }),
        button(t('Start the tour'), {
          kind: 'primary',
          onclick: () => {
            close();
            start(LESSONS[0]);
          },
        }),
      ],
    });
    body.append(h('p', null, t('New here? A 4-minute tour shows you around, and the next lessons take you from a drawing to a moving character.')), hint(t('You can find the lessons any time in Help ▸ Tutorials.')));
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

  /** Starts the first lesson (the tour). */
  const tour = () => start(LESSONS[0]);

  return { open, welcome, tour, coach, arena };
}
