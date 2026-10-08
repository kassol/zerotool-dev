// JSON to Python Dataclass — TypedDict marks keys missing from some samples as NotRequired
//
// Read:  src/components/tools/JsonToPythonDataclassTool.astro (extracts the real engine block
//        src/layouts/ToolLayout.astro (the real shared keyboard listener in the page VM);
//        between the `engine:start` / `engine:end` markers, so this test cannot drift from the
//        shipped source)
// Write: stdout only (test results); runs `python3` on generated code when it is available
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defect: in TypedDict mode a key that is absent from some objects was written
// as `Optional[T]`, which still makes the key required (PEP 589) and only allows None; it is now
// `NotRequired[T]` (PEP 655, typing in Python 3.11+), and `NotRequired[Optional[T]]` when the key
// is also null somewhere. Dataclass and Pydantic output keep `Optional[T] = None`. Also: an empty array
// in one sample no longer turns `List[str]` into `Union[List[str], List[Any]]`, and int with float is float
// (PEP 484 numeric tower) instead of `Union[int, float]`.
// With python3 >= 3.11 the generated TypedDict is executed and its __required_keys__ /
// __optional_keys__ are checked; otherwise SKIP.
// GA (2026-10-08): one `generate` event per committed action (input or root-name change, Example,
// a mode that changes) and only when code is shown; none after each 300 ms typing pause (before:
// every generation).
//
// Run: node scripts/test-json-to-python-dataclass.mjs

import vm from 'node:vm';
import { createHash } from 'node:crypto';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { annotations, contractProblems, examplePairs, fencedBlocks } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToPythonDataclassTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToPythonDataclassTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { generatePython };')();

let failures = 0, passes = 0, skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
const gen = (v, mode) => E.generatePython(v, 'Root', mode).code;

const SAMPLE = [
  { id: 1, name: 'Pen', note: null, tags: ['a'] },
  { id: 2, name: 'Ink', discount: 0.1, tags: [] },
];
eq('TypedDict: missing → NotRequired, null → Optional', gen(SAMPLE, 'typeddict').split('\n'), [
  'from typing import Any, List, NotRequired, Optional, TypedDict',
  '',
  'class Root(TypedDict):',
  '    id: int',
  '    name: str',
  '    note: NotRequired[Optional[Any]]',
  '    tags: List[str]',
  '    discount: NotRequired[float]',
]);
eq('TypedDict: null but always present → Optional only', gen({ a: null, b: 1 }, 'typeddict').split('\n'), [
  'from typing import Any, Optional, TypedDict', '', 'class Root(TypedDict):', '    a: Optional[Any]', '    b: int',
]);
eq('TypedDict: nothing missing → no NotRequired import', gen({ a: 1 }, 'typeddict').split('\n')[0], 'from typing import TypedDict');
eq('dataclass unchanged', gen(SAMPLE, 'dataclass').split('\n').slice(-6), [
  'class Root:', '    id: int', '    name: str', '    tags: List[str]', '    note: Optional[Any] = None', '    discount: Optional[float] = None',
]);
eq('pydantic unchanged', gen(SAMPLE, 'pydantic').split('\n').slice(-2), ['    note: Optional[Any] = None', '    discount: Optional[float] = None']);
eq('int and float across samples → float', gen([{ p: 2 }, { p: 1.5 }], 'dataclass').split('\n').pop(), '    p: float');
eq('primitive root → null', E.generatePython(5, 'Root', 'typeddict'), null);

const py = spawnSync('python3', ['-c', 'import sys; print(sys.version_info >= (3, 11))'], { encoding: 'utf8' });
if (py.status !== 0 || py.stdout.trim() !== 'True') {
  skips++;
  console.log('SKIP: python3 >= 3.11 not available');
} else {
  const code = gen(SAMPLE, 'typeddict') + '\nprint(sorted(Root.__required_keys__), sorted(Root.__optional_keys__))\n';
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  eq('python: required / optional keys', r.stdout.trim(), "['id', 'name', 'tags'] ['discount', 'note']");
  for (const mode of ['dataclass', 'typeddict']) {
    const c = spawnSync('python3', ['-c', gen(SAMPLE, mode)], { encoding: 'utf8' });
    check('python runs the ' + mode + ' output', c.status === 0, c.stderr);
  }
}

