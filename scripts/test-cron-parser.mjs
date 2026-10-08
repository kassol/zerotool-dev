// Cron Parser — field parsing, unsupported-syntax errors and next-run regression test
//
// Read:  src/components/tools/CronParserTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
//        src/layouts/ToolLayout.astro, src/data/tool-layouts.ts and the four cron-parser MDX files
//        (real shortcut, v2 registration and protected content).
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: parseCron on standard 5-field syntax (*, lists, ranges, steps, month and weekday
// names, 7 = Sunday); Quartz-style extensions (#, L, W, ?) give an "unsupported" error that
// names the token and the field instead of being read as a plain number; malformed numbers
// (1.5, 5abc, 1-2-3, monday) are invalid; out-of-range values; nextRuns from a fixed start;
// day of month OR day of week when both are restricted (cronie / POSIX, sources at that section),
// a field starting with * counts as unrestricted, month always ANDed; runs years ahead (Jan 1st,
// Feb 29 across 2100, Feb 30 never) within a time limit; non-existent DST times skipped; a step
// after a single number (5/10) is an error; 4-language STRINGS have the same keys; the English
// guide (src/content/blog/cron-parser-guide/en.mdx): the examples table (description and next three
// runs from 2026-10-01 08:00 local), the */35 runs, the quoted error messages and the DST example.
//
// Run: node scripts/test-cron-parser.mjs

process.env.TZ = 'America/New_York'; // fixed zone: run times are local, and one case needs a DST gap

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { contractProblems } from './lib/tool-mdx-contract.mjs';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CronParserTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CronParserTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseCron, parseField, nextRuns, humanizeCron, WDAY_ABBR };')();

let failures = 0;
let passes = 0;
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

// ---------- the reported defect: 1#2 must not become 1 ----------
eq('parseField 1#2 is not read as 1', E.parseField('1#2', 0, 7, E.WDAY_ABBR, 0), null);
eq('parseCron 1#2 → unsupported, names token and weekday field',
  E.parseCron('0 10 * * 1#2').error, { code: 'unsupported', token: '1#2', field: 4 });

// ---------- other Quartz-style extensions ----------
eq('L in day of month', E.parseCron('0 0 L * *').error, { code: 'unsupported', token: 'L', field: 2 });
eq('W in day of month', E.parseCron('0 0 15W * *').error, { code: 'unsupported', token: '15W', field: 2 });
eq('LW in day of month', E.parseCron('0 0 LW * *').error, { code: 'unsupported', token: 'LW', field: 2 });
eq('5L in weekday', E.parseCron('0 0 * * 5L').error, { code: 'unsupported', token: '5L', field: 4 });
eq('? in weekday', E.parseCron('0 0 1 * ?').error, { code: 'unsupported', token: '?', field: 4 });
eq('lowercase l in weekday', E.parseCron('0 0 * * 5l').error, { code: 'unsupported', token: '5l', field: 4 });
eq('# inside a list', E.parseCron('0 0 * * 1,3#1').error, { code: 'unsupported', token: '3#1', field: 4 });
eq('L in minute field', E.parseCron('L * * * *').error, { code: 'unsupported', token: 'L', field: 0 });

// ---------- malformed numbers: no silent truncation ----------
eq('1.5 invalid', E.parseCron('1.5 * * * *').error, { code: 'invalid', field: 0 });
eq('5abc invalid', E.parseCron('5abc * * * *').error, { code: 'invalid', field: 0 });
eq('1-2-3 invalid', E.parseCron('1-2-3 * * * *').error, { code: 'invalid', field: 0 });
eq('monday invalid', E.parseCron('0 0 * * monday').error, { code: 'invalid', field: 4 });
eq('*/5x invalid', E.parseCron('*/5x * * * *').error, { code: 'invalid', field: 0 });
eq('empty list item invalid', E.parseCron('1,,2 * * * *').error, { code: 'invalid', field: 0 });
eq('60 minute out of range', E.parseCron('60 * * * *').error, { code: 'invalid', field: 0 });
eq('day 0 out of range', E.parseCron('0 0 0 * *').error, { code: 'invalid', field: 2 });
eq('reversed range invalid', E.parseCron('0 0 * * 5-1').error, { code: 'invalid', field: 4 });
eq('step 0 invalid', E.parseCron('*/0 * * * *').error, { code: 'invalid', field: 0 });

// ---------- empty and field count ----------
eq('empty', E.parseCron('   ').error, { code: 'empty' });
eq('4 fields', E.parseCron('0 0 * *').error, { code: 'fields', n: 4 });
eq('6 fields', E.parseCron('0 0 0 * * *').error, { code: 'fields', n: 6 });

