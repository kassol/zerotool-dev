// JSON Diff — the generated JSON Patch turns Before into After
//
// Read:  src/components/tools/JsonDiffTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped
//        source); src/content/tools/json-diff/{en,zh,ja,ko}.mdx (the example patches);
//        src/layouts/ToolLayout.astro, src/styles/tool-common.css, src/data/tool-layouts.ts
// Write: stdout; one temporary JSON file under os.tmpdir() for the Python check (removed)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Every patch is applied with a strict RFC 6902 applier written in this file (paths per
// RFC 6901: "" is the whole document, "/" is the member named ""; remove and replace need an
// existing target; array add index may be at most the length) and the result must equal
// After. When python3 has the jsonpatch package, the same patches are also applied with
// jsonpatch.apply_patch; without it those checks are SKIP. Cases: root type changes (path ""),
// several removals from one array (must run from the highest index down), nested arrays,
// keys that exist on Object.prototype (constructor, toString, __proto__), RFC 6901 escaping,
// and 3,000 random document pairs.
//
// Run: node scripts/test-json-diff.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonDiffTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonDiffTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { diff, buildVisual };')();

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

// ---------- strict RFC 6902 applier ----------
function parsePointer(p) {
  if (p === '') return [];
  if (p[0] !== '/') throw new Error('bad pointer ' + p);
  return p.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function arrayIndex(arr, tok, forAdd) {
  if (forAdd && tok === '-') return arr.length;
  if (!/^(0|[1-9]\d*)$/.test(tok)) throw new Error('bad array index ' + tok);
  const i = Number(tok);
  if (i > arr.length || (!forAdd && i >= arr.length)) throw new Error('index out of range ' + tok);
  return i;
}
function applyPatch(doc, patch) {
  let d = structuredClone(doc);
  for (const op of patch) {
    const toks = parsePointer(op.path);
    if (toks.length === 0) {
      if (op.op === 'replace' || op.op === 'add') { d = structuredClone(op.value); continue; }
      throw new Error('cannot ' + op.op + ' the root');
    }
    let parent = d;
    for (const t of toks.slice(0, -1)) {
      if (Array.isArray(parent)) parent = parent[arrayIndex(parent, t, false)];
      else if (parent !== null && typeof parent === 'object' && own(parent, t)) parent = parent[t];
      else throw new Error('path not found ' + op.path);
    }
    const last = toks[toks.length - 1];
    if (Array.isArray(parent)) {
      if (op.op === 'add') parent.splice(arrayIndex(parent, last, true), 0, structuredClone(op.value));
      else if (op.op === 'remove') parent.splice(arrayIndex(parent, last, false), 1);
      else if (op.op === 'replace') parent[arrayIndex(parent, last, false)] = structuredClone(op.value);
      else throw new Error('unexpected op ' + op.op);
    } else if (parent !== null && typeof parent === 'object') {
      if (op.op === 'add') Object.defineProperty(parent, last, { value: structuredClone(op.value), enumerable: true, writable: true, configurable: true });
      else if (op.op === 'remove') { if (!own(parent, last)) throw new Error('remove missing ' + op.path); delete parent[last]; }
      else if (op.op === 'replace') { if (!own(parent, last)) throw new Error('replace missing ' + op.path); parent[last] = structuredClone(op.value); }
      else throw new Error('unexpected op ' + op.op);
    } else throw new Error('parent is not a container ' + op.path);
  }
  return d;
}
// Key order does not matter in JSON objects.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) Object.defineProperty(o, k, { value: canon(v[k]), enumerable: true });
    return o;
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const allCases = [];
function roundTrip(name, beforeText, afterText) {
  const before = JSON.parse(beforeText);
  const after = JSON.parse(afterText);
  const patch = E.diff(before, after, '');
  allCases.push({ name, before, after, patch });
  let result;
  let err = null;
  try { result = applyPatch(before, patch); } catch (e) { err = e.message; }
  check(name + ': patch applies (RFC 6902)', !err, err + ' — patch ' + JSON.stringify(patch));
  if (!err) check(name + ': patched Before equals After', same(result, after), JSON.stringify(result) + ' vs ' + JSON.stringify(after));
  return patch;
}

// ---------- the reported defects ----------
eq('root type change uses the empty path', roundTrip('object → array', '{"a":1}', '[1]'), [{ op: 'replace', path: '', value: [1] }]);
eq('different root scalars use the empty path', roundTrip('1 → 2', '1', '2'), [{ op: 'replace', path: '', value: 2 }]);
roundTrip('"a" → null', '"a"', 'null');
eq('two removals from one array run from the highest index', roundTrip('[1,2,3] → [1]', '[1,2,3]', '[1]'), [
  { op: 'remove', path: '/2' }, { op: 'remove', path: '/1' },
]);
roundTrip('nested array removals', '{"a":{"b":[0,1,2,3,4,5]}}', '{"a":{"b":[9,1]}}');
roundTrip('array grows', '[1]', '[1,2,3]');
roundTrip('array of arrays', '[[1,2,3],[4,5,6]]', '[[1],[4,5,6,7],[8]]');
roundTrip('array emptied', '{"x":[1,2,3,4]}', '{"x":[]}');

// ---------- keys that exist on Object.prototype ----------
eq('a new key named constructor is an add', roundTrip('constructor added', '{}', '{"constructor":1}'), [{ op: 'add', path: '/constructor', value: 1 }]);
eq('a removed key named toString is a remove', roundTrip('toString removed', '{"toString":1}', '{}'), [{ op: 'remove', path: '/toString' }]);
roundTrip('__proto__ key', '{"__proto__":{"a":1}}', '{"__proto__":{"a":2},"hasOwnProperty":0}');
{
  const v = E.buildVisual({}, { constructor: 1 }, '');
  eq('visual diff: constructor added', v, [{ type: 'add', path: 'constructor', value: 1 }]);
}

// ---------- RFC 6901 escaping and the page example ----------
eq('escaping', roundTrip('escaping', '{"a/b":1,"m~n":2,"list":[1,2,3]}', '{"a/b":2,"list":[1,2,3,4],"x":null}'), [
  { op: 'replace', path: '/a~1b', value: 2 },
  { op: 'remove', path: '/m~0n' },
  { op: 'add', path: '/list/3', value: 4 },
  { op: 'add', path: '/x', value: null },
]);
roundTrip('empty key', '{"":1}', '{"":2}');
eq('no difference', E.diff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }, ''), []);