// Complete page lifecycle plus actual ToolLayout keyboard handler; DOM/clipboard/timers are boundary doubles.
const pageScript = source.slice(source.indexOf('(function () {'), source.indexOf('</script>', source.indexOf('(function () {')));
const pageLabels = vm.runInNewContext('(' + source.match(/const STRINGS = (\{[\s\S]*?\n\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('page engine bytes including marker indentation', Buffer.byteLength(engineLines), 12384);
eq('page immutable engine SHA256', createHash('sha256').update(engineLines).digest('hex'), '7c7b9051b69a268857938664f6a1115950f3df51306c65ec7a71bb8819ccd118');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function lifecyclePage(lang, shellFirst = false) {
  const copies = [], tracks = [], clears = [], downloads = [], blobs = new Map(), timers = new Map(), docEvents = {};
  let now = 0, timerId = 0, doc;
  const decode = s => s.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const descendants = el => el.children.flatMap(c => [c, ...descendants(c)]);
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const words = part.trim().split(/\s+/);
      if (words.length > 1) {
        if (!matches(el, words.pop())) return false;
        for (let p = el.parentElement; p; p = p.parentElement) if (matches(p, words.join(' '))) return true;
        return false;
      }
      const tag = /^[a-z][\w-]*/i.exec(part)?.[0], id = /#([\w-]+)/.exec(part)?.[1];
      return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
        && [...part.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
        && [...part.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].every(m => el.attributes[m[1]] === m[2]);
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), attributes: {}, dataset: {}, listeners: {}, children: [], parentElement: null, className: '', value: '', textContent: '', checked: false }); }
    setAttribute(key, value) {
      this.attributes[key] = value;
      if (['id', 'type', 'value'].includes(key)) this[key] = value;
      if (key === 'class') this.className = value;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    removeAttribute(key) { delete this.attributes[key]; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    get classList() { const e = this; return { contains(c) { return e.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) e.className += ' ' + c; }, remove(c) { e.className = e.className.split(/\s+/).filter(v => v !== c).join(' '); } }; }
    appendChild(e) { this.children.push(e); e.parentElement = this; }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    contains(e) { return this === e || descendants(this).includes(e); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, type }); }
    click() { if (this.tagName === 'A') { downloads.push({ name: this.download, blob: blobs.get(this.href) }); return; } if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element('section'); widget.className = 'tool-widget'; body.appendChild(widget);
  const markup = source.split('\n---')[1].split('<script')[0]
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{L\.tips\.(\w+)\}<\/Toggletip>/g, (_, id, about, tip) =>
      '<span class="zt-tip"><button type="button" data-zt-tip="' + id + '"></button><span id="' + id + '" role="note">' + escape(pageLabels[lang].tips[tip]) + '</span></span>')
    .replace(/=\{L\.(\w+)\}/g, (_, key) => '="' + escape(pageLabels[lang][key]) + '"')
    .replace(/\{L\.(\w+)\}/g, (_, key) => escape(pageLabels[lang][key]));
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[3] !== undefined) { stack.at(-1).textContent += decode(token[3]).trim(); continue; }
    if (token[0].startsWith('</')) { if (stack.at(-1).tagName !== token[1].toUpperCase()) throw Error('Unbalanced real markup'); stack.pop(); continue; }
    const el = new Element(token[1]);
    for (const a of token[2].matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) el.setAttribute(a[1], decode(a[2] ?? a[3]));
    stack.at(-1).appendChild(el);
    if (!['input', 'br', 'hr'].includes(token[1]) && !token[2].endsWith('/')) stack.push(el);
  }
  const get = id => { const el = descendants(body).find(e => e.id === id); if (!el) throw Error('Missing real ID ' + id); return el; };
  doc = { createElement: tag => new Element(tag), body, activeElement: body, getElementById: get, querySelector: s => body.querySelector(s), addEventListener(type, fn) { (docEvents[type] ||= []).push(fn); } };
  const context = { document: doc, _slug: 'json-to-python-dataclass', console, Blob, hljs: { highlightElement() {} },
    URL: { createObjectURL(blob) { const id = 'blob:' + blobs.size; blobs.set(id, blob); return id; }, revokeObjectURL() {} },
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'JsonToPythonDataclassTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, downloads, timers, doc,
    input(value) { get('jpdc-input').value = value; get('jpdc-input').dispatch('input'); },
    key(id = 'jpdc-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}

const snapshot = p => JSON.stringify(['jpdc-input', 'jpdc-root-name', 'jpdc-output-code', 'jpdc-status', 'jpdc-copy'].map(id => { const e = p.get(id); return [e.value, e.textContent, e.className, !!e.disabled]; }));
const golden = p => { p.input('{}'); p.advance(300); };
const goldenCode = "from dataclasses import dataclass\n\n@dataclass\nclass Root:\n    pass";
const copy = p => { p.get('jpdc-copy').click(); return p.copies.at(-1); };
const copyFailure = { en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。', ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.' };
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = lifecyclePage(lang); golden(p);
    eq(lang + ': page golden complete bytes', p.get('jpdc-output-code').textContent, goldenCode);
    eq(lang + ': localized current result', p.get('jpdc-status').textContent, L.msgGenOne);
    p.get('jpdc-root-name').value = 'Api'; p.get('jpdc-root-name').dispatch('input'); p.advance(300);
    eq(lang + ': root changes automatically convert', p.get('jpdc-output-code').textContent.includes('Api'), true);
    p.advance(300);
    eq(lang + ': automatic root change applies name', p.get('jpdc-output-code').textContent.includes('Api'), true);
    p.get('jpdc-clear').click();
    eq(lang + ': Clear preserves root name', p.get('jpdc-root-name').value, 'Api');
    eq(lang + ': Clear removes derived state', !p.get('jpdc-input').value && !p.get('jpdc-output-code').textContent && !p.get('jpdc-status').textContent, true);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = lifecyclePage(lang, shellFirst); golden(q); q.input('{');
      q.key('jpdc-copy', 'L', modifier);
      eq(lang + ': shared clear immediate ' + shellFirst + modifier, !q.get('jpdc-input').value && !q.get('jpdc-root-name').value && !q.get('jpdc-output-code').textContent && !q.get('jpdc-status').textContent, true);
      eq(lang + ': clear focuses input ' + shellFirst + modifier, q.doc.activeElement === q.get('jpdc-input'), true);
      eq(lang + ': queued work cancelled ' + shellFirst + modifier, q.timers.size, 0);
      eq(lang + ': shared storage clear ' + shellFirst + modifier, q.clears.join(','), 'json-to-python-dataclass');
      q.advance(1);
      eq(lang + ': shared clear remains empty after deferred callbacks ' + shellFirst + modifier, !q.get('jpdc-output-code').textContent && !q.get('jpdc-status').textContent, true);
    }
    const outside = lifecyclePage(lang); golden(outside); const beforeOutside = snapshot(outside); outside.key(null); outside.advance(1); eq(lang + ': outside shortcut unchanged', snapshot(outside), beforeOutside);
    const invalid = lifecyclePage(lang); golden(invalid); invalid.input('{'); invalid.advance(300);
    eq(lang + ': error removes old result', invalid.get('jpdc-output-code').textContent, '');
    eq(lang + ': invalid input is visibly marked', invalid.get('jpdc-input').classList.contains('error'), true);
    invalid.get('jpdc-download').click(); eq(lang + ': invalid JSON cannot download old code', invalid.downloads.length, 0);
    invalid.input(''); invalid.advance(300);
    eq(lang + ': empty input removes error and status', !invalid.get('jpdc-input').classList.contains('error') && !invalid.get('jpdc-status').textContent && !invalid.get('jpdc-output-code').textContent, true);
    const q = lifecyclePage(lang); golden(q);
    const good = copy(q); eq(lang + ': clipboard complete output bytes', good.value, goldenCode); good.resolve(); await settle(); eq(lang + ': copy success', q.get('jpdc-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('jpdc-copy').textContent, L.copy);
    for (const failure of ['reject', 'missing']) {
      const beforeUnhandled = unhandled.length, clipboard = q.context.navigator.clipboard; let thrown = null;
      try { if (failure === 'missing') { q.context.navigator.clipboard = undefined; copy(q); } else copy(q).reject(Error('denied')); } catch (e) { thrown = e; }
      await settle(); eq(lang + ': copy ' + failure + ' does not throw', thrown, null); eq(lang + ': copy ' + failure + ' has translated failure', q.get('jpdc-status').textContent, copyFailure[lang]); eq(lang + ': copy ' + failure + ' handled', unhandled.length, beforeUnhandled);
      q.context.navigator.clipboard = clipboard; const retry = copy(q); eq(lang + ': retry preserves bytes ' + failure, retry.value, goldenCode); retry.resolve(); await settle(); eq(lang + ': retry succeeds ' + failure, q.get('jpdc-copy').textContent, L.copied); eq(lang + ': retry clears owned error ' + failure, q.get('jpdc-status').textContent === copyFailure[lang], false);
    }
    for (const action of ["input", "clear", "shortcut", "result", "error", "example", "root", "tab"]) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = lifecyclePage(lang); golden(r); const old = copy(r);
      if (outcome === 'timer') { old.resolve(); await settle(); }
      if (action === 'input') r.input('{"next":true}');
      if (action === 'root') { r.get('jpdc-root-name').value = 'NewRoot'; r.get('jpdc-root-name').dispatch('input'); }
      if (action === 'tab') r.doc.querySelector("[data-mode=\"typeddict\"]").click();
      if (action === 'clear') r.get('jpdc-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') { r.input('{"next":true}'); r.advance(300); }
      if (action === 'error') { r.input('{'); r.advance(300); }
      if (action === 'example') r.get('jpdc-example').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      if (outcome === 'timer') r.advance(1500); else { old[outcome](Error('late')); await settle(); }
      if (outcome !== 'timer' || !['input', 'root'].includes(action)) eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      else eq(lang + ': expired feedback after edit ' + action, r.get('jpdc-copy').textContent, L.copy);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = lifecyclePage(lang); golden(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500); eq(lang + ': old timer leaves newer feedback', t.get('jpdc-copy').textContent, L.copied); t.advance(1000); eq(lang + ': new timer expires', t.get('jpdc-copy').textContent, L.copy);
    const order = lifecyclePage(lang); golden(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle(); eq(lang + ': older success keeps current copy failure', order.get('jpdc-status').textContent, copyFailure[lang]); eq(lang + ': older success cannot claim copied', order.get('jpdc-copy').textContent, L.copy);
    // A1 / A2: prototype names are ordinary keys and root names; a failed generation clears the old output.
    {
      const a = lifecyclePage(lang); golden(a);
      a.input('[{"constructor": 1, "toString": "x"}, {"__proto__": true, "hasOwnProperty": null}]'); a.advance(300);
      eq(lang + ': A1 prototype-named keys in a root array generate fields', ['constructor: Optional[int] = None', 'toString: Optional[str] = None', '__proto__: Optional[bool] = None', 'hasOwnProperty: Optional[Any] = None'].every((l) => a.get('jpdc-output-code').textContent.includes(l)), true);
      a.get('jpdc-root-name').value = 'toString'; a.input('{"a": 1}'); a.advance(300);
      eq(lang + ': A2 root name toString generates its class', a.get('jpdc-output-code').textContent.includes('class toString:') && a.get('jpdc-status').textContent === pageLabels[lang].msgGenOne, true);
      a.get('jpdc-root-name').value = 'Root'; a.input('{"a": 1}'); a.advance(300);
      a.input(Array.from({ length: 50000 }, (_, i) => '{"k' + i + '":').join('') + '1' + '}'.repeat(50000)); a.advance(300);
      eq(lang + ': a failed generation clears the old output and disables Copy', [a.get('jpdc-output-code').textContent, !!a.get('jpdc-copy').disabled, a.get('jpdc-status').textContent.startsWith(pageLabels[lang].msgFailed || '\u0000')], ['', true, true]);
      a.input('{"b": 2}'); a.advance(300);
      eq(lang + ': the next input generates again and enables Copy', [a.get('jpdc-output-code').textContent.includes('b: int'), !!a.get('jpdc-copy').disabled], [true, false]);
    }
    // GA: one generate event per committed action (change, Example, a new mode), none on page load or typing pauses.
    const g = lifecyclePage(lang);
    eq(lang + ': GA page load sends no event', g.tracks.length, 0);
    g.input('{"a":1}'); g.advance(300);
    eq(lang + ': GA typing pause regenerates without an event', [g.get('jpdc-output-code').textContent.includes('a: int'), g.tracks.length], [true, 0]);
    g.get('jpdc-input').dispatch('change');
    eq(lang + ': GA change sends one event', g.tracks, [['json-to-python-dataclass', 'generate']]);
    g.input('{"pending":1}'); g.get('jpdc-input').dispatch('change');
    eq(lang + ': GA change flushes the pending edit first', [g.get('jpdc-output-code').textContent.includes('pending: int'), g.tracks.length], [true, 2]);
    g.advance(300); eq(lang + ': GA flushed edit sends nothing more', g.tracks.length, 2);
    g.input('{'); g.advance(300); g.get('jpdc-input').dispatch('change'); eq(lang + ': GA invalid JSON sends no event', g.tracks.length, 2);
    g.input(''); g.get('jpdc-input').dispatch('change'); eq(lang + ': GA empty input sends no event', g.tracks.length, 2);
    g.get('jpdc-example').click(); eq(lang + ': GA Example sends one event', g.tracks.length, 3);
    g.doc.querySelector('[data-mode="typeddict"]').click(); eq(lang + ': GA a new mode sends one event', g.tracks.length, 4);
    g.doc.querySelector('[data-mode="typeddict"]').click(); eq(lang + ': GA the same mode sends none', g.tracks.length, 4);
    g.get('jpdc-root-name').value = 'Order'; g.get('jpdc-root-name').dispatch('input'); g.get('jpdc-root-name').dispatch('change');
    eq(lang + ': GA root name change sends one event', [g.get('jpdc-output-code').textContent.includes('class Order('), g.tracks.length], [true, 5]);
    const d = lifecyclePage(lang); golden(d); d.get('jpdc-download').click(); eq(lang + ': current download filename', d.downloads[0].name, 'root.py'); eq(lang + ': actual Blob full bytes', await d.downloads[0].blob.text(), goldenCode); d.doc.querySelector('[data-mode="typeddict"]').click(); eq(lang + ': mode click converts immediately', d.get('jpdc-output-code').textContent, 'from typing import TypedDict\n\nclass Root(TypedDict):\n    pass');
  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);


// ---------- v2 page layout ----------
const V2 = {
  "slug": "json-to-python-dataclass",
  "prefix": "jpdc",
  "manual": false,
  "tips": [
    [
      "root-name",
      "rootName",
      "rootName"
    ],
    [
      "input",
      "jsonInput",
      "input"
    ],
    [
      "example",
      "example",
      "example"
    ],
    [
      "clear",
      "clear",
      "clear"
    ],
    [
      "copy",
      "copy",
      "copy"
    ],
    [
      "mode",
      "mode",
      "mode"
    ],
    [
      "download",
      "download",
      "download"
    ]
  ],
  "scriptSHA": "160c211c1405876287b73dc1e902efa0f6a11ab38c3d03d76e12bd2b7589cbec"
};
const hash = value => createHash('sha256').update(value).digest('hex');
const layoutMarkup = source.split('\n---')[1].split('<script')[0];
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const registration = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
const prefix = V2.prefix;
eq('v2 convert registration', new RegExp("'" + V2.slug + "':\\s*'convert'").test(registration), true);
eq('v2 page script hash (2026-10-08: GA only on change, Example and a new mode)', hash(pageScript), V2.scriptSHA);
eq('v2 direct root', new RegExp('^\\s*<div\\s+class="' + prefix + '-wrap"').test(layoutMarkup), true);
eq('v2 root fills available height', css.includes('.' + prefix + '-wrap { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0;'), true);
eq('v2 control-status-panel reading order', layoutMarkup.indexOf('class="' + prefix + '-config"') < layoutMarkup.indexOf('class="' + prefix + '-actions"') && layoutMarkup.indexOf('class="' + prefix + '-actions"') < layoutMarkup.indexOf('id="' + prefix + '-status"') && layoutMarkup.indexOf('id="' + prefix + '-status"') < layoutMarkup.indexOf('class="' + prefix + '-panels zt-io"'), true);
eq('v2 two shared IO panes', (layoutMarkup.match(/\bzt-io-pane\b/g) || []).length, 2);
eq('v2 both editors fill panes', layoutMarkup.includes('id="' + prefix + '-input" class="zt-io-fill"') && layoutMarkup.includes('id="' + prefix + '-output" class="' + prefix + '-output zt-io-fill"'), true);
eq('v2 fixed status with internal overflow', css.includes('height: 2.8rem; flex: none; overflow: auto; overflow-wrap: anywhere;'), true);
eq('v2 bounded keyboard accessible output', layoutMarkup.includes('tabindex="0" aria-labelledby="' + prefix + '-output-label"') && css.includes('.' + prefix + '-output { margin: 0; overflow: auto; white-space: pre; }'), true);
eq('v2 actual output controls desktop empty hint', css.includes('.' + prefix + '-output-pane:has(#' + prefix + '-output-code:empty) .' + prefix + '-empty { display: flex; }'), true);
eq('v2 stacked empty pane hidden and result bounded', css.includes('@media (max-width: 860px)') && css.includes('.' + prefix + '-output-pane:has(#' + prefix + '-output-code:empty) { display: none; }') && css.includes('height: 22rem; min-height: 160px; resize: none;'), true);
eq('v2 stacked input 144px, phone input 120px and name inline', css.includes('height: 144px; min-height: 144px;') && css.includes('width: 100%; flex-direction: row; align-items: center;') && /@media \(max-width: 640px\)\s*\{\s*\.jpdc-wrap \{ gap: 0\.25rem; \}\s*\.jpdc-status \{ height: 2\.4rem; \}\s*\.jpdc-panel textarea \{ height: 120px; min-height: 120px; \}/.test(css), true);
eq('v2 44px actions', css.includes('.' + prefix + '-actions button, .' + prefix + '-panel-header button { min-height: 44px; }'), true);
eq('v2 dark ancestry global', css.includes(':global(:root:not([data-theme="light"]))') && css.includes(':global([data-theme="dark"])'), true);
eq('v2 tips remain build-time only', !/data-i18n|define:vars/.test(source) && !/STRINGS|L\.tips|\.tips\b/.test(pageScript), true);
eq('v2 exact actual tip count', (layoutMarkup.match(/<Toggletip\b/g) || []).length, V2.tips.length);
for (const [id, about, key] of V2.tips) eq('v2 exact tip binding ' + id, layoutMarkup.includes('<Toggletip id="' + prefix + '-tip-' + id + '" lang={lang} about={L.' + about + '}>{L.tips.' + key + '}</Toggletip>'), true);
const actualButtons = [...layoutMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]).sort();
eq('v2 explicit buttons retained', actualButtons.join(','), ['clear','copy','example', ...(V2.manual ? ['convert'] : []), ...(prefix === 'jpdc' ? ['download'] : [])].map(id => prefix + '-' + id).sort().join(','));
if (!V2.manual) {
  eq('v2 no residual Generate label/action', !/generate:/.test(source) && !source.includes(prefix + '-convert') && !layoutMarkup.includes('btn-primary'), true);
  eq('v2 existing tab container shares segmented layout', layoutMarkup.includes(prefix + '-tabs zt-segmented'), true);
  eq('v2 selected segment contrasts in either theme', css.includes('.' + prefix + '-tab.active { background: var(--color-text); color: var(--color-bg); }'), true);
}
for (const lang of ['en','zh','ja','ko']) {
  const L = pageLabels[lang];
  eq(lang + ': v2 exact translated tip keys', Object.keys(L.tips).sort().join(','), V2.tips.map(t => t[2]).sort().join(','));
  for (const [id, about, key] of V2.tips) eq(lang + ': v2 localized plain tip ' + id, typeof L[about] === 'string' && !!L[about].trim() && !/[<>]/.test(L[about]) && typeof L.tips[key] === 'string' && !!L.tips[key].trim() && !/[<>]/.test(L.tips[key]), true);
  eq(lang + ': v2 localized empty text', typeof L.empty === 'string' && !!L.empty.trim() && layoutMarkup.includes('{L.empty}'), true);
  const p = lifecyclePage(lang), rootEl = p.doc.querySelector('.' + prefix + '-wrap');
  eq(lang + ': v2 only feedback forwarded', Object.keys(rootEl.dataset).sort().join(','), ['copy','copied','copyFailed','msgInvalidJson','msgFailed','msgGenerated','msgGenOne','msgGenMany', ...(prefix === 'jkt' ? ['msgRootList'] : []), ...(prefix === 'jpdc' ? ['download'] : [])].sort().join(','));
  const mdx = readFileSync(join(root, 'src/content/tools/' + V2.slug + '/' + lang + '.mdx'), 'utf8');
  const [,fm,body] = mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
  const steps = fm.match(/^steps:\n((?:  - .*\n)+)/m)[1].trimEnd().split('\n').map(l => JSON.parse(l.slice(4)));
  eq(lang + ': v2 steps correspond to controls', steps.length, V2.tips.length);
  eq(lang + ': v2 step limits and order', fm.indexOf('steps:') < fm.indexOf('faqItems:') && steps.every(x => [...x].length <= 280 && !/[<>]/.test(x)) && steps.reduce((n,x) => n+[...x].length,0) <= 1200, true);
  for (const [, about] of V2.tips) eq(lang + ': v2 steps actual label ' + about, steps.join('\n').includes(L[about]), true);
  eq(lang + ': MDX content contract', contractProblems('json-to-python-dataclass', lang), '');
  // JSON → Python examples, recomputed: the root name is one of the classes in the shown output.
  const pyPairs = examplePairs(body, b => b.lang === 'pre' && /^[[{]/.test(b.text), b => b.lang === 'pre' && /^from /.test(b.text));
  eq(lang + ': has JSON → Python examples', pyPairs.length > 0, true);
  eq(lang + ': each Python example equals the engine output', pyPairs.filter(([a, b]) => ![...b.text.matchAll(/^class (\w+)/gm)].some(([, name]) => ['dataclass', 'pydantic', 'typeddict'].some(mode => E.generatePython(JSON.parse(a.text), name, mode)?.code === b.text))).map(([, b]) => b.text), []);
  eq(lang + ': v2 no duplicate usage', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body), true);
  for (const shellFirst of [false,true]) for (const focus of ['output','tip']) {
    const q = lifecyclePage(lang,shellFirst);golden(q);q.key(focus === 'output' ? q.get(prefix + '-output') : q.doc.querySelector('[data-zt-tip="' + prefix + '-tip-copy"]'));
    eq(lang + ': v2 output focus survives CtrlL ' + shellFirst + focus, q.doc.activeElement === q.get(prefix+'-input') && !q.get(prefix+'-input').value && !q.get(prefix+'-root-name').value && !q.get(prefix+'-output-code').textContent && !q.get(prefix+'-status').textContent && q.clears.length === 1, true);
  }
  const selected=lifecyclePage(lang);
  for (const value of ["dataclass", "pydantic", "typeddict"]) {
    selected.doc.querySelector('[data-mode="'+value+'"]').click();
    for (const tab of selected.doc.querySelector('.jpdc-wrap').querySelectorAll('.jpdc-tab')) eq(lang + ': v2 pressed state ' + value + '/' + tab.dataset.mode, tab.getAttribute('aria-pressed'), String(tab.dataset.mode === value));
  }
  const q=lifecyclePage(lang);golden(q);const n=q.tracks.length;q.key(prefix+'-input','Enter');eq(lang + ': v2 CtrlEnter main action',q.tracks.length-n,V2.manual?1:0);
  q.key(prefix+'-input','Enter','metaKey');eq(lang + ': v2 MetaEnter main action',q.tracks.length-n,V2.manual?2:0);
}

// ---------- {/* jpdc-check: {"root", "mode"} */} worked examples, recomputed and executed ----------
// The first code block after the note is the input JSON, the second the complete output for that
// root name and mode. Each language needs at least 2. With Python 3.11+ every output runs; with
// Pydantic 2 importable (PYDANTIC_PYTHON=<python with pydantic>, else python3) a Pydantic output
// validates its input with model_validate() and a dataclass output is built with Root(**data).
const PY_OK = (bin) => { const r = spawnSync(bin, ['-c', 'import sys; print(sys.version_info >= (3, 11))'], { encoding: 'utf8' }); return r.status === 0 && r.stdout.trim() === 'True'; };
const pyBin = PY_OK('python3') ? 'python3' : null;
const pydBin = [process.env.PYDANTIC_PYTHON, 'python3'].filter(Boolean).find((bin) => PY_OK(bin) && spawnSync(bin, ['-c', 'import pydantic; assert pydantic.VERSION.startswith("2.")'], { encoding: 'utf8' }).status === 0) || null;
const runPy = (bin, code) => spawnSync(bin, ['-c', code], { encoding: 'utf8' });
const checks = [];
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-python-dataclass/' + lang + '.mdx'), 'utf8');
  const body = mdx.slice(mdx.indexOf('\n---\n', 4) + 5);
  const notes = annotations(body, 'jpdc-check');
  eq(lang + ': at least 2 jpdc-check examples', notes.length >= 2, true);
  notes.forEach((note, i) => {
    const blocks = fencedBlocks(note.after);
    const input = blocks[0]?.text, shown = blocks[1]?.text;
    const out = E.generatePython(JSON.parse(input), note.spec.root, note.spec.mode)?.code;
    eq(lang + ': jpdc-check ' + (i + 1) + ' output equals the engine', shown, out);
    checks.push({ name: lang + ' jpdc-check ' + (i + 1), input, out, root: note.spec.root, mode: note.spec.mode });
  });
}
if (!pyBin) { skips++; console.log('SKIP: python3 >= 3.11 not available for the page examples'); }
else for (const c of checks) {
  if (c.mode === 'pydantic' && !pydBin) continue;
  const tail = c.mode === 'pydantic' ? `\nimport json\n${c.root}.model_validate(json.loads(${JSON.stringify(c.input)}))\nprint('ok')`
    : c.mode === 'dataclass' ? `\nimport json\n${c.root}(**json.loads(${JSON.stringify(c.input)}))\nprint('ok')` : `\nprint('ok')`;
  const r = runPy(c.mode === 'pydantic' ? pydBin : pyBin, c.out + tail);
  eq(c.name + ' runs in Python' + (c.mode === 'pydantic' ? ' and validates its input with Pydantic' : c.mode === 'dataclass' ? ' and builds from its input' : ''), r.stdout.trim() || r.stderr.trim().split('\n').pop(), 'ok');
}
// Page claims about Python and Pydantic behaviour: the printed value must be what each listed page shows.
const pageText = Object.fromEntries(['en', 'zh', 'ja', 'ko'].map((l) => [l, readFileSync(join(root, 'src/content/tools/json-to-python-dataclass/' + l + '.mdx'), 'utf8')]));
const nestedJson = '{"id": 7, "title": "Release notes", "author": {"name": "Alice", "email": null}, "tags": ["python", "json"], "score": 4.5, "comments": [{"user": "bob", "text": "nice"}, {"user": "carol"}]}';
const geo = JSON.parse(checks.find((c) => c.root === 'GeocodeResponse').input);
const CLAIMS = [
  { langs: ['en', 'zh', 'ja', 'ko'], code: E.generatePython(JSON.parse('{"price": 10.0, "qty": 2}'), 'Item', 'pydantic').code + '\nfrom pydantic import ValidationError\ntry:\n    Item(price=10.5, qty=2)\nexcept ValidationError as e:\n    print(e.errors()[0]["msg"])', expect: 'Input should be a valid integer, got a number with a fractional part' },
  { langs: ['en', 'zh', 'ja', 'ko'], code: E.generatePython(JSON.parse(nestedJson), 'Root', 'dataclass').code + `\nimport json\nroot = Root(**json.loads(${JSON.stringify(nestedJson)}))\nprint(type(root.author))`, expect: "<class 'dict'>" },
  { langs: ['en', 'zh', 'ja', 'ko'], code: E.generatePython(JSON.parse(nestedJson), 'Root', 'pydantic').code + `\nimport json\nroot = Root.model_validate(json.loads(${JSON.stringify(nestedJson)}))\nprint(repr(root.comments[1]))`, expect: "CommentsItem(user='carol', text=None)" },
  { langs: ['ja'], code: 'from typing import List\nfrom pydantic import BaseModel\nclass A(BaseModel):\n    pops: List[int]\nprint(A(pops=["0", "10"]).pops)', expect: '[0, 10]' },
  { langs: [], code: 'from datetime import datetime\nfrom pydantic import BaseModel\nclass A(BaseModel):\n    at: datetime\nprint(A(at="2026-10-08T17:00:00+09:00").at.utcoffset().total_seconds())', expect: '32400.0' },
  { langs: ['ko'], code: 'from datetime import date\nfrom pydantic import BaseModel, ValidationError\nclass A(BaseModel):\n    postdate: date\ntry:\n    A(postdate="20161208")\nexcept ValidationError as e:\n    print(e.errors()[0]["msg"])', expect: 'Datetimes provided to dates should have zero time - e.g. be exact dates' },
  { langs: ['ko'], code: 'from datetime import datetime\nfrom pydantic import BaseModel, ValidationError\nclass A(BaseModel):\n    lastBuildDate: datetime\ntry:\n    A(lastBuildDate="Mon, 26 Sep 2016 10:39:37 +0900")\nexcept ValidationError as e:\n    print(e.errors()[0]["msg"])', expect: 'Input should be a valid datetime or date, invalid character in year' },
  { langs: ['ko'], code: 'from email.utils import parsedate_to_datetime\nprint(parsedate_to_datetime("Mon, 26 Sep 2016 10:39:37 +0900"))', expect: '2016-09-26 10:39:37+09:00' },
  { langs: [], code: 'from datetime import datetime\nprint(datetime.strptime("20161208", "%Y%m%d").date())', expect: '2016-12-08' },
  // zh: a model generated from the house-number result alone rejects the district-level result.
  { langs: [], code: E.generatePython({ ...geo, geocodes: [geo.geocodes[0]] }, 'GeocodeResponse', 'pydantic').code + `\nimport json\nfrom pydantic import ValidationError\ntry:\n    GeocodeResponse.model_validate(json.loads(${JSON.stringify(JSON.stringify(geo))}))\n    print('accepted')\nexcept ValidationError as e:\n    print('rejected ' + e.errors()[0]['loc'][-1])`, expect: 'rejected street' },
];
if (!pydBin) { skips++; console.log('SKIP: Python 3.11+ with Pydantic 2 not available (set PYDANTIC_PYTHON)'); }
else {
  console.log('Pydantic ' + runPy(pydBin, 'import pydantic; print(pydantic.VERSION)').stdout.trim());
  for (const [i, c] of CLAIMS.entries()) {
    const r = runPy(pydBin, c.code);
    eq('claim ' + (i + 1) + ' Python output', r.stdout.trim() || r.stderr.trim().split('\n').pop(), c.expect);
  }
}
for (const [i, c] of CLAIMS.entries()) for (const lang of c.langs) eq(lang + ': claim ' + (i + 1) + ' shown on the page', pageText[lang].includes(c.expect), true);

// Sample-coverage supplement uses independently recorded complete outputs.
const coverageFixtures = [
  {
    "input": {
      "tags": []
    },
    "output": "from dataclasses import dataclass\nfrom typing import Any, List\n\n@dataclass\nclass Root:\n    tags: List[Any]",
    "expectedLine": "tags: List[Any]"
  },
  {
    "input": [
      {
        "tags": []
      },
      {
        "tags": [
          "admin"
        ]
      }
    ],
    "output": "from dataclasses import dataclass\nfrom typing import List\n\n@dataclass\nclass Root:\n    tags: List[str]",
    "expectedLine": "tags: List[str]"
  },
  {
    "input": [
      {
        "id": 1
      },
      {
        "id": 2,
        "note": null
      }
    ],
    "output": "from dataclasses import dataclass\nfrom typing import Any, Optional\n\n@dataclass\nclass Root:\n    id: int\n    note: Optional[Any] = None",
    "expectedLine": "note: Optional[Any] = None"
  }
];
for (const [i, f] of coverageFixtures.entries()) eq("sample coverage full output " + i, E.generatePython(f.input, "Root", "dataclass").code, f.output);

console.log(`\n${passes} passed, ${failures} failed${skips ? ', ' + skips + ' skipped' : ''}`);
process.exit(failures ? 1 : 0);
