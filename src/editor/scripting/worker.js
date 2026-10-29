// SPDX-License-Identifier: MIT OR Apache-2.0
// The script sandbox: Python (Pyodide) in a Web Worker. Scripts and add-ons run here, on a copy of
// the project (engine.js). A worker has no page, no editor and no desktop file access; once Python
// has started, the worker also removes its own ways to reach the network and browser storage, so a
// script can only read and change the project it is given.

import moduleSource from './rigby.py?raw';
import { ScriptEngine } from './engine.js';

const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'importScripts', 'indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'cookieStore'];

function lockDown() {
  for (const name of BLOCKED) {
    // Remove the name from the worker and from every prototype it inherits from.
    for (let o = self; o; o = Object.getPrototypeOf(o)) {
      const d = Object.getOwnPropertyDescriptor(o, name);
      if (d?.configurable) delete o[name];
    }
    try {
      Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
    } catch {
      // Already gone.
    }
  }
  if (self.navigator && 'storage' in self.navigator) {
    try {
      Object.defineProperty(self.navigator, 'storage', { value: undefined });
    } catch {
      // Not configurable here.
    }
  }
}

const engine = (async () => {
  const base = new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.href).href;
  const { loadPyodide } = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
  const py = await loadPyodide({ indexURL: base });
  const e = new ScriptEngine(py, moduleSource);
  lockDown();
  return e;
})();

self.onmessage = async (event) => {
  const { id, ...msg } = event.data ?? {};
  try {
    const result = (await engine).handle(msg);
    self.postMessage({ id, ...result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
