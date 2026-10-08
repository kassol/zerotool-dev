// Timestamp Converter — reading a timestamp in seconds, milliseconds, microseconds or nanoseconds
//
// Read:  src/components/tools/TimestampConverterTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the 4-language STRINGS),
//        src/content/tools/timestamp-converter/{en,zh,ja,ko}.mdx
//        src/layouts/ToolLayout.astro (the exact shared shortcut handler)
//        src/data/tool-layouts.ts (compact registration and four MDX content protection)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: automatic unit by the number of integer digits (≤ 12 seconds, 13–15 milliseconds, 16–18
// microseconds, ≥ 19 nanoseconds; decimals no longer count as digits — `1712160000.123` used to be
// read as milliseconds); a chosen unit overrides it, so a 13-digit seconds value (after year 33658)
// can be read; nanosecond values beyond 2^53 keep their millisecond part (BigInt); negative values
// and fractions round like Date (toward zero); invalid text and out-of-range values; the examples
// on the English page; 4-language STRINGS share the same keys.
//
// Run: node scripts/test-timestamp-converter.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TimestampConverterTool.astro'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in TimestampConverterTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { readTimestamp };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  if (a === x) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + x + '\n  actual   ' + a);
}
const iso = (raw, unit = 'auto') => {
  const r = E.readTimestamp(raw, unit);
  return r.error ? r.error : [new Date(r.ms).toISOString(), r.unit];
};

// ---------- automatic unit ----------
eq('10 digits: seconds', iso('1700000000'), ['2023-11-14T22:13:20.000Z', 's']);
eq('13 digits: milliseconds', iso('1700000000123'), ['2023-11-14T22:13:20.123Z', 'ms']);
eq('16 digits: microseconds', iso('1700000000123456'), ['2023-11-14T22:13:20.123Z', 'us']);
eq('19 digits: nanoseconds', iso('1700000000123456789'), ['2023-11-14T22:13:20.123Z', 'ns']);
eq('12 digits: seconds', iso('100000000000'), ['5138-11-16T09:46:40.000Z', 's']);
eq('decimals do not count as digits', iso('1712160000.123'), ['2024-04-03T16:00:00.123Z', 's']);
eq('zero', iso('0'), ['1970-01-01T00:00:00.000Z', 's']);
eq('negative seconds', iso('-1'), ['1969-12-31T23:59:59.000Z', 's']);
eq('negative fraction rounds toward zero like Date', iso('-1.5'), ['1969-12-31T23:59:58.500Z', 's']);
eq('plus sign and spaces', iso('  +1700000000 '), ['2023-11-14T22:13:20.000Z', 's']);
eq('leading zeros count as digits', iso('0001700000000'), ['1970-01-20T16:13:20.000Z', 'ms']);

// ---------- chosen unit ----------
eq('13-digit seconds when s is chosen', iso('1000000000000', 's'), ['+033658-09-27T01:46:40.000Z', 's']);
eq('ms chosen for 10 digits', iso('1700000000', 'ms'), ['1970-01-20T16:13:20.000Z', 'ms']);
eq('max date in ms', iso('8640000000000000', 'ms'), ['+275760-09-13T00:00:00.000Z', 'ms']);
eq('one more ms is out of range', iso('8640000000000001', 'ms'), 'range');
eq('ns beyond 2^53 keeps the ms part', iso('9007199254740993123', 'ns'), [new Date(9007199254740).toISOString(), 'ns']);
eq('µs negative', iso('-1500', 'us'), ['1969-12-31T23:59:59.999Z', 'us']);

// ---------- errors ----------
for (const bad of ['', 'abc', '1e10', '0x10', '1.2.3', '12 34', '١٢٣']) eq('invalid ' + JSON.stringify(bad), E.readTimestamp(bad, 'auto').error, bad.trim() === '' ? 'empty' : 'num');
eq('too many seconds', E.readTimestamp('9999999999999999', 's').error, 'range');

