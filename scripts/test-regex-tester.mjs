// Regex Tester — styles for the match list, and the results quoted on the en tool page
//
// Read:  src/components/tools/RegexTesterTool.astro, src/content/tools/regex-tester/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// The match list (ul.rgx-match-list, span.rgx-pos, ul.rgx-groups) is built with innerHTML, so it
// does not get Astro's scope attribute; before the fix its rules were plain scoped selectors and
// never applied (the list kept browser bullets and no borders). They must be written as
// `.rgx-matches :global(...)` (AGENTS.md rule 11). The second part runs the patterns from the
// page's "Tested Patterns" table and "Flags in Practice" list with the same loop as the tool
// (always global, zero-length matches advance lastIndex) and compares the matches and indexes.
//
// Run: node scripts/test-regex-tester.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { Worker as ThreadWorker } from 'node:worker_threads';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/components/tools/RegexTesterTool.astro'), 'utf8');
const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
const script = src.slice(src.indexOf('<script'), src.indexOf('</script>'));

let passes = 0, failures = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + g + '\n  expected: ' + w); }
}

for (const cls of ['rgx-match-list', 'rgx-pos', 'rgx-groups']) {
  eq(`script creates .${cls}`, script.includes(cls), true);
  const uses = [...style.matchAll(new RegExp('(\\.rgx-matches :global\\()?\\.' + cls + '(?![\\w-])', 'g'))];
  eq(`.${cls} has rules, all under .rgx-matches :global(...)`, uses.length > 0 && uses.every((m) => m[1]), true);
}

// Same loop as run() in the component
function run(pattern, flags, text) {
  const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push([m[0], m.index, ...Array.from(m).slice(1)]);
    if (m[0].length === 0) re.lastIndex++;
    if (!flags.includes('g')) break;
  }
  return out;
}
eq('greedy', run('<.+>', 'g', '<a>foo</a>').map((m) => m[0]), ['<a>foo</a>']);
eq('lazy', run('<.+?>', 'g', '<a>foo</a>').map((m) => m[0]), ['<a>', '</a>']);
eq('signed decimal', run('-?\\d+(?:\\.\\d+)?', 'g', 'temp -3.5, max 42').map((m) => m[0]), ['-3.5', '42']);
eq('hex colors', run('#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})\\b', 'g', '#fff #1a73e8 #12345g').map((m) => m[0]), ['#fff', '#1a73e8']);
eq('lookbehind', run('(?<=\\$)\\d+', 'g', 'cost $42').map((m) => m[0]), ['42']);
eq('named groups listed by number', run('^(?<ts>\\S+)\\s+(?<level>\\w+)\\s+(?<msg>.+)$', 'g', '2026-04-07T14:23:01 ERROR connection refused')[0].slice(2), ['2026-04-07T14:23:01', 'ERROR', 'connection refused']);
eq('date format only', run('^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$', 'g', '2026-02-31').length, 1);
eq('\\w is ASCII only', run('\\w+', 'g', 'café 東京').map((m) => m[0]), ['caf']);
eq('no u flag: \\p{L} is literal', run('\\p{L}', 'g', 'p{L} a').map((m) => m[0]), ['p{L}']);
const LOG = 'ERROR disk full\nWARN retry 3\nERROR timeout';
eq('^ERROR with g', run('^ERROR .+', 'g', LOG).map((m) => [m[0], m[1]]), [['ERROR disk full', 0]]);
eq('^ERROR with gm', run('^ERROR .+', 'gm', LOG).map((m) => [m[0], m[1]]), [['ERROR disk full', 0], ['ERROR timeout', 29]]);
eq('dot without s', run('a.b', 'g', 'a\nb').length, 0);
eq('dot with s', run('a.b', 'gs', 'a\nb').length, 1);
eq('i does not ignore accents', run('cafe', 'gi', 'Café CAFE cafe').map((m) => m[0]), ['CAFE', 'cafe']);
eq('emoji adds 2 to the index', run('\\d', 'g', '😀 id=7')[0][1], 6);
const mdx = readFileSync(join(root, 'src/content/tools/regex-tester/en.mdx'), 'utf8');
eq('page states index 29', mdx.includes('the second at index 29'), true);