// ---------- standard syntax still parses ----------
function values(expr) { const r = E.parseCron(expr); return r.error ? r.error : r.values; }
eq('weekdays 9am', values('0 9 * * 1-5'), [[0], [9], range(1, 31), range(1, 12), [1, 2, 3, 4, 5]]);
eq('*/15 minutes', values('*/15 * * * *')[0], [0, 15, 30, 45]);
eq('range with step', values('10-30/10 * * * *')[0], [10, 20, 30]);
eq('list', values('0 8,12,18 * * *')[1], [8, 12, 18]);
eq('weekday names', values('0 0 * * mon-fri')[4], [1, 2, 3, 4, 5]);
eq('weekday names uppercase', values('0 0 * * MON,WED')[4], [1, 3]);
eq('month names', values('0 0 1 jan,jul *')[3], [1, 7]);
eq('7 is Sunday (kept as 7 in breakdown)', values('0 0 * * 7')[4], [7]);
eq('fields returned', E.parseCron('  0   9 * *   1-5 ').fields, ['0', '9', '*', '*', '1-5']);

// ---------- next runs from a fixed local start ----------
function runs(expr, from, n) {
  return E.nextRuns(E.parseCron(expr).fields, n, from).map((d) =>
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
}
const start = new Date(2026, 8, 29, 10, 30); // Tue 2026-09-29 10:30 local
eq('weekdays 9am next 3', runs('0 9 * * 1-5', start, 3), ['2026-09-30 09:00', '2026-10-01 09:00', '2026-10-02 09:00']);
eq('Sunday via 7', runs('0 0 * * 7', start, 2), ['2026-10-04 00:00', '2026-10-11 00:00']);
eq('every 20 min', runs('*/20 * * * *', start, 3), ['2026-09-29 10:40', '2026-09-29 11:00', '2026-09-29 11:20']);
eq('monthly 1st', runs('0 0 1 * *', start, 2), ['2026-10-01 00:00', '2026-11-01 00:00']);

// ---------- day of month OR day of week ----------
// cronie crontab(5), https://man7.org/linux/man-pages/man5/crontab.5.html : "If both fields are
// restricted (i.e., do not contain the "*" character), the command will be run when either field
// matches the current time. For example, "30 4 1,15 * 5" would cause a command to be run at 4:30 am
// on the 1st and 15th of each month, plus every Friday."
// POSIX crontab, https://pubs.opengroup.org/onlinepubs/9799919799/utilities/crontab.html : "if either
// the month or day of month is specified as an element or list, and the day of week is also
// specified as an element or list, then any day matching either the month and day of month, or
// the day of week, shall be matched."
// Where the two differ we follow cronie's code (src/cron.c, DOM_STAR / DOW_STAR): a field counts as
// unrestricted when it starts with "*" (so "*/2" is unrestricted), and the month field is always
// ANDed. POSIX has no steps, and would also OR a restricted month with a restricted weekday.
eq('0 0 1 * 1: the 1st or any Monday', runs('0 0 1 * 1', start, 5),
  ['2026-10-01 00:00', '2026-10-05 00:00', '2026-10-12 00:00', '2026-10-19 00:00', '2026-10-26 00:00']);
eq('cronie man page example 30 4 1,15 * 5', runs('30 4 1,15 * 5', start, 5),
  ['2026-10-01 04:30', '2026-10-02 04:30', '2026-10-09 04:30', '2026-10-15 04:30', '2026-10-16 04:30']);
eq('*/2 day of month counts as unrestricted: odd days that are Mondays', runs('0 0 */2 * 1', start, 3),
  ['2026-10-05 00:00', '2026-10-19 00:00', '2026-11-09 00:00']);
eq('month is still ANDed: Jan 1st or Mondays in January', runs('0 0 1 1 1', start, 4),
  ['2027-01-01 00:00', '2027-01-04 00:00', '2027-01-11 00:00', '2027-01-18 00:00']);
check('description says "or" when both day fields are restricted', / or on /.test(E.humanizeCron(['0', '0', '1', '*', '1'])), E.humanizeCron(['0', '0', '1', '*', '1']));
check('description says "and" when day of month starts with *', / and on /.test(E.humanizeCron(['0', '0', '*/2', '*', '1'])), E.humanizeCron(['0', '0', '*/2', '*', '1']));

// ---------- next runs far in the future ----------
eq('yearly Jan 1st', runs('0 0 1 1 *', start, 3), ['2027-01-01 00:00', '2028-01-01 00:00', '2029-01-01 00:00']);
eq('yearly Jan 1st, 10 runs', runs('0 0 1 1 *', start, 10).length, 10);
eq('Feb 29 only in leap years', runs('0 0 29 2 *', start, 3), ['2028-02-29 00:00', '2032-02-29 00:00', '2036-02-29 00:00']);
eq('Feb 29 across 2100 (not a leap year)', runs('0 0 29 2 *', new Date(2096, 2, 1), 1), ['2104-02-29 00:00']);
eq('Feb 30 never matches', runs('0 0 30 2 *', start, 3), []);
eq('every minute', runs('* * * * *', start, 3), ['2026-09-29 10:31', '2026-09-29 10:32', '2026-09-29 10:33']);
eq('start is exclusive', runs('30 10 * * *', start, 1), ['2026-09-30 10:30']);
eq('Dec 31 23:59 rolls into next year', runs('59 23 31 12 *', start, 2), ['2026-12-31 23:59', '2027-12-31 23:59']);
let t0 = Date.now();
runs('0 0 29 2 *', start, 10);
runs('0 0 30 2 *', start, 10);
runs('* * * * *', start, 10);
check('10 Feb 29 runs, an impossible date and every minute take < 500 ms', Date.now() - t0 < 500 * PERF_SLACK, (Date.now() - t0) + ' ms');
// America/New_York (set at the top): 2027-03-14 02:30 does not exist, cronie never matches it
eq('non-existent DST time is skipped', runs('30 2 * * *', new Date(2027, 2, 13, 0, 0), 2), ['2027-03-13 02:30', '2027-03-15 02:30']);

// ---------- steps need * or a range ----------
// cronie crontab(5): "Step values can be used in conjunction with ranges ... Step values are also
// permitted after an asterisk". cronie's parser (src/entry.c get_range, state R_NUM1) rejects "/"
// after a single number, so "5/10" is an error there too.
eq('5/10 is an error', E.parseCron('5/10 * * * *').error, { code: 'step', token: '5/10', field: 0 });
eq('mon/2 is an error', E.parseCron('0 0 * * mon/2').error, { code: 'step', token: 'mon/2', field: 4 });
eq('5/10 inside a list', E.parseCron('0 1,5/10 * * *').error, { code: 'step', token: '5/10', field: 1 });
eq('5-59/10 works', values('5-59/10 * * * *')[0], [5, 15, 25, 35, 45, 55]);
eq('*/10 works', values('*/10 * * * *')[0], [0, 10, 20, 30, 40, 50]);

// ---------- 4-language STRINGS have the same keys ----------
const stringsMatch = source.match(/const STRINGS = (\{[\s\S]*?\n\});\n\/\/ strings:end/);
check('STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const S = new Function('return ' + stringsMatch[1])();
  const enKeys = Object.keys(S.en).sort().join(',');
  for (const lang of ['zh', 'ja', 'ko']) eq('STRINGS ' + lang + ' keys match en', Object.keys(S[lang]).sort().join(','), enKeys);
  for (const key of ['errUnsupported', 'errStep']) {
    for (const lang of ['en', 'zh', 'ja', 'ko']) check(key + ' ' + lang + ' has {token} and {field}', /\{token\}/.test(S[lang][key] || '') && /\{field\}/.test(S[lang][key] || ''));
  }
}

// ---------- en tool page: Examples table ----------
{
  const from = new Date(2026, 9, 1, 8, 0); // 2026-10-01 08:00 local
  const page = [
    ['0 9 * * 1-5', 'At 9:00, on mon through fri', ['2026-10-01 09:00', '2026-10-02 09:00', '2026-10-05 09:00']],
    ['*/15 9-17 * * mon-fri', 'At every 15 minutes past 9 through 17, on mon, tue, wed, thu, fri', ['2026-10-01 09:00', '2026-10-01 09:15', '2026-10-01 09:30']],
    ['30 2 1,15 * *', 'At 2:30, on day 1, 15 of the month', ['2026-10-15 02:30', '2026-11-01 02:30', '2026-11-15 02:30']],
    ['0 0 1 * 1', 'At midnight, on day 1 of the month or on mon', ['2026-10-05 00:00', '2026-10-12 00:00', '2026-10-19 00:00']],
    ['0 0 29 2 *', 'At midnight, on day 29 of the month, in feb', ['2028-02-29 00:00', '2032-02-29 00:00', '2036-02-29 00:00']],
  ];
  for (const [expr, desc, first] of page) {
    eq('page description ' + expr, E.humanizeCron(E.parseCron(expr).fields), desc);
    eq('page first runs ' + expr, runs(expr, from, 3), first);
  }
  const day = runs('*/15 9-17 * * mon-fri', from, 36);
  eq('page: last run of the day is 17:45', day[35], '2026-10-01 17:45');
  eq('description pads minutes', E.humanizeCron(['5', '4', '*', '*', 'sun']), 'At 4:05, on sun');
  eq('description for */2 day of month', E.humanizeCron(['0', '0', '*/2', '*', '*']), 'At midnight, on every 2 days of the month');
  eq('page error: six fields', E.parseCron('0 0 * * * *').error, { code: 'fields', n: 6 });
  eq('page error: @daily is one field', E.parseCron('@daily').error, { code: 'fields', n: 1 });
  eq('page error: hour 24', E.parseCron('0 24 * * *').error, { code: 'invalid', field: 1 });
}

// ---------- en guide ----------
{
  const guide = readFileSync(join(root, 'src/content/blog/cron-parser-guide/en.mdx'), 'utf8');
  const S = new Function('return ' + source.match(/const STRINGS = (\{[\s\S]*?\n\});\n\/\/ strings:end/)[1])().en;
  const from = new Date(2026, 9, 1, 8, 0);
  const table = guide.slice(guide.indexOf('{/* cron-check: examples */}'));
  const rows = [...table.split('\n\n')[0].matchAll(/^\| `([^`]+)` \| (.+?) \| (.+?) \|$/gm)];
  eq('guide examples table has 10 rows', rows.length, 10);
  for (const [, expr, desc, shown] of rows) {
    const parsed = E.parseCron(expr);
    eq('guide description ' + expr, E.humanizeCron(parsed.fields), desc);
    let lastDay = '';
    const text = runs(expr, from, 3).map((r) => {
      const [d, t] = r.split(' ');
      const out = d === lastDay ? t : r;
      lastDay = d;
      return out;
    }).join(', ') || 'none';
    eq('guide runs ' + expr, text, shown);
  }
  const has = (name, text) => check('guide: ' + name, guide.includes(text), text);
  eq('*/35 runs', runs('*/35 * * * *', from, 3), ['2026-10-01 08:35', '2026-10-01 09:00', '2026-10-01 09:35']);
  has('*/35 text', 'as 08:35, 09:00 and 09:35');
  const err = (expr) => {
    const e = E.parseCron(expr).error;
    const names = [S.fMinute, S.fHour, S.fDay, S.fMonth, S.fWeekday];
    if (e.code === 'fields') return S.errFields.replace('{n}', e.n);
    return S[e.code === 'step' ? 'errStep' : 'errUnsupported'].replace('{token}', e.token).replace('{field}', names[e.field]);
  };
  has('5/10 message', '`' + err('5/10 * * * *') + '`');
  has('1#2 message', '`' + err('0 0 * * 1#2').split('. ')[0] + '`');
  has('six fields message', '`' + err('0 0 9 ? * MON-FRI') + '`');
  eq('@daily is one field', E.parseCron('@daily').error, { code: 'fields', n: 1 });
  eq('5-59/10', values('5-59/10 * * * *')[0], [5, 15, 25, 35, 45, 55]);
  eq('guide: */2 day of month and Monday', runs('0 0 */2 * 1', from, 2), ['2026-10-05 00:00', '2026-10-19 00:00']);
  check('guide: 30 4 1,15 * 5 description quoted', guide.includes('"' + E.humanizeCron(E.parseCron('30 4 1,15 * 5').fields) + '"'));
  eq('guide: DST gap 2027-03-14', runs('30 2 * * *', new Date(2027, 2, 13, 0, 0), 2), ['2027-03-13 02:30', '2027-03-15 02:30']);
  has('DST text', 'lists 13 March and then 15 March');
  check('guide: noRuns string starts as quoted', S.noRuns.startsWith('No run time found'));
}

function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }
function pad(n) { return String(n).padStart(2, '0'); }