// ---------- page ----------
const page = readFileSync(join(root, 'src/content/tools/timestamp-converter/en.mdx'), 'utf8');
eq('page no longer lists microseconds as unsupported', page.includes('Microsecond and nanosecond timestamps are not recognized'), false);
eq('page no longer says 13-digit seconds are always milliseconds', page.includes('**Seconds with 13 digits.**'), false);

// ---------- strings ----------
const block = /const STRINGS = (\{[\s\S]*?\n\});/.exec(source);
const STRINGS = new Function('return ' + block[1])();
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' keys', Object.keys(STRINGS[lang]).sort(), Object.keys(STRINGS.en).sort());
for (const k of ['unit', 'unitAuto', 'unitS', 'unitMs', 'unitUs', 'unitNs', 'readAs']) eq('en has ' + k, k in STRINGS.en, true);

// Complete page lifecycle. Only DOM/clipboard/timers are boundary doubles.
const lifecycleScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const lifecycleStrings = STRINGS;
const clientFor = lang => vm.runInNewContext(source.slice(source.indexOf('const T = STRINGS[lang];'), source.indexOf('\n---', 4)) + '\nCLIENT_T;', { STRINGS: lifecycleStrings, lang });
const lifecycleMarkup = source.replace(/^---[\s\S]*?---\s*/, '').split('<style>')[0].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const lifecycleLayout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const lifecycleShortcut = lifecycleLayout.slice(lifecycleLayout.indexOf('// ── Keyboard shortcuts:'), lifecycleLayout.indexOf('// ── Copy button visual feedback'));
if (!lifecycleShortcut.includes("document.addEventListener('keydown'")) throw Error('Actual shared shortcut missing');
const must = (ok, name) => { if (!ok) throw Error('Harness prerequisite: ' + name); };
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const captureUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', captureUnhandled);
function lifecyclePage(lang = 'en', shellFirst = false) {
  let doc;
  const clipboard = [], tracks = [], timers = new Map();
  let timerId = 0;
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  function descendants(el) { return el.children.flatMap(c => [c, ...descendants(c)]); }
  function oneMatches(el, selector) {
    if (el.tagName === '#TEXT') return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!oneMatches(el, parts.pop())) return false;
      let parent = el.parentNode;
      while (parent) { if (oneMatches(parent, parts.join(' '))) return true; parent = parent.parentNode; }
      return false;
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0];
    const id = /#([\w-]+)/.exec(plain)?.[1];
    const classes = [...plain.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id) && classes.every(c => el.classList.contains(c)) && attrs.every(a => a[2] === undefined ? el.getAttribute(a[1]) !== null : el.getAttribute(a[1]) === a[2]);
  }
  const matches = (el, selector) => selector.split(',').some(s => oneMatches(el, s.trim()));
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, value: '', id: '', className: '', style: {}, text: '', htmlWrites: 0, appendWrites: 0 }); }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'value', 'type'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); }
    getAttribute(k) { return k === 'id' ? this.id || null : k === 'class' ? this.className || null : this.attributes[k] ?? null; }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); } }; }
    get parentElement() { return this.parentNode; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.detachChildren(); this.text = String(v); }
    detachChildren() { for (const c of this.children) c.parentNode = null; this.children = []; this.text = ''; }
    set innerHTML(v) { this.htmlWrites++; this.detachChildren(); parse(String(v), this); }
    appendChild(child) { this.appendWrites++; this.children.push(child); child.parentNode = this; return child; }
    querySelectorAll(s) { return descendants(this).filter(el => matches(el, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    closest(s) { let el = this; while (el) { if (matches(el, s)) return el; el = el.parentNode; } return null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type, extra = {}) {
      const e = { type, target: this, defaultPrevented: false, bubbles: true, ...extra, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
      let target = this;
      while (target) { e.currentTarget = target; for (const listener of target.listeners[type] || []) listener.call(target, e); if (e.stopped || !e.bubbles) break; target = target.parentNode; }
      return e;
    }
    click() { if (!this.disabled) return this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  function parse(html, parent) {
    const stack = [parent];
    for (const token of html.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
      const s = token[0];
      if (s.startsWith('</')) { must(stack.length > 1, 'balanced markup'); stack.pop(); continue; }
      if (s.startsWith('<')) {
        const tag = /^<([\w-]+)/.exec(s)[1];
        const el = new Element(tag);
        for (const a of s.matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(a[1], decode(a[2]));
        stack.at(-1).appendChild(el);
        if (!/\/>$/.test(s) && !['input', 'hr', 'br', 'meta', 'link'].includes(tag)) stack.push(el);
      } else { const el = new Element('#text'); el.text = decode(s); stack.at(-1).appendChild(el); }
    }
    must(stack.length === 1, 'complete parsed markup');
  }
  doc = new Element('#document');
  doc.documentElement = new Element('html'); doc.documentElement.lang = lang; doc.appendChild(doc.documentElement);
  doc.body = new Element('body'); doc.documentElement.appendChild(doc.body);
  const widget = new Element('section'); widget.className = 'tool-widget'; doc.body.appendChild(widget); const text = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const markup = lifecycleMarkup.replace(/<Toggletip\b[^>]*>[\s\S]*?<\/Toggletip>/g, '').replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + text(lifecycleStrings[lang][key]) + '"').replace(/\{T\.(\w+)\}/g, (_, key) => text(lifecycleStrings[lang][key]));
  parse(markup, widget);
  // Deliberately no ID map: duplicate IDs resolve to the first connected element in DOM order.
  doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
  doc.createElement = tag => new Element(tag);
  for (const select of doc.querySelectorAll('select')) select.value = select.querySelector('option').value;
  doc.activeElement = doc.body;
  const sandbox = {
    document: doc, console, t: clientFor(lang), _slug: 'timestamp-converter', ztPersist: { clear() {} },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); clipboard.push({ value, resolve, reject }); return promise; } } },
    trackTool: (...args) => tracks.push(args),
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  if (shellFirst) vm.runInContext(lifecycleShortcut, context);
  vm.runInContext(lifecycleScript, context, { filename: 'TimestampConverterTool.astro' });
  if (!shellFirst) vm.runInContext(lifecycleShortcut, context);
  const get = id => { const el = doc.getElementById(id); must(el, 'real DOM ID ' + id); return el; };
  return {
    get, doc, widget, clipboard, tracks, timers,
    input(id, value, event = 'input') { get(id).value = value; get(id).dispatch(event); },
    key(id, key = 'l', modifier = 'ctrlKey') { const el = id ? get(id) : doc.body; el.focus(); return el.dispatch('keydown', { key, ...(modifier ? { [modifier]: true } : {}) }); },
    flushTimers() { for (let i = 0; i < 5 && timers.size; i++) { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(j => j.fn()); } },
  };
}

const languageText = { en: ['Copy', 'Copied!', 'Copy failed. Please copy the value manually.'], zh: ['复制', '已复制！', '复制失败，请手动复制数值。'], ja: ['コピー', 'コピー済み！', 'コピーに失敗しました。値を手動でコピーしてください。'], ko: ['복사', '복사됨!', '복사하지 못했습니다. 값을 직접 복사하세요.'] };
const upper = 'tc-ts-results', lower = 'tc-date-results';
const rows = (p, id) => p.get(id).querySelectorAll('.tc-row').map(r => r.querySelector('.tc-value').textContent);
function timestampSnapshot(p) {
  return { input: p.get('tc-ts-input').value, date: p.get('tc-date-input').value, unit: p.get('tc-unit').value, upper: rows(p, upper), lower: rows(p, lower), status: ['tc-ts-status', 'tc-date-status'].map(id => [p.get(id).textContent, p.get(id).className]), buttons: p.widget.querySelectorAll('.btn-copy').map(b => b.textContent) };
}
const emptyTimestamp = p => { const s = timestampSnapshot(p); return !s.input && !s.date && !s.upper.length && !s.lower.length && s.status.every(([text, cls]) => !text && cls === 'tc-status'); };
const convertTimestamp = (p, value = '0') => { p.input('tc-ts-input', value); p.get('tc-ts-convert').click(); };
const convertDate = (p, value = '2000-01-01T00:00:00') => p.input('tc-date-input', value, 'change');
function timestampCopy(p, id, index = 0) { const button = p.get(id).querySelectorAll('.btn-copy')[index]; button.click(); return { button, job: p.clipboard.at(-1) }; }
const originalTimezone = process.env.TZ;
try {
  for (const timezone of ['UTC', 'Asia/Singapore']) {
    process.env.TZ = timezone;
    const expectedUpper = ['0', '0', '1970-01-01T00:00:00.000Z', 'Thu, 01 Jan 1970 00:00:00 GMT', timezone === 'UTC' ? '1970-01-01 00:00:00' : '1970-01-01 07:30:00'];
    const expectedLower = timezone === 'UTC'
      ? ['946684800', '946684800000', '2000-01-01T00:00:00.000Z', 'Sat, 01 Jan 2000 00:00:00 GMT', '2000-01-01 00:00:00']
      : ['946656000', '946656000000', '1999-12-31T16:00:00.000Z', 'Fri, 31 Dec 1999 16:00:00 GMT', '2000-01-01 00:00:00'];
    for (const lang of Object.keys(languageText)) {
      const [copyLabel, copiedLabel, copyError] = languageText[lang], prefix = timezone + '/' + lang + ': ';
      for (const order of ['timestamp-first', 'date-first']) {
        const p = lifecyclePage(lang);
        if (order === 'timestamp-first') { convertTimestamp(p); convertDate(p); } else { convertDate(p); convertTimestamp(p); }
        eq(prefix + order + ' timestamp uses the known epoch in this timezone', rows(p, upper), expectedUpper);
        eq(prefix + order + ' datetime change uses the known local date', rows(p, lower), expectedLower);
        const ids = p.doc.querySelectorAll('.tc-value').map(el => el.id).filter(Boolean);
        eq(prefix + order + ' result IDs do not collide', ids.length, new Set(ids).size);
        for (const [id, expected] of [[upper, expectedUpper], [lower, expectedLower]]) for (let i = 0; i < 5; i++) {
          const { button, job } = timestampCopy(p, id, i); job.resolve(); await settle();
          eq(prefix + order + ' copies the displayed value from its own row ' + id + '/' + i, job.value, expected[i]);
          eq(prefix + order + ' copy displays localized success ' + id + '/' + i, button.textContent, copiedLabel);
          p.flushTimers(); eq(prefix + order + ' copy timer resets its own label ' + id + '/' + i, button.textContent, copyLabel);
        }
      }
      for (const shellFirst of [false, true]) for (const modifier of [null, 'ctrlKey', 'metaKey']) {
        const p = lifecyclePage(lang, shellFirst); p.input('tc-ts-input', '1700000000');
        const before = p.get(upper).htmlWrites; p.key('tc-ts-input', 'Enter', modifier);
        eq(prefix + 'Enter performs one DOM render ' + shellFirst + '/' + modifier, p.get(upper).htmlWrites - before, 1);
        eq(prefix + 'Enter keeps the actual timestamp value ' + shellFirst + '/' + modifier, rows(p, upper)[2], '2023-11-14T22:13:20.000Z');
        eq(prefix + 'shared primary action tracks once ' + shellFirst + '/' + modifier, p.tracks.length, modifier ? 1 : 0);
      }
      for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
        const p = lifecyclePage(lang, shellFirst); p.input('tc-unit', 'ms', 'change'); convertTimestamp(p); convertDate(p);
        const event = p.key('tc-date-input', 'L', modifier); p.flushTimers();
        eq(prefix + 'shortcut fully clears both directions ' + shellFirst + '/' + modifier, [event.defaultPrevented, emptyTimestamp(p), p.get('tc-unit').value], [true, true, 'ms']);
        convertTimestamp(p, 'not-a-timestamp'); convertDate(p, 'bad-date');
        eq(prefix + 'both invalid inputs enter error paths ' + modifier, [p.get('tc-ts-status').className, p.get('tc-date-status').className], ['tc-status error', 'tc-status error']);
        p.key('tc-ts-input', 'l', modifier); p.flushTimers(); eq(prefix + 'shortcut removes both old errors ' + shellFirst + '/' + modifier, emptyTimestamp(p), true);
        convertTimestamp(p, '1700000000123'); eq(prefix + 'conversion recovers with selected ms after shortcut ' + modifier, rows(p, upper)[2], '2023-11-14T22:13:20.123Z');
      }
      const outside = lifecyclePage(lang); convertTimestamp(outside); convertDate(outside); const beforeOutside = timestampSnapshot(outside); outside.key(null); outside.flushTimers(); eq(prefix + 'shortcut outside tool preserves state', timestampSnapshot(outside), beforeOutside);
      convertTimestamp(outside, ''); convertDate(outside, ''); eq(prefix + 'explicit empty conversion still clears both outputs', emptyTimestamp(outside), true);
      for (const id of [upper, lower]) {
        const p = lifecyclePage(lang); convertTimestamp(p); convertDate(p); const { job } = timestampCopy(p, id); job.reject(Error('current timestamp copy')); await settle();
        const status = p.get(id === upper ? 'tc-ts-status' : 'tc-date-status'); eq(prefix + 'current copy failure is localized in its own section ' + id, [status.textContent, status.className], [copyError, 'tc-status error']);
        eq(prefix + 'current copy failure retains actual output ' + id, rows(p, id), id === upper ? expectedUpper : expectedLower);
        const retry = timestampCopy(p, id); retry.job.resolve(); await settle();
        eq(prefix + 'successful retry clears the owned copy failure ' + id, [status.textContent, status.className], ['', 'tc-status']);
        const late = timestampCopy(p, id); if (id === upper) convertTimestamp(p, 'bad'); else convertDate(p, 'bad'); const validationState = timestampSnapshot(p); late.job.resolve(); await settle();
        eq(prefix + 'late successful retry preserves a newer conversion error ' + id, timestampSnapshot(p), validationState);
        convertTimestamp(p); convertDate(p); const failedAgain = timestampCopy(p, id); failedAgain.job.reject(Error('first failure')); await settle();
        const olderRetry = timestampCopy(p, id), newerFailure = timestampCopy(p, id, 1); newerFailure.job.reject(Error('newer failure')); await settle(); olderRetry.job.resolve(); await settle();
        eq(prefix + 'successful older retry preserves newer row copy failure ' + id, [status.textContent, status.className], [copyError, 'tc-status error']);
        const finalRetry = timestampCopy(p, id, 1); finalRetry.job.resolve(); await settle();
        eq(prefix + 'next successful retry clears current row copy failure ' + id, [status.textContent, status.className], ['', 'tc-status']);
        const ownFailure = timestampCopy(p, id); ownFailure.job.reject(Error('own failure')); await settle(); const ownRetry = timestampCopy(p, id);
        const otherId = id === upper ? lower : upper, otherStatus = p.get(id === upper ? 'tc-date-status' : 'tc-ts-status'); const otherFailure = timestampCopy(p, otherId); otherFailure.job.reject(Error('other section failure')); await settle(); ownRetry.job.resolve(); await settle();
        eq(prefix + 'successful retry only clears its own section error ' + id, [status.textContent, status.className, otherStatus.textContent, otherStatus.className], ['', 'tc-status', copyError, 'tc-status error']);

      }
      for (const id of [upper, lower]) for (const action of ['CtrlL', 'MetaL', 'timestamp edit', 'empty edit', 'date edit', 'date change', 'unit change', 'new conversion', 'empty conversion']) for (const outcome of ['resolve', 'reject', 'timer']) {
        const p = lifecyclePage(lang); convertTimestamp(p); convertDate(p); const { button, job } = timestampCopy(p, id);
        if (outcome === 'timer') { job.resolve(); await settle(); }
        if (action === 'CtrlL' || action === 'MetaL') p.key('tc-date-input', 'l', action === 'MetaL' ? 'metaKey' : 'ctrlKey');
        else if (action === 'timestamp edit') p.input('tc-ts-input', '123');
        else if (action === 'empty edit') p.input('tc-ts-input', '');
        else if (action === 'date edit') p.input('tc-date-input', '2024-02-29T12:34:56');
        else if (action === 'date change') convertDate(p, '2024-02-29T12:34:56');
        else if (action === 'unit change') p.input('tc-unit', 'ms', 'change');
        else if (action === 'new conversion') convertTimestamp(p, '1700000000');
        else { convertTimestamp(p, ''); convertDate(p, ''); }
        const state = timestampSnapshot(p), oldButton = button.textContent, errors = unhandled.length;
        if (outcome === 'resolve') job.resolve(); if (outcome === 'reject') job.reject(Error('stale timestamp copy'));
        await settle(); p.flushTimers(); await settle();
        eq(prefix + 'late copy ' + outcome + ' does not write after ' + action + '/' + id, [timestampSnapshot(p), button.textContent, unhandled.length], [state, oldButton, errors]);
        eq(prefix + 'old feedback resets on ' + action + '/' + outcome + '/' + id, oldButton, copyLabel);
      }
      const q = lifecyclePage(lang); convertTimestamp(q); const first = timestampCopy(q, upper), latest = timestampCopy(q, upper); latest.job.resolve(); await settle(); const status = q.get('tc-ts-status').textContent; first.job.reject(Error('superseded timestamp copy')); await settle();
      eq(prefix + 'superseded copy cannot replace current feedback/status', [q.get('tc-ts-status').textContent, latest.button.textContent], [status, copiedLabel]);
      q.flushTimers(); eq(prefix + 'latest copy timer restores base label', latest.button.textContent, copyLabel);
    }
  }
  await settle(); eq('all timestamp copy rejection promises are handled', unhandled, []);
} finally {
  if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone;
  process.off('unhandledRejection', captureUnhandled);
}

