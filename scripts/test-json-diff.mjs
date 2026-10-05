// JSON Diff — the generated JSON Patch turns Before into After
//
// Read:  src/components/tools/JsonDiffTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped
//        source); src/content/tools/json-diff/{en,zh,ja,ko}.mdx (the example patches)
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
import vm from 'node:vm';

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
function pageHarness(lang, sharedFirst) {
  const labels = vm.runInNewContext('(' + source.match(/const labels = ([\s\S]*?);\n\nconst L/)[1] + ')')[lang];
  const nodes = new Map(), events = {}, timers = new Map(), copies = [], tracked = [], persisted = [];
  let now = 0, timerId = 0;
  const markup = source.slice(source.indexOf('---', 3) + 3, source.indexOf('<script'));
  for (const m of markup.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]));
    const el = { id: m[3], tagName: m[1].toUpperCase(), value: '', textContent: '', innerHTML: '', className: attrs.class || '', style: { display: attrs.style?.includes('display:none') ? 'none' : '' }, handlers: {},
      addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
      dispatch(type) { for (const fn of this.handlers[type] || []) fn.call(this, { target: this }); },
      click() { this.dispatch('click'); }, focus() { document.activeElement = this; } };
    nodes.set(el.id, el);
  }
  nodes.get('jd-copy-patch').textContent = labels.copy;
  const wrap = { dataset: {}, contains: el => [...nodes.values()].includes(el) };
  for (const m of markup.matchAll(/data-([\w-]+)=\{L\.(\w+)\}/g)) wrap.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = labels[m[2]];
  const widget = { contains: wrap.contains, querySelector: s => s === '.btn-primary' ? nodes.get('jd-run') : null,
    querySelectorAll: () => [...nodes.values()].filter(el => el.tagName === 'TEXTAREA') };
  const document = { activeElement: null, getElementById: id => nodes.get(id), querySelector: s => s === '.jd-wrap' ? wrap : s === '.tool-widget' ? widget : s === '.tool-widget .btn-primary' ? nodes.get('jd-run') : null,
    addEventListener(type, fn) { (events[type] ||= []).push(fn); } };
  const context = vm.createContext({ document, _slug: 'json-diff', window: { trackTool: (...args) => tracked.push(args), ztPersist: { clear: slug => persisted.push(slug) } },
    navigator: { clipboard: { writeText(text) { return new Promise((resolve, reject) => copies.push({ text, resolve, reject })); } } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); } });
  if (sharedFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  if (!sharedFirst) vm.runInContext(shortcut, context);
  return { nodes, copies, tracked, persisted, labels,
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

console.log(`\n${passes} passed, ${failures} failed` + (skips ? `, ${skips} skipped` : ''));
process.exit(failures ? 1 : 0);
