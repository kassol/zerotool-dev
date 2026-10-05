// GraphQL Formatter — 4-space output keeps block string values unchanged
//
// Read:  src/components/tools/GraphqlFormatterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers), node_modules/graphql (16.x, the
//        same parser and printer the page loads), the 4 tool page mdx files
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix, 4-space mode doubled every run of leading spaces, including lines inside
// block strings ("""..."""). The GraphQL spec (BlockStringValue) removes only the common
// indentation, so doubling changed the relative indentation and therefore the description
// text. Each case re-parses the 4-space output with graphql-js and checks that print() of it
// equals the 2-space output (same document, same string values), that structural indentation
// is a multiple of 4, and a literal expected output.
//
// Complete page scripts and the shared shortcut cover manual operations, loader cancellation,
// clipboard failures/retries and stale promise/timer feedback. No network or native clipboard.
// Run: node scripts/test-graphql-formatter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse, print } from 'graphql';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { loadPage } from './astro-page-harness.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/GraphqlFormatterTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in GraphqlFormatterTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { reindent, blockStringRanges };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

function format(src, indent) {
  const printed = print(parse(src));
  return E.reindent(printed, indent, E.blockStringRanges(parse(printed)));
}
function blockValues(doc) {
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.kind === 'StringValue') out.push(n.value);
    for (const k of Object.keys(n)) if (k !== 'loc') walk(n[k]);
  })(doc);
  return out;
}

const SDL = `"""
The root query.
  Indented second line.
"""
type Query {
  """
  Returns a user.
    Indented note.

  Last line.
  """
  user(id: ID!, filter: UserFilter = {name: "a", tags: ["x"]}): User @deprecated(reason: """
  Use node().
    Since v2.
  """)
  users: [User!]!
}

input UserFilter { name: String tags: [String!] }

type User implements Node & Entity {
  id: ID!
  "single line"
  name: String
}`;

const QUERY = `query Q($id: ID!) { node(id: $id) { ... on User { posts(first: 10, after: "x") { edges { node { id body(format: """
  # Heading
    code
""") } } } } } }`;

const SAMPLE = /var SAMPLE = \[([\s\S]*?)\]\.join/.exec(source)[1].split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l.replace(/,$/, '').replace(/^'|'$/g, '"'))).join('\n');

for (const [name, src] of [['SDL with descriptions', SDL], ['query with block string argument', QUERY], ['built-in sample', SAMPLE]]) {
  const two = format(src, '  ');
  const four = format(src, '    ');
  check(name + ': 2-space output is graphql-js print()', two === print(parse(src)));
  check(name + ': 4-space output parses to the same document', print(parse(four)) === two, '\n' + four);
  check(name + ': string values unchanged', JSON.stringify(blockValues(parse(four))) === JSON.stringify(blockValues(parse(two))));
  const ranges = E.blockStringRanges(parse(four));
  const inBlock = (pos) => ranges.some(([a, b]) => pos > a && pos < b);
  let off = 0; let bad = '';
  for (const line of four.split('\n')) {
    const n = /^ */.exec(line)[0].length;
    if (!inBlock(off) && n % 4 !== 0 && !bad) bad = JSON.stringify(line);
    off += line.length + 1;
  }
  check(name + ': structural indentation is a multiple of 4', !bad, bad);
}

const SMALL = 'type Query {\n  """\n  Returns a user.\n    Indented note.\n  """\n  user(id: ID!): User\n}';
check('literal 4-space output', format(SMALL, '    ') === 'type Query {\n    """\n    Returns a user.\n      Indented note.\n    """\n    user(id: ID!): User\n}', format(SMALL, '    '));
check('description value', blockValues(parse(format(SMALL, '    ')))[0] === 'Returns a user.\n  Indented note.');

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/graphql-formatter', lang + '.mdx'), 'utf8');
  check(lang + ': page no longer says 4-space mode changes block strings', !/doubl|加倍|2 倍|두 배/.test(mdx), lang);
}

check('engine bytes unchanged', createHash('sha256').update(source.slice(startIndex, endIndex + END_MARK.length)).digest('hex') === '9eecb0c9d88782b0bfd5a218970020faf8150452427b55ba6fd1d9abfd5e2530');

