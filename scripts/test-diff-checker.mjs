// Diff Checker — line splitting and Side-by-Side pairing
//
// Read:  src/components/tools/DiffCheckerTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers), src/content/tools/diff-checker/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: CR LF, lone CR and LF all end a line (a textarea already turns pasted CR LF into LF —
// HTML "normalize newlines" — and the engine does the same, so a CR never shows up as a change);
// LCS diff keeps the line count of both sides; Side-by-Side pairs the removed and added lines of a
// change block by position (it used to pair only a removal that was directly followed by an
// addition, so two removals followed by two additions were drawn as del/empty, del/add,
// empty/add), with empty partners only for the extra lines of the longer side; line numbers on
// each side run 1..n; 2,000 random line lists keep both sides intact after pairing; the English
// page example. The status line counts changed pairs that differ only in whitespace / invisible
// characters or only in Unicode normalization. The worked examples on the four tool pages
// ({/* dc-check */}) are compared on the real page (page script and Worker) in that language.
//
// Run: node scripts/test-diff-checker.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { contractProblems, toolMdxContract, annotations, fencedBlocks, splitToolMdx, withoutCode } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/DiffCheckerTool.astro'), 'utf8');
const STRINGS = new Function('return ' + source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/)[1])();
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('      // ── Keyboard shortcuts:'), layout.indexOf('      // ── Copy button visual feedback'));
if (!shortcut.includes('window.ztPersist.clear(_slug)')) throw new Error('Shared shortcut block missing');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in DiffCheckerTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { splitLines, lcs, pairRows };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  if (a === x) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + x + '\n  actual   ' + a);
}

// ---------- line endings ----------
eq('LF', E.splitLines('a\nb'), ['a', 'b']);
eq('CR LF', E.splitLines('a\r\nb'), ['a', 'b']);
eq('lone CR', E.splitLines('a\rb'), ['a', 'b']);
eq('mixed', E.splitLines('a\r\nb\nc\rd'), ['a', 'b', 'c', 'd']);
eq('trailing newline keeps an empty last line', E.splitLines('a\r\n'), ['a', '']);
const diffOf = (a, b) => E.lcs(E.splitLines(a), E.splitLines(b));
eq('CR LF text equals LF text', diffOf('x\r\ny\r\nz', 'x\ny\nz').every((op) => op.type === 'equal'), true);

// Small independent oracle preserves the previous equal-first / add-on-tie traceback.
function oldLcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const result = []; let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && a[i - 1] === b[j - 1]) result.push({ type: 'equal', val: a[--i] }), j--;
    else if (j && (!i || dp[i][j - 1] >= dp[i - 1][j])) result.push({ type: 'add', val: b[--j] });
    else result.push({ type: 'del', val: a[--i] });
  }
  return result.reverse();
}
const lists = [[]];
for (let n = 1; n <= 5; n++) for (let mask = 0; mask < 2 ** n; mask++)
  lists.push(Array.from({ length: n }, (_, i) => 'ab'[(mask >> i) & 1]));
for (const a of lists) for (const b of lists) eq('old traceback ' + JSON.stringify([a, b]), E.lcs(a, b), oldLcs(a, b));

// ---------- pairing ----------
const sbs = (a, b) => E.pairRows(diffOf(a, b)).map((r) => [r.left.type, r.left.ln, r.left.val, r.right.type, r.right.ln, r.right.val]);
eq('two removals, two additions pair by position', sbs('k\na\nb\nz', 'k\nA\nB\nz'), [
  ['equal', 1, 'k', 'equal', 1, 'k'],
  ['del', 2, 'a', 'add', 2, 'A'],
  ['del', 3, 'b', 'add', 3, 'B'],
  ['equal', 4, 'z', 'equal', 4, 'z'],
]);
eq('three removals, one addition', sbs('a\nb\nc', 'X'), [
  ['del', 1, 'a', 'add', 1, 'X'],
  ['del', 2, 'b', 'empty', null, ''],
  ['del', 3, 'c', 'empty', null, ''],
]);
eq('one removal, two additions', sbs('a\nk', 'X\nY\nk'), [
  ['del', 1, 'a', 'add', 1, 'X'],
  ['empty', null, '', 'add', 2, 'Y'],
  ['equal', 2, 'k', 'equal', 3, 'k'],
]);
eq('pure addition', sbs('a', 'a\nb'), [['equal', 1, 'a', 'equal', 1, 'a'], ['empty', null, '', 'add', 2, 'b']]);
eq('two separate blocks', sbs('a\nk\nb', 'A\nk\nB'), [
  ['del', 1, 'a', 'add', 1, 'A'],
  ['equal', 2, 'k', 'equal', 2, 'k'],
  ['del', 3, 'b', 'add', 3, 'B'],
]);

