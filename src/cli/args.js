// SPDX-License-Identifier: MIT OR Apache-2.0
// Command-line argument parsing for the `rigby` CLI: positionals and typed options
// (`--name value`, `--name=value`, `-n value`, `--flag`, `--no-flag`, `--` ends options).

/** A mistake in how a command was called (exit code 2). */
export class UsageError extends Error {}

const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Converts an option's text to its type: 'string', 'number', 'integer', 'boolean', 'list' or 'json'. */
export function convertValue(name, type, text) {
  switch (type) {
    case 'number':
    case 'integer': {
      const n = Number(text);
      if (text.trim() === '' || !Number.isFinite(n)) throw new UsageError(`--${name} needs a number, not '${text}'`);
      if (type === 'integer' && !Number.isInteger(n)) throw new UsageError(`--${name} needs a whole number, not '${text}'`);
      return n;
    }
    case 'boolean':
      if (/^(true|yes|on|1)$/i.test(text)) return true;
      if (/^(false|no|off|0)$/i.test(text)) return false;
      throw new UsageError(`--${name} is true or false, not '${text}'`);
    case 'list':
      return text.split(',').map((s) => s.trim()).filter(Boolean);
    case 'json':
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new UsageError(`--${name} needs JSON: ${e.message}`);
      }
    default:
      return text;
  }
}

/**
 * Parses `argv` against `spec`: { options: { name: { type, short, choices } }, positionals: [names],
 * rest: name (collects extra positionals) }. Option names are kebab-case on the command line and
 * camelCase in the result. Lists given several times are joined. Returns { positionals: {...},
 * options: {...}, extra: [...] } where `extra` holds unknown `--key value` pairs when
 * `spec.passthrough` is set (used by `call`).
 */
export function parseArgs(argv, spec = {}) {
  const defs = spec.options ?? {};
  const byShort = new Map(Object.entries(defs).filter(([, d]) => d.short).map(([n, d]) => [d.short, n]));
  const options = {};
  const positionals = [];
  const extra = [];
  const set = (name, value) => {
    const def = defs[name];
    const key = camel(name);
    if (def.choices && !def.choices.includes(value)) throw new UsageError(`--${name} is one of ${def.choices.join(', ')}, not '${value}'`);
    if (def.type === 'list' && options[key]) options[key] = [...options[key], ...value];
    else options[key] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length > 1 && !/^-\d/.test(arg))) {
      let name;
      let inline = null;
      if (arg.startsWith('--')) {
        const eq = arg.indexOf('=');
        name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
        if (eq >= 0) inline = arg.slice(eq + 1);
      } else {
        name = byShort.get(arg.slice(1));
        if (!name) throw new UsageError(`unknown option '${arg}'`);
      }
      let def = defs[name];
      if (!def && name.startsWith('no-') && defs[name.slice(3)]?.type === 'boolean' && inline === null) {
        set(name.slice(3), false);
        continue;
      }
      if (!def) {
        if (!spec.passthrough) throw new UsageError(`unknown option '--${name}'`);
        // Unknown options pass through as `--key value` (or a bare flag: true).
        let value = inline;
        if (value === null) value = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
        extra.push([name, value]);
        continue;
      }
      if (def.type === 'boolean') {
        set(name, inline === null ? true : convertValue(name, 'boolean', inline));
        continue;
      }
      let text = inline;
      if (text === null) {
        if (i + 1 >= argv.length) throw new UsageError(`--${name} needs a value`);
        text = argv[++i];
      }
      set(name, convertValue(name, def.type ?? 'string', text));
      continue;
    }
    positionals.push(arg);
  }
  const names = spec.positionals ?? [];
  const named = {};
  for (const [k, n] of names.entries()) {
    const optional = n.endsWith('?');
    const key = camel(optional ? n.slice(0, -1) : n);
    if (k < positionals.length) named[key] = positionals[k];
    else if (!optional) throw new UsageError(`missing <${optional ? n.slice(0, -1) : n}>`);
  }
  const left = positionals.slice(names.length);
  if (spec.rest) named[camel(spec.rest)] = left;
  else if (left.length) throw new UsageError(`unexpected argument '${left[0]}'`);
  for (const [name, def] of Object.entries(defs)) if (def.default !== undefined && options[camel(name)] === undefined) options[camel(name)] = def.default;
  return { positionals: named, options, extra };
}

/** Turns `--key value` pairs into tool arguments: values that read as JSON are JSON, the rest strings. */
export function toolArguments(pairs) {
  const out = {};
  for (const [key, text] of pairs) {
    let value = text;
    try {
      value = JSON.parse(text);
    } catch {
      // plain text
    }
    out[key.replace(/-/g, '_')] = value;
  }
  return out;
}
