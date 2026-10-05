// Markdown Linter — the results quoted on the English page come from markdownlint
//
// Read:  src/components/tools/MarkdownLinterTool.astro, src/content/tools/markdown-linter/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the component calls markdownlint's `lint` with only `strings` (default rules, inline
// configuration comments allowed); the changelog and heading examples on the English page,
// formatted the way the result list and Copy Results show them; markdownlint-disable /
// -enable and -disable-next-line comments switch rules off inside the document; the rule count
// quoted in the FAQ.
//
// Run: node scripts/test-markdown-linter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lint } from 'markdownlint/promise';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parseFragment, defaultTreeAdapter } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MarkdownLinterTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/markdown-linter/en.mdx'), 'utf8');

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}

const run = async (content) => (await lint({ strings: { content } })).content;
// The text the result list shows: rule, "L n", description — detail [context]
const shown = (i) => `${i.ruleNames[0]} L ${i.lineNumber} ${i.ruleDescription}${i.errorDetail ? ' — ' + i.errorDetail : ''}${i.errorContext ? ' [' + i.errorContext + ']' : ''}`;
// The text Copy Results writes
const copied = (i) => `L ${i.lineNumber} [${i.ruleNames[0]}] ${i.ruleDescription}${i.errorDetail ? ' — ' + i.errorDetail : ''}${i.errorContext ? ' [' + i.errorContext + ']' : ''}`;

eq('component lints with default options', /lintFn\(\{ strings: \{ content: content \} \}\)/.test(source), true);

// changelog example
const changelog = '# Changelog\n\n## 1.2.0\n\n### Added\n\n- Export button\n\n## 1.1.0\n\n### Added\n\n* Dark mode\n\nSee https://example.com/releases';
eq('page shows the changelog', page.includes(changelog), true);
eq('changelog without a final line break adds MD047', (await run(changelog)).map((i) => i.ruleNames[0]).includes('MD047'), true);
eq('changelog results', (await run(changelog + '\n')).map((i) => `L${i.lineNumber} ${i.ruleNames[0]}`), ['L13 MD004', 'L11 MD024', 'L15 MD034']);