const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const sharedShortcut = layoutSource.slice(layoutSource.indexOf('// ── Keyboard shortcuts:'), layoutSource.indexOf('// ── Copy button visual feedback'));
const STRINGS = vm.runInNewContext(source.slice(source.indexOf('var STRINGS ='), source.indexOf('var SAMPLE =')) + ';STRINGS');
const copyFailure = { en: 'Copy failed. Try again.', zh: '复制失败，请重试。', ja: 'コピーに失敗しました。再試行してください。', ko: '복사하지 못했습니다. 다시 시도하세요.' };
const settle = async () => { await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(String(error)));
function page(lang, sharedFirst = false) {
  const elements = new Map(), keys = [], timers = [], copies = [], saved = [], tracked = [], events = new Map(), downloads = [], blobs = new Map();
  let seq = 0;
  const markup = source.slice(0, source.indexOf('<script'));
  for (const m of markup.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const listeners = {};
    const el = { id: m[3], value: '', textContent: '', className: '', disabled: false, hidden: false,
      getAttribute(name) { return new RegExp('\\b' + name + '="([^"]+)"').exec(m[2])?.[1] ?? null; },
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      dispatch(type, init = {}) { const event = { type, target: el, defaultPrevented: false, cancelBubble: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }, ...init }; for (const fn of listeners[type] || []) fn.call(el, event); if (type === 'keydown' && !event.cancelBubble) for (const fn of keys) fn(event); return event; },
      click() { if (!el.disabled) { el.focus(); el.dispatch('click'); } }, focus() { doc.activeElement = el; },
    };
    el.classList = { add(c) { if (!this.contains(c)) el.className += ' ' + c; }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, contains(c) { return el.className.split(/\s+/).includes(c); } };
    elements.set(el.id, el);
  }
  const get = id => { const el = elements.get(id); if (!el) throw new Error('Actual markup lacks ' + id); return el; };
  const widget = { contains: el => [...elements.values()].includes(el), querySelectorAll: () => [get('gqlf-input'), get('gqlf-output')] };
  const doc = { documentElement: { lang }, activeElement: {}, getElementById: get,
    querySelector: selector => selector === '.tool-widget .btn-primary' ? get('gqlf-format') : selector === '.tool-widget' || selector === '.gqlf-wrap' ? widget : null,
    querySelectorAll: selector => [...elements.values()].filter(el => el.getAttribute(selector.slice(1, -1)) !== null),
    addEventListener: (type, fn) => { if (type === 'keydown') keys.push(fn); },
  };
  get('gqlf-indent').value = '2';
  doc.body = { appendChild() {}, removeChild() {} };
  doc.createElement = tag => { if (tag !== 'a') throw new Error('Unexpected element ' + tag); return { click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); } }; };
  const globals = { document: doc, Blob,
    Event: class { constructor(type) { this.type = type; } },
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
    removeEventListener(type, fn) { events.set(type, (events.get(type) || []).filter(x => x !== fn)); },
    dispatchEvent(event) { for (const fn of [...events.get(event.type) || []]) fn(event); },
    URL: { createObjectURL(blob) { const url = 'blob:test-' + blobs.size; blobs.set(url, blob); return url; }, revokeObjectURL(url) { blobs.delete(url); } },
    _slug: 'graphql-formatter', ztPersist: { clear(slug) { saved.push(slug); } }, trackTool(...args) { tracked.push(args); },
    navigator: { clipboard: { writeText(text) { return new Promise((resolve, reject) => copies.push({ text, resolve, reject })); } } },
    setTimeout(fn, ms) { timers.push({ id: ++seq, fn, ms, cancelled: false }); return seq; }, clearTimeout(id) { const timer = timers.find(t => t.id === id); if (timer) timer.cancelled = true; },
  };
  if (sharedFirst) vm.runInNewContext(sharedShortcut, { ...globals, window: globals });
  const p = loadPage('src/components/tools/GraphqlFormatterTool.astro', { lang, globals });
  if (!sharedFirst) p.run(sharedShortcut);
  return { get, doc, copies, timers, saved, tracked, events, downloads, ctx: p.ctx,
    holdLib() { const lib = p.ctx.__gqlfLib; p.ctx.__gqlfLib = undefined; return () => { p.ctx.__gqlfLib = lib; globals.dispatchEvent({ type: 'gqlf-lib-ready' }); }; },
    flush(ms) { for (const t of timers.filter(t => t.ms === ms && !t.cancelled && !t.ran)) { t.ran = true; t.fn(); } },
    type(text) { get('gqlf-input').value = text; get('gqlf-input').dispatch('input'); },
    format(text) { this.type(text); get('gqlf-format').click(); },
    key(id, key = 'l', mod = 'ctrlKey') { get(id).focus(); return get(id).dispatch('keydown', { key, [mod]: true }); },
  };
}
const bodySnapshot = h => [h.get('gqlf-input').value, h.get('gqlf-output').value, h.get('gqlf-status').textContent, h.get('gqlf-status').className];
function eq(name, actual, expected) { check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected)); }
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const t = STRINGS[lang], prefix = lang + ': page ';
  const h = page(lang); h.type('{alpha}'); eq(prefix + 'typing stays manual', h.get('gqlf-output').value, '');
  h.get('gqlf-format').click(); eq(prefix + 'Format with real graphql', h.get('gqlf-output').value, '{\n  alpha\n}');
  h.get('gqlf-indent').value = '4'; h.get('gqlf-indent').dispatch('change'); eq(prefix + 'indent remains manual', h.get('gqlf-output').value, '{\n  alpha\n}');
  h.get('gqlf-format').click(); eq(prefix + '4-space Format', h.get('gqlf-output').value, '{\n    alpha\n}');
  h.get('gqlf-minify').click(); eq(prefix + 'Minify', h.get('gqlf-output').value, '{alpha}');
  h.get('gqlf-validate').click(); eq(prefix + 'Validate keeps output bytes', h.get('gqlf-output').value, '{alpha}'); check(prefix + 'Validate status', h.get('gqlf-status').textContent.startsWith(t.valid));
  h.type('{beta}'); eq(prefix + 'edited valid input remains manual', h.get('gqlf-output').value, '{alpha}');
  h.get('gqlf-format').click(); h.get('gqlf-download').click(); eq(prefix + 'real download Blob bytes', await h.downloads[0].blob.text(), '{\n    beta\n}'); eq(prefix + 'download filename', h.downloads[0].name, 'query.graphql');
  h.type('{'); h.get('gqlf-format').click(); eq(prefix + 'syntax error clears output', h.get('gqlf-output').value, ''); check(prefix + 'real GraphQLError location', h.get('gqlf-status').textContent.includes(t.line + ' 1, ' + t.column + ' 2'));
  h.type(''); h.get('gqlf-format').click(); eq(prefix + 'empty explanation', h.get('gqlf-status').textContent, t.emptyInput);
  for (const first of [false, true]) for (const [key, mod] of [['l', 'ctrlKey'], ['L', 'metaKey']]) {
    const p = page(lang, first); p.format('{alpha}'); const label = prefix + (first ? 'shared-first ' : 'shared-last ') + mod;
    const event = p.key('gqlf-copy', key, mod); eq(label + ' CtrlL clears current state', JSON.stringify(bodySnapshot(p).slice(0, 3)), '["","",""]'); check(label + ' shared persistence runs', event.defaultPrevented && p.saved.length === 1);
    p.format('{outside}'); const before = bodySnapshot(p); p.doc.activeElement = {}; p.get('gqlf-input').dispatch('keydown', { key, [mod]: true }); eq(label + ' outside focus untouched', JSON.stringify(bodySnapshot(p)), JSON.stringify(before));
    p.type('{single}'); const n = p.tracked.length; p.key('gqlf-input', 'Enter', mod); eq(label + ' CtrlEnter exactly once', p.tracked.length - n, 1); eq(label + ' keyboard actual output', p.get('gqlf-output').value, '{\n  single\n}');
  }
  for (const action of ['format', 'minify', 'validate']) for (const trigger of ['clear', 'shortcut-before', 'shortcut-after', 'input', 'newer-request', 'newer-empty']) {
    const p = page(lang, trigger === 'shortcut-before'), ready = p.holdLib(); p.type('{alpha}'); p.get('gqlf-' + action).click();
    eq(prefix + action + '/' + trigger + ' loader actually waiting', p.events.get('gqlf-lib-ready').length, 1); eq(prefix + action + '/' + trigger + ' loading status', p.get('gqlf-status').textContent, t.libLoading);
    if (trigger === 'clear') p.get('gqlf-clear').click(); else if (trigger.startsWith('shortcut')) p.key('gqlf-input'); else if (trigger === 'input') p.type('{beta}');
    else if (trigger === 'newer-request') { p.type('{beta}'); p.get('gqlf-minify').click(); } else { p.type(''); p.get('gqlf-format').click(); }
    const before = bodySnapshot(p); ready();
    if (trigger === 'newer-request') { eq(prefix + action + ' newest request result', p.get('gqlf-output').value, '{beta}'); eq(prefix + action + ' only newest action executed', p.tracked.length, 1); }
    else { eq(prefix + action + '/' + trigger + ' stale loader preserves state', JSON.stringify(bodySnapshot(p)), JSON.stringify(before)); eq(prefix + action + '/' + trigger + ' stale action not executed', p.tracked.length, 0); }
    eq(prefix + action + '/' + trigger + ' one-shot listeners removed', p.events.get('gqlf-lib-ready').length, 0);
  }
  const p = page(lang); p.format('{alpha}'); const btn = p.get('gqlf-copy'), prior = bodySnapshot(p);
  btn.click(); eq(prefix + 'copy exact output', p.copies[0].text, '{\n  alpha\n}'); p.copies[0].reject(new Error('denied')); await settle();
  eq(prefix + 'copy failure localized', btn.textContent, copyFailure[lang]); eq(prefix + 'failure preserves result/status', JSON.stringify(bodySnapshot(p)), JSON.stringify(prior));
  btn.click(); p.copies[1].resolve(); await settle(); eq(prefix + 'same-value retry', btn.textContent, t.copied); p.flush(1500); eq(prefix + 'retry returns Copy', btn.textContent, t.copy);
  for (const api of [undefined, { writeText() { throw new Error('sync denied'); } }]) {
    p.ctx.navigator.clipboard = api; let thrown = false; try { btn.click(); } catch { thrown = true; }
    check(prefix + 'unavailable/throw handled', !thrown); eq(prefix + 'unavailable/throw visible', btn.textContent, copyFailure[lang]);
  }
  for (const trigger of ['clear', 'shortcut', 'input', 'new-result', 'sample', 'validate', 'indent']) for (const outcome of ['resolve', 'reject']) {
    const q = page(lang); q.format('{alpha}'); const b = q.get('gqlf-copy'); b.click();
    if (trigger === 'clear') q.get('gqlf-clear').click(); else if (trigger === 'shortcut') q.key('gqlf-copy'); else if (trigger === 'input') q.type('{beta}'); else if (trigger === 'new-result') q.format('{beta}'); else if (trigger === 'sample') q.get('gqlf-sample').click(); else if (trigger === 'validate') q.get('gqlf-validate').click(); else { q.get('gqlf-indent').value = '4'; q.get('gqlf-indent').dispatch('change'); }
    const state = bodySnapshot(q); q.copies[0][outcome](new Error('old')); await settle();
    eq(prefix + trigger + '/' + outcome + ' old copy label ignored', b.textContent, t.copy); eq(prefix + trigger + '/' + outcome + ' old copy state ignored', JSON.stringify(bodySnapshot(q)), JSON.stringify(state));
  }
  for (const outcome of ['resolve', 'reject']) {
    const q = page(lang); q.format('{alpha}'); const b = q.get('gqlf-copy'); b.click(); b.click(); q.copies[1].resolve(); await settle(); q.copies[0][outcome](new Error('old same-value')); await settle();
    eq(prefix + 'same-value newest wins ' + outcome, b.textContent, t.copied); q.flush(1500); eq(prefix + 'overlap latest timer restores ' + outcome, b.textContent, t.copy);
  }
  const q = page(lang); q.format('{alpha}'); const b = q.get('gqlf-copy'); b.click(); q.copies[0].resolve(); await settle(); const oldTimers = q.timers.filter(t => t.ms === 1500);
  b.click(); q.copies[1].resolve(); await settle(); for (const timer of oldTimers) timer.fn(); eq(prefix + 'old timer cannot erase new Copied', b.textContent, t.copied); q.flush(1500); eq(prefix + 'latest timer restores Copy', b.textContent, t.copy);
}
eq('no unhandled clipboard rejection', unhandled.length, 0);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