// ---------- actual page + actual shared shortcuts ----------
// Only DOM/event boundaries are adapted. The complete shipped IIFE and parser run unchanged.
const require = createRequire(join(root, 'package.json'));
const { parseFragment } = require('parse5');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
check('actual shared shortcut found', shortcut.includes("widget.querySelectorAll('textarea"));
const pageScript = source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1];
const markupTemplate = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0];
const astroRequire = createRequire(require.resolve('astro/package.json'));
const compiled = await astroRequire('@astrojs/compiler').transform(source, {
  filename: join(root, 'src/components/tools/CronParserTool.astro'), scopedStyleStrategy: 'attribute',
});
check('component compiles without errors', !compiled.diagnostics.some(d => d.severity === 1));
const css = compiled.css.join('\n');
const scopeAttribute = css.match(/data-astro-cid-[\w-]+/)[0];
const escapeMarkup = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function renderMarkup(lang) {
  const T = new Function('return ' + stringsMatch[1])()[lang];
  return markupTemplate
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g, (_all, id, label, key) =>
      '<span class="zt-tip"><button type="button" data-zt-tip="' + id + '">' + escapeMarkup(T[label]) + '</button><span id="' + id + '" class="zt-tip-pop" hidden>' + escapeMarkup(T.tips[key]) + '</span></span>')
    .replace(/=\{T\.(\w+)\}/g, (_all, key) => '="' + escapeMarkup(T[key]) + '"')
    .replace(/\{T\.(\w+)\}/g, (_all, key) => escapeMarkup(T[key]));
}
function page(lang, order) {
  const tracks = [], persistCalls = [];
  let document;
  const all = el => el.children.flatMap(child => [child, ...all(child)]);
  function match(el, selector) {
    if (el.tagName.startsWith('#')) return false;
    if (selector.includes(',')) return selector.split(',').some(s => match(el, s.trim()));
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!match(el, parts.pop())) return false;
      for (let p = el.parentNode; p; p = p.parentNode) if (match(p, parts.join(' '))) return true;
      return false;
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const simple = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(simple)?.[0], id = /#([\w-]+)/.exec(simple)?.[1];
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
      && [...simple.matchAll(/\.([\w-]+)/g)].every(m => el.className.split(/\s+/).includes(m[1]))
      && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', value: '', text: '' }); }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children.forEach(c => c.parentNode = null); this.children = []; this.text = String(v); }
    set innerHTML(v) { this.textContent = ''; for (const n of parseFragment(String(v)).childNodes) this.appendChild(fromNode(n)); }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    querySelectorAll(s) { return all(this).filter(el => match(el, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
    contains(el) { return this === el || all(this).includes(el); }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type, extra = {}) {
      const event = { type, target: this, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      for (let el = this; el; el = el.parentNode) {
        for (const fn of el.listeners[type] || []) fn.call(el, event);
        if (event.stopped) break;
      }
      return event;
    }
    focus() { document.activeElement = this; }
    click() { this.focus(); this.dispatch('click'); if (this.tagName === 'SUMMARY') this.parentNode.open = !this.parentNode.open; }
  }
  function fromNode(n) {
    const el = new Element(n.tagName || n.nodeName);
    if (n.nodeName === '#text') el.text = n.value;
    for (const a of n.attrs || []) el.setAttribute(a.name, a.value);
    for (const c of n.childNodes || []) if (c.nodeName !== '#comment') el.appendChild(fromNode(c));
    return el;
  }
  document = new Element('#document');
  document.documentElement = document.appendChild(new Element('html'));
  document.documentElement.lang = lang;
  document.body = document.documentElement.appendChild(new Element('body'));
  document.activeElement = document.body;
  const widget = document.body.appendChild(new Element('section')); widget.className = 'tool-widget'; widget.innerHTML = renderMarkup(lang);
  // Astro scopes static elements only; later innerHTML children receive no attribute.
  for (const el of all(widget)) if (!el.tagName.startsWith('#')) el.setAttribute(scopeAttribute, '');
  document.getElementById = id => all(document).find(el => el.id === id) ?? null;
  const { tips: _tips, ...client } = new Function('return ' + stringsMatch[1])()[lang];
  const globals = { document, S: client, _slug: 'cron-parser', ztPersist: { clear(slug) { persistCalls.push(slug); } }, trackTool(...args) { tracks.push(args); } };
  globals.window = globals;
  const context = vm.createContext(globals);
  if (order === 'shared-before') vm.runInContext(shortcut, context, { filename: 'ToolLayout.astro:keyboard' });
  vm.runInContext(pageScript, context, { filename: 'CronParserTool.astro:actual-IIFE' });
  if (order === 'shared-after') vm.runInContext(shortcut, context, { filename: 'ToolLayout.astro:keyboard' });
  const get = id => document.getElementById(id);
  return { document, tracks, persistCalls, get,
    input(value) { get('cron-input').value = value; get('cron-input').dispatch('input'); },
    key(id, key, mod) { const el = get(id); el.focus(); return el.dispatch('keydown', { key, ...(mod ? { [mod]: true } : {}) }); },
  };
}
const S = new Function('return ' + stringsMatch[1])();
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const order of ['shared-before', 'shared-after']) {
  const p = page(lang, order), tag = lang + '/' + order;
  const input = p.get('cron-input'), result = p.get('cron-results'), status = p.get('cron-status');
  eq(tag + '/default input', input.value, '0 9 * * 1-5');
  eq(tag + '/initial result', [result.querySelectorAll('.cron-field-row').length, result.querySelectorAll('.cron-next-list li').length, status.textContent], [5, 10, S[lang].valid]);
  const old = result.textContent;
  p.input('* * * * *'); eq(tag + '/input remains manual', result.textContent, old);
  let n = p.tracks.length; p.get('cron-parse').click();
  eq(tag + '/Parse once', p.tracks.length - n, 1);
  eq(tag + '/real minute result', result.querySelector('.cron-field-expr').textContent, '*');
  for (const mod of [null, 'ctrlKey', 'metaKey']) {
    n = p.tracks.length; p.key('cron-input', 'Enter', mod);
    eq(tag + '/' + (mod || 'plain') + ' Enter once', p.tracks.length - n, 1);
  }
  for (const [key, mod, focus, value] of [['l', 'ctrlKey', 'cron-parse', '* * * * *'], ['L', 'metaKey', 'cron-input', 'invalid']]) {
    p.input(value); p.get('cron-parse').click();
    eq(tag + '/' + key + '/pre-clear state', status.textContent, value === 'invalid' ? S[lang].errFields.replace('{n}', '1') : S[lang].valid);
    n = p.persistCalls.length; const event = p.key(focus, key, mod);
    eq(tag + '/' + key + '/clears input, results and status', [input.value, result.textContent, status.textContent, status.className], ['', '', '', 'cron-status']);
    eq(tag + '/' + key + '/stable input focus', p.document.activeElement.id, 'cron-input');
    eq(tag + '/' + key + '/shared persistence still executes once', p.persistCalls.slice(n), ['cron-parser']);
    check(tag + '/' + key + '/default prevented', event.defaultPrevented);
  }
  p.input('0 9 * * 1-5'); p.get('cron-parse').click();
  eq(tag + '/recovery', [status.textContent, result.querySelectorAll('.cron-next-list li').length], [S[lang].valid, 10]);
  const snapshot = [input.value, result.textContent, status.textContent, p.persistCalls.length];
  p.document.body.focus(); p.document.body.dispatch('keydown', { key: 'l', ctrlKey: true });
  eq(tag + '/outside focus untouched', [input.value, result.textContent, status.textContent, p.persistCalls.length], snapshot);
}
{
  const p = page('en', 'shared-after');
  const presets = p.document.querySelectorAll('.btn-preset');
  eq('eight unchanged preset expressions', presets.map(el => el.getAttribute('data-expr')), ['* * * * *', '0 * * * *', '0 0 * * *', '0 9 * * 1-5', '0 0 * * 0', '0 0 1 * *', '*/5 * * * *', '0 0 1 1 *']);
  p.document.querySelector('#cron-preset-details summary').click();
  for (const preset of presets) {
    const n = p.tracks.length; preset.click();
    eq('preset applies and parses once ' + preset.getAttribute('data-expr'), [p.get('cron-input').value, p.tracks.length - n, p.get('cron-results').querySelectorAll('.cron-next-list li').length], [preset.getAttribute('data-expr'), 1, 10]);
  }
  // Use the actual compiled base selector against real generated nodes, including static scope.
  for (const name of ['cron-human', 'cron-breakdown', 'cron-field-row', 'cron-field-name', 'cron-field-expr', 'cron-field-vals', 'cron-next-label', 'cron-next-list']) {
    const selector = css.match(new RegExp('(?:\\.cron-results\\[data-astro-cid-[^\\]]+\\]\\s+)?\\.' + name + '(?:\\[data-astro-cid-[^\\]]+\\])?\\s*\\{'))?.[0].replace(/\s*\{$/, '');
    const result = p.get('cron-results'), nodes = result.querySelectorAll('.' + name);
    check('actual dynamic nodes exist ' + name, nodes.length > 0);
    check('compiled CSS matches every actual ' + name, !!selector && result.querySelectorAll(selector).length === nodes.length, selector);
  }
  check('system-dark human rule leaves root global', /:root:not\(\[data-theme="light"\]\)\s+\.cron-results\[data-astro-cid-[^\]]+\]\s+\.cron-human\s*\{border-color:#4b5e8a/.test(css));
  check('explicit-dark human rule leaves theme ancestor global', /\[data-theme="dark"\]\s+\.cron-results\[data-astro-cid-[^\]]+\]\s+\.cron-human\s*\{border-color:#4b5e8a/.test(css));
}
const protectedEngine = source.match(/^      \/\* ── engine:start ── \*\/[\s\S]*?^      \/\* ── engine:end ── \*\//m)?.[0];
eq('engine protected bytes including indentation', Buffer.byteLength(protectedEngine || ''), 8802);
eq('engine protected SHA-256', createHash('sha256').update(protectedEngine || '').digest('hex'), 'd0c0eaca9f016e86b2737818d45781d96ecd3a7fd97f461f207152ad7710b9c8');


// ---------- v2 page layout ----------
const hash = value => createHash('sha256').update(value).digest('hex');
const oldKeys = ["cronExpr", "parse", "fMinute", "fHour", "fDay", "fMonth", "fWeekday", "presets", "pEveryMinute", "pEveryHour", "pDailyMidnight", "pWeekdays9am", "pWeeklySunday", "pMonthly1st", "pEvery5min", "pYearlyJan1", "errEmpty", "errFields", "errInvalid", "errStep", "errUnsupported", "valid", "nextRuns", "noRuns"];
const oldStringHashes = {
  "en": "4089aee86c5f8f9f2a8516ad6966d7ff38fc3c50e7ce09af6f021b116ac5c22a",
  "zh": "d87d65c1e6e0abede36e44dfb2e84b12e9db64823a5e388f3abcf5deb11ff971",
  "ja": "6d68c536f1b01f71160a57d71eecf42b272a3817b0303669a61f1067952f7fb3",
  "ko": "4db98115d82ba54b470bf10bde2d6254117c94afbd891947cc261f2cc42b1888"
};
const tipKeys = ['input', 'parse', 'presets', 'explanation', 'fields', 'runs'];
const bindings = [...markupTemplate.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 six unique literal tip IDs', bindings.map(m => m[1]), tipKeys.map(k => 'cron-tip-' + k));
eq('v2 tip bindings follow reading order', bindings.map(m => m[3]), tipKeys);
check('v2 direct analyze root', /^<div class="cron-wrap">/.test(markupTemplate));
check('v2 no runtime i18n attributes or lookup', !/data-i18n|document\.documentElement\.lang/.test(source));
check('v2 client vars exclude tips', /define:vars=\{\{ S: CLIENT_T \}\}/.test(source) && !/TIPS|tips|STRINGS/.test(pageScript));
check('v2 control/status/result order', markupTemplate.indexOf('cron-preset-details') < markupTemplate.indexOf('id="cron-status"') && markupTemplate.indexOf('id="cron-status"') < markupTemplate.indexOf('class="cron-result-section"'));
check('v2 root has zero min-height', /\.cron-wrap\s*\{[^}]*min-height:\s*0/.test(source));
check('v2 result section grows with viewport', /\.cron-result-section\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0/.test(source));
check('v2 result scroll has zero flex basis', /\.cron-results\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*auto/.test(source));
check('v2 status reserves height with internal overflow', /\.cron-status\s*\{[^}]*height:\s*2\.8em[^}]*overflow:\s*auto/.test(source));
check('v2 stacked result is bounded and empty section hidden', /@media \(max-width: 860px\)\s*\{\s*\.cron-result-section\s*\{[^}]*height:\s*26rem/.test(source) && /\.cron-result-section:has\(#cron-results:empty\)\s*\{\s*display:\s*none/.test(source));
check('v2 phone input and main action at least 44px', /\.cron-input-group input, #cron-parse\s*\{\s*min-height:\s*44px/.test(source));
check('v2 dense preset and summary targets at least 24px', /\.btn-preset\s*\{\s*min-height:\s*28px/.test(source) && /\.cron-preset-details summary\s*\{[^}]*min-height:\s*28px/.test(source));
check('v2 presets have bounded scrolling', /\.cron-presets\s*\{[^}]*max-height:\s*8rem[^}]*overflow:\s*auto/.test(source));
for (const name of ['cron-status', 'btn-preset']) {
  check('v2 system dark ancestor matches html for ' + name, new RegExp(':root:not\\(\\[data-theme="light"\\]\\)\\s+\\.' + name).test(css));
  check('v2 explicit dark ancestor matches html for ' + name, new RegExp('\\[data-theme="dark"\\]\\s+\\.' + name).test(css));
}
const frontmatter = source.split('---')[1];
const getLocale = new Function('lang', frontmatter.slice(frontmatter.indexOf('const STRINGS')) + '\nreturn { T, TIPS, CLIENT_T };');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const { T, TIPS, CLIENT_T } = getLocale(lang);
  eq('v2 ' + lang + ' old labels unchanged', hash(JSON.stringify(Object.fromEntries(oldKeys.map(key => [key, T[key]])))), oldStringHashes[lang]);
  eq('v2 ' + lang + ' tip keys', Object.keys(TIPS), tipKeys);
  check('v2 ' + lang + ' serialized client has no tip text', !('tips' in CLIENT_T) && Object.values(TIPS).every(text => !JSON.stringify(CLIENT_T).includes(text)));
  check('v2 ' + lang + ' tips are plain sentences', Object.values(TIPS).every(text => typeof text === 'string' && text.trim() && !/[<>\n]|https?:/.test(text)));
  const p = page(lang, 'shared-after'), doc = p.document;
  eq('v2 ' + lang + ' native presets initially closed', doc.querySelector('#cron-preset-details').getAttribute('open'), null);
  doc.querySelector('#cron-preset-details summary').click();
  check('v2 ' + lang + ' summary opens presets', doc.querySelector('#cron-preset-details').open);
  eq('v2 ' + lang + ' localized main action', p.get('cron-parse').textContent, T.parse);
  eq('v2 ' + lang + ' localized empty hint', p.get('cron-empty').textContent, T.emptyResult);
  eq('v2 ' + lang + ' results have accessible region name', [p.get('cron-results').getAttribute('tabindex'), p.get('cron-results').getAttribute('role'), p.get('cron-results').getAttribute('aria-label')], ['0', 'region', T.results]);
  eq('v2 ' + lang + ' only existing actions', doc.querySelectorAll('button').filter(el => el.getAttribute('data-zt-tip') === null).length, 9);
  for (const [, id, aboutKey, textKey] of bindings) {
    eq('v2 ' + lang + ' literal body ' + id, p.get(id).textContent, TIPS[textKey]);
    check('v2 ' + lang + ' localized about ' + id, typeof T[aboutKey] === 'string' && T[aboutKey].length > 0);
  }
  const content = readFileSync(join(root, 'src/content/tools/cron-parser', lang + '.mdx'), 'utf8');
  const data = require('js-yaml').load(content.match(/^---\n([\s\S]*?)\n---/)[1]);
  eq('v2 ' + lang + ' six steps', data.steps.length, 6);
  check('v2 ' + lang + ' steps bounded', data.steps.every(text => text.length <= 280 && !/[<>\n]/.test(text)) && data.steps.join('').length <= 1200);
  check('v2 ' + lang + ' steps before FAQ', content.indexOf('steps:') < content.indexOf('faqItems:'));
  check('v2 ' + lang + ' steps use current Parse label and actual first-12 limit', data.steps.some(text => text.includes(T.parse)) && data.steps.some(text => text.includes('12')));
  eq('v2 ' + lang + ' MDX content contract', contractProblems('cron-parser', lang), '');
  for (const order of ['shared-before', 'shared-after']) {
    const q = page(lang, order), tip = q.document.querySelector('[data-zt-tip="cron-tip-fields"]');
    tip.focus(); tip.dispatch('keydown', { key: 'l', ctrlKey: true });
    eq('v2 ' + lang + '/' + order + ' result-tip clear keeps shared focus', [q.document.activeElement.id, q.get('cron-results').textContent, q.get('cron-status').textContent, q.persistCalls], ['cron-input', '', '', ['cron-parser']]);
  }
}
// Bound the pane, not the result algorithm: run a long real expression and verify unchanged output.
{
  const p = page('en', 'shared-after');
  const expr = Array.from({ length: 300 }, () => '0,15,30,45').join(',') + ' * * * *';
  p.input(expr); p.get('cron-parse').click();
  eq('v2 long valid expression remains complete', p.get('cron-results').querySelector('.cron-field-expr').textContent, expr.split(' ')[0]);
  eq('v2 real field values still first twelve', p.get('cron-results').querySelector('.cron-field-vals').textContent, '0, 15, 30, 45');
  eq('v2 long expression still returns ten runs', p.get('cron-results').querySelectorAll('.cron-next-list li').length, 10);
  p.input('0 0 * * 7'); p.get('cron-parse').click();
  eq('v2 weekday seven remains numeric in the real breakdown', p.get('cron-results').querySelectorAll('.cron-field-vals')[4].textContent, '7');
}
eq('v2 full engine, rendering and FIX event tail unchanged', hash(source.slice(source.indexOf('      /* ── engine:start'), source.indexOf('  </script>'))), '4c72a60dddd96e6897b0474d3529f3bcbc3bdc09df9706006ed955a759288538');
let moduleError = '';
try { await require('esbuild').transform(compiled.code, { loader: 'ts', format: 'esm' }); } catch (error) { moduleError = String(error); }
eq('v2 Astro generated module parses', moduleError, '');
check('v2 registered as analyze', /'cron-parser':\s*'analyze'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));

console.log((failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