// ---------- random pairs ----------
let seed = 20261001;
function rnd(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }
const KEYS = ['a', 'b', 'c', 'constructor', '', 'x/y', 'm~n', '0', '__proto__'];
function randomValue(depth) {
  const r = rnd(depth > 2 ? 5 : 8);
  if (r === 0) return null;
  if (r === 1) return rnd(5);
  if (r === 2) return ['s', 't', ''][rnd(3)];
  if (r === 3) return rnd(2) === 0;
  if (r === 4) return rnd(3);
  if (r === 5 || r === 6) {
    const n = rnd(5);
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(randomValue(depth + 1));
    return arr;
  }
  const o = {};
  const n = rnd(4);
  for (let i = 0; i < n; i++) Object.defineProperty(o, KEYS[rnd(KEYS.length)], { value: randomValue(depth + 1), enumerable: true, writable: true, configurable: true });
  return o;
}
let randomFailures = 0;
for (let i = 0; i < 3000; i++) {
  const before = randomValue(0);
  const after = randomValue(0);
  const patch = E.diff(before, after, '');
  let ok = false;
  let detail = '';
  try { ok = same(applyPatch(before, patch), after); detail = 'result differs'; } catch (e) { detail = e.message; }
  if (!ok && randomFailures++ < 5) check('random pair ' + i, false, detail + ' — ' + JSON.stringify(before) + ' → ' + JSON.stringify(after) + ' patch ' + JSON.stringify(patch));
  if (ok) allCases.push({ name: 'random ' + i, before, after, patch });
}
check('3,000 random pairs round-trip', randomFailures === 0, randomFailures + ' failed');

// ---------- Python jsonpatch ----------
const havePy = spawnSync('python3', ['-c', 'import jsonpatch'], { encoding: 'utf8' }).status === 0;
if (havePy) {
  const tmp = mkdtempSync(join(tmpdir(), 'jd-test-'));
  const file = join(tmp, 'cases.json');
  writeFileSync(file, JSON.stringify(allCases));
  const py = [
    'import json, sys, jsonpatch',
    'cases = json.load(open(sys.argv[1]))',
    'bad = []',
    'for c in cases:',
    '    try:',
    '        r = jsonpatch.apply_patch(c["before"], c["patch"])',
    '        if r != c["after"]: bad.append(c["name"] + ": result differs")',
    '    except Exception as e:',
    '        bad.append(c["name"] + ": " + type(e).__name__ + " " + str(e))',
    'print(json.dumps(bad))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', py, file], { encoding: 'utf8' });
  rmSync(tmp, { recursive: true, force: true });
  const bad = r.status === 0 ? JSON.parse(r.stdout) : ['python failed: ' + r.stderr];
  check('python jsonpatch applies all ' + allCases.length + ' patches', bad.length === 0, bad.slice(0, 5).join('; '));
} else {
  skips++;
  console.log('SKIP: python3 jsonpatch not installed');
}