// Drive the real input listener and its timer, not a mirror of the match loop.
function pageHarness(lang = 'en', noWorker = false) {
  const nodes = new Map();
  function element() {
    return { value: '', textContent: '', _html: '', className: '', hidden: false,
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.children = []; },
      listeners: {}, children: [], addEventListener(k, f) { this.listeners[k] = f; },
      appendChild(n) { this.children.push(n); }, setAttribute() {} };
  }
  const flags = ['g', 'i', 'm', 's'].map(value => ({ value, checked: value === 'g', addEventListener() {} }));
  const blobs = new Map(), workers = [], timers = new Map(), events = {};
  let timerId = 0;
  class BrowserWorker {
    constructor(url) {
      this.thread = new ThreadWorker(`const {parentPort}=require('node:worker_threads'); const self={postMessage:v=>parentPort.postMessage(v)}; ${blobs.get(url)}; parentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
      this.thread.on('message', data => { this.result = data; this.onmessage?.({ data }); });
      this.thread.on('error', error => this.onerror?.(error));
      workers.push(this);
    }
    postMessage(data) { this.thread.postMessage(data); }
    terminate() { this.terminated = true; return this.thread.terminate(); }
  }
  const context = vm.createContext({ document: {
    documentElement: { lang }, querySelectorAll: s => s.includes('rgx-flags') ? flags : [],
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element, addEventListener() {}
  }, window: { addEventListener(k, f) { events[k] = f; } }, Worker: noWorker ? undefined : BrowserWorker,
    Blob: class { constructor(parts) { this.source = parts.join(''); } },
    URL: { createObjectURL(b) { const key = 'blob:' + blobs.size; blobs.set(key, b.source); return key; }, revokeObjectURL() {} },
    setTimeout(f, ms) { const id = ++timerId; timers.set(id, { f, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, performance, console });
  vm.runInContext(src.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  const fire = (id, value) => { nodes.get(id).value = value; nodes.get(id).listeners.input(); };
  function tick(ms) {
    for (const [id, timer] of [...timers]) if (timer.ms === ms) {
      timers.delete(id); context.callback = timer.f;
      vm.runInContext('callback()', context, { timeout: 100 });
    }
  }
  async function match(pattern, text, selected = 'g') {
    flags.forEach(f => { f.checked = selected.includes(f.value); });
    fire('rgx-pattern', pattern); fire('rgx-test', text); tick(300);
    const w = workers.at(-1);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker result did not arrive')), 5000);
      const receive = w.onmessage;
      w.onmessage = event => { receive(event); clearTimeout(timer); resolve(); };
    });
    return w.result;
  }
  return { nodes, workers, flags, events, fire, tick, match, async close() { await Promise.all(workers.map(w => w.terminate())); } };
}
const page = pageHarness();
page.fire('rgx-pattern', '^(a+)+$');
page.fire('rgx-test', 'a'.repeat(28) + '!');
let blocked = false;
try { page.tick(300); } catch (e) { blocked = e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'; }
eq('real input entry does not execute backtracking on main thread', blocked, false);
eq('real input starts a terminable worker', page.workers.length > 0, true);
eq('real page has a cancel listener', !!page.nodes.get('rgx-cancel')?.listeners.click, true);
if (page.workers.length) {
  page.tick(2000);
  eq('deadline terminates the running worker', page.workers[0].terminated, true);
  eq('timeout is explicit', page.nodes.get('rgx-status').textContent.includes('2 s'), true);
  page.fire('rgx-pattern', '(?<digit>\\d)'); page.fire('rgx-test', '😀 7'); page.tick(300);
  await new Promise(resolve => { const timer = setTimeout(resolve, 5000); const worker = page.workers.at(-1); const receive = worker.onmessage; worker.onmessage = event => { receive(event); clearTimeout(timer); resolve(); }; });
  eq('real worker renders UTF-16 position and groups', page.nodes.get('rgx-matches').children.at(-1)?.children[0]?.innerHTML.includes('index 3'), true);
  const late = page.workers.at(-1).onmessage;
  page.fire('rgx-test', '');
  late({ data: { count: 999, matches: [] } });
  eq('input replacement rejects late results', page.nodes.get('rgx-status').textContent.includes('999'), false);
  page.tick(300);
  page.nodes.get('rgx-cancel').listeners.click();
  eq('cancel terminates the worker', page.workers.at(-1).terminated, true);
}
await page.close();

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = pageHarness(lang);
  try {
    for (const [pattern, flags, text] of [
      ['^ERROR .+', 'gm', LOG], ['a.b', 'gs', 'a\nb'], ['cafe', 'gi', 'Café CAFE cafe'],
      ['(?<digit>\\d)', '', '😀 7 8'], ['(?=(a))', 'g', 'aa'], ['(a)|(b)', 'g', 'ab'],
      ['$', 'gm', 'a\nb'], ['(?<=\\$)\\d+', 'g', 'cost $42'], ['\\d', 'g', '']
    ]) {
      const result = await p.match(pattern, text, flags);
      eq(`${lang} actual Worker ${pattern}/${flags}`, result.matches.map(m => [m.match, m.index, ...m.groups]), run(pattern, flags, text));
    }
    eq(`${lang} invalid pattern clears list`, (await p.match('[', 'a')).error.length > 0 && p.nodes.get('rgx-matches').children.length === 0, true);
    const huge = await p.match('(a+)'.repeat(25), 'a'.repeat(120000));
    eq(`${lang} large capture payload bounded`, huge.clipped && huge.matches[0].groups.length === 20 && huge.matches[0].match.length <= 1001, true);
    const many = await p.match('(a)', 'a'.repeat(100001));
    eq(`${lang} full count with bounded highlight and list`, [many.count, many.matches.length, p.nodes.get('rgx-matches').children[0].children.length], [100001, 1000, 101]);
    eq(`${lang} preview text stays bounded`, p.nodes.get('rgx-highlight').innerHTML.replace(/<[^>]+>/g, '').length, 100000);
    const budget = await p.match('(a)(?=' + '(a*)'.repeat(20) + ')', 'a'.repeat(2000));
    eq(`${lang} capture list has total budget`, budget.matches.slice(0, 100).flatMap(m => [m.match, ...m.groups]).reduce((n, s) => n + s.replace(/…$/, '').length, 0) <= 100000, true);
    p.fire('rgx-pattern', '^(a+)+$'); p.fire('rgx-test', 'a'.repeat(28) + '!'); p.tick(300);
    const stale = p.workers.at(-1).onmessage;
    p.nodes.get('rgx-cancel').listeners.click();
    const cancelled = p.nodes.get('rgx-status').textContent;
    stale({ data: { count: 999, matches: [] } });
    eq(`${lang} cancel discards queued result`, p.nodes.get('rgx-status').textContent, cancelled);
    p.fire('rgx-pattern', ''); p.fire('rgx-test', ''); p.tick(300);
    eq(`${lang} clear resets all output`, [p.nodes.get('rgx-status').textContent, p.nodes.get('rgx-highlight').innerHTML, p.nodes.get('rgx-matches').children.length], ['', '', 0]);
    p.fire('rgx-pattern', 'a'); p.events.pagehide(); p.tick(300);
    eq(`${lang} pagehide removes debounce`, p.nodes.get('rgx-cancel').hidden, true);
  } finally { await p.close(); }
}
const unavailable = pageHarness('en', true);
unavailable.fire('rgx-pattern', 'a'); unavailable.tick(300);
eq('no Worker reports failure without synchronous fallback', unavailable.nodes.get('rgx-status').textContent.includes('worker'), true);
await unavailable.close();

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
