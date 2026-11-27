// SPDX-License-Identifier: MIT OR Apache-2.0
// The code editor of the Script editor and its console (CodeMirror 6): Python highlighting, line
// numbers, auto-indent (4 spaces; Tab indents), bracket matching, search, the line a failed run
// points to marked with its error, and completion of the rigby API (with each function's
// signature and docstring, from rigby.py) and of the open project's names inside strings
// (rigby.bone(" lists the bones). Colors follow the editor theme (CSS variables).

import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as placeholderText } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, insertNewlineAndIndent } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { globalCompletion, localCompletionSource, python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';
import { classOf, stringContext } from './apidoc.js';
import { pickerNames } from './toolargs.js';

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: tags.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-function)' },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.function(tags.variableName))], color: 'var(--code-definition)' },
  { tag: [tags.className, tags.definition(tags.className)], color: 'var(--code-class)' },
  { tag: tags.propertyName, color: 'var(--code-property)' },
  { tag: [tags.self, tags.special(tags.variableName)], color: 'var(--code-keyword)' },
  { tag: tags.meta, color: 'var(--code-decorator)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: '13px' },
  '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, Consolas, monospace)', caretColor: 'var(--text)', padding: '6px 0' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, Consolas, monospace)', lineHeight: '1.45' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { background: 'var(--panel)', color: 'var(--weak)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--text) 5%, transparent)' },
  '.cm-activeLineGutter': { background: 'color-mix(in srgb, var(--text) 8%, transparent)', color: 'var(--text)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { background: 'var(--selected) !important' },
  '.cm-matchingBracket': { background: 'var(--ui-accent-soft)', outline: '1px solid var(--accent)' },
  '.cm-selectionMatch': { background: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
  '.cm-tooltip': { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: 'var(--shadow-popover)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono, ui-monospace, Consolas, monospace)', maxHeight: '16em' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--selected)', color: 'var(--fg, var(--text))' },
  '.cm-completionDetail': { color: 'var(--weak)', fontStyle: 'normal', marginLeft: '0.6em' },
  '.cm-completionInfo': { maxWidth: '360px', padding: '6px 9px', whiteSpace: 'pre-wrap', lineHeight: '1.4' },
  '.cm-completionInfo .sig': { fontFamily: 'var(--font-mono, ui-monospace, Consolas, monospace)', color: 'var(--code-function)', marginBottom: '4px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-errorLine': { background: 'color-mix(in srgb, var(--danger) 16%, transparent)' },
  '.cm-panels': { background: 'var(--panel)', color: 'var(--text)' },
  '.cm-panels input, .cm-panels button': { fontSize: '12px' },
  '.cm-placeholder': { color: 'var(--weak)' },
});

const KIND_TYPE = { function: 'function', class: 'class', method: 'method', property: 'property', constant: 'constant' };

function option(entry, owner = null) {
  return {
    label: entry.name,
    type: KIND_TYPE[entry.kind] ?? 'variable',
    detail: entry.signature || (owner ? `${owner}` : ''),
    info: () => {
      const box = document.createElement('div');
      const sig = document.createElement('div');
      sig.className = 'sig';
      const returns = entry.returns && entry.kind !== 'class' ? ` → ${entry.returnsList ? `[${entry.returns}]` : entry.returns}` : '';
      sig.textContent = `${owner ? `${owner}.` : entry.kind === 'class' ? '' : 'rigby.'}${entry.name}${entry.signature}${returns}`;
      box.append(sig, document.createTextNode(entry.doc || ''));
      return box;
    },
    boost: entry.kind === 'class' ? -1 : 0,
  };
}

/**
 * The rigby completion source: `api` (apidoc.parseApi), `getDoc()` the open project for names in
 * strings, `extraNames(prefix)` (optional, async) for the console's own variables, `earlier()`
 * (optional) code run before this text (the console's history), read for the types of names.
 */
export function rigbyCompletion(api, getDoc, extraNames = null, earlier = null) {
  return async (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    // Names from the project inside a string: rigby.bone("ar|, animation="wa|.
    const str = stringContext(before);
    if (str) {
      const doc = getDoc();
      if (!doc) return null;
      // Picking a name closes the string when nothing closes it yet.
      const quote = before.slice(0, before.length - str.typed.length).at(-1);
      const apply = (view, completion, from, to) => {
        const next = view.state.sliceDoc(to, to + 1);
        const insert = completion.label + (next === quote ? '' : quote);
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + completion.label.length + 1 } });
      };
      return { from: context.pos - str.typed.length, options: pickerNames(doc, str.kind).map((n) => ({ label: n, type: 'text', detail: str.kind, apply })), validFor: /^[^"'\\]*$/ };
    }
    const member = /((?:rigby\.\w+\([^()]*\))|[\w.]+)\.(\w*)$/.exec(before);
    if (member) {
      const [, expr, typed] = member;
      const from = context.pos - typed.length;
      if (expr === 'rigby') return { from, options: api.module.map((e) => option(e)), validFor: /^\w*$/ };
      const text = `${earlier ? `${earlier()}\n` : ''}${context.state.sliceDoc(0, context.pos)}`;
      const cls = classOf(api, text, expr);
      if (cls && api.classes[cls]) return { from, options: api.classes[cls].map((e) => option(e, cls)), validFor: /^\w*$/ };
      // Unknown type: every class's members, each once, labeled with the classes that have it.
      const seen = new Map();
      for (const [c, list] of Object.entries(api.classes)) for (const e of list) seen.set(e.name, [...(seen.get(e.name) ?? []), [c, e]]);
      if (!seen.size || /^\d/.test(expr)) return null;
      return { from, options: [...seen.values()].map((hits) => ({ ...option(hits[0][1], hits.map(([c]) => c).join(' / ')), detail: hits.map(([c]) => c).join(' / ') })), validFor: /^\w*$/ };
    }
    const word = context.matchBefore(/\w+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const options = [{ label: 'rigby', type: 'namespace', detail: 'the scripting API', boost: 2 }];
    if (extraNames) for (const n of await extraNames(word.text)) options.push({ label: n, type: 'variable', detail: 'console', boost: 1 });
    return { from: word.from, options, validFor: /^\w*$/ };
  };
}

/**
 * A code editor in `parent`. Options: value, onChange(text), onRun() (Ctrl+Enter), completion
 * (a source from rigbyCompletion), console (Enter submits via onSubmit(text); Shift+Enter adds a
 * line; Up and Down walk `history`), placeholder.
 * Returns { view, value(), setValue(text), focus(), showError(line, message), clearError() }.
 */
export function createCodeEditor(parent, { value = '', onChange = null, onRun = null, completion = null, console: isConsole = false, onSubmit = null, history: past = [], placeholder = '' } = {}) {
  let back = past.length;
  let draft = '';
  const view = new EditorView({ parent });
  const setText = (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
  const consoleKeys = [
    {
      key: 'Enter',
      run: () => {
        if (completionStatus(view.state) === 'active') return false;
        const text = view.state.doc.toString();
        // An unfinished block (a line ending in ':') or an indented last line goes on to the next line.
        const last = text.split('\n').at(-1);
        if (/:\s*$/.test(last) || (/^\s+\S/.test(last) && text.includes('\n'))) return insertNewlineAndIndent(view);
        if (!text.trim()) return true;
        onSubmit?.(text);
        back = past.length;
        draft = '';
        setText('');
        return true;
      },
    },
    { key: 'Shift-Enter', run: insertNewlineAndIndent },
    {
      key: 'ArrowUp',
      run: () => {
        if (completionStatus(view.state) === 'active' || view.state.doc.lineAt(view.state.selection.main.head).number !== 1 || back === 0) return false;
        if (back === past.length) draft = view.state.doc.toString();
        setText(past[--back]);
        return true;
      },
    },
    {
      key: 'ArrowDown',
      run: () => {
        const { state } = view;
        if (completionStatus(state) === 'active' || state.doc.lineAt(state.selection.main.head).number !== state.doc.lines || back >= past.length) return false;
        back++;
        setText(back === past.length ? draft : past[back]);
        return true;
      },
    },
  ];
  const extensions = [
    isConsole ? [] : [lineNumbers(), highlightActiveLineGutter(), lintGutter(), highlightActiveLine()],
    history(),
    drawSelection(),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    python(),
    syntaxHighlighting(highlight),
    autocompletion({ override: [completion, localCompletionSource, globalCompletion].filter(Boolean), icons: true, activateOnTyping: true }),
    placeholder ? placeholderText(placeholder) : [],
    theme,
    keymap.of([
      ...(isConsole ? consoleKeys : []),
      { key: 'Mod-Enter', run: () => (onRun?.(), true) },
      { key: 'Tab', run: (v) => (completionStatus(v.state) === 'active' ? false : indentMore(v)), shift: indentLess },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      // An edit clears the error marker of the last run.
      if (marked) clear();
      onChange?.(u.state.doc.toString());
    }),
    // The editor's own shortcuts (Delete, Space, numbers…) must not act on the rig while typing.
    EditorView.domEventHandlers({ keydown: (e) => e.stopPropagation() }),
  ];
  view.setState(EditorState.create({ doc: value, extensions }));
  let marked = false;
  const clear = () => {
    marked = false;
    view.dispatch(setDiagnostics(view.state, []));
  };
  return {
    view,
    value: () => view.state.doc.toString(),
    setValue: (text) => {
      view.setState(EditorState.create({ doc: text, extensions }));
      marked = false;
    },
    focus: () => view.focus(),
    /** Marks line `line` (1-based) with `message` and scrolls to it. */
    showError(line, message) {
      const doc = view.state.doc;
      if (line < 1 || line > doc.lines) return;
      const l = doc.line(line);
      const from = l.from + (l.text.length - l.text.trimStart().length);
      view.dispatch(setDiagnostics(view.state, [{ from, to: Math.max(from, l.to), severity: 'error', message }]), { selection: { anchor: from }, scrollIntoView: true });
      marked = true;
    },
    clearError: clear,
  };
}

/** The line of `script` a Python traceback points to last (the innermost frame in that file), or null. */
export function errorLine(trace, script) {
  if (!trace) return null;
  let line = null;
  for (const m of String(trace).matchAll(/File "([^"]*)", line (\d+)/g)) if (m[1] === script) line = Number(m[2]);
  // A SyntaxError names the line after the frames.
  return line;
}