// ---------- random invariants ----------
let seed = 7;
const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t = 0; t < 2000; t++) {
  const a = Array.from({ length: rand(12) }, () => 'abcd'[rand(4)]);
  const b = Array.from({ length: rand(12) }, () => 'abcd'[rand(4)]);
  const rows = E.pairRows(E.lcs(a, b));
  const left = rows.filter((r) => r.left.type !== 'empty');
  const right = rows.filter((r) => r.right.type !== 'empty');
  const ok = JSON.stringify(left.map((r) => r.left.val)) === JSON.stringify(a)
    && JSON.stringify(right.map((r) => r.right.val)) === JSON.stringify(b)
    && left.every((r, i) => r.left.ln === i + 1) && right.every((r, i) => r.right.ln === i + 1)
    && rows.every((r) => !(r.left.type === 'empty' && r.right.type === 'empty'));
  if (!ok) { eq('random ' + t + ' ' + JSON.stringify([a, b]), false, true); break; }
  // no row pairs an empty cell while the other side of the same block still has an unpaired line
  let i = 0;
  let bad = false;
  while (i < rows.length) {
    if (rows[i].left.type === 'equal') { i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].left.type !== 'equal') j++;
    const block = rows.slice(i, j);
    const dels = block.filter((r) => r.left.type === 'del').length;
    const adds = block.filter((r) => r.right.type === 'add').length;
    if (block.length !== Math.max(dels, adds)) bad = true;
    i = j;
  }
  if (bad) { eq('block rows = max(dels, adds) ' + JSON.stringify([a, b]), false, true); break; }
  passes++;
}

// ---------- page ----------
const page = readFileSync(join(root, 'src/content/tools/diff-checker/en.mdx'), 'utf8');
eq('page no longer says pairing is adjacent-only', page.includes('pairs only adjacent lines'), false);
eq('page no longer says CR LF marks every line', page.includes('marks **every** line as changed'), false);

