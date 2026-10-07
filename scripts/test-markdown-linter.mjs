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
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';
import { compile } from '@mdx-js/mdx';
import { toolSteps } from '../src/data/llms.mjs';

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
const inline = source.match(/<script is:inline define:vars=\{\{ t: CLIENT_T \}\}>([\s\S]*?)<\/script>/)[1];
const strings = vm.runInNewContext('(' + source.match(/const STRINGS = (\{[\s\S]*?\n\});/)[1] + ')');
const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('<style')[0];
const expectedCounts = { en: ['No issues found', '1 issue found', '2 issues found', '7 issues found'], zh: ['未发现问题', '发现 1 个问题', '发现 2 个问题', '发现 7 个问题'], ja: ['問題なし', '1 件の問題', '2 件の問題', '7 件の問題'], ko: ['문제 없음', '1개 문제 발견', '2개 문제 발견', '7개 문제 발견'] };
const escapeHTML = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const tipMarkup = readFileSync(join(root, 'src/components/Toggletip.astro'), 'utf8').replace(/^---[\s\S]*?---\s*/, '').split('<script>')[0];
function renderTip(id, about, content) {
  return tipMarkup.replace("class:list={['zt-tip-btn', { 'zt-tip-btn--text': text }]}", 'class="zt-tip-btn"')
    .replace("class:list={['zt-tip-pop', { 'zt-tip-pop--wide': wide }]}", 'class="zt-tip-pop"')
    .replace(/\{text && <span[\s\S]*?<\/span>\}/, '')
    .replace(/=\{id\}/g, '="' + escapeHTML(id) + '"')
    .replace('aria-label={text ? undefined : name}', 'aria-label="' + escapeHTML(about) + '"')
    .replace('<slot />', escapeHTML(content));
}
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
    setAttribute(key, value) { this.attrs[key] = String(value); if (['id', 'class', 'type'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); if (this.id === 'ml-results' && key === 'data-empty' && String(value) === 'true' && doc.querySelector('.ml-results-pane .ml-heading')?.contains(doc.activeElement)) doc.activeElement = doc.body; }
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
  widget.innerHTML = markup.replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{T\.tips\.(\w+)\}<\/Toggletip>/g, (_, id, about, key) => renderTip(id, strings[lang][about], strings[lang].tips[key]))
    .replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + escapeHTML(strings[lang][key]) + '"')
    .replace(/\{T\.(\w+)\}/g, (_, key) => escapeHTML(strings[lang][key]));
  doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
  doc.createElement = tag => new Element(tag);
  doc.execCommand = () => { throw Error('Forbidden OS clipboard'); };
  function actualLint(options) { const job = { ...deferred(), real: lint(options), options, released: false }; jobs.push(job); return job.promise; }
  const { tips, ...client } = strings[lang];
  const sandbox = { t: JSON.parse(JSON.stringify(client)), document: doc, console, _slug: 'markdown-linter', ztPersist: { clear(slug) { clears.push(slug); } },
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
    snapshot() { return { value: get('ml-editor').value, summary: get('ml-summary').textContent, className: get('ml-summary').className, result: get('ml-results').textContent, button: get('ml-copy').textContent, empty: get('ml-results').getAttribute('data-empty') }; },
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
    eq(prefix + 'localized initial issue count', p.get('ml-summary').textContent, expectedCounts[lang][3]);
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
    if (action === 'none') { eq(prefix + 'ml-ready starts pending initial sample exactly once', p.jobs.length, 1); await p.release(); eq(prefix + 'pending sample computes real issues', p.get('ml-summary').textContent, expectedCounts[lang][3]); }
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

// ---------- v2 page layout ----------
{
  const beforePasses = passes, beforeFailures = failures;
  const check = (name, value) => eq(name, Boolean(value), true);
  const sha = value => createHash('sha256').update(value).digest('hex');
  const css = source.split('<style>')[1].split('</style>')[0];
  check('registered as analyze', /'markdown-linter':\s*'analyze'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('direct tool root after frontmatter', /^<div class="ml-wrap">/.test(markup));
  check('root and panes can shrink within the first screen', /\.ml-wrap\s*\{[^}]*flex-direction: column;[^}]*min-width: 0; min-height: 0/.test(css) && /\.ml-pane\s*\{[^}]*min-width: 0; min-height: 0/.test(css));
  check('empty input uses shared analyze zone', /class="ml-pane ml-editor-pane zt-empty-drop"/.test(markup));
  check('desktop empty input fills available height', /\.ml-wrap:has\(#ml-results\[data-empty="true"\]\) #ml-editor \{ flex: 1 1 0; min-height: 220px; \}/.test(css));
  check('full-width results fill bounded remainder', /\.ml-results-pane \{ flex: 1 1 0; overflow: hidden; \}/.test(css) && /\.ml-results \{ flex: 1 1 0; min-width: 0; min-height: 0; overflow: auto;/.test(css));
  check('status space is reserved and can scroll', /\.ml-summary \{ flex: none; height: 2\.4rem; overflow: auto;/.test(css));
  check('input has fixed compact height and internal scroll', /width: 100%; height: 180px; min-height: 0; overflow: auto;/.test(css) && css.includes('resize: none'));
  check('mobile output keeps fixed height for short and long results', /@media \(max-width: 860px\)[\s\S]*?\.ml-results-pane \{ flex: none; height: 24rem; \}/.test(css) && /@media \(max-width: 640px\)[\s\S]*?\.ml-results-pane \{ height: 22rem; \}/.test(css));
  check('mobile hides only the empty result pane', /\.ml-results-pane:has\(#ml-results\[data-empty="true"\]\) \{ display: none; \}/.test(css));
  check('results heading disappears only for empty state', css.includes('.ml-results-pane:has(#ml-results[data-empty="true"]) .ml-heading { display: none; }'));
  check('results keyboard focus is visible', css.includes('.ml-results:focus-visible'));
  check('long descriptions and aliases wrap inside zero-minimum grid', css.includes('grid-template-columns: auto auto minmax(0, 1fr)') && /:global\(\.ml-desc\) \{ min-width: 0; overflow-wrap: anywhere;/.test(css) && /:global\(\.ml-alias\) \{ min-width: 0; overflow-wrap: anywhere;/.test(css));
  check('primary controls retain44px targets', css.includes('.ml-control button { min-height: 44px; }'));
  check('toolbar and reserved summary precede editor/results', markup.indexOf('ml-toolbar') < markup.indexOf('ml-summary') && markup.indexOf('ml-summary') < markup.indexOf('ml-editor-pane') && markup.indexOf('ml-editor-pane') < markup.indexOf('ml-results-pane'));
  eq('exactly two original actions, no invented Run', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]), ['ml-clear','ml-copy']);
  check('no primary action or extra Enter listener', !markup.includes('btn-primary') && !inline.includes("e.key === 'Enter'"));
  check('strings are build-time and tips excluded from client', !source.includes('data-i18n') && source.includes('const { tips, ...CLIENT_T } = T;') && !inline.includes('STRINGS') && !inline.includes('tips'));
  check('no storage/network changes in actual inline logic', !/fetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(inline));
  const retained = {
    en: ['a2cfd73ad974f489bb4406148d7e0c1348cc5c6c5a0ad6e9f1ce4862958bf9fb','fd173c97e6e065d9536dfeacf3964093bd339828cdd610232cd689e99e0a2ffc'],
    zh: ['1653ad931d4d653ddefbcd6ef165336aa8dce58068b09e88362148d4e24f6ec3','d1699c9ea2747a126ee203f6db257978b095af1831a29619ccd3d28c0fb005c9'],
    ja: ['00103260025c05ef967f27ed0c495e022bdfd22497c74bdd3408f84c7299e9fb','f0cf4ece6a565a25e6ccf3f1a044e5fbc9703764ac59d7de1fdb7ccb8f88cc45'],
    ko: ['01dba0cfab6d59cb027cdee74f14dc418eb7998ca83eeae3549fc4716d998249','ff3a4daebcde704fec200ab2f9942465b66cc01e096af96dd583b8ad89d63e02'],
  };
  const tipKeys = ['input','clear','copy','results'];
  eq('four control-bound tips', [...markup.matchAll(/<Toggletip id="ml-tip-([^"]+)"/g)].map(m => m[1]).sort(), tipKeys.slice().sort());
  for (const key of tipKeys) check(key + ': tip binds matching localized text', markup.includes('{T.tips.' + key + '}'));
  for (const lang of ['en','zh','ja','ko']) {
    const entry = strings[lang], { tips, ...client } = entry;
    eq(lang + ': localized keys match', Object.keys(entry).sort(), Object.keys(strings.en).sort());
    eq(lang + ': tip keys match', Object.keys(tips).sort(), tipKeys.slice().sort());
    for (const key of tipKeys) check(lang + '/' + key + ': explanatory plain text', typeof tips[key] === 'string' && tips[key].trim().length > 0 && !/[\n<>]/.test(tips[key]));
    check(lang + ': serialized client excludes every tip', !('tips' in client) && Object.values(tips).every(value => !JSON.stringify(client).includes(JSON.stringify(value))));
    eq(lang + ': count templates survive JSON serialization', JSON.parse(JSON.stringify(client)).issueCount, entry.issueCount);
    const mdx = readFileSync(join(root, 'src/content/tools/markdown-linter', lang + '.mdx'), 'utf8');
    const split = mdx.indexOf('\n---\n', 4), metadata = mdx.slice(0, split), body = mdx.slice(split + 5), parsed = loadYaml(metadata.slice(4));
    const { steps } = parsed;
    check(lang + ': five plain steps within8/280/1200 limits', steps.length === 5 && steps.every(step => typeof step === 'string' && step.length <= 280 && !/<[^>]*>/.test(step)) && steps.join('').length <= 1200);
    for (const key of ['inputLabel','resultsLabel','clear','copyResults']) check(lang + ': steps reference actual ' + key, steps.some(step => step.includes(entry[key])));
    eq(lang + ': FAQ and SEO byte-identical', sha(metadata.replace(/^steps:\n(?:  .*\n)*/m, '')), retained[lang][0]);
    eq(lang + ': non-Usage body byte-identical', sha(body), retained[lang][1]);
    check(lang + ': Usage removed', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
    eq(lang + ': llms receives complete steps', toolSteps(parsed), steps);
    await compile(body); check(lang + ': MDX body compiles', true);
    const p = pageVM(lang); await p.release();
    eq(lang + ': Clear is initially localized', p.get('ml-clear').textContent, entry.clear);
    eq(lang + ': Copy is initially localized', p.get('ml-copy').textContent, entry.copyResults);
    eq(lang + ': input placeholder is localized', p.get('ml-editor').getAttribute('placeholder'), entry.placeholder);
    eq(lang + ': results accessible label is localized', p.get('ml-results-label').textContent, entry.resultsLabel);
    eq(lang + ': output is keyboard-scrollable region', [p.get('ml-results').getAttribute('tabindex'),p.get('ml-results').getAttribute('role'),p.get('ml-results').getAttribute('aria-labelledby')], ['0','region','ml-results-label']);
    for (const [index, content] of [safeDoc,'# Title\n\nText','# Title\n\nhttps://example.com'].entries()) {
      p.input(content); p.advance(300); const actual = await p.release();
      eq(lang + ': real fixture has' + index + ' issues', actual.content.length, index);
      eq(lang + ': serialized template preserves count' + index, p.get('ml-summary').textContent, expectedCounts[lang][index]);
      eq(lang + ': count' + index + ' keeps actual results visible', p.get('ml-results').getAttribute('data-empty'), 'false');
    }
    p.input('# Error fixture\n'); p.advance(300); await p.release(undefined, true);
    eq(lang + ': library error keeps result pane visible', p.get('ml-results').getAttribute('data-empty'), 'false');
    check(lang + ': visible failure text is real Promise error', p.get('ml-results').textContent.includes('controlled lint rejection'));
    p.input(''); p.advance(300); eq(lang + ': empty input returns to full input state', p.get('ml-results').getAttribute('data-empty'), 'true');
    const longText = '# Long results\n\n' + Array.from({ length: 200 }, (_, i) => 'https://example.com/' + i).join('\n') + '\n';
    p.input(longText); p.advance(300); const actual = await p.release();
    eq(lang + ': long actual Markdown fixture has200 issues', actual.content.length, 200);
    eq(lang + ': all long issue rows are rendered', p.get('ml-results').querySelectorAll('.ml-issue').length, 200);
    p.get('ml-copy').click();
    eq(lang + ': long copy retains all actual result bytes', p.clipboard.at(-1).value, actual.content.map(i => `${entry.line} ${i.lineNumber} [${i.ruleNames[0]}] ${i.ruleDescription}${i.errorDetail ? ' — ' + i.errorDetail : ''}${i.errorContext ? ' [' + i.errorContext + ']' : ''}`).join('\n'));
    p.clipboard.at(-1).resolve(); await settle();
    p.key('l', {}, p.get('ml-results'));
    eq(lang + ': output-region CtrlL keeps clear semantics', clearState(p), true);
    eq(lang + ': output-region CtrlL returns focus', p.doc.activeElement === p.get('ml-editor'), true);
    for (const order of ['shared-before','shared-after']) {
      const q = pageVM(lang, order); await q.release(); const sample = q.get('ml-editor').value;
      const tip = q.doc.querySelector('[data-zt-tip="ml-tip-results"]');
      check(lang + '/' + order + ': real result-tip button present', tip);
      tip.focus(); q.get('ml-results').setAttribute('data-empty', 'true');
      eq(lang + '/' + order + ': positive hiding focused heading loses focus', q.doc.activeElement === q.doc.body, true);
      q.input(sample); q.advance(300); await q.release();
      q.key('l', {}, tip);
      eq(lang + '/' + order + ': result-tip CtrlL clears page', clearState(q), true);
      eq(lang + '/' + order + ': clear focuses editor before hidden heading', q.doc.activeElement === q.get('ml-editor'), true);
      eq(lang + '/' + order + ': real shared handler clears persistence', q.clears, ['markdown-linter']);
    }
  }
  const require = createRequire(import.meta.url);
  const { transform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const { transform: parseJs } = await import('esbuild');
  const compiled = await transform(source, { filename: 'MarkdownLinterTool.astro' });
  eq('Astro compilation has no errors', compiled.diagnostics.filter(d => d.severity === 1).length, 0);
  await parseJs(compiled.code, { loader: 'ts', format: 'esm' });
  check('compiled client receives CLIENT_T only', compiled.code.includes('$$defineScriptVars({ t: CLIENT_T })'));
  const compiledCSS = compiled.css.join('\n');
  check('compiled dynamic selectors resolve global syntax', !compiledCSS.includes(':global(') && /\.ml-wrap[^{}]* \.ml-issue\s*\{/.test(compiledCSS) && /\.ml-wrap[^{}]* \.ml-desc\s*\{/.test(compiledCSS));
  check('compiled empty selector targets real result state', /\.ml-wrap[^{}]*:has\(#ml-results[^)]*\[data-empty="true"\][^)]*\)/.test(compiledCSS));
  console.log('v2 page layout: ' + (passes - beforePasses) + ' passed, ' + (failures - beforeFailures) + ' failed');
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