// ---------- tool page examples ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/json-diff/' + lang + '.mdx'), 'utf8');
  const re = /\{\/\* diff: (\{[\s\S]*?\}) \*\/\}\n\n```json\n([\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    const spec = JSON.parse(m[1]);
    const patch = E.diff(spec.before, spec.after, '');
    eq(lang + ': example patch ' + count + ' is what the engine writes', JSON.parse(m[2]), patch);
  }
  check(lang + ': page has checked example patches', count >= 2, String(count));
}

// ---------- full page result and clipboard lifecycle ----------
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('      // ── Keyboard shortcuts:'), layout.indexOf('      // ── Copy button visual feedback'));
check('read actual shared shortcut handler', shortcut.includes('window.ztPersist.clear(_slug)'));
const unhandled = [];
const onUnhandled = e => unhandled.push(String(e));
process.on('unhandledRejection', onUnhandled);
const tick = () => new Promise(resolve => setImmediate(resolve));
function pageHarness(lang, sharedFirst, viewport = { width: 1366, height: 900, resultTop: 500 }) {
  const labels = vm.runInNewContext('(' + source.match(/const STRINGS = ([\s\S]*?);\n\nconst L/)[1] + ')')[lang];
  const nodes = new Map(), events = {}, timers = new Map(), copies = [], tracked = [], persisted = [], scrolled = [];
  let now = 0, timerId = 0;
  const markup = source.slice(source.indexOf('---', 3) + 3, source.indexOf('<script'));
  const stack = [], all = [], camel = key => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (const m of markup.matchAll(/<(\/?)([\w-]+)\b([^>]*)>/g)) {
    if (m[1]) { stack.pop(); continue; }
    const attrs = Object.fromEntries([...m[3].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    for (const a of m[3].matchAll(/([\w-]+)=\{L\.(\w+)\}/g)) attrs[a[1]] = labels[a[2]];
    const el = { id: attrs.id || '', tagName: m[2].toUpperCase(), parentElement: stack.at(-1) || null, value: '', textContent: '', innerHTML: '', className: attrs.class || '', style: { display: attrs.style?.includes('display:none') ? 'none' : '' }, handlers: {}, dataset: {},
      hidden: /\bhidden(?:\s|$)/.test(m[3]), disabled: /\bdisabled(?:\s|$)/.test(m[3]),
      setAttribute(key, value) { attrs[key] = String(value); if (key.startsWith('data-')) this.dataset[camel(key.slice(5))] = String(value); },
      getAttribute(key) { return attrs[key] ?? null; },
      contains(node) { for (; node; node = node.parentElement) if (node === this) return true; return false; },
      getBoundingClientRect() { return { top: viewport.resultTop }; },
      scrollIntoView(options) { scrolled.push({ id: this.id, options }); },
      addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
      dispatch(type) { for (const fn of this.handlers[type] || []) fn.call(this, { target: this }); },
      click() { if (!this.disabled) this.dispatch('click'); }, focus() { document.activeElement = this; } };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) el.dataset[camel(key.slice(5))] = value;
    all.push(el); if (el.id) nodes.set(el.id, el);
    if (!/\/$/.test(m[3]) && !/^(input|br|hr|img|meta|link)$/i.test(m[2])) stack.push(el);
  }
  nodes.get('jd-copy-patch').textContent = labels.copy;
  nodes.get('jd-toggle-inputs').textContent = labels.hideInputs;
  const wrap = all.find(el => el.className === 'jd-wrap');
  const widget = { contains: el => wrap.contains(el), querySelector: s => s === '.btn-primary' ? nodes.get('jd-run') : null,
    querySelectorAll: () => [...nodes.values()].filter(el => el.tagName === 'TEXTAREA') };
  const document = { activeElement: null, getElementById: id => nodes.get(id), querySelector: s => s === '.jd-wrap' ? wrap : s === '.tool-widget' ? widget : s === '.tool-widget .btn-primary' ? nodes.get('jd-run') : null,
    addEventListener(type, fn) { (events[type] ||= []).push(fn); } };
  const context = vm.createContext({ document, _slug: 'json-diff', window: { innerHeight: viewport.height, matchMedia: query => ({ matches: query === '(max-width: 640px)' && viewport.width <= 640 }), trackTool: (...args) => tracked.push(args), ztPersist: { clear: slug => persisted.push(slug) } },
    navigator: { clipboard: { writeText(text) { return new Promise((resolve, reject) => copies.push({ text, resolve, reject })); } } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); } });
  if (sharedFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  if (!sharedFirst) vm.runInContext(shortcut, context);
  return { nodes, copies, tracked, persisted, labels, scrolled, document,
    input(id, value) { const e = nodes.get(id); e.value = value; e.dispatch('input'); },
    run(n = 2) { this.input('jd-left', '{"x":1}'); this.input('jd-right', JSON.stringify({ x: n })); nodes.get('jd-run').click(); },
    key(key, focus = 'jd-left', meta = false) { document.activeElement = nodes.get(focus) || {}; let prevented = false; const e = { key, ctrlKey: !meta, metaKey: meta, preventDefault() { prevented = true; } }; for (const fn of events.keydown || []) fn(e); return prevented; },
    async settle(i, reject = false) { copies[i][reject ? 'reject' : 'resolve'](reject ? Error('clipboard rejected') : undefined); await tick(); await tick(); },
    advance(ms) { now += ms; for (const [id, t] of [...timers]) if (t.due <= now) { timers.delete(id); t.fn(); } },
    snap() { return { inputs: ['jd-left', 'jd-right'].map(id => nodes.get(id).value), patch: nodes.get('jd-patch-out').value, visual: nodes.get('jd-visual').innerHTML,
      patchVisible: nodes.get('jd-patch-block').style.display !== 'none', visualVisible: nodes.get('jd-visual-block').style.display !== 'none', status: nodes.get('jd-status').textContent, copy: nodes.get('jd-copy-patch').textContent }; }
  };
}
const noResult = s => !s.patch && !s.visual && !s.patchVisible && !s.visualVisible;
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const sharedFirst of [false, true]) {
  const name = lang + '/sharedFirst=' + sharedFirst + ': ', h = pageHarness(lang, sharedFirst), click = id => h.nodes.get(id).click();
  h.run();
  eq(name + 'real complete page patch', JSON.parse(h.snap().patch), [{ op: 'replace', path: '/x', value: 2 }]);
  check(name + 'visual contains actual before and after values', h.snap().visual.includes('<code>1</code>') && h.snap().visual.includes('<code>2</code>'));
  h.input('jd-right', '{"x":3}');
  check(name + 'editing invalidates results without comparing', noResult(h.snap()) && !h.snap().status && h.tracked.length === 1);
  h.run(); click('jd-swap');
  check(name + 'swap invalidates results and keeps manual comparison', noResult(h.snap()) && h.tracked.length === 2);
  eq(name + 'swap preserves exact text', h.snap().inputs, ['{"x":2}', '{"x":1}']);
  click('jd-run'); eq(name + 'manual reverse patch', JSON.parse(h.snap().patch), [{ op: 'replace', path: '/x', value: 1 }]);
  for (const [id, value] of [['jd-left', ''], ['jd-left', '{'], ['jd-right', '{']]) {
    h.run(); h.nodes.get(id).value = value; click('jd-run');
    check(name + id + '/' + value + ' error removes old output and preserves inputs', noResult(h.snap()) && h.nodes.get('jd-status').className.includes('error') && h.nodes.get(id).value === value);
  }
  h.run(); h.nodes.get('jd-right').value = '{"x":1}'; click('jd-run');
  check(name + 'identical documents erase old bytes', noResult(h.snap()) && h.snap().status === h.labels.msgNoDiff);
  for (const meta of [false, true]) for (const key of ['l', 'L']) {
    h.run(); const count = h.persisted.length; h.key(key, 'jd-left', meta);
    check(name + key + '/' + meta + ' clears all result state and persists once', noResult(h.snap()) && h.snap().inputs.every(x => !x) && !h.snap().status && h.persisted.length === count + 1);
  }
  h.run(); const saved = h.snap(); h.key('l', 'outside'); eq(name + 'outside shortcut has no effect', h.snap(), saved);
  const count = h.tracked.length; h.key('Enter'); check(name + 'CtrlEnter compares once', h.tracked.length === count + 1);
  for (const action of ['clear', 'input', 'swap', 'new', 'error', 'shortcut']) for (const rejected of [false, true]) {
    h.run(); click('jd-copy-patch'); const index = h.copies.length - 1;
    eq(name + 'copies exact complete patch', h.copies[index].text, h.snap().patch);
    if (action === 'clear') click('jd-clear');
    else if (action === 'input') h.input('jd-right', 'new text');
    else if (action === 'swap') click('jd-swap');
    else if (action === 'new') h.run(9);
    else if (action === 'error') { h.nodes.get('jd-right').value = '{'; click('jd-run'); }
    else h.key('l');
    const current = h.snap(), errors = unhandled.length; await h.settle(index, rejected); h.advance(2000);
    eq(name + 'late copy cannot overwrite ' + action + '/' + rejected, h.snap(), current);
    check(name + 'late rejection handled ' + action, unhandled.length === errors);
  }
  h.run(); click('jd-copy-patch'); const index = h.copies.length - 1, current = h.snap(), errors = unhandled.length;
  await h.settle(index, true);
  check(name + 'current rejection is visible and handled', unhandled.length === errors && h.snap().copy === h.labels.copyFailed && h.snap().copy !== h.labels.copy);
  eq(name + 'failed copy preserves patch', h.snap().patch, current.patch);
  click('jd-copy-patch'); await h.settle(index + 1); check(name + 'retry same output succeeds', h.snap().copy === h.labels.copied);
  h.advance(500); click('jd-copy-patch'); await h.settle(index + 2); h.advance(1000);
  check(name + 'old timer cannot end newer copy feedback', h.snap().copy === h.labels.copied);
  h.advance(500); check(name + 'feedback returns to original label', h.snap().copy === h.labels.copy);
  h.run(); click('jd-copy-patch'); click('jd-copy-patch'); const latest = h.copies.length - 1;
  await h.settle(latest); await h.settle(latest - 1, true);
  check(name + 'earlier rejected copy cannot overwrite newer success', h.snap().copy === h.labels.copied);
  click('jd-clear'); check(name + 'Clear erases actual result bytes', noResult(h.snap()) && h.snap().inputs.every(x => !x) && !h.snap().status);
  const before = h.copies.length; click('jd-copy-patch'); check(name + 'empty result never calls clipboard', h.copies.length === before);
}
process.removeListener('unhandledRejection', onUnhandled);

// ---------- numbers JavaScript cannot hold, duplicate keys, deep nesting (S2-7, 2026-10-08) ----------
// JSON.parse rounds 9007199254740993 to 9007199254740992 and keeps only the last of two equal
// keys, so the page said "No differences" for documents that differ. It now names those values.
// A document nested a few thousand levels deep overflowed the call stack and the click failed
// with nothing on the page.
{
  const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(o[k]));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const h = pageHarness(lang, false), L = h.labels, n = id => h.nodes.get(id);
    const compare = (a, b) => { h.input('jd-left', a); h.input('jd-right', b); n('jd-run').click(); return h.snap(); };
    const side = { before: L.sideBefore, after: L.sideAfter };
    let r = compare('{"x":1}', '{"x":2}');
    eq(lang + ' plain comparison has no note', [r.status, n('jd-status').className], [fill(L.msgChanges, { n: 1 }), 'jd-status success']);
    r = compare('{"id":9007199254740993,"name":"a"}', '{"id":9007199254740992,"name":"a"}');
    const sep = L.noteSep ?? ' ';
    eq(lang + ' rounded number is named next to "no differences"', [r.status, n('jd-status').className],
      [L.msgNoDiff + sep + fill(L.msgLossy || 'msgLossy', { list: side.before + ' /id: 9007199254740993 → 9007199254740992' }), 'jd-status error']);
    r = compare('{"p":1}', '{"p":1e400,"q":0.1000000000000000055511}');
    eq(lang + ' overflow and long decimal are named with the patch', r.status,
      fill(L.msgChanges, { n: 2 }) + sep + fill(L.msgLossy || 'msgLossy', { list: side.after + ' /p: 1e400 → Infinity; ' + side.after + ' /q: 0.1000000000000000055511 → 0.1' }));
    eq(lang + ' the patch still shows what JavaScript read', JSON.parse(r.patch), [{ op: 'replace', path: '/p', value: null }, { op: 'add', path: '/q', value: 0.1 }]);
    r = compare('{"a":1,"a":2,"m/n":{"k":0,"k":1}}', '{"a":2,"m/n":{"k":1}}');
    eq(lang + ' duplicate keys are named', r.status,
      L.msgNoDiff + sep + fill(L.msgDup || 'msgDup', { list: side.before + ' /a; ' + side.before + ' /m~1n/k' }));
    const many = '[' + Array(12).fill('9007199254740993').join(',') + ']';
    r = compare(many, '[]');
    check(lang + ' long lists end with a count of the rest', r.status.endsWith(fill(L.msgMore || 'msgMore', { n: 2 }) + (lang === 'zh' || lang === 'ja' ? '。' : '.')), r.status.slice(-80));
    let deepA = '1', deepB = '2';
    for (let i = 0; i < 20000; i++) { deepA = '[' + deepA + ']'; deepB = '[' + deepB + ']'; }
    let thrown = '';
    try { r = compare(deepA, deepB); } catch (e) { thrown = e.name; }
    eq(lang + ' deep nesting reports an error instead of throwing', [thrown, r.status, n('jd-status').className, r.patch], ['', L.msgTooDeep, 'jd-status error', '']);
    r = compare('{"x":1}', '{"x":2}');
    eq(lang + ' a later comparison recovers', r.status, fill(L.msgChanges, { n: 1 }));
  }
  const fnLines = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) return '';
    const indent = src.slice(src.lastIndexOf('\n', i) + 1, i);
    const end = src.indexOf('\n' + indent + '}\n', i);
    return end < 0 ? '' : src.slice(i, end + indent.length + 2).split('\n').map((l) => l.trim()).join('\n');
  };
  const jsv = readFileSync(join(root, 'src/components/tools/json-schema-validator-engine.js'), 'utf8');
  for (const name of ['decimalKey', 'isExactNumber', 'scanJson']) {
    check(name + ' is the same as in json-schema-validator-engine.js', fnLines(source, name) !== '' && fnLines(source, name) === fnLines(jsv, name));
  }
  const oneLine = (src, re) => (src.match(re) || [''])[0].trim();
  check('escSeg is the same as in json-schema-validator-engine.js', oneLine(source, /^\s*function escSeg\(.*$/m) !== '' && oneLine(source, /^\s*function escSeg\(.*$/m) === oneLine(jsv, /^\s*function escSeg\(.*$/m));
}

// ---------- v2 page layout ----------
const v2Start = passes;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const strings = vm.runInNewContext('(' + source.match(/const STRINGS = ([\s\S]*?);\n\nconst L/)[1] + ')');
const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const css = source.split('<style>')[1].split('</style>')[0];
const sharedCss = readFileSync(join(root, 'src/styles/tool-common.css'), 'utf8');
const clientScript = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
eq('v2 immutable engine including marker bytes', [Buffer.byteLength(source.slice(startIndex, endIndex + END_MARK.length)), sha256(source.slice(startIndex, endIndex + END_MARK.length))], [3844, '0a1ef8599569b4b9f4a16f47d204a73e43857e924b632185e09d4b092dcd67fd']);
check('v2 direct bounded flex root', /^<div\s+class="jd-wrap"/.test(markup) && /\.jd-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0/.test(css));
check('v2 registered compare', /'json-diff':\s*'compare'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('v2 controls/status/inputs/results reading order', ['class="jd-actions"', 'id="jd-status"', 'id="jd-inputs"', 'id="jd-results"'].map(x => markup.indexOf(x)).every((n, i, all) => n >= 0 && (!i || n > all[i - 1])));
check('v2 stable live status with bounded error text', /id="jd-status"[^>]*role="status"[^>]*aria-live="polite"/.test(markup) && /\.jd-status\s*\{[^}]*height:\s*3rem;[^}]*overflow:\s*auto/.test(css));
check('v2 adopts shared compare inputs and results', /id="jd-inputs"[^>]*class="jd-inputs zt-compare-inputs"/.test(markup) && /id="jd-results"[^>]*class="jd-results zt-compare-results"/.test(markup));
check('v2 shared desktop inputs are two bounded 180px editors', /\.zt-compare-inputs\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(sharedCss) && /\.zt-compare-inputs textarea\s*\{[^}]*height:\s*180px;[^}]*min-height:\s*0;[^}]*overflow:\s*auto/.test(sharedCss));
check('v2 shared results fill remaining desktop space', /\.zt-compare-results\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*min-height:\s*0/.test(sharedCss));
check('v2 860 stack has 120px inputs and 24rem result', /@media \(max-width: 860px\)[\s\S]*\.zt-compare-inputs\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(sharedCss) && /\.zt-compare-inputs textarea\s*\{ height: 120px; \}/.test(sharedCss) && /\.zt-compare-results\s*\{ flex: none; height: 24rem; \}/.test(sharedCss));
check('v2 640 phone has 22rem result and 44px actions', /@media \(max-width: 640px\)\s*\{\s*\.zt-compare-results\s*\{ height: 22rem; \}/.test(sharedCss) && /@media \(max-width: 640px\)[\s\S]*\.jd-actions button, #jd-toggle-inputs, #jd-copy-patch\s*\{ min-height: 44px; \}/.test(css));
check('v2 mobile empty result hides while desktop has explanation', /data-empty="true"/.test(markup) && /<p id="jd-empty"[^>]*>\{L\.emptyResult\}<\/p>/.test(markup) && /@media \(max-width: 860px\)[\s\S]*\.zt-compare-results\[data-empty="true"\]\s*\{ display: none; \}/.test(sharedCss));
check('v2 hidden overrides shared input grid', /\.jd-wrap \[hidden\]\s*\{ display: none; \}/.test(css));
eq('v2 original manual controls plus input disclosure', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]).sort(), ['jd-run', 'jd-clear', 'jd-swap', 'jd-copy-patch', 'jd-toggle-inputs'].sort());
check('v2 disclosure starts disabled and controls real inputs', /id="jd-toggle-inputs"[^>]*aria-controls="jd-inputs"[^>]*aria-expanded="true"[^>]*disabled/.test(markup));
for (const id of ['jd-left', 'jd-right']) check('v2 label and editable input ' + id, markup.includes('for="' + id + '"') && !/readonly|disabled/.test(markup.match(new RegExp('<textarea id="' + id + '"[^>]*>'))?.[0] || 'disabled'));
check('v2 patch is labelled readonly keyboard-focusable textarea', /<label for="jd-patch-out">\{L.patchTitle\}<\/label>/.test(markup) && /<textarea id="jd-patch-out"[^>]*readonly/.test(markup) && !/tabindex="-1"|disabled/.test(markup.match(/<textarea id="jd-patch-out"[^>]*>/)?.[0] || 'disabled'));
check('v2 visual region can receive keyboard scrolling', /id="jd-visual"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-labelledby="jd-visual-label"/.test(markup) && /\.jd-visual:focus-visible/.test(css));
for (const cls of ['jd-out-area', 'jd-visual']) check('v2 independent bounded scroller ' + cls, new RegExp('\\.' + cls + '\\s*\\{[^}]*flex:\\s*1 1 0;[^}]*min-height:\\s*0;[^}]*overflow:\\s*auto').test(css));
check('v2 scroll blocks are bounded and runtime rows use global styles', /\.jd-output-block\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0/.test(css) && /\.jd-visual :global\(\.jd-line\)/.test(css) && /:global\(\.jd-add\)/.test(css));
check('v2 tips and all languages stay outside inline client', source.includes('const TIPS = L.tips;') && !/STRINGS|TIPS|L\.tips|define:vars|data-i18n/.test(clientScript) && !/data-tips=/.test(markup));
const tipMap = { compare: 'compare', clear: 'clear', swap: 'swap', before: 'labelBefore', after: 'labelAfter', patch: 'patchTitle', visual: 'visualTitle', results: 'result' };
const tips = [...markup.matchAll(/<Toggletip id="(jd-tip-[^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 exactly eight source-backed tip bindings', tips.map(m => [m[1], m[2], m[3]]).sort(), Object.entries(tipMap).map(([key, about]) => ['jd-tip-' + key, about, key]).sort());
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  eq(lang + ' v2 root string keys', Object.keys(strings[lang]).sort(), Object.keys(strings.en).sort());
  eq(lang + ' v2 same eight tip keys', Object.keys(strings[lang].tips).sort(), Object.keys(tipMap).sort());
  for (const [key, about] of Object.entries(tipMap)) check(lang + ' v2 nonempty fact and actual control label ' + key, typeof strings[lang].tips[key] === 'string' && strings[lang].tips[key].trim().length > 0 && typeof strings[lang][about] === 'string' && strings[lang][about].trim().length > 0);
  const mdx = readFileSync(join(root, 'src/content/tools/json-diff', lang + '.mdx'), 'utf8');
  const steps = (mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1] || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line.trim().slice(2)));
  eq(lang + ' v2 six steps before FAQ', steps.length, 6);
  check(lang + ' v2 plain steps meet 280/1200 limits', steps.every(step => [...step].length <= 280 && !/[<>]|\]\(|\*\*|`/.test(step)) && steps.reduce((n, step) => n + [...step].length, 0) <= 1200);
  check(lang + ' v2 steps use actual manual controls', ['compare', 'clear', 'swap', 'copy', 'hideInputs', 'showInputs'].every(key => steps.join(' ').includes(strings[lang][key])));
  check(lang + ' v2 Usage is removed', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx));
  eq(lang + ' MDX content contract', contractProblems('json-diff', lang), '');
  for (const sharedFirst of [false, true]) {
    const h = pageHarness(lang, sharedFirst, { width: 390, height: 844, resultTop: 900 });
    const prefix = lang + '/v2/sharedFirst=' + sharedFirst + ': ', n = id => h.nodes.get(id), click = id => n(id).click();
    const fold = () => [n('jd-inputs').hidden, n('jd-toggle-inputs').disabled, n('jd-toggle-inputs').getAttribute('aria-expanded'), n('jd-results').dataset.empty, n('jd-empty').hidden];
    eq(prefix + 'initial empty inputs expanded and disclosure disabled', fold(), [false, true, 'true', 'true', false]);
    click('jd-toggle-inputs'); check(prefix + 'disabled disclosure cannot hide input', !n('jd-inputs').hidden);
    h.run(); eq(prefix + 'real result enables disclosure and hides empty copy', fold(), [false, false, 'true', 'false', true]);
    eq(prefix + 'offscreen phone result scrolls into view once', h.scrolled, [{ id: 'jd-results', options: { block: 'start', behavior: 'auto' } }]);
    const before = h.snap(), count = h.tracked.length;
    click('jd-toggle-inputs'); eq(prefix + 'collapse changes disclosure only', [fold(), n('jd-toggle-inputs').textContent, h.snap(), h.tracked.length], [[true, false, 'false', 'false', true], h.labels.showInputs, before, count]);
    click('jd-toggle-inputs'); eq(prefix + 'show restores original values without comparison', [fold(), n('jd-toggle-inputs').textContent, h.snap(), h.tracked.length], [[false, false, 'true', 'false', true], h.labels.hideInputs, before, count]);
    for (const action of ['input', 'swap', 'error', 'equal', 'clear']) {
      h.run(); click('jd-toggle-inputs');
      if (action === 'input') h.input('jd-right', '{"changed":true}');
      else if (action === 'swap') click('jd-swap');
      else if (action === 'error') { n('jd-right').value = '{'; click('jd-run'); }
      else if (action === 'equal') { n('jd-right').value = n('jd-left').value; click('jd-run'); }
      else click('jd-clear');
      eq(prefix + action + ' reopens inputs and removes both results', fold(), [false, true, 'true', 'true', false]);
      check(prefix + action + ' removes actual patch/visual bytes', noResult(h.snap()));
      if (action === 'input') eq(prefix + 'edit remains unconverted and keeps exact text', h.snap().inputs, ['{"x":1}', '{"changed":true}']);
      if (action === 'swap') eq(prefix + 'swap keeps exact exchanged text', h.snap().inputs, ['{"x":2}', '{"x":1}']);
      if (action === 'error') check(prefix + 'error preserves invalid text and visible status', n('jd-right').value === '{' && h.snap().status.startsWith(h.labels.msgParseErrorAfter));
    }
    for (const target of ['jd-patch-out', 'jd-visual', 'jd-copy-patch', 'jd-toggle-inputs']) {
      h.run(); click('jd-toggle-inputs'); const beforePersist = h.persisted.length;
      h.key('l', target, target === 'jd-visual');
      check(prefix + 'CtrlL from ' + target + ' clears data and focuses reopened original', noResult(h.snap()) && h.snap().inputs.every(value => !value) && !h.snap().status && !n('jd-inputs').hidden && h.document.activeElement === n('jd-left') && h.persisted.length === beforePersist + 1);
    }
  }
}
for (const [width, top, expected] of [[1366, 900, 0], [641, 900, 0], [640, 749, 1], [390, 748, 0], [390, 747, 0]]) {
  const h = pageHarness('en', false, { width, height: 844, resultTop: top }); h.run();
  eq('v2 actual phone scroll boundary width=' + width + '/top=' + top, h.scrolled.length, expected);
}
console.log('v2 page layout: ' + (passes - v2Start) + ' passed, ' + failures + ' total failures');

console.log(`\n${passes} passed, ${failures} failed` + (skips ? `, ${skips} skipped` : ''));
process.exit(failures ? 1 : 0);