// heading example
const headings = 'Intro paragraph\n## Setup\n#### Install\nRun `npm install`.\n```\nnpm test\n```';
eq('page shows the heading example', page.includes(headings.replace(/`/g, '\\`')), true);
const hr = await run(headings + '\n');
eq('heading example: eight results', hr.length, 8);
for (const quote of [
  shown(hr.find((i) => i.ruleNames[0] === 'MD001')),
  shown(hr.find((i) => i.ruleNames[0] === 'MD022')),
  shown(hr.find((i) => i.ruleNames[0] === 'MD041')),
  copied(hr.find((i) => i.ruleNames[0] === 'MD001')),
]) eq('page quotes ' + quote, page.includes(quote), true);
eq('MD031 and MD040 on line 5', hr.filter((i) => i.lineNumber === 5).map((i) => i.ruleNames[0]), ['MD031', 'MD040']);

// inline configuration comments
const long = 'This line is deliberately longer than eighty characters so that MD013 would normally report it.';
eq('MD013 without a comment', (await run('# Notes\n\n' + long + '\n')).map((i) => i.ruleNames[0]), ['MD013']);
eq('markdownlint-disable / -enable', await run('# Notes\n\n<!-- markdownlint-disable MD013 -->\n' + long + '\n<!-- markdownlint-enable MD013 -->\n'), []);
eq('markdownlint-disable-next-line', await run('# Notes\n\n<!-- markdownlint-disable-next-line MD034 -->\nSee https://example.com\n'), []);

// rule count in the FAQ (markdownlint enables every rule by default)
const rules = (await import(join(root, 'node_modules/markdownlint/lib/rules.mjs'))).default;
eq('FAQ rule count', page.includes('all ' + rules.length + ' of its rules'), true);

// Complete unchanged page IIFE, actual markdownlint, and shared shortcut handlers.
// Only DOM, Promise delivery, timers and clipboard APIs are controlled.
const inline = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const strings = vm.runInNewContext('(' + inline.match(/var STRINGS = (\{[\s\S]*?\n      \});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcuts = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const failuresText = { en: 'Copy failed', zh: '复制失败', ja: 'コピーに失敗', ko: '복사 실패' };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function pageVM(lang = 'en', order = 'shared-after', ready = true) {
  const jobs = [], clipboard = [], timers = new Map(), tracks = [], clears = [], events = {};
  let doc, timerId = 0, now = 0;
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  function matchesOne(el, selector) {
    if (el.tagName.startsWith('#')) return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!matchesOne(el, parts.pop())) return false;
      for (let parent = el.parentNode; parent; parent = parent.parentNode) if (matchesOne(parent, parts.join(' '))) return true;
      return false;
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
      && [...plain.matchAll(/\.([\w-]+)/g)].every(m => el.className.split(/\s+/).includes(m[1]))
      && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
  }
  const matches = (el, selector) => selector.split(',').some(part => matchesOne(el, part));
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: {}, listeners: {}, id: '', className: '', text: '', value: '', disabled: false, hidden: false, clientHeight: 200, scrollTop: 0 }); }
    get parentElement() { return this.parentNode; }
    setAttribute(key, value) { this.attrs[key] = String(value); if (['id', 'class', 'type'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); }
    getAttribute(key) { return key === 'class' ? this.className || null : this.attrs[key] ?? null; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { if (doc?.activeElement !== this && this.contains(doc?.activeElement)) doc.activeElement = doc.body; for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(value); }
    set innerHTML(value) {
      this.textContent = '';
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(value)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type, extra = {}) {
      const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      const path = []; for (let el = this; el; el = el.parentNode) path.push(el);
      for (const el of path) { for (const fn of el.listeners[type] || []) fn.call(el, event); if (event.stopped) break; }
      return event;
    }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  function fromParse5(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
    for (const child of node.childNodes || []) if (child.nodeName !== '#comment') el.appendChild(fromParse5(child));
    return el;
  }
  doc = new Element('#document'); doc.documentElement = new Element('html'); doc.documentElement.lang = lang; doc.appendChild(doc.documentElement);
  doc.body = new Element('body'); doc.documentElement.appendChild(doc.body); doc.activeElement = doc.body;
  const widget = new Element('section'); widget.className = 'tool-widget'; doc.body.appendChild(widget);
  widget.innerHTML = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('<style')[0];
  doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
  doc.createElement = tag => new Element(tag);
  doc.execCommand = () => { throw Error('Forbidden OS clipboard'); };
  function actualLint(options) { const job = { ...deferred(), real: lint(options), options, released: false }; jobs.push(job); return job.promise; }
  const sandbox = { document: doc, console, _slug: 'markdown-linter', ztPersist: { clear(slug) { clears.push(slug); } },
    __mlLint: ready ? actualLint : undefined,
    addEventListener(type, fn) { (events[type] ??= []).push(fn); },
    getComputedStyle() { return { lineHeight: '20px', paddingTop: '0px' }; },
    trackTool(...args) { tracks.push(args); },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    navigator: { clipboard: { writeText(value) { const job = { ...deferred(), value: String(value) }; clipboard.push(job); return job.promise; } } },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  if (order === 'shared-before') vm.runInContext(shortcuts, context);
  vm.runInContext(inline, context, { filename: 'MarkdownLinterTool.astro:complete-inline', timeout: 1000 });
  if (order === 'shared-after') vm.runInContext(shortcuts, context);
  const get = id => { const el = doc.getElementById(id); if (!el) throw Error('Missing actual ID ' + id); return el; };
  return { get, doc, jobs, clipboard, timers, tracks, clears, sandbox,
    input(value) { get('ml-editor').value = value; get('ml-editor').dispatch('input'); },
    key(key, extra = {}, target = get('ml-editor')) { target.focus(); return target.dispatch('keydown', { key, ctrlKey: true, ...extra }); },
    advance(ms) { now += ms; for (const [id, job] of [...timers]) if (job.due <= now && timers.has(id)) { timers.delete(id); job.fn(); } },
    takeTimer(ms) { const entry = [...timers].find(([, job]) => job.ms === ms); if (!entry) throw Error('Missing actual ' + ms + ' ms timer'); now = Math.max(now, entry[1].due); timers.delete(entry[0]); return entry[1].fn; },
    ready() { sandbox.__mlLint = actualLint; for (const fn of events['ml-ready'] || []) fn(); },
    async release(job = jobs.at(-1), reject = false) { if (!job || job.released) throw Error('Missing pending actual lint'); const result = await job.real; job.released = true; reject ? job.reject(Error('controlled lint rejection')) : job.resolve(result); await settle(); return result; },
    snapshot() { return { value: get('ml-editor').value, summary: get('ml-summary').textContent, className: get('ml-summary').className, result: get('ml-results').textContent, button: get('ml-copy').textContent }; },
  };
}
const clearState = p => p.get('ml-editor').value === '' && p.get('ml-summary').textContent === '' && p.get('ml-summary').className === 'ml-summary' && p.get('ml-results').textContent === strings[p.doc.documentElement.lang].resultsPlaceholder;
const safeDoc = '# Recovery\n\nGood text.\n';
const pageStart = passes;
for (const lang of ['en','zh','ja','ko']) for (const order of ['shared-before','shared-after']) {
  const prefix = lang + '/' + order + ': ', t = strings[lang];
  {
    const p = pageVM(lang, order); const actual = await p.release();
    eq(prefix + 'default sample linted by real markdownlint', actual.content.map(issue => issue.ruleNames[0]), ['MD001','MD009','MD012','MD012','MD013','MD034','MD047']);
    eq(prefix + 'localized initial issue count', p.get('ml-summary').textContent, t.issueCount(actual.content.length));
    const issue = p.get('ml-results').querySelector('.ml-issue'), line = Number(issue.getAttribute('data-line'));
    issue.click();
    eq(prefix + 'click result focuses actual editor', p.doc.activeElement === p.get('ml-editor'), true);
    eq(prefix + 'click result selects actual source line', p.get('ml-editor').value.slice(p.get('ml-editor').selectionStart, p.get('ml-editor').selectionEnd), p.get('ml-editor').value.split('\n')[line - 1]);
    eq(prefix + 'copy bytes use real lint output', (p.get('ml-copy').click(), p.clipboard.at(-1).value), actual.content.map(i => `${t.line} ${i.lineNumber} [${i.ruleNames[0]}] ${i.ruleDescription}${i.errorDetail ? ' — ' + i.errorDetail : ''}${i.errorContext ? ' [' + i.errorContext + ']' : ''}`).join('\n'));
    p.clipboard.at(-1).resolve(); await settle();
    eq(prefix + 'current copy succeeds', p.get('ml-copy').textContent, t.copied); p.advance(1500);
    eq(prefix + 'current label timer restores action', p.get('ml-copy').textContent, t.copyResults);
    const before = p.jobs.length; p.key('Enter');
    eq(prefix + 'CtrlEnter has no invented primary action', p.jobs.length, before);
    p.input(safeDoc); p.advance(299); eq(prefix + 'automatic lint waits300ms', p.jobs.length, before);
    p.advance(1); await p.release(); eq(prefix + 'current clean result positive', p.get('ml-summary').textContent, t.noIssues);
    p.input(''); p.advance(300); eq(prefix + 'empty input clears after existing debounce', clearState(p), true);
    const n = p.clipboard.length; p.get('ml-copy').click(); eq(prefix + 'no issues means no clipboard call', p.clipboard.length, n);
  }
  for (const action of ['clear','ctrl','meta']) {
    const p = pageVM(lang, order); await p.release();
    action === 'clear' ? p.get('ml-clear').click() : p.key('L', action === 'meta' ? { ctrlKey: false, metaKey: true } : {});
    eq(prefix + action + ' clears actual output/status', clearState(p), true);
    if (action !== 'clear') eq(prefix + action + ' shared persistence clear still executes', p.clears, ['markdown-linter']);
    const n = p.jobs.length; p.advance(300); eq(prefix + action + ' never schedules lint', p.jobs.length, n);
  }
  for (const outcome of ['resolve','reject']) for (const action of ['clear','ctrl','meta','input','empty','new-result']) {
    const p = pageVM(lang, order), old = p.jobs[0];
    if (action === 'clear') p.get('ml-clear').click();
    if (action === 'ctrl' || action === 'meta') p.key('l', action === 'meta' ? { ctrlKey: false, metaKey: true } : {});
    if (action === 'input' || action === 'new-result') p.input(safeDoc);
    if (action === 'empty') { p.input(''); p.advance(300); }
    if (action === 'new-result') { p.advance(300); await p.release(); }
    const before = p.snapshot(); await p.release(old, outcome === 'reject');
    eq(prefix + 'old lint ' + outcome + ' after ' + action + ' cannot write', p.snapshot(), before);
    if (['clear','ctrl','meta','empty'].includes(action)) eq(prefix + action + ' stays clear after late lint', clearState(p), true);
  }
  {
    const p = pageVM(lang, order); await p.release(p.jobs[0], true);
    eq(prefix + 'current failure is visible', p.get('ml-results').textContent, 'Error: Error: controlled lint rejection');
    p.input(safeDoc); p.advance(300); await p.release();
    eq(prefix + 'current failure recovers via real lint', p.get('ml-summary').textContent, t.noIssues);
  }
  for (const action of ['none','clear','ctrl','edit']) {
    const p = pageVM(lang, order, false);
    eq(prefix + 'library not ready reports pending', p.get('ml-summary').textContent, t.libPending);
    if (action === 'clear') p.get('ml-clear').click();
    if (action === 'ctrl') p.key('l');
    if (action === 'edit') p.input(safeDoc);
    const before = p.snapshot(); p.ready();
    if (action === 'none') { eq(prefix + 'ml-ready starts pending initial sample exactly once', p.jobs.length, 1); await p.release(); eq(prefix + 'pending sample computes real issues', p.get('ml-summary').textContent, t.issueCount(7)); }
    else { eq(prefix + 'ml-ready after ' + action + ' cannot restart stale request', p.jobs.length, 0); eq(prefix + 'ml-ready after ' + action + ' preserves current state', p.snapshot(), before); }
    if (action === 'edit') { p.advance(300); await p.release(); eq(prefix + 'edited input keeps original300ms schedule', p.get('ml-summary').textContent, t.noIssues); }
  }
  {
    const p = pageVM(lang, order); await p.release(); p.input(safeDoc); p.get('ml-clear').click();
    const count = p.jobs.length; p.advance(300); eq(prefix + 'Clear cancels queued debounce', p.jobs.length, count); eq(prefix + 'Clear debounce remains empty', clearState(p), true);
    p.input(safeDoc); p.key('l'); p.advance(300); eq(prefix + 'CtrlL cancels queued debounce', p.jobs.length, count); eq(prefix + 'CtrlL debounce remains empty', clearState(p), true);
    const before = p.snapshot(); p.key('l', {}, p.doc.body); eq(prefix + 'outside-tool CtrlL changes nothing', p.snapshot(), before);
  }
}
console.log('Page lint/control checks: ' + (passes - pageStart) + ' passed');
const copyStart = passes;
for (const lang of ['en','zh','ja','ko']) for (const order of ['shared-before','shared-after']) {
  const prefix = 'copy ' + lang + '/' + order + ': ', t = strings[lang];
  for (const outcome of ['resolve','reject']) for (const action of ['clear','ctrl','input','empty','new-result','new-error']) {
    const p = pageVM(lang, order); await p.release(); p.get('ml-copy').click(); const old = p.clipboard.at(-1);
    if (action === 'clear') p.get('ml-clear').click();
    if (action === 'ctrl') p.key('l');
    if (['input','new-result','new-error'].includes(action)) p.input(safeDoc);
    if (action === 'empty') { p.input(''); p.advance(300); }
    if (action === 'new-result' || action === 'new-error') { p.advance(300); await p.release(undefined, action === 'new-error'); }
    const before = p.snapshot(), n = unhandled.length;
    outcome === 'resolve' ? old.resolve() : old.reject(Error('late clipboard rejection')); await settle();
    eq(prefix + 'old ' + outcome + ' after ' + action + ' cannot write', p.snapshot(), before);
    eq(prefix + 'old ' + outcome + ' after ' + action + ' has no unhandled rejection', unhandled.length - n, 0);
    p.advance(1500);
    const afterDebounce = action === 'input' ? { ...before, summary: t.loading, className: 'ml-summary' } : before;
    eq(prefix + 'old ' + outcome + ' after ' + action + ' timer cannot write', p.snapshot(), afterDebounce);
  }
  for (const lintOutcome of ['resolve','reject']) for (const copyOutcome of ['resolve','reject']) {
    const p = pageVM(lang, order); await p.release(); p.input(safeDoc); p.advance(300);
    // The previous visible list is still copyable while the new lint is pending.
    p.get('ml-copy').click(); const held = p.clipboard.at(-1);
    await p.release(undefined, lintOutcome === 'reject'); const before = p.snapshot(), n = unhandled.length;
    copyOutcome === 'resolve' ? held.resolve() : held.reject(Error('copy during pending lint')); await settle();
    eq(prefix + 'copy made during pending lint ' + lintOutcome + '/' + copyOutcome + ' cannot relabel replacement', p.snapshot(), before);
    eq(prefix + 'pending lint copy failure handled', unhandled.length - n, 0);
  }
  for (const mode of ['reject','throw','absent']) {
    const p = pageVM(lang, order); await p.release(); const original = p.sandbox.navigator.clipboard; const before = p.get('ml-results').textContent, n = unhandled.length;
    if (mode === 'throw') p.sandbox.navigator.clipboard = { writeText() { throw Error('clipboard throws'); } };
    if (mode === 'absent') delete p.sandbox.navigator.clipboard;
    let thrown = null; try { p.get('ml-copy').click(); } catch (e) { thrown = String(e); }
    if (mode === 'reject') p.clipboard.at(-1).reject(Error('current clipboard rejection'));
    await settle(); eq(prefix + mode + ' current API failure is contained', thrown, null);
    eq(prefix + mode + ' current rejection handled', unhandled.length - n, 0);
    eq(prefix + mode + ' localized failure visible', p.get('ml-copy').textContent, failuresText[lang]);
    p.sandbox.navigator.clipboard = original; p.get('ml-copy').click(); p.clipboard.at(-1).resolve(); await settle();
    eq(prefix + mode + ' direct same-output retry succeeds', p.get('ml-copy').textContent, t.copied);
    eq(prefix + mode + ' same-output retry preserves issues', p.get('ml-results').textContent, before);
  }
  for (const first of ['resolve','reject']) for (const second of ['resolve','reject']) {
    const p = pageVM(lang, order); await p.release(); p.get('ml-copy').click(); const a = p.clipboard.at(-1); p.get('ml-copy').click(); const b = p.clipboard.at(-1);
    first === 'resolve' ? a.resolve() : a.reject(Error('first copy failed')); await settle();
    eq(prefix + first + '/' + second + ' first request cannot change second pending label', p.get('ml-copy').textContent, t.copyResults);
    second === 'resolve' ? b.resolve() : b.reject(Error('second copy failed')); await settle();
    eq(prefix + first + '/' + second + ' second request owns feedback', p.get('ml-copy').textContent, second === 'resolve' ? t.copied : failuresText[lang]);
  }
  {
    const p = pageVM(lang, order); await p.release(); p.get('ml-copy').click(); p.clipboard.at(-1).resolve(); await settle();
    const expired = p.takeTimer(1500); p.get('ml-copy').click(); p.clipboard.at(-1).resolve(); await settle();
    expired(); eq(prefix + 'old already-due timer cannot restore new Copied', p.get('ml-copy').textContent, t.copied);
    p.advance(1499); eq(prefix + 'new Copied keeps its own full1500ms', p.get('ml-copy').textContent, t.copied);
    p.advance(1); eq(prefix + 'new timer restores label at own deadline', p.get('ml-copy').textContent, t.copyResults);
  }
  for (const action of ['clear','ctrl','input','new-result']) {
    const p = pageVM(lang, order); await p.release(); p.get('ml-copy').click(); p.clipboard.at(-1).resolve(); await settle(); const oldTimer = p.takeTimer(1500);
    if (action === 'clear') p.get('ml-clear').click();
    if (action === 'ctrl') p.key('l');
    if (action === 'input' || action === 'new-result') p.input(safeDoc);
    if (action === 'new-result') { p.advance(300); await p.release(); }
    const before = p.snapshot(); oldTimer(); eq(prefix + 'due timer after ' + action + ' leaves current state alone', p.snapshot(), before);
    eq(prefix + 'input/clear/new result resets copied feedback', p.get('ml-copy').textContent, t.copyResults);
  }
}
console.log('Page copy checks: ' + (passes - copyStart) + ' passed');
eq('all clipboard Promise rejections are handled', unhandled.length, 0);
process.off('unhandledRejection', onUnhandled);
// This component has no engine markers: protect the real library bootstrap, rendering and sample bytes.
const protectedParts = [
  ['library bootstrap', source.slice(source.indexOf('  <script>'), source.indexOf('  </script>') + '  </script>'.length), 239, 'd63bf33d62026162329deb58f1948bbf71236739ddafce85caa6d27eda501c12'],
  ['rendering and line navigation', source.slice(source.indexOf('      // Severity color map'), source.indexOf('      function runLint()')), 2694, '59ef136c24af6e97db1918924b25aaf51a631147df769d266aa7bfbe3e95d7b9'],
  ['default sample', source.slice(source.indexOf('      // Default sample with intentional issues'), source.indexOf('      runLint();\n    })();')), 628, '10102fcd9f48c981c84c8af7883930edbd150f3f320adda26e379bf86043dac0'],
];
for (const [name, code, bytes, hash] of protectedParts) {
  eq(name + ': bytes unchanged', Buffer.byteLength(code), bytes);
  eq(name + ': SHA256 unchanged', createHash('sha256').update(code).digest('hex'), hash);
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