// ---------- v2 page layout ----------
{
  const beforePasses = passes, beforeFailures = failures;
  const check = (name, actual) => eq(name, !!actual, true);
  const template = source.slice(source.indexOf('\n---\n') + 5, source.indexOf('<script')).trim();
  const css = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'));
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  const sha = value => createHash('sha256').update(value).digest('hex');
  const keys = ['convert', 'date', 'input', 'now', 'unit'];
  check('timestamp-converter is registered as compact', /'timestamp-converter':\s*'compact'/.test(layouts));
  check('root is a natural-height shrinkable column', template.startsWith('<div class="tc-wrap">') && /\.tc-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0/.test(css) && !/\b(?:height|min-height):[^;]*(?:vh|svh)/.test(css));
  check('timestamp buttons precede status, input and results', template.indexOf('id="tc-ts-convert"') < template.indexOf('id="tc-ts-status"') && template.indexOf('id="tc-ts-status"') < template.indexOf('id="tc-ts-input"') && template.indexOf('id="tc-ts-input"') < template.indexOf('id="tc-ts-results"'));
  check('date status precedes input and results', template.indexOf('id="tc-date-status"') < template.indexOf('id="tc-date-input"') && template.indexOf('id="tc-date-input"') < template.indexOf('id="tc-date-results"'));
  check('two directions have fixed scrolling status areas', /\.tc-wrap \.tc-status\s*\{[^}]*height: 3em;[^}]*overflow: auto/.test(css) && /\.tc-wrap \.tc-status\s*\{ height: 4.5em/.test(css));
  check('two columns stack at 860 with phone controls at 640', /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(css) && /@media \(max-width: 860px\)/.test(css) && /@media \(max-width: 640px\)/.test(css) && /\.tc-unit\s*\{ min-height: 44px/.test(css));
  check('long input cannot expand the field', /\.tc-input-row input\s*\{[^}]*width: 100%; min-width: 0/.test(css));
  check('result rows have a fixed height and shrinkable value column', /\.tc-results :global\(\.tc-row\)\s*\{[^}]*grid-template-columns: 6.5rem minmax\(0, 1fr\) auto;[^}]*height: 3.5rem/.test(css));
  check('long result values scroll without wrapping or clipping the page', /\.tc-results :global\(\.tc-value\)\s*\{[^}]*min-width: 0; height: 3rem;[^}]*overflow-x: auto; overflow-y: hidden; white-space: pre/.test(css) && !/word-break: break-all|text-overflow: ellipsis/.test(css));
  check('dynamic result values are keyboard scrollable and named', lifecycleScript.includes('<code class="tc-value" tabindex="0" aria-label="') && /:global\(\.tc-value\)/.test(css));
  check('only redundant Date Convert is removed', !source.includes('tc-date-convert') && template.includes('id="tc-ts-convert"') && template.includes('id="tc-ts-now"') && lifecycleScript.includes("dateInput.addEventListener('change', convertDate)"));
  check('hidden states retain display precedence', /\.tc-wrap \[hidden\]\s*\{ display: none !important/.test(css));
  const tips = [...template.matchAll(/<Toggletip\b([^>]*)>([\s\S]*?)<\/Toggletip>/g)];
  check('five tips have stable unique IDs', JSON.stringify(tips.map(m => /id="tc-tip-([^"]+)"/.exec(m[1])?.[1]).sort()) === JSON.stringify(keys));
  check('tips are outside labels and summaries', !/<(?:label|summary)\b[^>]*>(?:(?!<\/(?:label|summary)>)[\s\S])*?<Toggletip/.test(template));
  for (const tip of tips) check('tip uses build-time language and matching content', /lang=\{lang\}/.test(tip[1]) && /about=\{T\.\w+\}/.test(tip[1]) && tip[2] === '{TIPS.' + /id="tc-tip-([^"]+)"/.exec(tip[1])[1] + '}');
  check('runtime i18n removed and only client strings serialized', /define:vars=\{\{ t: CLIENT_T \}\}/.test(source) && !/data-i18n|STRINGS|TIPS/.test(lifecycleScript));
  const engine = source.match(/^      \/\* ── engine:start ── \*\/[\s\S]*?^      \/\* ── engine:end ── \*\//m)[0];
  check('exact engine bytes protected', sha(engine) === '478ed4b2739a9d8a0ddb6b24247629961e1988e624e7446675df6680c40f628e');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const entry = lifecycleStrings[lang], client = clientFor(lang);
    check(lang + ' all four languages share string keys', JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(Object.keys(lifecycleStrings.en).sort()));
    check(lang + ' tip keys match all actual controls', JSON.stringify(Object.keys(entry.tips).sort()) === JSON.stringify(keys));
    for (const key of keys) check(lang + '/' + key + ' tip is plain nonempty text', typeof entry.tips[key] === 'string' && !!entry.tips[key].trim() && !/<[^>]*>|\n/.test(entry.tips[key]));
    check(lang + ' client excludes tips and their text', !('tips' in client) && Object.values(entry.tips).every(tip => !JSON.stringify(client).includes(JSON.stringify(tip))));
    const mdx = readFileSync(join(root, 'src/content/tools/timestamp-converter', lang + '.mdx'), 'utf8');
    const [, meta, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(mdx), { steps } = loadYaml(meta);
    check(lang + ' five plain steps remain within llms limits', steps.length === 5 && steps.every(step => typeof step === 'string' && step.length <= 280 && !/<[^>]*>/.test(step)) && steps.join('').length <= 1200);
    for (const key of ['copy', 'convert', 'now', 'timestamp', 'dateTime']) check(lang + ' steps use the actual ' + key + ' label', steps.some(step => step.includes(entry[key])));
    check(lang + ' Usage removed, Limits retained', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body) && /^## (?:Limits|限制|制限事項|제한 사항)/m.test(body));
    check(lang + ' MDX content contract', !contractProblems('timestamp-converter', lang), contractProblems('timestamp-converter', lang));
  }
  const require = createRequire(import.meta.url);
  const { transform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const { transform: parseJs } = await import('esbuild');
  const compiled = await transform(source, { filename: 'TimestampConverterTool.astro' });
  check('Astro reports no compilation error', compiled.diagnostics.filter(d => d.severity === 1).length === 0);
  await parseJs(compiled.code, { loader: 'ts', format: 'esm' });
  check('generated JavaScript parses and serializes CLIENT_T', compiled.code.includes('$$defineScriptVars({ t: CLIENT_T })'));
  console.log('v2 page layout: ' + (passes - beforePasses) + ' passed, ' + (failures - beforeFailures) + ' failed');
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
