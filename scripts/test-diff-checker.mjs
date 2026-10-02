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
// page example.
//
// Run: node scripts/test-diff-checker.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { Worker as ThreadWorker } from 'node:worker_threads';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/DiffCheckerTool.astro'), 'utf8');
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
  const nodes = new Map(), blobs = new Map(), workers = [], events = {}, timers = new Map();
  let serial = 0;
  function element() { return { value: '', textContent: '', innerHTML: '', className: '', hidden: false, disabled: false,
    style: {}, scrollHeight: 160, listeners: {}, classList: { add() {}, remove() {} },
    addEventListener(k, f) { this.listeners[k] = f; }, setAttribute() {} }; }
  class BrowserWorker {
    constructor(url) {
      if (options.throwWorker) throw new Error('Worker blocked');
      this.thread = new ThreadWorker(`const {parentPort}=require('node:worker_threads'); const self={postMessage:v=>parentPort.postMessage(v)}; ${blobs.get(url)}; parentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
      this.thread.on('message', data => { this.result = data; this.responses = (this.responses || 0) + 1; this.onmessage?.({ data }); });
      this.thread.on('error', error => this.onerror?.(error)); workers.push(this);
    }
    postMessage(data) { this.sent = data; this.thread.postMessage(data); }
    terminate() { this.terminated = true; return this.thread.terminate(); }
  }
  const context = vm.createContext({ document: { documentElement: { lang }, querySelectorAll: () => [],
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, addEventListener() {} },
    window: { addEventListener(k, f) { events[k] = f; } }, Worker: options.noWorker ? undefined : BrowserWorker,
    Blob: class { constructor(parts) { this.source = parts.join(''); } },
    URL: { createObjectURL(b) { const id = 'blob:' + blobs.size; blobs.set(id, b.source); return id; }, revokeObjectURL() {} },
    setTimeout(f, ms) { const id = ++serial; timers.set(id, { f, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, console });
  vm.runInContext(source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  function click(id, timeout = 100) { context.callback = nodes.get(id)?.listeners.click; vm.runInContext('callback()', context, { timeout }); }
  return { nodes, workers, events, click, input(id, value) { nodes.get(id).value = value; nodes.get(id).listeners.input(); },
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

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
