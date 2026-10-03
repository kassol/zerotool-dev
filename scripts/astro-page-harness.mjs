// Runs the client scripts of one tool component (.astro) in a node:vm context with a small
// stand-in DOM, so tests can drive the real page entry points: input events with the
// debounce timer, button clicks, Ctrl/Cmd+Enter and the copy buttons.
//
// Read:  the component file, and npm packages that its <script> imports (through require,
//        resolved from the repository root)
// Write: nothing (no files, no network)
//
// Module scripts (<script> without is:inline) are TypeScript; they are transpiled to CommonJS
// with node_modules typescript and run in document order with the is:inline scripts. Top-level
// declarations stay visible to later `page.run()` calls in the same context.
// If the frontmatter has a `// strings:start` / `// strings:end` region with `const STRINGS`,
// `page.strings` is STRINGS[lang]; the test passes it to the element that carries
// data-strings (see `dataset` below), as the built page does.
//
// Not a test itself (no `test-` prefix): imported by scripts/test-*.mjs.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requireFromRoot = createRequire(join(root, 'package.json'));

export function readComponent(relPath) {
  const src = readFileSync(join(root, relPath), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(src);
  const frontmatter = fm ? fm[1] : '';
  const scripts = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src))) scripts.push({ inline: /\bis:inline\b/.test(m[1] || ''), code: m[2] });
  return { src, frontmatter, scripts };
}

export function frontmatterStrings(frontmatter) {
  const m = /\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/.exec(frontmatter);
  if (!m) return null;
  return vm.runInNewContext(m[1] + '\n;STRINGS');
}

function makeElement(key) {
  const listeners = {};
  const el = {
    key, id: key, value: '', textContent: '', className: '', disabled: false, hidden: false,
    dataset: {}, style: {}, attributes: {},
    setAttribute(n, v) { this.attributes[n] = String(v); if (n === 'disabled') this.disabled = true; },
    getAttribute(n) { return n in this.attributes ? this.attributes[n] : null; },
    removeAttribute(n) { delete this.attributes[n]; if (n === 'disabled') this.disabled = false; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    dispatch(type, init = {}) {
      const ev = { type, target: el, currentTarget: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
      for (const fn of listeners[type] || []) fn.call(el, ev);
      return ev;
    },
    // A disabled button does not fire click events in a browser.
    click() { if (!el.disabled) el.dispatch('click'); },
    focus() {}, blur() {}, select() {},
    querySelectorAll() { return []; },
  };
  el.classList = {
    add(...c) { const s = new Set(el.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); el.className = [...s].join(' '); },
    remove(...c) { el.className = el.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
    toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : on; if (want) this.add(c); else this.remove(c); return want; },
    contains(c) { return el.className.split(/\s+/).includes(c); },
  };
  return el;
}

/* options: { lang = 'en', dataset: { selector: { key: value } },
              stringsSelector: element that gets data-strings = JSON of STRINGS[lang] } */
export function loadPage(relPath, options = {}) {
  const lang = options.lang || 'en';
  const comp = readComponent(relPath);
  const all = comp.frontmatter ? frontmatterStrings(comp.frontmatter) : null;
  const strings = all ? (all[lang] || all.en) : null;
  const elements = new Map();
  const get = (key) => { if (!elements.has(key)) elements.set(key, makeElement(key)); return elements.get(key); };
  for (const [sel, data] of Object.entries(options.dataset || {})) Object.assign(get(sel).dataset, data);
  if (strings && options.stringsSelector) Object.assign(get(options.stringsSelector).dataset, { strings: JSON.stringify(strings), lang });

  let timers = [];
  let timerSeq = 0;
  const clipboard = [];
  const document = {
    documentElement: { lang },
    getElementById: (id) => get(id),
    querySelector: (sel) => get(sel),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: (tag) => makeElement('<' + tag + '>'),
    execCommand: () => false,
    body: makeElement('body'),
  };
  const sandbox = {
    document,
    navigator: { clipboard: { writeText: (t) => { clipboard.push(t); return Promise.resolve(); } } },
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    console, JSON, Math, Number, String, Object, Array, Promise, Error, TypeError, RangeError, SyntaxError,
    Map, Set, WeakMap, RegExp, Date, Symbol, BigInt, Intl, isFinite, isNaN, parseInt, parseFloat,
    exports: {}, module: { exports: {} },
    // Relative imports (./conversion-fidelity.js) resolve from the component's directory.
    require: (name) => requireFromRoot(name.startsWith('.') ? join(root, dirname(relPath), name) : name),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const s of comp.scripts) {
    const code = s.inline ? s.code : ts.transpileModule(s.code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInContext(code, ctx, { filename: relPath });
  }
  return {
    lang, strings, clipboard, ctx,
    el: (id) => get(id),
    q: (sel) => get(sel),
    run: (code) => vm.runInContext(code, ctx),
    /* Runs pending timers (the 300 ms debounce) until none are left. */
    flush() { for (let i = 0; i < 100 && timers.length; i++) { const t = timers.shift(); t.fn(); } },
    type(id, text) { const e = get(id); e.value = text; e.dispatch('input'); this.flush(); },
    key(id, init) { get(id).dispatch('keydown', init); this.flush(); },
  };
}
