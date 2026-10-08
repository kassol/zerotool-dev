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
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/components/tools/RegexTesterTool.astro'), 'utf8');
const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
const script = src.slice(src.indexOf('<script'), src.indexOf('</script>'));
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const markup = src.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const strings = vm.runInNewContext('(' + src.match(/const STRINGS = ([\s\S]*?);\nconst T/)[1] + ')');
function clientStrings(lang) {
  const context = vm.createContext({ STRINGS: strings, lang });
  vm.runInContext(src.match(/const T = [\s\S]*?(?=\n---)/)[0] + '\nglobalThis.client = CLIENT;', context);
  return JSON.parse(JSON.stringify(context.client));
}

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
function pageHarness(lang = 'en', noWorker = false, order = 'shared-after') {
  const nodes = new Map();
  const document = { documentElement: { lang }, activeElement: null, body: {}, listeners: {},
    addEventListener(k, f) { (this.listeners[k] ||= []).push(f); } };
  function element() {
    return { value: '', _text: '', _html: '', className: '', _hidden: false,
      get textContent() { return this._text; }, set textContent(v) { this._text = v; this._html = ''; this.children = []; },
      get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this._text = ''; this.children = []; },
      get hidden() { return this._hidden; }, set hidden(v) { this._hidden = v; if (v && document.activeElement === this) document.activeElement = document.body; },
      listeners: {}, children: [], addEventListener(k, f) { this.listeners[k] = f; },
      appendChild(n) { this.children.push(n); }, setAttribute() {}, focus() { document.activeElement = this; } };
  }
  const flags = ['g', 'i', 'm', 's'].map(value => Object.assign(element(), { value, checked: value === 'g' }));
  const blobs = new Map(), workers = [], timers = new Map(), events = {};
  const persistedClears = [], delivery = { hold: false };
  const widget = { dataset: { empty: markup.match(/class="rgx-wrap" data-empty="([^"]+)"/)[1] },
    contains(el) { return [...nodes.values(), ...flags].includes(el); },
    querySelectorAll(s) { return s === 'textarea, input[type="text"]' ? [nodes.get('rgx-pattern'), nodes.get('rgx-test')] : []; } };
  Object.assign(document, {
    querySelectorAll: s => s.includes('rgx-flags') ? flags : [],
    querySelector: s => ['.tool-widget', '.rgx-wrap'].includes(s) ? widget : null,
    getElementById: id => {
      if (!nodes.has(id)) {
        const node = element(), tag = markup.match(new RegExp('<[^>]+\\bid="' + id + '"[^>]*>'))?.[0] || '';
        node.className = tag.match(/class="([^"]*)"/)?.[1] || '';
        node.hidden = /\shidden(?:\s|>)/.test(tag);
        nodes.set(id, node);
      }
      return nodes.get(id);
    },
    createElement: element
  });
  let timerId = 0;
  class BrowserWorker {
    constructor(url) {
      this.ready = new Promise(resolve => { this.resolve = resolve; });
      this.thread = new ThreadWorker(`const {parentPort}=require('node:worker_threads'); const self={postMessage:v=>parentPort.postMessage(v)}; ${blobs.get(url)}; parentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
      this.thread.on('message', data => { this.result = data; this.resolve(data); if (!delivery.hold) this.onmessage?.({ data }); });
      this.thread.on('error', error => this.onerror?.(error));
      workers.push(this);
    }
    postMessage(data) { this.thread.postMessage(data); }
    terminate() { this.terminated = true; return this.thread.terminate(); }
  }
  const context = vm.createContext({ document, S: clientStrings(lang), _slug: 'regex-tester',
    window: { addEventListener(k, f) { events[k] = f; }, ztPersist: { clear(slug) { persistedClears.push(slug); } } }, Worker: noWorker ? undefined : BrowserWorker,
    Blob: class { constructor(parts) { this.source = parts.join(''); } },
    URL: { createObjectURL(b) { const key = 'blob:' + blobs.size; blobs.set(key, b.source); return key; }, revokeObjectURL() {} },
    setTimeout(f, ms) { const id = ++timerId; timers.set(id, { f, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, performance, console });
  if (order === 'shared-before') vm.runInContext(shortcut, context);
  vm.runInContext(src.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  if (order === 'shared-after') vm.runInContext(shortcut, context);
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
  function key(key = 'l', modifier = 'ctrlKey') {
    const event = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const handler of document.listeners.keydown || []) handler(event);
    return event;
  }
  async function ready(worker) {
    let timer;
    try { return await Promise.race([worker.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Worker result did not arrive')), 5000); })]); }
    finally { clearTimeout(timer); }
  }
  return { nodes, workers, flags, events, fire, tick, match, key, ready, document, widget, persistedClears, delivery, timers,
    async close() { await Promise.all(workers.map(w => w.terminate())); } };
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

// Actual full page IIFE + actual ToolLayout keydown in both registration orders.
const workerSource = src.slice(src.indexOf('      function matchWorker() {'), src.indexOf('      function stop() {'));
eq('native matchWorker bytes unchanged', [Buffer.byteLength(workerSource), createHash('sha256').update(workerSource).digest('hex')],
  [1429, '349958c8b545e3e82bdbc4d5600b7fd2bf1e7f21da98e2c5f6c4e6dc37752a79']);
eq('shared shortcut extracted', shortcut.includes("widget.querySelectorAll('textarea, input[type=\"text\"]')"), true);
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const order of ['shared-before', 'shared-after']) {
  const p = pageHarness(lang, false, order), prefix = `${lang} ${order}`;
  const state = () => [p.nodes.get('rgx-pattern').value, p.nodes.get('rgx-test').value,
    p.nodes.get('rgx-status').textContent, p.nodes.get('rgx-status').className,
    p.nodes.get('rgx-highlight').innerHTML, p.nodes.get('rgx-highlight').textContent,
    p.nodes.get('rgx-matches').children.length, p.nodes.get('rgx-cancel').hidden];
  const empty = ['', '', '', 'rgx-status', '', '', 0, true];
  try {
    const result = await p.match('(?<digit>\\d)', '😀 7 8', 'im');
    eq(`${prefix} positive real Worker fixture`, result.matches.map(m => [m.match, m.index, ...m.groups]), [['7', 3, '7']]);
    p.nodes.get('rgx-test').focus();
    const before = state(); p.key('l', 'altKey');
    eq(`${prefix} unmodified shortcut keeps current result`, state(), before);
    p.document.activeElement = p.document.body; p.key();
    eq(`${prefix} outside shortcut keeps current result`, state(), before);
    p.nodes.get('rgx-pattern').focus(); p.key();
    eq(`${prefix} CtrlL clears completed result and status`, state(), empty);
    eq(`${prefix} CtrlL keeps stable input focus`, p.document.activeElement === p.nodes.get('rgx-test'), true);
    eq(`${prefix} CtrlL preserves flags`, p.flags.filter(f => f.checked).map(f => f.value), ['i', 'm']);
    eq(`${prefix} shared clear still runs once`, p.persistedClears, ['regex-tester']);

    await p.match('[', 'broken'); p.nodes.get('rgx-test').focus(); p.key('L', 'metaKey');
    eq(`${prefix} MetaL clears invalid-pattern state`, state(), empty);
    p.fire('rgx-pattern', 'a'); p.fire('rgx-test', 'a');
    const count = p.workers.length;
    p.nodes.get('rgx-pattern').focus(); p.key();
    eq(`${prefix} CtrlL removes pending debounce timer`, [...p.timers.values()].some(timer => timer.ms === 300), false);
    p.tick(300);
    eq(`${prefix} CtrlL cancels queued debounce`, p.workers.length, count);
    eq(`${prefix} debounce cannot refill empty UI`, state(), empty);

    p.delivery.hold = true;
    p.fire('rgx-pattern', '(\\d)'); p.fire('rgx-test', 'x7'); p.tick(300);
    const pending = p.workers.at(-1), reply = await p.ready(pending);
    eq(`${prefix} delayed result uses actual Worker output`, reply.matches.map(m => [m.match, m.index, ...m.groups]), [['7', 1, '7']]);
    p.nodes.get('rgx-cancel').focus(); p.key('L', 'metaKey');
    eq(`${prefix} CtrlL terminates pending Worker`, pending.terminated, true);
    eq(`${prefix} Cancel focus transfers before hidden`, p.document.activeElement === p.nodes.get('rgx-test'), true);
    eq(`${prefix} both keydown listeners retain widget focus`, p.persistedClears.length, 4);
    pending.onmessage({ data: reply }); pending.onerror(new Error('late Worker failure')); p.tick(2000);
    eq(`${prefix} late Worker result/error/deadline cannot refill`, state(), empty);
    p.delivery.hold = false;
    eq(`${prefix} fresh match works after CtrlL`, (await p.match('b', 'aba')).matches.map(m => [m.match, m.index]), [['b', 1]]);
  } finally { await p.close(); }
}

// ---------- v2 page layout ----------
const v2Start = passes;
eq('v2 direct flex root with zero minimum sizes', /^<div class="rgx-wrap" data-empty="true">/.test(markup)
  && /\.rgx-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0/.test(style), true);
eq('v2 registered analyze', /'regex-tester':\s*'analyze'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')), true);
eq('v2 controls then reserved status then input then full-width results', ['class="rgx-controls"','id="rgx-status"','class="rgx-field rgx-input-section"','id="rgx-results"'].map(x => markup.indexOf(x)).every((x,i,a) => x >= 0 && (i === 0 || x > a[i - 1])), true);
eq('v2 only existing Cancel action, no artificial primary or copy', [...markup.matchAll(/<button\b[^>]*id="([^"]+)"/g)].map(m => m[1]), ['rgx-cancel']);
eq('v2 Cancel hidden semantics with reserved control space', /id="rgx-cancel"[^>]*hidden/.test(markup) && /#rgx-cancel\[hidden\]\s*\{ display: none; \}/.test(style) && /\.rgx-cancel-slot\s*\{[^}]*min-height: 44px/.test(style), true);
eq('v2 input and Cancel 44px targets', /\.rgx-pattern-row > input\[type="text"\]\s*\{[^}]*min-height: 44px/.test(style) && /#rgx-cancel\s*\{[^}]*min-height: 44px/.test(style), true);
eq('v2 static labels and placeholders use build-time locale', !/data-i18n|pageLang/.test(src) && /for="rgx-pattern">\{T.pattern\}/.test(markup) && /for="rgx-test">\{T.testString\}/.test(markup) && markup.includes('placeholder={T.testPlaceholder}'), true);
eq('v2 only current-language strings enter script, no tip bodies', /define:vars=\{\{ S: CLIENT \}\}/.test(script) && !/STRINGS|tips|TIPS/.test(script), true);
eq('v2 status has fixed height and keyboard scrolling', /\.rgx-status\s*\{[^}]*height: 3\.9em;[^}]*overflow: auto/.test(style) && /id="rgx-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*tabindex="0"/.test(markup), true);
eq('v2 empty input receives available height', /\.rgx-input-section\s*\{ flex: 1 1 0; min-height: 160px; \}/.test(style) && /\.rgx-field textarea\s*\{[^}]*flex: 1 1 0;[^}]*min-height: 0;[^}]*overflow: auto;[^}]*resize: none/.test(style), true);
eq('v2 populated desktop input is compact', /\.rgx-wrap\[data-empty="false"\] #rgx-test\s*\{ flex: none; height: 120px; \}/.test(style), true);
eq('v2 results follow available height without content basis', /\.rgx-results\s*\{[^}]*flex: 1 1 0;[^}]*min-width: 0;[^}]*min-height: 0/.test(style) && /\.rgx-result-body\s*\{[^}]*flex: 1 1 0;[^}]*min-height: 0/.test(style), true);
for (const [id,label] of [['rgx-highlight','highlightedMatches'],['rgx-matches','matches']]) {
  eq('v2 bounded keyboard-scrollable output ' + id, new RegExp('\\.' + id + '\\s*\\{[^}]*flex: 1 1 0;[^}]*min-height: 0;[^}]*overflow: auto').test(style)
    && new RegExp('id="' + id + '"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label=\\{T\\.' + label + '\\}').test(markup), true);
}
eq('v2 result sections use a full-width column', /\.rgx-result-body\s*\{ display: flex; flex-direction: column;/.test(style) && !/grid-template-columns/.test(style), true);
eq('v2 desktop empty hint and content are mutually exclusive', markup.includes('{T.emptyResult}') && /\.rgx-wrap\[data-empty="true"\] \.rgx-result-body, \.rgx-wrap\[data-empty="false"\] \.rgx-empty\s*\{ display: none; \}/.test(style), true);
eq('v2 860 stack bounds input/results and hides empty output', /@media \(max-width: 860px\)[\s\S]*height: 160px;[\s\S]*\.rgx-results\s*\{ flex: none; height: 26rem; \}[\s\S]*\.rgx-wrap\[data-empty="true"\] \.rgx-results\s*\{ display: none; \}/.test(style), true);
eq('v2 640 controls and results remain bounded', /@media \(max-width: 640px\)[\s\S]*\.rgx-flags label\s*\{ min-height: 44px; \}[\s\S]*\.rgx-results\s*\{ height: 24rem; \}/.test(style), true);
eq('v2 theme ancestor selectors are global', [...style.matchAll(/^\s*([^\n{]*(?:data-theme)[^\n{]*)\{/gm)].every(m => m[1].includes(':global(')), true);
for (const [theme, selector] of [
  ['light', '.rgx-highlight :global(mark)'],
  ['system dark', ':global(:root:not([data-theme="light"])) .rgx-highlight :global(mark)'],
  ['explicit dark', ':global([data-theme="dark"]) .rgx-highlight :global(mark)']
]) {
  const rule = style.split('\n').map(line => line.trim()).join('\n').match(new RegExp('(?:^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}'))?.[1] || '';
  const colors = ['color', 'background'].map(property => rule.match(new RegExp('(?:^|;)\\s*' + property + ':\\s*(#[a-f\\d]{3}(?:[a-f\\d]{3})?)\\s*;', 'i'))?.[1]);
  const luminances = colors.map(hex => {
    if (!hex) return NaN;
    const digits = hex.slice(1).length === 3 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1);
    return digits.match(/../g).map(channel => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  });
  const ratio = (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
  console.log('INFO mark contrast ' + theme + ': ' + colors.join(' on ') + ' = ' + ratio);
  eq('v2 ' + theme + ' mark text contrast is at least 4.5:1', ratio >= 4.5, true);
}
eq('v2 original plural branch remains n greater than one', script.includes("count > 1 ? t.matchMany : t.matchOne") && script.includes("t.andMore.replace('{n}', count - 100)"), true);
const tipKeys = ['pattern','g','i','m','s','input','highlight','matches'];
const tips = [...markup.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=(?:\{T\.(\w+)\}|"([gims])")>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 exact eight control-bound tip IDs', tips.map(m => [m[1],m[4]]), tipKeys.map(k => ['rgx-tip-' + k,k]));
const statusLiterals = {
  en: ['No matches.', '1 match found.', '2 matches found.', '... and 2 more matches.', '0 match found.'],
  zh: ['无匹配项。', '找到 1 个匹配项。', '找到 2 个匹配项。', '... 还有 2 个匹配项。', '找到 0 个匹配项。'],
  ja: ['マッチなし。', '1 件マッチしました。', '2 件マッチしました。', '... 他 2 件のマッチ。', '0 件マッチしました。'],
  ko: ['일치하는 항목이 없습니다.', '1개 일치 항목을 찾았습니다.', '2개 일치 항목을 찾았습니다.', '... 외 2개 일치 항목.', '0개 일치 항목을 찾았습니다.']
};
for (const lang of ['en','zh','ja','ko']) {
  const t = strings[lang], client = clientStrings(lang);
  eq(lang + ' v2 locale keys match', Object.keys(t).sort(), Object.keys(strings.en).sort());
  eq(lang + ' v2 all tip keys match', Object.keys(t.tips).sort(), [...tipKeys].sort());
  eq(lang + ' v2 client excludes tips and functions', !('tips' in client) && Object.values(client).every(v => typeof v === 'string'), true);
  for (const tip of tips) eq(lang + ' v2 visible label and fact ' + tip[1], typeof (tip[2] ? t[tip[2]] : tip[3]) === 'string' && typeof t.tips[tip[4]] === 'string' && t.tips[tip[4]].trim().length > 0 && !/<\/?[a-z]|https?:\/\//.test(t.tips[tip[4]]), true);
  const mdx = readFileSync(join(root, 'src/content/tools/regex-tester', lang + '.mdx'), 'utf8');
  const steps = (mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1] || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line.trim().slice(2)));
  eq(lang + ' v2 six plain steps', steps.length, 6);
  eq(lang + ' v2 bounded steps use actual localized controls', steps.every(s => [...s].length <= 280 && !/[<>]|\]\(|\*\*|`/.test(s)) && steps.reduce((n,s) => n + [...s].length, 0) <= 1200 && ['pattern','testString','highlightedMatches','matches','cancel'].every(k => steps.join(' ').includes(t[k])), true);
  eq(lang + ' MDX content contract', contractProblems('regex-tester', lang), '');
  eq(lang + ' v2 zero retains original singular template', client.matchOne.replace('{n}', 0), statusLiterals[lang][4]);
  const p = pageHarness(lang);
  try {
    eq(lang + ' v2 initial empty state and hidden Cancel', [p.widget.dataset.empty, p.nodes.get('rgx-cancel').hidden], ['true',true]);
    for (const [text,count] of [['x',0],['a',1],['aa',2]]) {
      await p.match('a',text);
      eq(lang + ' v2 literal count message ' + count, p.nodes.get('rgx-status').textContent, statusLiterals[lang][count]);
      eq(lang + ' v2 actual result expands correct layout ' + count, p.widget.dataset.empty, 'false');
    }
    // The match list labels its UTF-16 position in the page language (it said "index" in all four).
    const firstItem = p.nodes.get('rgx-matches').children[0].children[1].innerHTML;
    eq(lang + ' match list position label is in the page language', /\(index \d+\)/.test(firstItem), lang === 'en');
    eq(lang + ' match list shows the localized position of match 2', firstItem.includes('(' + (client.indexLabel ?? 'index') + ' 1)'), true);
    p.flags[0].checked = false; p.flags[0].listeners.change(); p.tick(300);
    eq(lang + ' v2 actual flag change still runs automatically', (await p.ready(p.workers.at(-1))).count, 1);
    await p.match('a','a'.repeat(102));
    eq(lang + ' v2 list overflow template preserves plural text', p.nodes.get('rgx-matches').children[0].children.at(-1).textContent, statusLiterals[lang][3]);
    p.fire('rgx-pattern',''); p.fire('rgx-test','plain <&>'); p.tick(300);
    eq(lang + ' v2 pattern-free text preview retains exact bytes', [p.nodes.get('rgx-highlight').textContent,p.widget.dataset.empty], ['plain <&>','false']);
    for (const order of ['shared-before','shared-after']) {
      const q = pageHarness(lang, false, order);
      try {
        await q.match('a','a'); q.document.getElementById('rgx-tip-matches').focus(); q.key();
        eq(lang + ' v2 result-tip CtrlL preserves shared cleanup ' + order, [q.widget.dataset.empty, q.document.activeElement === q.nodes.get('rgx-test'), q.persistedClears], ['true',true,['regex-tester']]);
      } finally { await q.close(); }
    }
    p.fire('rgx-pattern',''); p.fire('rgx-test','');
    eq(lang + ' v2 empty layout returns during debounce', p.widget.dataset.empty, 'true');
    p.tick(300);
    eq(lang + ' v2 empty input starts no Worker and has no status', p.nodes.get('rgx-status').textContent, '');
  } finally { await p.close(); }
}
try {
  const require = createRequire(import.meta.url);
  const { transform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const compiled = await transform(src, { filename: 'RegexTesterTool.astro' });
  eq('v2 actual Astro compiler has no error diagnostics', compiled.diagnostics.filter(d => d.severity === 1), []);
  await require('esbuild').transform(compiled.code, { loader: 'ts', format: 'esm' });
  eq('v2 generated Astro JavaScript compiles', true, true);
} catch (error) { eq('v2 actual Astro and generated JavaScript compilation', error.message, 'no error'); }
console.log('v2 page layout: ' + (passes - v2Start) + ' passed, ' + failures + ' total failures');
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