// The real Compare click must return before the O(n*m) work and expose cancellation.
function pageHarness(lang = 'en', options = {}) {
  const nodes = new Map(), blobs = new Map(), workers = [], events = {}, timers = new Map(), keydowns = [], persisted = [];
  const markup = source.slice(0, source.indexOf('<script'));
  const textareas = [...markup.matchAll(/<textarea[^>]*id="([^"]+)"/g)].map(m => m[1]);
  const primary = markup.match(/<button[^>]*id="([^"]+)"[^>]*class="[^"]*\bbtn-primary\b/)?.[1];
  let serial = 0;
  function element(id) {
    const tag = markup.match(new RegExp('<[\\w-]+\\b[^>]*\\bid="' + id + '"[^>]*>'))?.[0];
    if (!tag) throw new Error('Missing real markup ID ' + id);
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    const el = { value: '', textContent: '', innerHTML: '', className: attrs.class || '', hidden: /\shidden(?:\s|>)/.test(tag), disabled: /\sdisabled(?:\s|>)/.test(tag),
      style: {}, scrollHeight: 160, listeners: {}, attrs, scrolls: [],
      addEventListener(k, f) { this.listeners[k] = f; },
      setAttribute(k, v) { attrs[k] = String(v); if (id === 'diff-results' && k === 'data-empty' && v === 'true' && options.mobile && this.contains(document.activeElement)) document.activeElement = { tagName: 'BODY' }; },
      getAttribute(k) { return attrs[k] ?? null; },
      contains(node) { const section = markup.match(/<section id="diff-results"[\s\S]*?<\/section>/)?.[0] || ''; return id === 'diff-results' && [...section.matchAll(/\bid="([^"]+)"/g)].some(m => nodes.get(m[1]) === node); },
      focus() { if (!this.hidden && !(id === 'diff-original' && nodes.get('diff-inputs').hidden)) document.activeElement = this; },
      getBoundingClientRect() { return { top: options.resultTop ?? 100 }; }, scrollIntoView(value) { this.scrolls.push(value); },
      click() { if (!this.disabled) this.listeners.click?.call(this); } };
    el.classList = { add(name) { el.className = [...new Set(el.className.split(' ').concat(name))].join(' '); }, remove(name) { el.className = el.className.split(' ').filter(n => n !== name).join(' '); } };
    return el;
  }
  class BrowserWorker {
    constructor(url) {
      if (options.throwWorker) throw new Error('Worker blocked');
      this.thread = new ThreadWorker(`const {parentPort}=require('node:worker_threads'); const self={postMessage:v=>parentPort.postMessage(v)}; ${blobs.get(url)}; parentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
      this.thread.on('message', data => { this.result = data; this.responses = (this.responses || 0) + 1; if (!options.holdResponses) this.onmessage?.({ data }); });
      this.thread.on('error', error => this.onerror?.(error)); workers.push(this);
    }
    postMessage(data) { this.sent = data; this.thread.postMessage(data); }
    terminate() { this.terminated = true; return this.thread.terminate(); }
  }
  const widget = { contains: el => [...nodes.values()].includes(el),
    querySelectorAll(selector) {
      if (selector !== 'textarea, input[type="text"]') throw new Error('Unexpected clear selector ' + selector);
      return textareas.map(id => document.getElementById(id));
    } };
  const document = { documentElement: { lang }, activeElement: null, querySelectorAll: () => [],
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); },
    querySelector(selector) {
      if (selector === '.tool-widget' || selector === '.diff-wrap') return widget;
      if (selector === '.tool-widget .btn-primary') return primary ? this.getElementById(primary) : null;
      throw new Error('Unexpected selector ' + selector);
    },
    addEventListener(k, f) { if (k === 'keydown') keydowns.push(f); } };
  for (const match of markup.matchAll(/\bid="([^"]+)"/g)) document.getElementById(match[1]);
  const { tips, ...t } = STRINGS[lang];
  const context = vm.createContext({ document, t, _slug: 'diff-checker',
    window: { innerHeight: 844, matchMedia: () => ({ matches: !!options.mobile }), addEventListener(k, f) { events[k] = f; }, ztPersist: { clear(slug) { persisted.push(slug); } } }, Worker: options.noWorker ? undefined : BrowserWorker,
    Blob: class { constructor(parts) { this.source = parts.join(''); } },
    URL: { createObjectURL(b) { const id = 'blob:' + blobs.size; blobs.set(id, b.source); return id; }, revokeObjectURL() {} },
    setTimeout(f, ms) { const id = ++serial; timers.set(id, { f, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, console });
  if (options.shortcut && options.sharedFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  if (options.shortcut && !options.sharedFirst) vm.runInContext(shortcut, context);
  function click(id, timeout = 100) { context.target = nodes.get(id); vm.runInContext('target.click()', context, { timeout }); }
  return { nodes, workers, events, persisted, click, document,
    key(key, modifier = 'ctrlKey', focus = 'diff-original') {
      document.activeElement = focus ? nodes.get(focus) : { outside: true };
      const event = { key, ctrlKey: false, metaKey: false, prevented: false, preventDefault() { this.prevented = true; } };
      if (modifier) event[modifier] = true;
      for (const handler of keydowns) handler(event);
      return event.prevented;
    }, input(id, value) { nodes.get(id).value = value; nodes.get(id).listeners.input(); },
    async compare(a, b) {
      nodes.get('diff-original').value = a; nodes.get('diff-modified').value = b; click('diff-compare');
      const w = workers.at(-1);
      await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('No worker result')), 10000);
        const receive = w.onmessage; w.onmessage = e => { receive(e); clearTimeout(timer); resolve(); }; }); return w.result;
    }, async close() { await Promise.all(workers.map(w => w.terminate())); } };
}
const p = pageHarness();
p.nodes.get('diff-original').value = Array.from({ length: 2500 }, (_, i) => 'original-' + i).join('\n');
p.nodes.get('diff-modified').value = Array.from({ length: 2500 }, (_, i) => 'modified-' + i).join('\n');
let blocked = false;
try { p.click('diff-compare'); } catch (err) { blocked = err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'; }
eq('real Compare entry returns without quadratic main-thread work', blocked, false);
eq('real Compare starts a terminable worker', p.workers.length > 0, true);
eq('real page exposes cancel', !!p.nodes.get('diff-cancel')?.listeners.click, true);
if (p.workers.length) { p.click('diff-cancel'); eq('cancel terminates actual worker', p.workers.at(-1).terminated, true); }
await p.close();

async function waitFor(predicate) {
  const end = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Worker response timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const h = pageHarness(lang);
  const a = Array.from({ length: 205 }, (_, i) => 'row-' + i).join('\n');
  const r = await h.compare(a, a);
  eq(lang + ' complete count', [r.total, r.adds, r.dels], [205, 0, 0]);
  eq(lang + ' first page bounded', r.rows.length, 100);
  eq(lang + ' idle cancel hidden', h.nodes.get('diff-cancel').hidden, true);
  eq(lang + ' navigation available', h.nodes.get('diff-pages').hidden, false);
  const w = h.workers.at(-1);
  let replies = w.responses;
  h.click('diff-next'); await waitFor(() => w.responses > replies);
  eq(lang + ' page two line numbers', [w.result.rows[0].origLn, w.result.rows.at(-1).modLn], [101, 200]);
  replies = w.responses; h.click('diff-next'); await waitFor(() => w.responses > replies);
  eq(lang + ' last page complete', [w.result.rows.length, h.nodes.get('diff-next').disabled], [5, true]);
  replies = w.responses; h.click('diff-prev'); await waitFor(() => w.responses > replies);
  eq(lang + ' previous page', w.result.page, 1);
  replies = w.responses; h.click('diff-view-side'); await waitFor(() => w.responses > replies);
  eq(lang + ' switch resets page and pairs', [w.result.page, w.result.rows[0].left.ln, w.result.rows[0].right.ln], [0, 1, 1]);
  const old = h.nodes.get('diff-output').innerHTML;
  w.onmessage({ data: { ...w.result, request: w.result.request - 1, rows: [] } });
  eq(lang + ' stale page ignored', h.nodes.get('diff-output').innerHTML, old);
  h.input('diff-original', 'new');
  w.onmessage({ data: w.result });
  eq(lang + ' changed input clears old pages', [w.terminated, h.nodes.get('diff-output').innerHTML, h.nodes.get('diff-pages').hidden], [true, '', true]);
  const changed = await h.compare('k\na\nb\nz', 'k\nA\nB\nz');
  eq(lang + ' real side pairing', changed.rows.map(r => [r.left.val, r.right.val]), [['k','k'],['a','A'],['b','B'],['z','z']]);
  for (const action of ['diff-cancel', 'diff-swap', 'diff-clear', 'pagehide']) {
    await h.compare('left', 'right'); const pending = h.workers.at(-1);
    if (action === 'pagehide') h.events.pagehide(); else h.click(action);
    pending.onmessage({ data: pending.result });
    eq(lang + ' ' + action + ' invalidates late reply', [pending.terminated, h.nodes.get('diff-output').innerHTML, h.nodes.get('diff-pages').hidden], [true, '', true]);
  }
  await h.close();
}
for (const options of [{ noWorker: true }, { throwWorker: true }]) {
  const h = pageHarness('zh', options);
  h.nodes.get('diff-original').value = 'a'; h.click('diff-compare');
  eq('unavailable worker is explicit', h.nodes.get('diff-status').textContent.includes('Web Worker'), true);
  eq('unavailable worker restores controls', [h.nodes.get('diff-compare').disabled, h.nodes.get('diff-cancel').hidden], [false, true]);
  await h.close();
}
const fail = pageHarness();
fail.nodes.get('diff-original').value = 'a'; fail.click('diff-compare');
fail.workers.at(-1).onerror(new Error('Worker failure'));
eq('worker error clears result', [fail.nodes.get('diff-output').innerHTML, fail.nodes.get('diff-status').textContent], ['', 'Comparison failed. Try again.']);
fail.nodes.get('diff-original').value = ''; fail.nodes.get('diff-modified').value = ''; fail.click('diff-compare');
eq('empty input starts no new worker', fail.workers.length, 1);
await fail.close();

// ---------- races: view changes during calculation, rapid paging ----------
{
  // 300 changed lines: unified has 600 rows (6 pages), side-by-side has 300 rows (3 pages).
  const a = Array.from({ length: 300 }, (_, i) => 'x-' + i).join('\n');
  const b = Array.from({ length: 300 }, (_, i) => 'y-' + i).join('\n');
  const h = pageHarness('en');
  h.nodes.get('diff-original').value = a; h.nodes.get('diff-modified').value = b;
  h.click('diff-compare');
  const w = h.workers.at(-1);
  h.click('diff-view-side'); // before the first reply arrives
  await waitFor(() => w.result && w.result.view === 'side');
  eq('view chosen during calculation is the one shown', [w.result.view, w.result.page, w.result.total], ['side', 0, 300]);
  eq('side view rendered after in-flight switch', h.nodes.get('diff-output').innerHTML.includes('diff-sbs'), true);
  eq('page label after in-flight switch', h.nodes.get('diff-page').textContent, '1–100 / 300');

  // Rapid paging: only the newest request renders.
  h.click('diff-view-unified'); await waitFor(() => w.result.view === 'unified');
  let replies = w.responses;
  h.click('diff-next'); h.click('diff-next'); h.click('diff-next');
  await waitFor(() => w.responses >= replies + 3);
  eq('rapid next renders the last requested page', [w.result.page, h.nodes.get('diff-page').textContent], [3, '301–400 / 600']);

  // Switch to the shorter view and page past its end before the new total arrives.
  replies = w.responses;
  h.click('diff-view-side');
  for (let k = 0; k < 5; k++) h.click('diff-next');
  await waitFor(() => w.responses >= replies + 6);
  eq('paging past the end of the new view is clamped', [w.result.view, w.result.page, w.result.rows.length > 0], ['side', 2, true]);
  eq('clamped page label', [h.nodes.get('diff-page').textContent, h.nodes.get('diff-next').disabled], ['201–300 / 300', true]);
  eq('clamped page is not an empty result', h.nodes.get('diff-output').innerHTML.includes('No differences found'), false);
  await h.close();
}

// ---------- complete page + shared clear shortcut ----------
console.log('Existing checks: ' + passes + ' passed, ' + failures + ' failed');
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const sharedFirst of [false, true]) {
  const h = pageHarness(lang, { shortcut: true, sharedFirst, holdResponses: true });
  const prefix = lang + ' sharedFirst=' + sharedFirst;
  const snapshot = () => ({
    inputs: ['diff-original', 'diff-modified'].map(id => h.nodes.get(id).value),
    output: h.nodes.get('diff-output').innerHTML, status: h.nodes.get('diff-status').textContent,
    statusClass: h.nodes.get('diff-status').className, page: h.nodes.get('diff-page').textContent,
    pagesHidden: h.nodes.get('diff-pages').hidden, cancelHidden: h.nodes.get('diff-cancel').hidden,
    busy: h.nodes.get('diff-compare').disabled
  });
  const empty = { inputs: ['', ''], output: '', status: '', statusClass: 'diff-status', page: '', pagesHidden: true, cancelHidden: true, busy: false };
  try {
    h.input('diff-original', 'keep\nOLD'); h.input('diff-modified', 'keep\nNEW');
    eq(prefix + ' typing remains manual', h.workers.length, 0);
    eq(prefix + ' shared CtrlEnter starts comparison', [h.key('Enter'), h.workers.length], [true, 1]);
    let worker = h.workers.at(-1); await waitFor(() => worker.result);
    eq(prefix + ' actual Worker independent diff', worker.result.rows.map(r => [r.type, r.val]), [['equal','keep'],['del','OLD'],['add','NEW']]);
    worker.onmessage({ data: worker.result });
    const rows = Array.from({ length: 105 }, (_, i) => 'row-' + i).join('\n');
    for (const modifier of ['ctrlKey', 'metaKey']) for (const key of ['l', 'L']) {
      const name = prefix + ' ' + modifier + '+' + key;
      h.input('diff-original', rows); h.input('diff-modified', rows); h.click('diff-compare');
      worker = h.workers.at(-1); await waitFor(() => worker.result); worker.onmessage({ data: worker.result });
      eq(name + ' positive paginated result', [worker.result.total, h.nodes.get('diff-pages').hidden, h.nodes.get('diff-page').textContent], [105, false, '1–100 / 105']);
      const before = snapshot(), saved = h.persisted.length;
      eq(name + ' outside focus leaves state and persistence alone', [h.key(key, modifier, null), snapshot(), h.persisted.length, !!worker.terminated], [false, before, saved, false]);
      eq(name + ' unmodified letter leaves state alone', [h.key(key, null), snapshot(), h.persisted.length], [false, before, saved]);
      eq(name + ' tool shortcut clears visible result and shared persistence', [h.key(key, modifier, 'diff-modified'), snapshot(), !!worker.terminated, h.persisted.slice(saved)], [true, empty, true, ['diff-checker']]);
      worker.onmessage({ data: worker.result });
      eq(name + ' old rendered page cannot return after clear', snapshot(), empty);

      h.input('diff-original', 'old-left'); h.input('diff-modified', 'old-right'); h.click('diff-compare');
      worker = h.workers.at(-1); await waitFor(() => worker.result);
      eq(name + ' real completed message held at delivery boundary', [h.nodes.get('diff-compare').disabled, h.nodes.get('diff-cancel').hidden, h.nodes.get('diff-output').innerHTML], [true, false, '']);
      const pendingSaved = h.persisted.length;
      eq(name + ' tool-button focus cancels pending work synchronously', [h.key(key, modifier, 'diff-clear'), snapshot(), !!worker.terminated, h.persisted.slice(pendingSaved)], [true, empty, true, ['diff-checker']]);
      worker.onmessage({ data: worker.result }); worker.onerror(new Error('Late obsolete Worker error'));
      eq(name + ' late actual response and error cannot revive cleared state', snapshot(), empty);
    }
    const obsolete = worker;
    h.input('diff-original', 'new-left'); h.input('diff-modified', 'new-right'); h.click('diff-view-side'); h.click('diff-compare');
    worker = h.workers.at(-1); await waitFor(() => worker.result); worker.onmessage({ data: worker.result });
    eq(prefix + ' comparison recovers with selected view', [worker.result.view, worker.result.rows.map(r => [r.left.val, r.right.val]), h.nodes.get('diff-status').textContent], ['side', [['new-left', 'new-right']], '+1 / -1']);
    const fresh = snapshot(); obsolete.onmessage({ data: obsolete.result });
    eq(prefix + ' cleared task cannot overwrite newer comparison', snapshot(), fresh);
    h.click('diff-clear'); eq(prefix + ' explicit Clear retains its behavior', snapshot(), empty);
    h.click('diff-compare'); eq(prefix + ' empty Compare still reports an error', h.nodes.get('diff-status').className, 'diff-status error');
    h.key('L', 'metaKey'); eq(prefix + ' shortcut also clears current error class', snapshot(), empty);
  } finally { await h.close(); }
}

// ---------- v2 page layout ----------
const v2Start = passes;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const css = source.split('<style>')[1].split('</style>')[0];
const compareCss = readFileSync(join(root, 'src/styles/tool-common.css'), 'utf8');
const clientScript = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
eq('v2 direct flex root with bounded height', /^<div class="diff-wrap">/.test(markup) && /\.diff-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0/.test(css), true);
eq('v2 registered as compare', /'diff-checker':\s*'compare'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')), true);
eq('v2 controls, reserved status, inputs and full-width result are ordered', ['class="diff-actions"', 'id="diff-status"', 'id="diff-inputs"', 'id="diff-results"'].map(x => markup.indexOf(x)).every((n, i, all) => n >= 0 && (!i || n > all[i - 1])), true);
eq('v2 reserves status height including errors', /\.diff-status\s*\{[^}]*flex:\s*none;[^}]*height:\s*3rem;[^}]*overflow:\s*auto/.test(css), true);
eq('v2 two bounded desktop editors', /\.zt-compare-inputs\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(compareCss) && /\.zt-compare-inputs textarea\s*\{[^}]*height:\s*180px;[^}]*min-height:\s*0;[^}]*overflow:\s*auto/.test(compareCss), true);
eq('v2 860px stacked 120px inputs and bounded result', /@media \(max-width: 860px\)[\s\S]*\.zt-compare-inputs\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/.test(compareCss) && /\.zt-compare-inputs textarea\s*\{ height: 120px; \}/.test(compareCss) && /\.zt-compare-results\s*\{ flex: none; height: 24rem; \}/.test(compareCss), true);
eq('v2 640px phone operations keep 44px height', /@media \(max-width: 640px\)[\s\S]*\.diff-actions button, #diff-toggle-inputs\s*\{ min-height: 44px; \}/.test(css), true);
eq('v2 result fills remaining height and scrolls internally', /\.zt-compare-results\s*\{[^}]*flex: 1 1 0;[^}]*min-height:\s*0/.test(compareCss) && /\.diff-output\s*\{[^}]*flex: 1 1 0;[^}]*min-height:\s*0;[^}]*overflow:\s*auto/.test(css), true);
eq('v2 pager remains outside the scrolling result', /<div id="diff-output"[^>]*><\/div>\s*<div id="diff-pages"/.test(markup), true);
eq('v2 output scroll region is keyboard reachable', /id="diff-output"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label=\{T.result\}/.test(markup), true);
eq('v2 empty result is explained on desktop and hidden on stacked screens', /data-placeholder=\{T.emptyResult\}/.test(markup) && /\.diff-output:empty::before[^}]*content: attr\(data-placeholder\)/.test(css) && /@media \(max-width: 860px\)[\s\S]*\.zt-compare-results\[data-empty="true"\]\s*\{ display: none; \}/.test(compareCss), true);
eq('v2 collapse is a disabled-until-result, associated disclosure', /id="diff-toggle-inputs"[^>]*aria-controls="diff-inputs"[^>]*aria-expanded="true" disabled/.test(markup), true);
eq('v2 hidden inputs and idle Cancel cannot be overridden by display', /\.diff-wrap \[hidden\]\s*\{ display: none; \}/.test(css), true);
eq('v2 retains all eight manual controls plus input disclosure', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]).sort(), ['diff-compare', 'diff-cancel', 'diff-swap', 'diff-clear', 'diff-view-unified', 'diff-view-side', 'diff-prev', 'diff-next', 'diff-toggle-inputs'].sort());
for (const id of ['diff-original', 'diff-modified']) {
  const input = markup.match(new RegExp('<textarea id="' + id + '"[^>]*>'))?.[0] || '';
  eq('v2 editable associated input ' + id, !!input && !/readonly|disabled|hidden/.test(input) && markup.includes('for="' + id + '"'), true);
}
eq('v2 generated diff rows keep global CSS', /<style is:global>[\s\S]*\.diff-output \.diff-line[\s\S]*\.diff-output \.diff-sbs-line/.test(source), true);
eq('v2 build-time text only', !/data-i18n|RUN_STRINGS|pageLang|var STRINGS/.test(source), true);
eq('v2 excludes all tips and unselected languages from client strings', source.includes('const { tips: TIPS, ...CLIENT_T } = T;') && source.includes('define:vars={{ t: CLIENT_T }}') && !/TIPS|STRINGS/.test(clientScript), true);
const tips = [...markup.matchAll(/<Toggletip id="(diff-tip-[^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 seven tips map to actual controls', tips.map(m => [m[1], m[2], m[3]]).sort(), ['compare', 'swap', 'clear', 'view', 'original', 'modified', 'results'].map(key => ['diff-tip-' + key, key === 'results' ? 'result' : key, key]).sort());
function leaves(value, path = '') { return Object.entries(value).flatMap(([key, item]) => typeof item === 'object' ? leaves(item, path + key + '.') : [[path + key, item]]); }
const enLeaves = Object.fromEntries(leaves(STRINGS.en));
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const local = Object.fromEntries(leaves(STRINGS[lang]));
  eq(lang + ' v2 recursive string keys', Object.keys(local).sort(), Object.keys(enLeaves).sort());
  for (const [key, value] of Object.entries(local)) {
    eq(lang + ' v2 nonempty ' + key, typeof value === 'string' && value.trim().length > 0, true);
    eq(lang + ' v2 placeholders ' + key, [...value.matchAll(/\{[^}]+\}/g)].map(m => m[0]).sort(), [...enLeaves[key].matchAll(/\{[^}]+\}/g)].map(m => m[0]).sort());
  }
  const mdx = readFileSync(join(root, 'src/content/tools/diff-checker', lang + '.mdx'), 'utf8');
  const steps = (mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1] || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line.trim().slice(2)));
  eq(lang + ' v2 steps count', steps.length, 6);
  eq(lang + ' v2 steps meet 280/1200 limits and use plain text', steps.every(step => [...step].length <= 280 && !/[<>]|\]\(|\*\*|`/.test(step)) && steps.reduce((n, step) => n + [...step].length, 0) <= 1200, true);
  eq(lang + ' v2 steps use actual operation labels', ['compare', 'cancel', 'swap', 'clear', 'unified', 'side_by_side', 'previous', 'next', 'hideInputs', 'showInputs'].every(key => steps.join(' ').includes(STRINGS[lang][key])), true);
  eq(lang + ' v2 usage removed', /<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx), false);
  eq(lang + ' MDX content contract', contractProblems('diff-checker', lang), '');
}
eq('v2 engine marker bytes unchanged', [Buffer.byteLength(source.slice(s, e + END.length)), sha256(source.slice(s, e + END.length))], [4153, 'a1e1be3e9e9d76a3c3756294a6bd755ee7a389bf37dd44c0cac556c4e3e96d2f']);

// Run actual handlers and real Worker messages through the new disclosure and scroll boundaries.
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const sharedFirst of [false, true]) {
  const h = pageHarness(lang, { shortcut: true, sharedFirst, mobile: true, resultTop: 900 });
  const prefix = lang + ' v2 sharedFirst=' + sharedFirst;
  const inputs = h.nodes.get('diff-inputs'), toggle = h.nodes.get('diff-toggle-inputs'), result = h.nodes.get('diff-results');
  const values = () => ['diff-original', 'diff-modified'].map(id => h.nodes.get(id).value);
  try {
    eq(prefix + ' initially empty expanded inputs cannot collapse', [inputs.hidden, toggle.disabled, result.getAttribute('data-empty')], [false, true, 'true']);
    h.click('diff-toggle-inputs'); eq(prefix + ' disabled disclosure cannot hide inputs', inputs.hidden, false);
    const text = Array.from({ length: 105 }, (_, i) => 'line-' + i).join('\n');
    await h.compare(text, text);
    eq(prefix + ' successful Compare leaves editable inputs expanded', [inputs.hidden, toggle.disabled, result.getAttribute('data-empty')], [false, false, 'false']);
    eq(prefix + ' first offscreen phone result scrolls into view', result.scrolls, [{ block: 'start', behavior: 'auto' }]);
    const before = values(), worker = h.workers.at(-1);
    h.click('diff-toggle-inputs');
    eq(prefix + ' manual collapse preserves both values and active Worker', [inputs.hidden, toggle.textContent, toggle.getAttribute('aria-expanded'), values(), !!worker.terminated], [true, STRINGS[lang].showInputs, 'false', before, false]);
    let replies = worker.responses;
    h.click('diff-next'); await waitFor(() => worker.responses > replies);
    eq(prefix + ' paging preserves collapse, values and real line numbers', [inputs.hidden, values(), worker.result.rows[0].origLn, h.nodes.get('diff-page').textContent, result.scrolls.length], [true, before, 101, '101–105 / 105', 1]);
    replies = worker.responses;
    h.click('diff-view-side'); await waitFor(() => worker.responses > replies);
    eq(prefix + ' view change keeps input collapse, returns first page without new Worker', [inputs.hidden, values(), h.workers.length, worker.result.view, worker.result.page, h.nodes.get('diff-view-side').getAttribute('aria-pressed'), h.nodes.get('diff-view-unified').getAttribute('aria-pressed'), result.scrolls.length], [true, before, 1, 'side', 0, 'true', 'false', 1]);
    h.click('diff-toggle-inputs');
    eq(prefix + ' manual expansion restores same values', [inputs.hidden, values(), toggle.getAttribute('aria-expanded'), toggle.textContent], [false, before, 'true', STRINGS[lang].hideInputs]);
    h.click('diff-toggle-inputs'); h.input('diff-modified', 'edited');
    eq(prefix + ' edited input invalidates Worker and reopens inputs', [inputs.hidden, values(), toggle.disabled, result.getAttribute('data-empty'), worker.terminated], [false, [text, 'edited'], true, 'true', true]);
    await h.compare('left', 'right'); h.click('diff-toggle-inputs'); h.click('diff-swap');
    eq(prefix + ' Swap reopens and invalidates without losing text', [inputs.hidden, values(), toggle.disabled, result.getAttribute('data-empty'), h.nodes.get('diff-status').textContent], [false, ['right', 'left'], true, 'true', STRINGS[lang].swapped]);
    await h.compare('left', 'right'); h.click('diff-toggle-inputs'); h.workers.at(-1).onerror(new Error('Worker failed'));
    eq(prefix + ' current Worker failure reopens preserved inputs and clears result', [inputs.hidden, values(), toggle.disabled, result.getAttribute('data-empty'), h.nodes.get('diff-status').textContent], [false, ['left', 'right'], true, 'true', STRINGS[lang].failed]);
    await h.compare('left', 'right'); h.click('diff-toggle-inputs'); h.click('diff-clear');
    eq(prefix + ' Clear reopens empty inputs and output', [inputs.hidden, values(), toggle.disabled, result.getAttribute('data-empty'), h.nodes.get('diff-status').textContent], [false, ['', ''], true, 'true', '']);
    await h.compare('left', 'right'); h.click('diff-toggle-inputs');
    eq(prefix + ' shared shortcut from disclosure remains reachable', h.key('L', 'metaKey', 'diff-toggle-inputs'), true);
    eq(prefix + ' shared shortcut clears collapsed inputs in either listener order', [inputs.hidden, values(), toggle.disabled, result.getAttribute('data-empty'), h.persisted], [false, ['', ''], true, 'true', ['diff-checker']]);
    eq(prefix + ' clearing focused disclosure restores visible input focus', h.document.activeElement === h.nodes.get('diff-original'), true);
    await h.compare('left', 'right'); h.key('l', 'ctrlKey', 'diff-output');
    eq(prefix + ' clearing focused result region restores visible input focus', h.document.activeElement === h.nodes.get('diff-original') && !inputs.hidden, true);
    h.click('diff-compare');
    eq(prefix + ' blank error keeps input editors visible', [inputs.hidden, toggle.disabled, h.nodes.get('diff-status').textContent], [false, true, STRINGS[lang].empty]);
    h.click('diff-view-unified'); const blank = await h.compare('', 'only');
    eq(prefix + ' empty side still represents one empty line', blank.rows.map(row => [row.type, row.val]), [['del', ''], ['add', 'only']]);
  } finally { await h.close(); }
}
// ---------- changed lines that look the same ----------
// A pair of changed lines that differ only in whitespace or invisible characters (trailing
// space, tab, U+00A0, U+3000, U+200B, U+FEFF) or only in Unicode normalization (NFC / NFD) was
// shown as - / + with no reason. The status line now counts these pairs.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const T = STRINGS[lang];
  const h = pageHarness(lang);
  try {
    const status = () => h.nodes.get('diff-status').textContent;
    await h.compare('a \nb\tc\nx\u00a0y\n全角\u3000\nz\u200bw\nsame', 'a\nb    c\nx y\n全角\nzw\nsame');
    eq(lang + ' whitespace-only pairs are counted', status(), '+5 / -5 ' + T.onlySpace?.replace('{n}', '5'));
    await h.compare('caf\u00e9\n\u1100\u1161\nkeep', 'cafe\u0301\n\uac00\nkeep');
    eq(lang + ' normalization-only pairs are counted', status(), '+2 / -2 ' + T.onlyNormalization?.replace('{n}', '2'));
    await h.compare('one\ntwo ', 'ONE\ntwo');
    eq(lang + ' only qualifying pairs are counted', status(), '+2 / -2 ' + T.onlySpace?.replace('{n}', '1'));
    await h.compare('a\nb', 'A\nb');
    eq(lang + ' ordinary change has no note', status(), '+1 / -1');
    await h.compare('a', 'a ');
    eq(lang + ' single pair', status(), '+1 / -1 ' + T.onlySpace?.replace('{n}', '1'));
    await h.compare('x\ny', 'x\ny');
    eq(lang + ' identical text', status(), T.identical);
  } finally { await h.close(); }
}

