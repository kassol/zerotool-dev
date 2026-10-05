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
//
// Run: node scripts/test-json-to-python-dataclass.mjs

import vm from 'node:vm';
import { createHash } from 'node:crypto';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
const pageLabels = vm.runInNewContext('(' + source.match(/const labels = (\{[\s\S]*?\n\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('page engine bytes including marker indentation', Buffer.byteLength(engineLines), 12265);
eq('page immutable engine SHA256', createHash('sha256').update(engineLines).digest('hex'), '09bdd50af71f3e9d0a9ed72651cf3f8964cfcafc80803bfe818b107eae12154f');
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
    p.get('jpdc-convert').click();
    eq(lang + ': Generate applies root name', p.get('jpdc-output-code').textContent.includes('Api'), true);
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
      if (action === 'result') { r.input('{"next":true}'); r.get('jpdc-convert').click(); }
      if (action === 'error') { r.input('{'); r.get('jpdc-convert').click(); }
      if (action === 'example') r.get('jpdc-example').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      if (outcome === 'timer') r.advance(1500); else { old[outcome](Error('late')); await settle(); }
      if (outcome !== 'timer' || !['input', 'root'].includes(action)) eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      else eq(lang + ': expired feedback after edit ' + action, r.get('jpdc-copy').textContent, L.copy);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = lifecyclePage(lang); golden(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500); eq(lang + ': old timer leaves newer feedback', t.get('jpdc-copy').textContent, L.copied); t.advance(1000); eq(lang + ': new timer expires', t.get('jpdc-copy').textContent, L.copy);
    const order = lifecyclePage(lang); golden(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle(); eq(lang + ': older success keeps current copy failure', order.get('jpdc-status').textContent, copyFailure[lang]); eq(lang + ': older success cannot claim copied', order.get('jpdc-copy').textContent, L.copy);
    const d = lifecyclePage(lang); golden(d); d.get('jpdc-download').click(); eq(lang + ': current download filename', d.downloads[0].name, 'root.py'); eq(lang + ': actual Blob full bytes', await d.downloads[0].blob.text(), goldenCode); d.doc.querySelector('[data-mode="typeddict"]').click(); eq(lang + ': mode click converts immediately', d.get('jpdc-output-code').textContent, 'from typing import TypedDict\n\nclass Root(TypedDict):\n    pass');
  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);

console.log(`\n${passes} passed, ${failures} failed${skips ? ', ' + skips + ' skipped' : ''}`);
process.exit(failures ? 1 : 0);