for (const [mobile, top] of [[false, 900], [true, 100]]) {
  const h = pageHarness('en', { mobile, resultTop: top });
  try {
    await h.compare('a', 'b');
    eq('v2 no unexpected result scroll mobile=' + mobile + ' top=' + top, h.nodes.get('diff-results').scrolls.length, 0);
  } finally { await h.close(); }
}
console.log('v2 page layout: ' + (passes - v2Start) + ' passed, ' + failures + ' total failures');

// ---------- worked examples on the tool pages ({/* dc-check: {...} */}) ----------
// Each example is compared on the real page (page script and Worker) in that page language.
// Inputs: spec.a / spec.b, or else the first two code blocks after the annotation. The Unified
// output (marker, space, line; the first page) must equal a later code block when spec.show has
// "unified"; the status line must appear verbatim in a code block or inline code when it has
// "status". Default show: ["unified", "status"].
{
  const examplesStart = passes;
  const pending = [];
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const body = splitToolMdx(readFileSync(join(root, 'src/content/tools/diff-checker', lang + '.mdx'), 'utf8')).body;
    for (const note of annotations(body, 'dc-check')) pending.push({ lang, note });
  }
  const results = new Map();
  for (const { lang, note } of pending) {
    note.spec ??= {};
    const blocks = fencedBlocks(note.after);
    const a = note.spec.a ?? blocks[0]?.text, b = note.spec.b ?? blocks[1]?.text;
    if (typeof a !== 'string' || typeof b !== 'string') { results.set(lang + '#' + note.index, { error: 'no inputs' }); continue; }
    const h = pageHarness(lang);
    try {
      const r = await h.compare(a, b);
      const marker = { equal: ' ', del: '-', add: '+' };
      results.set(lang + '#' + note.index, { unified: r.rows.map(op => marker[op.type] + ' ' + op.val).join('\n'), status: h.nodes.get('diff-status').textContent });
    } finally { await h.close(); }
  }
  const codeTexts = after => {
    const out = fencedBlocks(after).map(x => x.text);
    const prose = withoutCode(after);
    for (const m of prose.matchAll(/<code>\{("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\}<\/code>/g)) out.push(new Function('return ' + m[1])());
    for (const m of prose.replace(/<code>[\s\S]*?<\/code>/g, ' ').matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
    return out;
  };
  const verify = ({ spec, after, lang, index }) => {
    const got = results.get(lang + '#' + index);
    if (!got) return 'not computed';
    if (got.error) return got.error;
    const codes = codeTexts(after);
    const missing = ((spec ?? {}).show ?? ['unified', 'status']).filter(k => !codes.includes(got[k]));
    return missing.length ? missing.map(k => k + ' ' + JSON.stringify(got[k]) + ' not shown').join('; ') : null;
  };
  const contract = toolMdxContract('diff-checker', { annotations: [{ tag: 'dc-check', min: 2, verify }] });
  for (const r of contract.results.filter(r => /dc-check/.test(r.rule))) eq(r.message, r.ok, true);
  console.log('page examples: ' + (passes - examplesStart) + ' passed, ' + failures + ' total failures');
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
